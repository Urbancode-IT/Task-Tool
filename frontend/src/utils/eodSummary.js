/**
 * Turns the day's task activity (GET /eod-summary) into a ready-to-edit EOD summary:
 * plain text for the textarea forms, HTML for the rich editor. Sections with nothing
 * in them are left out; open tasks already listed above are not repeated.
 */
import itUpdatesApi from '../api/itUpdatesApi';

const pad = (n) => String(n).padStart(2, '0');

/** Today's date (yyyy-mm-dd) in the browser's local time — the EOD form's default. */
export const localToday = () => {
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};

const fmtDay = (ymd) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(ymd || '');
  if (!m) return '';
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])).toLocaleDateString(undefined, {
    day: 'numeric',
    month: 'short',
  });
};

const statusText = (s) => String(s || '').replace(/_/g, ' ');

/**
 * Section list: [{ heading, groups: [{ project, items: [string] }] }]. Within a
 * section, tasks are grouped under their project name (A–Z); tasks with no project
 * come last, under "Other tasks".
 */
export function buildEodSections(summary, reportDate) {
  if (!summary) return [];
  const listed = new Set();
  const sections = [];

  // Each task appears once, under the first heading that applies: Completed, then
  // Worked on, then New tasks created, then Still open.
  const fresh = (list) => (list || []).filter((t) => !listed.has(String(t.task_id)));

  const addSection = (heading, tasks, line) => {
    if (!tasks.length) return;
    const byProject = new Map();
    for (const t of tasks) {
      listed.add(String(t.task_id));
      const project = (t.project_name || '').trim();
      if (!byProject.has(project)) byProject.set(project, []);
      byProject.get(project).push(line(t));
    }
    const groups = [...byProject.entries()]
      .sort(([a], [b]) => (!a ? 1 : !b ? -1 : a.localeCompare(b)))
      .map(([project, items]) => ({ project, items }));
    sections.push({ heading, groups });
  };

  // No durations in the EOD — only what was done. Completed tasks list the subtasks
  // worked on that day, when there were any.
  const workedToday = new Map((summary.worked || []).map((t) => [String(t.task_id), t]));
  const withSubtasks = (title, subtasks) => (subtasks?.length ? `${title} (${subtasks.join(', ')})` : title);

  addSection('Completed', fresh(summary.completed), (t) =>
    withSubtasks(t.task_title, workedToday.get(String(t.task_id))?.subtasks)
  );
  addSection('Worked on', fresh(summary.worked), (t) => withSubtasks(t.task_title, t.subtasks));
  addSection('New tasks created', fresh(summary.created), (t) => t.task_title);
  addSection('Still open', fresh(summary.open), (t) => {
    const overdue = t.due_date && reportDate && t.due_date < reportDate;
    const due = t.due_date ? ` — due ${fmtDay(t.due_date)}${overdue ? ' (overdue)' : ''}` : '';
    return `${t.task_title} — ${statusText(t.status)}${due}`;
  });

  return sections;
}

// A section in which no task has a project stays a plain list, without an "Other tasks" label.
const groupLabel = (section, group) => group.project || (section.groups.length > 1 ? 'Other tasks' : '');

export const sectionsToText = (sections) =>
  sections
    .map((s) => {
      const body = s.groups
        .map((g) => {
          const label = groupLabel(s, g);
          const items = g.items.map((i) => `• ${i}`).join('\n');
          return label ? `${label}:\n${items}` : items;
        })
        .join('\n');
      return `${s.heading}\n${body}`;
    })
    .join('\n\n');

const esc = (v) =>
  String(v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

export const sectionsToHtml = (sections) =>
  sections
    .map((s) => {
      const body = s.groups
        .map((g) => {
          const label = groupLabel(s, g);
          const items = `<ul>${g.items.map((i) => `<li>${esc(i)}</li>`).join('')}</ul>`;
          return label ? `<p><u>${esc(label)}:</u></p>${items}` : items;
        })
        .join('');
      return `<p><b>${esc(s.heading)}</b></p>${body}`;
    })
    .join('');

/** Fetch and build the sections for one day; [] when there was no activity. */
export async function loadEodSections(reportDate, team) {
  const { data } = await itUpdatesApi.getEodSummary(reportDate, team);
  return buildEodSections(data, reportDate);
}
