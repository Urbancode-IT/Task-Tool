import pg from 'pg';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '..', '.env') });

const toNullableDate = (val) => (val === '' || val === undefined ? null : val);
const toNullableInt = (val) => {
  if (val === '' || val === undefined || val === null) return null;
  const n = Number(val);
  return Number.isFinite(n) ? Math.trunc(n) : null;
};
const normalizeTeammatesInput = (val) => {
  if (Array.isArray(val)) {
    return [...new Set(val.map((v) => String(v || '').trim()).filter(Boolean))];
  }
  if (typeof val === 'string') {
    return [...new Set(val.split(',').map((v) => v.trim()).filter(Boolean))];
  }
  return [];
};
const teammatesToText = (val) => normalizeTeammatesInput(val).join(', ');
const teammatesFromText = (val) => normalizeTeammatesInput(val);

const { Pool } = pg;

let pool = null;
// Tracks whether Postgres is actually reachable (set by testConnection on startup).
// This avoids "env is set but DB is unreachable" causing hard 401 login failures.
let dbAvailability = null;

function getConnectionString() {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL;
  const user = process.env.DB_USER;
  const password = process.env.DB_PASSWORD;
  const host = process.env.DB_HOST || 'localhost';
  const port = process.env.DB_PORT || '5432';
  const database = process.env.DB_DATABASE;
  if (!user || !database) return null;
  const encoded = password ? encodeURIComponent(password) : '';
  return `postgresql://${user}${encoded ? ':' + encoded : ''}@${host}:${port}/${database}`;
}

export function getPool() {
  if (!pool) {
    const connectionString = getConnectionString();
    if (connectionString) {
      pool = new Pool({
        connectionString,
        ssl: process.env.DATABASE_SSL === 'true' ? { rejectUnauthorized: false } : false,
      });
    }
  }
  return pool;
}

export function useDb() {
  if (dbAvailability !== null) return dbAvailability;
  return Boolean(getConnectionString());
}

/** Find user by email or username (for login). Returns row or null. */
export async function dbFindUserByEmailOrUsername(emailOrUsername) {
  const p = getPool();
  if (!p) return null;
  const input = String(emailOrUsername || '').replace(/\s+/g, ' ').trim();
  if (!input) return null;
  try {
    const { rows } = await p.query(
      `SELECT user_id, username, email, password_hash, profile_image, is_it_developer, is_it_manager
       FROM users
       WHERE LOWER(TRIM(email)) = LOWER($1)
          OR LOWER(REGEXP_REPLACE(TRIM(username), '\\s+', ' ', 'g')) = LOWER($1)
       LIMIT 1`,
      [input]
    );
    return rows[0] || null;
  } catch (err) {
    console.error('dbFindUserByEmailOrUsername:', err.message);
    return null;
  }
}

/** Get user by id (for permission resolution when RBAC tables missing). */
export async function dbGetUserById(userId) {
  const p = getPool();
  if (!p) return null;
  const id = parseInt(String(userId), 10);
  if (!Number.isFinite(id)) return null;
  try {
    const { rows } = await p.query(
      'SELECT user_id, username, email, is_it_developer, is_it_manager FROM users WHERE user_id = $1',
      [id]
    );
    const row = rows[0];
    if (!row) return null;
    return {
      ...row,
      is_it_developer: row.is_it_developer === true || row.is_it_developer === 1,
      is_it_manager: row.is_it_manager === true || row.is_it_manager === 1,
    };
  } catch (err) {
    console.error('dbGetUserById:', err.message);
    return null;
  }
}

/** Get permissions for a user. Uses RBAC tables if present; merges with legacy is_it_developer/is_it_manager so IT staff always have it_updates access. */
export async function dbGetUserPermissionsOrLegacy(userId) {
  let perms = [];
  try {
    perms = await dbGetUserPermissions(userId);
  } catch (_) {}
  const user = await dbGetUserById(userId);
  const legacy = [];
  if (user?.is_it_developer || user?.is_it_manager) {
    legacy.push('it_updates.view', 'it_updates.manage', 'it_updates.users');
  }
  const combined = [...new Set([...(Array.isArray(perms) ? perms : []), ...legacy])];
  return combined.length > 0 ? combined : legacy;
}

/** List all users (safe fields only). */
export async function dbGetUsers() {
  const p = getPool();
  if (!p) return [];
  try {
    const { rows } = await p.query(
      `SELECT user_id, username, email, is_it_developer, is_it_manager, created_at
       FROM users
       ORDER BY username`
    );
    return rows;
  } catch (err) {
    console.error('dbGetUsers:', err.message);
    return [];
  }
}

/** Create a user. Returns created row (without password_hash) or null. */
export async function dbCreateUser({ username, email, password_hash, is_it_developer, is_it_manager }) {
  const p = getPool();
  if (!p) return null;
  const emailVal = email && String(email).trim() ? String(email).trim() : null;
  try {
    const { rows } = await p.query(
      `INSERT INTO users (username, email, password_hash, is_it_developer, is_it_manager)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING user_id, username, email, is_it_developer, is_it_manager, created_at`,
      [
        String(username || '').trim(),
        emailVal,
        password_hash,
        Boolean(is_it_developer),
        Boolean(is_it_manager),
      ]
    );
    return rows[0] || null;
  } catch (err) {
    console.error('dbCreateUser:', err.message);
    return null;
  }
}

/** Update a user. password_hash optional. Returns updated row or null. */
export async function dbUpdateUser(userId, { username, email, password_hash, is_it_developer, is_it_manager }) {
  const p = getPool();
  if (!p) return null;
  const id = parseInt(userId, 10);
  if (!Number.isFinite(id)) return null;
  try {
    const updates = [];
    const values = [];
    let i = 1;
    if (username !== undefined) {
      updates.push(`username = $${i++}`);
      values.push(String(username || '').trim());
    }
    if (email !== undefined) {
      updates.push(`email = $${i++}`);
      values.push(email && String(email).trim() ? String(email).trim() : null);
    }
    if (password_hash !== undefined && password_hash !== null) {
      updates.push(`password_hash = $${i++}`);
      values.push(password_hash);
    }
    if (is_it_developer !== undefined) {
      updates.push(`is_it_developer = $${i++}`);
      values.push(Boolean(is_it_developer));
    }
    if (is_it_manager !== undefined) {
      updates.push(`is_it_manager = $${i++}`);
      values.push(Boolean(is_it_manager));
    }
    if (updates.length === 0) {
      const { rows } = await p.query(
        `SELECT user_id, username, email, is_it_developer, is_it_manager, created_at FROM users WHERE user_id = $1`,
        [id]
      );
      return rows[0] || null;
    }
    values.push(id);
    const { rows } = await p.query(
      `UPDATE users SET ${updates.join(', ')} WHERE user_id = $${i} RETURNING user_id, username, email, is_it_developer, is_it_manager, created_at`,
      values
    );
    return rows[0] || null;
  } catch (err) {
    console.error('dbUpdateUser:', err.message);
    return null;
  }
}

/** Delete a user. Returns true if deleted. */
export async function dbDeleteUser(userId) {
  const p = getPool();
  if (!p) return false;
  const id = parseInt(userId, 10);
  if (!Number.isFinite(id)) return false;
  try {
    const { rowCount } = await p.query('DELETE FROM users WHERE user_id = $1', [id]);
    return rowCount > 0;
  } catch (err) {
    console.error('dbDeleteUser:', err.message);
    return false;
  }
}

/** Auto-create tables if missing. */
export async function dbEnsureTables() {
  const p = getPool();
  if (!p) return;

  // Keep project fields in sync for ownership + teammates.
  try {
    await p.query(`
      ALTER TABLE it_projects
      ADD COLUMN IF NOT EXISTS owner_user_id INT,
      ADD COLUMN IF NOT EXISTS owner_name VARCHAR(200),
      ADD COLUMN IF NOT EXISTS teammates TEXT,
      ADD COLUMN IF NOT EXISTS project_url TEXT;
    `);
  } catch (err) {
    console.warn('dbEnsureTables: project ownership columns check failed:', err.message);
  }

  const taskTablesForReview = ['it_tasks', 'consultant_tasks', 'digital_marketing_tasks'];
  for (const tbl of taskTablesForReview) {
    try {
      const { rows } = await p.query(
        "SELECT EXISTS (SELECT FROM information_schema.tables WHERE table_schema = 'public' AND table_name = $1)",
        [tbl]
      );
      if (!rows[0]?.exists) continue;
      await p.query(`
        ALTER TABLE ${tbl}
        ADD COLUMN IF NOT EXISTS reviewed_by INT REFERENCES users(user_id),
        ADD COLUMN IF NOT EXISTS review_comment TEXT,
        ADD COLUMN IF NOT EXISTS reviewed_at TIMESTAMPTZ;
      `);
    } catch (err) {
      console.warn(`dbEnsureTables: ${tbl} review columns:`, err.message);
    }
  }

  // If base tables aren't present yet (e.g. `it_tasks`), creating a FK table will fail.
  // This is a symptom that `schema.sql` / migrations weren't applied to the DB.
  let hasItTasks = false;
  try {
    const { rows } = await p.query(
      "SELECT to_regclass('public.it_tasks') AS it_tasks_regclass;"
    );
    hasItTasks = Boolean(rows?.[0]?.it_tasks_regclass);
  } catch (err) {
    console.warn('dbEnsureTables: table existence check failed:', err.message);
  }

  if (!hasItTasks) {
    console.warn('dbEnsureTables: skipping it_task_requirements because it_tasks does not exist yet');
    return;
  }

  const sql = `
    CREATE TABLE IF NOT EXISTS it_task_requirements (
      requirement_id SERIAL PRIMARY KEY,
      task_id        INT NOT NULL REFERENCES it_tasks(task_id) ON DELETE CASCADE,
      title          VARCHAR(500) NOT NULL,
      description    TEXT,
      status         VARCHAR(20) DEFAULT 'pending',
      priority       VARCHAR(20) DEFAULT 'medium',
      due_date       DATE,
      sort_order     INT DEFAULT 0,
      created_at     TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at     TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS idx_task_requirements_task_id ON it_task_requirements(task_id);
    CREATE INDEX IF NOT EXISTS idx_task_requirements_status ON it_task_requirements(status);
  `;
  try {
    await p.query(sql);
    console.log('DB: it_task_requirements table ensured.');
  } catch (err) {
    console.error('dbEnsureTables ERROR:', err.message);
  }
}

/** Test DB connection on startup. Returns { ok: true } or { ok: false, error: string }. */
export async function testConnection() {
  const p = getPool();
  if (!p) {
    const user = process.env.DB_USER;
    const database = process.env.DB_DATABASE;
    if (!user || !database) {
      dbAvailability = false;
      return { ok: false, error: 'Missing DB_USER or DB_DATABASE in .env' };
    }
    dbAvailability = false;
    return { ok: false, error: 'Could not create pool (check .env)' };
  }
  try {
    const client = await p.connect();
    await client.query('SELECT 1');
    client.release();
    // Also ensure requirements table
    await dbEnsureTables();
    dbAvailability = true;
    return { ok: true };
  } catch (err) {
    dbAvailability = false;
    return { ok: false, error: err.message };
  }
}

// Map DB rows to API shape
export async function dbGetProjects(status = null) {
  const p = getPool();
  if (!p) return [];
  try {
    const query = status
      ? 'SELECT * FROM it_projects WHERE status = $1 ORDER BY project_id'
      : 'SELECT * FROM it_projects ORDER BY project_id';
    const params = status ? [status] : [];
    const { rows } = await p.query(query, params);
    const projectIds = rows.map((r) => r.project_id);
    let progressMap = {};
    let taskCountMap = {};
    if (projectIds.length > 0) {
      try {
        const { rows: taskRows } = await p.query(
          `SELECT project_id, COUNT(*) FILTER (WHERE status = 'completed') AS completed, COUNT(*) AS total
           FROM it_tasks WHERE project_id = ANY($1::int[]) GROUP BY project_id`,
          [projectIds]
        );
        taskRows.forEach((r) => {
          const total = Number(r.total);
          const completed = Number(r.completed);
          progressMap[r.project_id] = total > 0 ? Math.round((completed / total) * 100) : 0;
          taskCountMap[r.project_id] = { total, completed };
        });
      } catch {
        // it_tasks may not exist
      }
    }
    return rows.map((r) => {
      const counts = taskCountMap[r.project_id] || { total: 0, completed: 0 };
      return {
        id: String(r.project_id),
        project_id: r.project_id,
        name: r.project_name,
        project_name: r.project_name,
        project_code: r.project_code,
        project_url: r.project_url || '',
        description: r.description,
        status: r.status,
        priority: r.priority,
        start_date: r.start_date,
        end_date: r.end_date,
        owner: r.owner_name || 'IT Team',
        owner_name: r.owner_name || 'IT Team',
        owner_user_id: r.owner_user_id ?? null,
        teammates: teammatesFromText(r.teammates),
        teammates_text: r.teammates || '',
        progress: progressMap[r.project_id] ?? 0,
        total_tasks: counts.total,
        completed_tasks: counts.completed,
        completion_percentage: progressMap[r.project_id] ?? 0,
      };
    });
  } catch (err) {
    console.error('dbGetProjects:', err.message);
    return [];
  }
}

export async function dbCreateProject(data) {
  const p = getPool();
  if (!p) return null;
  const {
    rows: [row],
  } = await p.query(
    `INSERT INTO it_projects (
      project_name, project_code, project_url, description, status, priority, start_date, end_date, owner_user_id, owner_name, teammates
    )
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
     RETURNING *`,
    [
      data.name ?? data.project_name ?? 'Untitled Project',
      data.project_code ?? null,
      data.project_url ?? null,
      data.description ?? null,
      data.status ?? 'active',
      data.priority ?? 'medium',
      toNullableDate(data.start_date),
      toNullableDate(data.end_date),
      toNullableInt(data.owner_user_id),
      data.owner_name ?? data.owner ?? null,
      teammatesToText(data.teammates ?? data.teammates_text),
    ]
  );
  if (!row) return null;
  return {
    id: String(row.project_id),
    name: row.project_name,
    project_code: row.project_code,
    project_url: row.project_url || '',
    description: row.description,
    status: row.status,
    priority: row.priority,
    start_date: row.start_date,
    end_date: row.end_date,
    owner: row.owner_name || 'IT Team',
    owner_name: row.owner_name || 'IT Team',
    owner_user_id: row.owner_user_id ?? null,
    teammates: teammatesFromText(row.teammates),
    teammates_text: row.teammates || '',
    progress: 0,
  };
}

export async function dbUpdateProject(projectId, data) {
  const p = getPool();
  if (!p) return null;
  const allowed = [
    'project_name',
    'project_code',
    'project_url',
    'description',
    'status',
    'priority',
    'start_date',
    'end_date',
    'owner_user_id',
    'owner_name',
    'teammates',
  ];
  const updates = [];
  const values = [];
  let i = 1;
  for (const [k, v] of Object.entries(data)) {
    let col = k === 'name' ? 'project_name' : k;
    if (col === 'owner') col = 'owner_name';
    if (col === 'teammates_text') col = 'teammates';
    if (allowed.includes(col) && v !== undefined) {
      updates.push(`${col} = $${i}`);
      const val =
        col === 'start_date' || col === 'end_date' || col === 'due_date' || col === 'task_date'
          ? toNullableDate(v)
          : col === 'owner_user_id'
            ? toNullableInt(v)
            : col === 'teammates'
              ? teammatesToText(v)
              : v;
      values.push(val);
      i++;
    }
  }
  if (updates.length === 0) return dbGetProjectById(projectId);
  updates.push(`updated_at = CURRENT_TIMESTAMP`);
  values.push(projectId);
  const { rows } = await p.query(
    `UPDATE it_projects SET ${updates.join(', ')} WHERE project_id = $${i} RETURNING *`,
    values
  );
  const row = rows[0];
  if (!row) return null;
  return {
    id: String(row.project_id),
    name: row.project_name,
    project_code: row.project_code,
    project_url: row.project_url || '',
    description: row.description,
    status: row.status,
    priority: row.priority,
    start_date: row.start_date,
    end_date: row.end_date,
    owner: row.owner_name || 'IT Team',
    owner_name: row.owner_name || 'IT Team',
    owner_user_id: row.owner_user_id ?? null,
    teammates: teammatesFromText(row.teammates),
    teammates_text: row.teammates || '',
    progress: 0,
  };
}

export async function dbGetProjectById(projectId) {
  const p = getPool();
  if (!p) return null;
  const { rows } = await p.query('SELECT * FROM it_projects WHERE project_id = $1', [
    projectId,
  ]);
  const row = rows[0];
  if (!row) return null;
  return {
    id: String(row.project_id),
    name: row.project_name,
    project_code: row.project_code,
    project_url: row.project_url || '',
    description: row.description,
    status: row.status,
    priority: row.priority,
    start_date: row.start_date,
    end_date: row.end_date,
    owner: row.owner_name || 'IT Team',
    owner_name: row.owner_name || 'IT Team',
    owner_user_id: row.owner_user_id ?? null,
    teammates: teammatesFromText(row.teammates),
    teammates_text: row.teammates || '',
    progress: 0,
  };
}

export async function dbDeleteProject(projectId) {
  const p = getPool();
  if (!p) return false;
  const { rowCount } = await p.query('DELETE FROM it_projects WHERE project_id = $1', [
    projectId,
  ]);
  return rowCount > 0;
}

// Tasks: API uses title, assignee, projectId, dueDate
export async function dbGetTasks(filters = {}) {
  const p = getPool();
  if (!p) return [];
  let query = `
    SELECT t.*, u_assigned.name AS assignee_name, u_by.name AS assigned_by_name
    FROM it_tasks t
    LEFT JOIN users u_assigned ON t.assigned_to = u_assigned.user_id
    LEFT JOIN users u_by ON t.assigned_by = u_by.user_id
    WHERE 1=1
  `;
  const params = [];
  let i = 1;
  if (filters.status) {
    query += ` AND t.status = $${i}`;
    params.push(filters.status);
    i++;
  }
  if (filters.assignee) {
    query += ` AND (u_assigned.name ILIKE $${i} OR u_assigned.email ILIKE $${i})`;
    params.push(`%${filters.assignee}%`);
    i++;
  }
  if (filters.projectId) {
    query += ` AND t.project_id = $${i}`;
    params.push(filters.projectId);
    i++;
  }
  query += ' ORDER BY t.task_id';
  const { rows } = await p.query(query, params);
  return rows.map((r) => ({
    id: String(r.task_id),
    title: r.task_title,
    task_description: r.task_description,
    status: r.status,
    priority: r.priority,
    assignee: r.assignee_name || (r.assigned_to ? String(r.assigned_to) : 'Unassigned'),
    assigned_to: r.assigned_to,
    assigned_by: r.assigned_by,
    assigned_by_name: r.assigned_by_name,
    projectId: r.project_id ? String(r.project_id) : null,
    dueDate: r.due_date,
    task_date: r.task_date,
    created_at: r.created_at,
  }));
}

// Tasks with filters: project_id, assigned_to, status, priority, task_date, from_date, to_date
export async function dbGetTasksSimple(filters = {}) {
  const p = getPool();
  if (!p) return [];

  try {
    const normalizedTeam = String(filters.team || '').trim();
    const taskTable =
      normalizedTeam === 'consultant'
        ? 'consultant_tasks'
        : normalizedTeam === 'digital_marketing'
          ? 'digital_marketing_tasks'
          : 'it_tasks';
    const reqTable =
      normalizedTeam === 'consultant'
        ? 'consultant_task_requirements'
        : normalizedTeam === 'digital_marketing'
          ? 'digital_marketing_task_requirements'
          : 'it_task_requirements';

    const { rows: tableCheck } = await p.query(
      "SELECT EXISTS (SELECT FROM information_schema.tables WHERE table_schema = 'public' AND table_name = $1)",
      [reqTable]
    );
    const hasReqs = tableCheck[0]?.exists;

    let query = `
      SELECT t.*, 
             u_assigned.username AS assignee_username, 
             u_assigned.profile_image AS assignee_profile_image,
             u_by.username AS assigned_by_username,
             u_review.username AS reviewer_username
      FROM ${taskTable} t
      LEFT JOIN users u_assigned ON t.assigned_to = u_assigned.user_id
      LEFT JOIN users u_by ON t.assigned_by = u_by.user_id
      LEFT JOIN users u_review ON t.reviewed_by = u_review.user_id
    `;

    const whereParts = [];
    const params = [];
    let i = 1;

    if (filters.status) {
      whereParts.push(`t.status = $${i++}`);
      params.push(filters.status);
    }
    if (filters.project_id != null || filters.projectId != null) {
      whereParts.push(`t.project_id = $${i++}`);
      params.push(filters.project_id ?? filters.projectId);
    }
    if (filters.assigned_to != null || filters.assignee != null) {
      whereParts.push(`t.assigned_to = $${i++}`);
      params.push(filters.assigned_to ?? filters.assignee);
    }
    if (filters.priority) {
      whereParts.push(`t.priority = $${i++}`);
      params.push(filters.priority);
    }
    if (filters.task_date) {
      whereParts.push(`t.task_date = $${i++}`);
      params.push(filters.task_date);
    }
    if (filters.from_date) {
      whereParts.push(`t.task_date >= $${i++}`);
      params.push(filters.from_date);
    }
    if (filters.to_date) {
      whereParts.push(`t.task_date <= $${i++}`);
      params.push(filters.to_date);
    }

    // Overdue filter: due_date in past and not completed
    // Accept truthy values: overdue=true, overdue=1, overdue_only=true
    const overdueFlag =
      filters.overdue === true ||
      String(filters.overdue).toLowerCase() === 'true' ||
      String(filters.overdue).toLowerCase() === '1' ||
      String(filters.overdue_only).toLowerCase() === 'true';
    if (overdueFlag) {
      whereParts.push(`t.due_date IS NOT NULL`);
      whereParts.push(`t.due_date < CURRENT_DATE`);
      whereParts.push(`t.status <> 'completed'`);
    }

    // Optional team filter based on assignee's RBAC role code (legacy support).
    // For consultant/digital tables we don't need this role filter.
    if (filters.team && taskTable === 'it_tasks') {
      if (String(filters.team) === 'it') {
        whereParts.push(
          `(COALESCE(u_assigned.is_it_developer, false) = true
            OR COALESCE(u_assigned.is_it_manager, false) = true
            OR EXISTS (
              SELECT 1
              FROM user_roles ur
              JOIN roles r ON r.role_id = ur.role_id
              WHERE ur.user_id = t.assigned_to
                AND r.code = ANY($${i++})
            ))`
        );
        params.push(['it_developer', 'it_manager', 'admin']);
      } else {
        whereParts.push(
          `EXISTS (
            SELECT 1
            FROM user_roles ur
            JOIN roles r ON r.role_id = ur.role_id
            WHERE ur.user_id = t.assigned_to
              AND r.code = $${i++}
          )`
        );
        params.push(filters.team);
      }
    }

    if (whereParts.length > 0) query += ` WHERE ${whereParts.join(' AND ')}`;
    query += ' ORDER BY t.task_id';

    const { rows } = await p.query(query, params);

    // Fetch requirements stats only if table exists
    let reqStats = {};
    if (hasReqs && rows.length > 0) {
      const taskIds = rows.map(r => r.task_id);
      const { rows: statsRows } = await p.query(
        `SELECT task_id, COUNT(*) AS total, 
                COUNT(*) FILTER (WHERE status = 'completed') AS completed
         FROM ${reqTable}
         WHERE task_id = ANY($1)
         GROUP BY task_id`,
        [taskIds]
      );
      statsRows.forEach(s => {
        reqStats[s.task_id] = { total: Number(s.total), completed: Number(s.completed) };
      });
    }

    return rows.map(r => ({
      id: String(r.task_id),
      task_id: r.task_id,
      title: r.task_title || r.title,
      task_title: r.task_title || r.title,
      task_description: r.task_description || r.description,
      status: r.status,
      priority: r.priority,
      assignee: r.assignee_username || (r.assigned_to ? String(r.assigned_to) : 'Unassigned'),
      assigned_to: r.assigned_to,
      assigned_by: r.assigned_by,
      assigned_by_name: r.assigned_by_username,
      assignee_profile_image: r.assignee_profile_image,
      projectId: r.project_id ? String(r.project_id) : null,
      project_id: r.project_id,
      dueDate: r.due_date,
      task_date: r.task_date,
      created_at: r.created_at,
      completed_at: r.completed_at,
      req_total: reqStats[r.task_id]?.total || 0,
      req_completed: reqStats[r.task_id]?.completed || 0,
      reviewed_by: r.reviewed_by ?? null,
      reviewed_by_username: r.reviewer_username ?? null,
      review_comment: r.review_comment ?? null,
      reviewed_at: r.reviewed_at ?? null,
      team:
        taskTable === 'consultant_tasks'
          ? 'consultant'
          : taskTable === 'digital_marketing_tasks'
            ? 'digital_marketing'
            : 'it',
    }));
  } catch (err) {
    console.error('dbGetTasksSimple Critical Error:', err.message);
    try {
      const { rows } = await p.query('SELECT * FROM it_tasks ORDER BY task_id');
      return rows.map(r => ({
        id: String(r.task_id),
        task_id: r.task_id,
        title: r.task_title || r.title,
        status: r.status,
        priority: r.priority,
        projectId: r.project_id ? String(r.project_id) : null,
        req_total: 0,
        req_completed: 0
      }));
    } catch {
      return [];
    }
  }
}

/** Admin dashboard: pending/review + overdue (deadline missed) summary. */
export async function dbGetAdminPendingSummary() {
  const p = getPool();
  if (!p) {
    return {
      pending_count: 0,
      review_count: 0,
      overdue_count: 0,
      overdue_tasks: [],
    };
  }
  try {
    const [{ rows: pendingRows }, { rows: overdueRows }] = await Promise.all([
      p.query(
        `SELECT
           COUNT(*) FILTER (WHERE status IN ('todo','in_progress','review','rework'))::int AS pending_count,
           COUNT(*) FILTER (WHERE status = 'review')::int AS review_count
         FROM it_tasks`
      ),
      p.query(
        `SELECT
           t.task_id,
           t.task_title,
           t.status,
           t.priority,
           t.due_date,
           u.username AS assignee_username
         FROM it_tasks t
         LEFT JOIN users u ON t.assigned_to = u.user_id
         WHERE t.due_date IS NOT NULL
           AND t.due_date < CURRENT_DATE
           AND t.status <> 'completed'
         ORDER BY t.due_date ASC
         LIMIT 100`
      ),
    ]);

    const pending = pendingRows?.[0] || {};
    const overdueTasks = (overdueRows || []).map((r) => ({
      task_id: r.task_id,
      task_title: r.task_title,
      status: r.status,
      priority: r.priority,
      due_date: r.due_date,
      assignee: r.assignee_username || 'Unassigned',
    }));

    return {
      pending_count: Number(pending.pending_count || 0),
      review_count: Number(pending.review_count || 0),
      overdue_count: overdueTasks.length,
      overdue_tasks: overdueTasks,
    };
  } catch (err) {
    console.error('dbGetAdminPendingSummary:', err.message);
    return {
      pending_count: 0,
      review_count: 0,
      overdue_count: 0,
      overdue_tasks: [],
    };
  }
}

function resolveTeamFromInput(team) {
  const t = String(team || '').trim().toLowerCase();
  if (t === 'consultant') return 'consultant';
  if (t === 'digital_marketing' || t === 'digital') return 'digital_marketing';
  return 'it';
}

function taskTableForTeam(team) {
  if (team === 'consultant') return 'consultant_tasks';
  if (team === 'digital_marketing') return 'digital_marketing_tasks';
  return 'it_tasks';
}

function reqTableForTeam(team) {
  if (team === 'consultant') return 'consultant_task_requirements';
  if (team === 'digital_marketing') return 'digital_marketing_task_requirements';
  return 'it_task_requirements';
}

async function detectTaskTeamById(taskId) {
  const p = getPool();
  if (!p) return 'it';
  const id = parseInt(String(taskId), 10);
  if (!Number.isFinite(id)) return 'it';
  const checks = [
    { team: 'consultant', table: 'consultant_tasks' },
    { team: 'digital_marketing', table: 'digital_marketing_tasks' },
    { team: 'it', table: 'it_tasks' },
  ];
  for (const c of checks) {
    try {
      const { rows } = await p.query(
        "SELECT EXISTS (SELECT FROM information_schema.tables WHERE table_schema = 'public' AND table_name = $1) AS ex",
        [c.table]
      );
      if (!rows[0]?.ex) continue;
      const { rowCount } = await p.query(`SELECT 1 FROM ${c.table} WHERE task_id = $1 LIMIT 1`, [id]);
      if (rowCount > 0) return c.team;
    } catch {
      // ignore table-specific detection failures
    }
  }
  return 'it';
}

export async function dbCreateTask(data) {
  const p = getPool();
  if (!p) return null;
  const team = resolveTeamFromInput(data?.team);
  const taskTable = taskTableForTeam(team);
  // Helper: convert empty strings to null for integer columns
  const toNullableInt = (v) => (v === '' || v === undefined || v === null ? null : v);
  const {
    rows: [row],
  } = await p.query(
    `INSERT INTO ${taskTable} (project_id, assigned_to, assigned_by, created_by, task_title, task_description, priority, status, task_date, due_date)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
     RETURNING *`,
    [
      toNullableInt(data.projectId ?? data.project_id),
      toNullableInt(data.assigned_to),
      toNullableInt(data.assigned_by),
      toNullableInt(data.created_by ?? data.assigned_by),
      data.title ?? data.task_title ?? 'New Task',
      data.task_description ?? data.description ?? null,
      data.priority ?? 'medium',
      data.status ?? 'in_progress',
      toNullableDate(data.task_date ?? data.taskDate) ?? new Date().toISOString().slice(0, 10),
      toNullableDate(data.dueDate ?? data.due_date),
    ]
  );
  if (!row) return null;
  return {
    id: String(row.task_id),
    title: row.task_title,
    task_description: row.task_description,
    status: row.status,
    priority: row.priority,
    assignee: row.assigned_to ? String(row.assigned_to) : 'Unassigned',
    assigned_to: row.assigned_to,
    projectId: row.project_id ? String(row.project_id) : null,
    dueDate: row.due_date,
    task_date: row.task_date,
    created_at: row.created_at,
    team,
  };
}

export async function dbUpdateTask(taskId, data) {
  const p = getPool();
  if (!p) return null;
  const team = resolveTeamFromInput(data?.team || await detectTaskTeamById(taskId));
  const taskTable = taskTableForTeam(team);
  const allowed = [
    'task_title',
    'task_description',
    'priority',
    'status',
    'due_date',
    'assigned_to',
    'assigned_by',
    'project_id',
    'reviewed_by',
    'review_comment',
    'reviewed_at',
  ];
  const updates = [];
  const values = [];
  let i = 1;
  const map = {
    title: 'task_title',
    description: 'task_description',
    dueDate: 'due_date',
    projectId: 'project_id',
    reviewComment: 'review_comment',
    reviewedBy: 'reviewed_by',
    reviewedAt: 'reviewed_at',
  };
  for (const [k, v] of Object.entries(data)) {
    const col = map[k] || k;
    if (allowed.includes(col) && v !== undefined) {
      updates.push(`${col} = $${i}`);
      let val;
      if (col === 'start_date' || col === 'end_date' || col === 'due_date' || col === 'task_date') {
        val = toNullableDate(v);
      } else if (col === 'reviewed_at') {
        val = v === '' || v == null ? null : v;
      } else if (col === 'assigned_to' || col === 'assigned_by' || col === 'project_id' || col === 'reviewed_by') {
        val = v === '' ? null : v;
      } else if (col === 'review_comment') {
        val = v === '' || v == null ? null : String(v);
      } else {
        val = v;
      }
      values.push(val);
      i++;
    }
  }
  if (updates.length === 0) return dbGetTaskById(taskId, team);
  updates.push('updated_at = CURRENT_TIMESTAMP');
  if (data.status === 'completed') {
    updates.push('completed_at = CURRENT_TIMESTAMP');
  } else if (data.status !== undefined && data.status !== 'completed') {
    updates.push('completed_at = NULL');
  }
  values.push(taskId);
  const { rows } = await p.query(
    `UPDATE ${taskTable} SET ${updates.join(', ')} WHERE task_id = $${i} RETURNING *`,
    values
  );
  if (!rows[0]) return null;
  return dbGetTaskById(taskId, team);
}

export async function dbGetTaskById(taskId, teamInput = null) {
  const p = getPool();
  if (!p) return null;
  const team = resolveTeamFromInput(teamInput || await detectTaskTeamById(taskId));
  const taskTable = taskTableForTeam(team);
  const { rows } = await p.query(
    `SELECT t.*, u_rev.username AS reviewer_username
     FROM ${taskTable} t
     LEFT JOIN users u_rev ON t.reviewed_by = u_rev.user_id
     WHERE t.task_id = $1`,
    [taskId]
  );
  const row = rows[0];
  if (!row) return null;
  return {
    id: String(row.task_id),
    title: row.task_title,
    task_description: row.task_description,
    status: row.status,
    priority: row.priority,
    assignee: row.assigned_to ? String(row.assigned_to) : 'Unassigned',
    assigned_to: row.assigned_to,
    projectId: row.project_id ? String(row.project_id) : null,
    dueDate: row.due_date,
    task_date: row.task_date,
    created_at: row.created_at,
    completed_at: row.completed_at ?? null,
    reviewed_by: row.reviewed_by ?? null,
    reviewed_by_username: row.reviewer_username ?? null,
    review_comment: row.review_comment ?? null,
    reviewed_at: row.reviewed_at ?? null,
    team,
  };
}

export async function dbDeleteTask(taskId, teamInput = null) {
  const p = getPool();
  if (!p) return false;
  const team = resolveTeamFromInput(teamInput || await detectTaskTeamById(taskId));
  const taskTable = taskTableForTeam(team);
  const { rowCount } = await p.query(`DELETE FROM ${taskTable} WHERE task_id = $1`, [
    taskId,
  ]);
  return rowCount > 0;
}

export async function dbGetTaskComments(taskId) {
  const p = getPool();
  if (!p) return [];
  const { rows } = await p.query(
    'SELECT * FROM task_comments WHERE task_id = $1 ORDER BY created_at',
    [taskId]
  );
  return rows.map((r) => ({
    id: String(r.comment_id),
    taskId: String(r.task_id),
    author: r.user_id ? String(r.user_id) : 'System',
    message: r.comment_text,
    createdAt: r.created_at,
  }));
}

export async function dbAddTaskComment(taskId, data) {
  const p = getPool();
  if (!p) return null;
  const {
    rows: [row],
  } = await p.query(
    `INSERT INTO task_comments (task_id, user_id, comment_text)
     VALUES ($1, $2, $3)
     RETURNING *`,
    [taskId, data.user_id || null, data.message ?? data.comment_text ?? '']
  );
  if (!row) return null;
  return {
    id: String(row.comment_id),
    taskId: String(row.task_id),
    author: data.author || 'System',
    message: row.comment_text,
    createdAt: row.created_at,
  };
}

export async function dbGetDashboardStats() {
  const p = getPool();
  if (!p)
    return {
      activeProjects: 0,
      completedTasksToday: 0,
      totalProjects: 0,
      totalTasks: 0,
    };
  try {
    const [projRes, tasksRes, todayRes] = await Promise.all([
      p.query(
        "SELECT COUNT(*) AS n FROM it_projects WHERE status = 'active'"
      ),
      p.query('SELECT COUNT(*) AS n FROM it_tasks'),
      p.query(
        "SELECT COUNT(*) AS n FROM it_tasks WHERE status = 'completed' AND (completed_at::date = CURRENT_DATE OR (completed_at IS NULL AND task_date = CURRENT_DATE))"
      ),
    ]);
    const totalProjects = Number(
      (await p.query('SELECT COUNT(*) AS n FROM it_projects')).rows[0].n
    );
    return {
      activeProjects: Number(projRes.rows[0].n),
      completedTasksToday: Number(todayRes.rows[0].n),
      totalProjects,
      totalTasks: Number(tasksRes.rows[0].n),
    };
  } catch (err) {
    console.error('dbGetDashboardStats:', err.message);
    return {
      activeProjects: 0,
      completedTasksToday: 0,
      totalProjects: 0,
      totalTasks: 0,
    };
  }
}

// Spec shape: { stats: { active_projects, active_tasks, completed_tasks }, projects: [...], teamActivity: [...] }
export async function dbGetDashboardStatsFull() {
  const p = getPool();
  if (!p) {
    return {
      stats: { active_projects: 0, active_tasks: 0, completed_tasks: 0 },
      projects: [],
      teamActivity: [],
    };
  }
  const empty = {
    stats: { active_projects: 0, active_tasks: 0, completed_tasks: 0 },
    projects: [],
    teamActivity: [],
  };
  try {
    const [activeProj, activeTasks, completedTasks, projectRows, teamRows] = await Promise.all([
      p.query("SELECT COUNT(*) AS n FROM it_projects WHERE status = 'active'"),
      p.query("SELECT COUNT(*) AS n FROM it_tasks WHERE status IN ('todo', 'in_progress', 'review', 'rework')"),
      p.query("SELECT COUNT(*) AS n FROM it_tasks WHERE status = 'completed'"),
      p.query(`
        SELECT p.project_id, p.project_name, p.priority,
               COUNT(t.task_id) AS total_tasks,
               COUNT(t.task_id) FILTER (WHERE t.status = 'completed') AS completed_tasks
        FROM it_projects p
        LEFT JOIN it_tasks t ON t.project_id = p.project_id
        WHERE p.status = 'active'
        GROUP BY p.project_id, p.project_name, p.priority
        ORDER BY p.project_id
      `),
      p.query(`
        SELECT u.user_id, COALESCE(u.username, u.email) AS username, u.profile_image,
               COUNT(t.task_id) AS total_assigned,
               COUNT(t.task_id) FILTER (WHERE t.status IN ('todo', 'in_progress', 'review', 'rework')) AS in_progress_count,
               COUNT(t.task_id) FILTER (WHERE t.status = 'completed' AND (t.completed_at::date = CURRENT_DATE OR (t.completed_at IS NULL AND t.task_date = CURRENT_DATE))) AS completed_today
        FROM users u
        LEFT JOIN it_tasks t ON t.assigned_to = u.user_id
        GROUP BY u.user_id, u.username, u.email, u.profile_image
        ORDER BY total_assigned DESC
      `),
    ]);
    const stats = {
      active_projects: Number(activeProj.rows[0]?.n ?? 0),
      active_tasks: Number(activeTasks.rows[0]?.n ?? 0),
      completed_tasks: Number(completedTasks.rows[0]?.n ?? 0),
    };
    const projects = (projectRows.rows || []).map((r) => ({
      project_id: r.project_id,
      project_name: r.project_name,
      priority: r.priority,
      total_tasks: Number(r.total_tasks ?? 0),
      completed_tasks: Number(r.completed_tasks ?? 0),
      completion_percentage: r.total_tasks > 0
        ? Math.round((Number(r.completed_tasks) / Number(r.total_tasks)) * 100)
        : 0,
    }));
    const teamActivity = (teamRows.rows || []).map((r) => ({
      user_id: r.user_id,
      username: r.username,
      profile_image: r.profile_image,
      in_progress_count: Number(r.in_progress_count ?? 0),
      completed_today: Number(r.completed_today ?? 0),
      total_assigned: Number(r.total_assigned ?? 0),
    }));
    return { stats, projects, teamActivity };
  } catch (err) {
    console.error('dbGetDashboardStatsFull:', err.message);
    return empty;
  }
}

export async function dbGetTeamOverview(team = null) {
  const p = getPool();
  if (!p) return [];
  try {
    const teamWhereClause =
      team === 'it'
        ? `WHERE (
            COALESCE(u.is_it_developer, false) = true
            OR COALESCE(u.is_it_manager, false) = true
            OR EXISTS (
              SELECT 1
              FROM user_roles ur
              JOIN roles r ON r.role_id = ur.role_id
              WHERE ur.user_id = u.user_id
                AND r.code = ANY($1)
            )
          )`
        : team
          ? `WHERE EXISTS (
              SELECT 1
              FROM user_roles ur
              JOIN roles r ON r.role_id = ur.role_id
              WHERE ur.user_id = u.user_id
                AND r.code = $1
            )`
          : '';

    const params =
      team === 'it' ? [['it_developer', 'it_manager', 'admin']] : team ? [team] : [];

    const { rows } = await p.query(
      `
        SELECT u.user_id, COALESCE(u.username, u.email) AS username, u.profile_image,
               u.is_it_developer, u.is_it_manager,
               COUNT(t.task_id) AS total_tasks,
               COUNT(t.task_id) FILTER (WHERE t.status = 'completed') AS completed_tasks,
               COUNT(t.task_id) FILTER (WHERE t.status IN ('todo', 'in_progress', 'review', 'rework')) AS in_progress_tasks
        FROM users u
        LEFT JOIN it_tasks t ON t.assigned_to = u.user_id
        ${teamWhereClause}
        GROUP BY u.user_id, u.username, u.email, u.profile_image, u.is_it_developer, u.is_it_manager
        ORDER BY total_tasks DESC
      `,
      params
    );
    return rows.map((r) => ({
      user_id: r.user_id,
      username: r.username,
      profile_image: r.profile_image,
      is_it_developer: Boolean(r.is_it_developer),
      is_it_manager: Boolean(r.is_it_manager),
      total_tasks: Number(r.total_tasks ?? 0),
      completed_tasks: Number(r.completed_tasks ?? 0),
      in_progress_tasks: Number(r.in_progress_tasks ?? 0),
      assignee: r.username,
    }));
  } catch (err) {
    console.error('dbGetTeamOverview (users):', err.message);
    try {
      const { rows } = await p.query(`
        SELECT COALESCE(t.assigned_to::text, 'Unassigned') AS assignee,
               COUNT(*) AS total,
               COUNT(*) FILTER (WHERE t.status IN ('todo', 'in_progress', 'review', 'rework')) AS open_tasks,
               COUNT(*) FILTER (WHERE t.status = 'completed') AS completed
        FROM it_tasks t GROUP BY t.assigned_to
      `);
      return rows.map((r) => ({
        assignee: r.assignee || 'Unassigned',
        total_tasks: Number(r.total),
        in_progress_tasks: Number(r.open_tasks),
        completed_tasks: Number(r.completed),
      }));
    } catch (err2) {
      console.error('dbGetTeamOverview (fallback):', err2.message);
      return [];
    }
  }
}

export async function dbCreateEodReport(data) {
  const p = getPool();
  if (!p) return null;
  try {
    const { rows: [row] } = await p.query(
      `INSERT INTO eod_reports (user_id, report_date, achievements, blockers, tomorrow_plan, hours_worked, mood)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING *`,
      [
        data.user_id ?? null,
        data.report_date ?? new Date().toISOString().slice(0, 10),
        data.achievements ?? null,
        data.blockers ?? null,
        data.tomorrow_plan ?? null,
        data.hours_worked ?? null,
        data.mood ?? null,
      ]
    );
    return row ? { id: row.report_id, ...row } : null;
  } catch {
    return null;
  }
}

export async function dbGetEodReports(filters = {}) {
  const p = getPool();
  if (!p) return [];
  try {
    let query = `
      SELECT e.*, u.username
      FROM eod_reports e
      LEFT JOIN users u ON e.user_id = u.user_id
      WHERE 1=1
    `;
    const params = [];
    let i = 1;
    if (filters.user_id != null) { query += ` AND e.user_id = $${i}`; params.push(filters.user_id); i++; }
    if (filters.report_date) { query += ` AND e.report_date = $${i}`; params.push(filters.report_date); i++; }
    query += ' ORDER BY e.report_date DESC, e.report_id DESC';
    const { rows } = await p.query(query, params);
    return rows.map((r) => ({
      report_id: r.report_id,
      user_id: r.user_id,
      username: r.username,
      report_date: r.report_date,
      achievements: r.achievements,
      blockers: r.blockers,
      tomorrow_plan: r.tomorrow_plan,
      hours_worked: r.hours_worked,
      mood: r.mood,
      created_at: r.created_at,
    }));
  } catch {
    try {
      const { rows } = await p.query(
        'SELECT * FROM eod_reports ORDER BY report_date DESC, report_id DESC'
      );
      return rows;
    } catch {
      return [];
    }
  }
}

// ── Task Requirements (subtasks) ──────────────────────────

const mapRequirement = (r) => ({
  id: r.requirement_id,
  requirement_id: r.requirement_id,
  task_id: r.task_id,
  title: r.title,
  description: r.description,
  status: r.status,
  priority: r.priority,
  due_date: r.due_date,
  sort_order: r.sort_order,
  created_at: r.created_at,
  updated_at: r.updated_at,
});

export async function dbGetRequirements(taskId, teamInput = null) {
  const p = getPool();
  if (!p) return [];
  try {
    const team = resolveTeamFromInput(teamInput || await detectTaskTeamById(taskId));
    const reqTable = reqTableForTeam(team);
    // Check if table exists
    const { rows: tableCheck } = await p.query(
      "SELECT EXISTS (SELECT FROM information_schema.tables WHERE table_name = $1)",
      [reqTable]
    );
    if (!tableCheck[0]?.exists) return [];

    const { rows } = await p.query(
      `SELECT * FROM ${reqTable} WHERE task_id = $1 ORDER BY sort_order, requirement_id`,
      [parseInt(taskId, 10)]
    );
    return rows.map(mapRequirement);
  } catch (err) {
    console.error('dbGetRequirements:', err.message);
    return [];
  }
}

export async function dbGetRequirementById(reqId) {
  const p = getPool();
  if (!p) return null;
  try {
    const { rows } = await p.query(
      'SELECT * FROM it_task_requirements WHERE requirement_id = $1',
      [reqId]
    );
    return rows[0] ? mapRequirement(rows[0]) : null;
  } catch (err) {
    console.error('dbGetRequirementById:', err.message);
    return null;
  }
}

export async function dbCreateRequirement(taskId, data, teamInput = null) {
  const p = getPool();
  if (!p) return null;
  try {
    const team = resolveTeamFromInput(teamInput || data?.team || await detectTaskTeamById(taskId));
    const reqTable = reqTableForTeam(team);
    // DB schema uses VARCHAR(500) for title; clamp to prevent 500 errors.
    const normalizedTitle = String(data?.title ?? 'Untitled Requirement').trim();
    const safeTitle = (normalizedTitle || 'Untitled Requirement').slice(0, 500);
    // Get next sort_order
    const { rows: maxRows } = await p.query(
      `SELECT COALESCE(MAX(sort_order), -1) + 1 AS next FROM ${reqTable} WHERE task_id = $1`,
      [parseInt(taskId, 10)]
    );
    const nextOrder = maxRows[0]?.next ?? 0;

    const { rows: [row] } = await p.query(
      `INSERT INTO ${reqTable} (task_id, title, description, status, priority, due_date, sort_order)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING *`,
      [
        parseInt(taskId, 10),
        safeTitle,
        data.description ?? null,
        data.status ?? 'pending',
        data.priority ?? 'medium',
        toNullableDate(data.due_date),
        data.sort_order ?? nextOrder,
      ]
    );
    return row ? mapRequirement(row) : null;
  } catch (err) {
    console.error('dbCreateRequirement:', err.message);
    return null;
  }
}

export async function dbUpdateRequirement(reqId, data, taskId = null, teamInput = null) {
  const p = getPool();
  if (!p) return null;
  const team = resolveTeamFromInput(teamInput || data?.team || (taskId ? await detectTaskTeamById(taskId) : null));
  const reqTable = reqTableForTeam(team);
  const allowed = ['title', 'description', 'status', 'priority', 'due_date', 'sort_order'];
  const updates = [];
  const values = [];
  let i = 1;
  for (const [k, v] of Object.entries(data)) {
    if (allowed.includes(k) && v !== undefined) {
      updates.push(`${k} = $${i}`);
      const val =
        k === 'due_date'
          ? toNullableDate(v)
          : k === 'title'
            ? String(v ?? '').trim().slice(0, 500)
            : v;
      values.push(val);
      i++;
    }
  }
  if (updates.length === 0) return dbGetRequirementById(reqId);
  updates.push('updated_at = CURRENT_TIMESTAMP');
  values.push(reqId);
  try {
    const { rows } = await p.query(
      `UPDATE ${reqTable} SET ${updates.join(', ')} WHERE requirement_id = $${i} RETURNING *`,
      values
    );
    return rows[0] ? mapRequirement(rows[0]) : null;
  } catch (err) {
    console.error('dbUpdateRequirement:', err.message);
    return null;
  }
}

export async function dbDeleteRequirement(reqId, taskId = null, teamInput = null) {
  const p = getPool();
  if (!p) return false;
  try {
    const team = resolveTeamFromInput(teamInput || (taskId ? await detectTaskTeamById(taskId) : null));
    const reqTable = reqTableForTeam(team);
    const { rowCount } = await p.query(
      `DELETE FROM ${reqTable} WHERE requirement_id = $1`,
      [reqId]
    );
    return rowCount > 0;
  } catch (err) {
    console.error('dbDeleteRequirement:', err.message);
    return false;
  }
}

export async function dbGetRequirementStats(taskId) {
  const p = getPool();
  if (!p) return { total: 0, completed: 0 };
  try {
    const { rows } = await p.query(
      `SELECT COUNT(*) AS total,
              COUNT(*) FILTER (WHERE status = 'completed') AS completed
       FROM it_task_requirements WHERE task_id = $1`,
      [taskId]
    );
    return {
      total: Number(rows[0]?.total ?? 0),
      completed: Number(rows[0]?.completed ?? 0),
    };
  } catch (err) {
    console.error('dbGetRequirementStats:', err.message);
    return { total: 0, completed: 0 };
  }
}

// ─── RBAC ───────────────────────────────────────────────────────────────

/** Get all permissions (for admin config). */
export async function dbGetPermissions() {
  const p = getPool();
  if (!p) return [];
  try {
    const { rows } = await p.query(
      'SELECT permission_id, code, name, module, description FROM permissions ORDER BY module, code'
    );
    return rows;
  } catch (err) {
    console.error('dbGetPermissions:', err.message);
    return [];
  }
}

/** Get all roles with department name. */
export async function dbGetRoles() {
  const p = getPool();
  if (!p) return [];
  try {
    const { rows } = await p.query(
      `SELECT r.role_id, r.name, r.code, r.department_id, r.description, d.name AS department_name, d.code AS department_code
       FROM roles r LEFT JOIN departments d ON r.department_id = d.department_id
       ORDER BY r.name`
    );
    return rows;
  } catch (err) {
    console.error('dbGetRoles:', err.message);
    return [];
  }
}

/** Get permission IDs for a role. */
export async function dbGetRolePermissionIds(roleId) {
  const p = getPool();
  if (!p) return [];
  try {
    const { rows } = await p.query(
      'SELECT permission_id FROM role_permissions WHERE role_id = $1',
      [roleId]
    );
    return rows.map((r) => r.permission_id);
  } catch (err) {
    console.error('dbGetRolePermissionIds:', err.message);
    return [];
  }
}

/** Get permissions for a role (full permission rows). */
export async function dbGetRolePermissions(roleId) {
  const p = getPool();
  if (!p) return [];
  try {
    const { rows } = await p.query(
      `SELECT p.permission_id, p.code, p.name, p.module FROM permissions p
       INNER JOIN role_permissions rp ON p.permission_id = rp.permission_id
       WHERE rp.role_id = $1 ORDER BY p.module, p.code`,
      [roleId]
    );
    return rows;
  } catch (err) {
    console.error('dbGetRolePermissions:', err.message);
    return [];
  }
}

/** Get role codes for a user (from user_roles). */
export async function dbGetUserRoleIds(userId) {
  const p = getPool();
  if (!p) return [];
  try {
    const { rows } = await p.query(
      'SELECT role_id FROM user_roles WHERE user_id = $1',
      [userId]
    );
    return rows.map((r) => r.role_id);
  } catch (err) {
    console.error('dbGetUserRoleIds:', err.message);
    return [];
  }
}

/** Get distinct permission codes for a user (all roles combined). */
export async function dbGetUserPermissions(userId) {
  const p = getPool();
  if (!p) return [];
  try {
    const { rows } = await p.query(
      `SELECT DISTINCT p.code FROM permissions p
       INNER JOIN role_permissions rp ON p.permission_id = rp.permission_id
       INNER JOIN user_roles ur ON ur.role_id = rp.role_id
       WHERE ur.user_id = $1 ORDER BY p.code`,
      [userId]
    );
    return rows.map((r) => r.code);
  } catch (err) {
    console.error('dbGetUserPermissions:', err.message);
    return [];
  }
}

/** Assign a role to a user. */
export async function dbAssignUserRole(userId, roleId, assignedBy = null) {
  const p = getPool();
  if (!p) return false;
  try {
    await p.query(
      'INSERT INTO user_roles (user_id, role_id, assigned_by) VALUES ($1, $2, $3) ON CONFLICT (user_id, role_id) DO NOTHING',
      [userId, roleId, assignedBy]
    );
    return true;
  } catch (err) {
    console.error('dbAssignUserRole:', err.message);
    return false;
  }
}

/** Remove a role from a user. */
export async function dbRemoveUserRole(userId, roleId) {
  const p = getPool();
  if (!p) return false;
  try {
    const { rowCount } = await p.query(
      'DELETE FROM user_roles WHERE user_id = $1 AND role_id = $2',
      [userId, roleId]
    );
    return rowCount > 0;
  } catch (err) {
    console.error('dbRemoveUserRole:', err.message);
    return false;
  }
}

/** Set all roles for a user (replaces existing). */
export async function dbSetUserRoles(userId, roleIds, assignedBy = null) {
  const p = getPool();
  if (!p) return false;
  try {
    await p.query('DELETE FROM user_roles WHERE user_id = $1', [userId]);
    for (const roleId of roleIds) {
      await p.query(
        'INSERT INTO user_roles (user_id, role_id, assigned_by) VALUES ($1, $2, $3) ON CONFLICT (user_id, role_id) DO NOTHING',
        [userId, roleId, assignedBy]
      );
    }
    return true;
  } catch (err) {
    console.error('dbSetUserRoles:', err.message);
    return false;
  }
}

/** Set permissions for a role (replaces existing). */
export async function dbSetRolePermissions(roleId, permissionIds) {
  const p = getPool();
  if (!p) return false;
  try {
    await p.query('DELETE FROM role_permissions WHERE role_id = $1', [roleId]);
    for (const permId of permissionIds) {
      await p.query(
        'INSERT INTO role_permissions (role_id, permission_id) VALUES ($1, $2) ON CONFLICT (role_id, permission_id) DO NOTHING',
        [roleId, permId]
      );
    }
    return true;
  } catch (err) {
    console.error('dbSetRolePermissions:', err.message);
    return false;
  }
}

/** Create audit log entry. */
export async function dbCreateAuditLog({ userId, action, resource, resourceId = null, details = null, ipAddress = null }) {
  const p = getPool();
  if (!p) return null;
  try {
    const { rows } = await p.query(
      `INSERT INTO audit_log (user_id, action, resource, resource_id, details, ip_address)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING audit_id, created_at`,
      [userId, action, resource, resourceId, details ? JSON.stringify(details) : null, ipAddress]
    );
    return rows[0] || null;
  } catch (err) {
    console.error('dbCreateAuditLog:', err.message);
    return null;
  }
}

/** Get audit log with optional filters. */
export async function dbGetAuditLogs(filters = {}) {
  const p = getPool();
  if (!p) return [];
  const { userId, resource, limit = 100, offset = 0 } = filters;
  try {
    const params = [];
    let i = 1;
    let sql = `SELECT a.audit_id, a.user_id, a.action, a.resource, a.resource_id, a.details, a.ip_address, a.created_at, u.username
               FROM audit_log a LEFT JOIN users u ON a.user_id = u.user_id WHERE 1=1`;
    if (userId) {
      params.push(userId);
      sql += ` AND a.user_id = $${i++}`;
    }
    if (resource) {
      params.push(resource);
      sql += ` AND a.resource = $${i++}`;
    }
    params.push(limit, offset);
    sql += ` ORDER BY a.created_at DESC LIMIT $${i} OFFSET $${i + 1}`;
    const { rows } = await p.query(sql, params);
    return rows;
  } catch (err) {
    console.error('dbGetAuditLogs:', err.message);
    return [];
  }
}

/** Get departments. */
export async function dbGetDepartments() {
  const p = getPool();
  if (!p) return [];
  try {
    const { rows } = await p.query(
      'SELECT department_id, name, code, description FROM departments ORDER BY name'
    );
    return rows;
  } catch (err) {
    console.error('dbGetDepartments:', err.message);
    return [];
  }
}

/** Get users with their role names (for admin user list). */
export async function dbGetUsersWithRoles() {
  const p = getPool();
  if (!p) return [];
  try {
    const { rows } = await p.query(
      `SELECT u.user_id, u.username, u.email, u.is_it_developer, u.is_it_manager, u.created_at,
              COALESCE(array_agg(r.name) FILTER (WHERE r.role_id IS NOT NULL), '{}') AS role_names,
              COALESCE(array_agg(r.code) FILTER (WHERE r.role_id IS NOT NULL), '{}') AS role_codes
       FROM users u
       LEFT JOIN user_roles ur ON u.user_id = ur.user_id
       LEFT JOIN roles r ON ur.role_id = r.role_id
       GROUP BY u.user_id ORDER BY u.username`
    );
    return rows.map((row) => ({
      ...row,
      role_names: Array.isArray(row.role_names) ? row.role_names : (row.role_names || []),
      role_codes: Array.isArray(row.role_codes) ? row.role_codes : (row.role_codes || []),
    }));
  } catch (err) {
    console.error('dbGetUsersWithRoles:', err.message);
    return [];
  }
}
