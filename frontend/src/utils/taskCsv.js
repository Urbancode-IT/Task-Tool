/**
 * Bulk task import from CSV (Excel and Google Sheets both save as CSV).
 *
 * Columns, matched by header name in any order and case. The template lists them in
 * the order a task row shows them:
 *   Title (required) · Project · Status · Due date · Priority · Assignee · Assigned by
 *   · Start date · Description
 * Dates may be yyyy-mm-dd, dd-mm-yyyy or dd/mm/yyyy. Status and priority accept the
 * stored key or the label shown in Seyal ("In Progress" or "in_progress"). Title, Assignee
 * and Assigned by are required; people are matched by email or username, and "Me" (or
 * the importer's own email / username) means the person importing.
 */

export const MAX_IMPORT_ROWS = 200;

const HEADER_ALIASES = {
  title: ['title', 'task', 'task title', 'task name', 'name', 'summary'],
  description: ['description', 'details', 'task description', 'notes'],
  status: ['status', 'state'],
  priority: ['priority'],
  task_date: ['start date', 'start', 'task date', 'date'],
  due_date: ['due date', 'due', 'deadline', 'end date'],
  project: ['project', 'project name'],
  assignee: ['assignee', 'assigned to', 'assign to', 'owner'],
  assigned_by: ['assigned by', 'assigner', 'reporter'],
};

const PRIORITIES = ['low', 'medium', 'high', 'critical'];

/** RFC 4180 CSV parse: quoted fields, escaped quotes, commas and newlines inside quotes. */
export function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;
  const src = String(text || '').replace(/^\uFEFF/, '');
  for (let i = 0; i < src.length; i += 1) {
    const ch = src[i];
    if (quoted) {
      if (ch === '"' && src[i + 1] === '"') {
        field += '"';
        i += 1;
      } else if (ch === '"') {
        quoted = false;
      } else {
        field += ch;
      }
    } else if (ch === '"') {
      quoted = true;
    } else if (ch === ',') {
      row.push(field);
      field = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && src[i + 1] === '\n') i += 1;
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else {
      field += ch;
    }
  }
  if (field !== '' || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((r) => r.some((c) => String(c).trim() !== ''));
}

const norm = (s) => String(s || '').trim().toLowerCase().replace(/[_\s]+/g, ' ');

function toYmd(raw) {
  const s = String(raw || '').trim();
  if (!s) return { value: null };
  let m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(s);
  let y;
  let mo;
  let d;
  if (m) [, y, mo, d] = m;
  else {
    m = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})$/.exec(s);
    if (!m) return { error: `"${s}" is not a date (use yyyy-mm-dd or dd-mm-yyyy)` };
    [, d, mo, y] = m;
  }
  const date = new Date(Number(y), Number(mo) - 1, Number(d));
  if (date.getFullYear() !== Number(y) || date.getMonth() !== Number(mo) - 1 || date.getDate() !== Number(d)) {
    return { error: `"${s}" is not a real date` };
  }
  return { value: `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}` };
}

/**
 * Turn CSV text into import rows. Returns { rows, error } where each row is
 * { line, data, errors: [string] } — `data` is the API payload for a valid row.
 *   statuses / statusLabel — the module's statuses (first is the default)
 *   projects — optional list; when given, the Project column is matched by name
 *   assignees / assigners — admins only: people the Assignee / Assigned by columns may
 *                 name. Without them, those columns may only name the importer.
 *   currentUser — the importer; "Me" or their own email / username means them
 * Title, Assignee and Assigned by are required on every row.
 * Each row also carries `show` — the project and people names, for the preview.
 */
export function readTaskCsv(
  text,
  {
    statuses = [],
    statusLabel = (k) => k,
    projects = null,
    assignees = null,
    assigners = null,
    currentUser = null,
  } = {}
) {
  const grid = parseCsv(text);
  if (!grid.length) return { rows: [], error: 'The file is empty.' };

  const header = grid[0].map(norm);
  const col = {};
  for (const [key, aliases] of Object.entries(HEADER_ALIASES)) {
    const idx = header.findIndex((h) => aliases.includes(h));
    if (idx >= 0) col[key] = idx;
  }
  const missing = [
    ['title', 'Title'],
    ['assignee', 'Assignee'],
    ['assigned_by', 'Assigned by'],
  ]
    .filter(([key]) => col[key] == null)
    .map(([, name]) => `"${name}"`);
  if (missing.length) {
    return {
      rows: [],
      error: `Required column${missing.length > 1 ? 's' : ''} ${missing.join(', ')} not found. Download the template to see the expected columns.`,
    };
  }
  const body = grid.slice(1);
  if (!body.length) return { rows: [], error: 'The file has a header row but no tasks.' };
  if (body.length > MAX_IMPORT_ROWS) {
    return { rows: [], error: `The file has ${body.length} tasks; import at most ${MAX_IMPORT_ROWS} at a time.` };
  }

  const statusByText = new Map();
  statuses.forEach((s) => {
    statusByText.set(norm(s), s);
    statusByText.set(norm(statusLabel(s)), s);
  });
  const projectByName = new Map(
    (projects || []).map((p) => [norm(p.name || p.project_name), p.project_id ?? p.id])
  );
  const cell = (r, key) => (col[key] != null ? String(r[col[key]] ?? '').trim() : '');

  // People by lower-case email and username. Returns { id, name } — id null means "me".
  const peopleIndex = (list) => {
    const m = new Map();
    (list || []).forEach((u) => {
      const id = u.user_id ?? u.id;
      const name = u.username || u.name || u.email;
      [u.email, u.username, u.name].filter(Boolean).forEach((k) => m.set(norm(k), { id, name }));
    });
    return m;
  };
  const assigneeIndex = peopleIndex(assignees);
  const assignerIndex = peopleIndex(assigners);
  // "Me", or the importer's own email / username, means the importer.
  const myKeys = new Set(
    ['me', currentUser?.email, currentUser?.username, currentUser?.name].filter(Boolean).map(norm)
  );
  const resolvePerson = (text, list, index, label, errors) => {
    if (!text) {
      errors.push(`${label} is required (write "Me" for yourself)`);
      return { id: null, name: '—' };
    }
    if (myKeys.has(norm(text))) return { id: null, name: 'Me' };
    if (!list) {
      errors.push(`${label}: only admins can assign tasks to someone else (write "Me")`);
      return { id: null, name: text };
    }
    const hit = index.get(norm(text));
    if (!hit) errors.push(`${label}: no team member "${text}"`);
    return hit || { id: null, name: text };
  };

  const rows = body.map((r, i) => {
    const errors = [];
    const title = cell(r, 'title');
    if (!title) errors.push('Title is empty');
    else if (title.length > 500) errors.push('Title is longer than 500 characters');

    const statusText = cell(r, 'status');
    const status = statusText ? statusByText.get(norm(statusText)) : statuses[0] || 'todo';
    if (!status) errors.push(`Unknown status "${statusText}"`);

    const priorityText = norm(cell(r, 'priority'));
    const priority = priorityText || 'medium';
    if (!PRIORITIES.includes(priority)) errors.push(`Unknown priority "${cell(r, 'priority')}"`);

    const start = toYmd(cell(r, 'task_date'));
    const due = toYmd(cell(r, 'due_date'));
    if (start.error) errors.push(`Start date: ${start.error}`);
    if (due.error) errors.push(`Due date: ${due.error}`);
    if (start.value && due.value && due.value < start.value) errors.push('Due date is before the start date');

    let projectId = null;
    const projectText = cell(r, 'project');
    if (projectText) {
      if (!projects) errors.push('Projects cannot be set in this module');
      else {
        projectId = projectByName.get(norm(projectText)) ?? null;
        if (projectId == null) errors.push(`Unknown project "${projectText}"`);
      }
    }

    const assignee = resolvePerson(cell(r, 'assignee'), assignees, assigneeIndex, 'Assignee', errors);
    const assigner = resolvePerson(cell(r, 'assigned_by'), assigners, assignerIndex, 'Assigned by', errors);

    return {
      line: i + 2,
      errors,
      show: { project: projectText, assignee: assignee.name, assigner: assigner.name },
      data: {
        title,
        task_description: cell(r, 'description') || null,
        status,
        priority,
        task_date: start.value || undefined,
        dueDate: due.value,
        projectId,
        ...(assignee.id != null ? { assigned_to: assignee.id } : {}),
        ...(assigner.id != null ? { assigned_by: assigner.id } : {}),
      },
    };
  });
  return { rows, error: null };
}

/**
 * A ready-to-fill CSV template with one example row. Columns follow a task row on
 * screen — Title, Project, Status, Due date, Priority, Assignee — then the extras.
 * Project appears only where the module has projects.
 */
export function taskCsvTemplate({ withProject = false, statusExample = 'To Do' } = {}) {
  const cols = [
    ['Title', 'Prepare client report'],
    ...(withProject ? [['Project', '']] : []),
    ['Status', statusExample],
    ['Due date', ''],
    ['Priority', 'Medium'],
    ['Assignee', 'Me'],
    ['Assigned by', 'Me'],
    ['Start date', ''],
    ['Description', 'Monthly summary for review'],
  ];
  const head = cols.map(([h]) => h).join(',');
  const example = cols.map(([, v]) => `"${v}"`).join(',');
  return `${head}\r\n${example}\r\n`;
}
