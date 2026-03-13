import pg from 'pg';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '..', '.env') });

const toNullableDate = (val) => (val === '' || val === undefined ? null : val);

const { Pool } = pg;

let pool = null;

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

/** Auto-create tables if missing. */
export async function dbEnsureTables() {
  const p = getPool();
  if (!p) return;
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
      return { ok: false, error: 'Missing DB_USER or DB_DATABASE in .env' };
    }
    return { ok: false, error: 'Could not create pool (check .env)' };
  }
  try {
    const client = await p.connect();
    await client.query('SELECT 1');
    client.release();
    // Also ensure requirements table
    await dbEnsureTables();
    return { ok: true };
  } catch (err) {
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
        description: r.description,
        status: r.status,
        priority: r.priority,
        start_date: r.start_date,
        end_date: r.end_date,
        owner: 'IT Team',
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
    `INSERT INTO it_projects (project_name, project_code, description, status, priority, start_date, end_date)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     RETURNING *`,
    [
      data.name ?? data.project_name ?? 'Untitled Project',
      data.project_code ?? null,
      data.description ?? null,
      data.status ?? 'active',
      data.priority ?? 'medium',
      toNullableDate(data.start_date),
      toNullableDate(data.end_date),
    ]
  );
  if (!row) return null;
  return {
    id: String(row.project_id),
    name: row.project_name,
    project_code: row.project_code,
    description: row.description,
    status: row.status,
    priority: row.priority,
    start_date: row.start_date,
    end_date: row.end_date,
    owner: 'IT Team',
    progress: 0,
  };
}

export async function dbUpdateProject(projectId, data) {
  const p = getPool();
  if (!p) return null;
  const allowed = [
    'project_name',
    'project_code',
    'description',
    'status',
    'priority',
    'start_date',
    'end_date',
  ];
  const updates = [];
  const values = [];
  let i = 1;
  for (const [k, v] of Object.entries(data)) {
    const col = k === 'name' ? 'project_name' : k;
    if (allowed.includes(col) && v !== undefined) {
      updates.push(`${col} = $${i}`);
      const val = (col === 'start_date' || col === 'end_date' || col === 'due_date' || col === 'task_date')
        ? toNullableDate(v)
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
    description: row.description,
    status: row.status,
    priority: row.priority,
    start_date: row.start_date,
    end_date: row.end_date,
    owner: 'IT Team',
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
    description: row.description,
    status: row.status,
    priority: row.priority,
    start_date: row.start_date,
    end_date: row.end_date,
    owner: 'IT Team',
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
    // 1. Check if it_task_requirements exists
    const { rows: tableCheck } = await p.query(
      "SELECT EXISTS (SELECT FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'it_task_requirements')"
    );
    const hasReqs = tableCheck[0]?.exists;

    let query = `
      SELECT t.*, 
             u_assigned.username AS assignee_username, 
             u_assigned.profile_image AS assignee_profile_image,
             u_by.username AS assigned_by_username
      FROM it_tasks t
      LEFT JOIN users u_assigned ON t.assigned_to = u_assigned.user_id
      LEFT JOIN users u_by ON t.assigned_by = u_by.user_id
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
         FROM it_task_requirements
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

export async function dbCreateTask(data) {
  const p = getPool();
  if (!p) return null;
  const {
    rows: [row],
  } = await p.query(
    `INSERT INTO it_tasks (project_id, assigned_to, assigned_by, created_by, task_title, task_description, priority, status, task_date, due_date)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
     RETURNING *`,
    [
      data.projectId ?? data.project_id ?? null,
      data.assigned_to ?? null,
      data.assigned_by ?? null,
      data.created_by ?? data.assigned_by ?? null,
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
  };
}

export async function dbUpdateTask(taskId, data) {
  const p = getPool();
  if (!p) return null;
  const allowed = [
    'task_title',
    'task_description',
    'priority',
    'status',
    'due_date',
    'assigned_to',
    'project_id',
  ];
  const updates = [];
  const values = [];
  let i = 1;
  const map = {
    title: 'task_title',
    description: 'task_description',
    dueDate: 'due_date',
    projectId: 'project_id',
  };
  for (const [k, v] of Object.entries(data)) {
    const col = map[k] || k;
    if (allowed.includes(col) && v !== undefined) {
      updates.push(`${col} = $${i}`);
      const val = (col === 'start_date' || col === 'end_date' || col === 'due_date' || col === 'task_date')
        ? toNullableDate(v)
        : v;
      values.push(val);
      i++;
    }
  }
  if (updates.length === 0) return dbGetTaskById(taskId);
  updates.push('updated_at = CURRENT_TIMESTAMP');
  if (data.status === 'completed') {
    updates.push('completed_at = CURRENT_TIMESTAMP');
  } else if (data.status !== undefined && data.status !== 'completed') {
    updates.push('completed_at = NULL');
  }
  values.push(taskId);
  const { rows } = await p.query(
    `UPDATE it_tasks SET ${updates.join(', ')} WHERE task_id = $${i} RETURNING *`,
    values
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
  };
}

export async function dbGetTaskById(taskId) {
  const p = getPool();
  if (!p) return null;
  const { rows } = await p.query('SELECT * FROM it_tasks WHERE task_id = $1', [
    taskId,
  ]);
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
  };
}

export async function dbDeleteTask(taskId) {
  const p = getPool();
  if (!p) return false;
  const { rowCount } = await p.query('DELETE FROM it_tasks WHERE task_id = $1', [
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
      p.query("SELECT COUNT(*) AS n FROM it_tasks WHERE status IN ('in_progress', 'review')"),
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
               COUNT(t.task_id) FILTER (WHERE t.status IN ('in_progress', 'review')) AS in_progress_count,
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

export async function dbGetTeamOverview() {
  const p = getPool();
  if (!p) return [];
  try {
    const { rows } = await p.query(`
      SELECT u.user_id, COALESCE(u.username, u.email) AS username, u.profile_image,
             u.is_it_developer, u.is_it_manager,
             COUNT(t.task_id) AS total_tasks,
             COUNT(t.task_id) FILTER (WHERE t.status = 'completed') AS completed_tasks,
             COUNT(t.task_id) FILTER (WHERE t.status IN ('in_progress', 'review')) AS in_progress_tasks
      FROM users u
      LEFT JOIN it_tasks t ON t.assigned_to = u.user_id
      GROUP BY u.user_id, u.username, u.email, u.profile_image, u.is_it_developer, u.is_it_manager
      ORDER BY total_tasks DESC
    `);
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
               COUNT(*) AS total, COUNT(*) FILTER (WHERE t.status = 'in_progress') AS in_progress,
               COUNT(*) FILTER (WHERE t.status = 'review') AS review,
               COUNT(*) FILTER (WHERE t.status = 'completed') AS completed
        FROM it_tasks t GROUP BY t.assigned_to
      `);
      return rows.map((r) => ({
        assignee: r.assignee || 'Unassigned',
        total_tasks: Number(r.total),
        in_progress_tasks: Number(r.in_progress) + Number(r.review),
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

export async function dbGetRequirements(taskId) {
  const p = getPool();
  if (!p) return [];
  try {
    // Check if table exists
    const { rows: tableCheck } = await p.query(
      "SELECT EXISTS (SELECT FROM information_schema.tables WHERE table_name = 'it_task_requirements')"
    );
    if (!tableCheck[0]?.exists) return [];

    const { rows } = await p.query(
      'SELECT * FROM it_task_requirements WHERE task_id = $1 ORDER BY sort_order, requirement_id',
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

export async function dbCreateRequirement(taskId, data) {
  const p = getPool();
  if (!p) return null;
  try {
    // Get next sort_order
    const { rows: maxRows } = await p.query(
      'SELECT COALESCE(MAX(sort_order), -1) + 1 AS next FROM it_task_requirements WHERE task_id = $1',
      [parseInt(taskId, 10)]
    );
    const nextOrder = maxRows[0]?.next ?? 0;

    const { rows: [row] } = await p.query(
      `INSERT INTO it_task_requirements (task_id, title, description, status, priority, due_date, sort_order)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING *`,
      [
        parseInt(taskId, 10),
        data.title ?? 'Untitled Requirement',
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

export async function dbUpdateRequirement(reqId, data) {
  const p = getPool();
  if (!p) return null;
  const allowed = ['title', 'description', 'status', 'priority', 'due_date', 'sort_order'];
  const updates = [];
  const values = [];
  let i = 1;
  for (const [k, v] of Object.entries(data)) {
    if (allowed.includes(k) && v !== undefined) {
      updates.push(`${k} = $${i}`);
      const val = (k === 'due_date') ? toNullableDate(v) : v;
      values.push(val);
      i++;
    }
  }
  if (updates.length === 0) return dbGetRequirementById(reqId);
  updates.push('updated_at = CURRENT_TIMESTAMP');
  values.push(reqId);
  try {
    const { rows } = await p.query(
      `UPDATE it_task_requirements SET ${updates.join(', ')} WHERE requirement_id = $${i} RETURNING *`,
      values
    );
    return rows[0] ? mapRequirement(rows[0]) : null;
  } catch (err) {
    console.error('dbUpdateRequirement:', err.message);
    return null;
  }
}

export async function dbDeleteRequirement(reqId) {
  const p = getPool();
  if (!p) return false;
  try {
    const { rowCount } = await p.query(
      'DELETE FROM it_task_requirements WHERE requirement_id = $1',
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
