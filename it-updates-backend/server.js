import express from 'express';

import cors from 'cors';
import cookieParser from 'cookie-parser';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import bcrypt from 'bcrypt';
import * as db from './db/index.js';
import { requireAuth, signAccessToken, signRefreshToken, verifyRefreshToken } from './middlewares/authMiddleware.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '.env') });

const COOKIE_OPTS = { httpOnly: true, sameSite: 'lax', secure: process.env.NODE_ENV === 'production' };

const app = express();

const PORT = process.env.PORT || 3000;
const CLIENT_ORIGIN = process.env.CLIENT_ORIGIN || 'http://localhost:5174';

app.use(
  cors({
    origin: CLIENT_ORIGIN,
    credentials: true,
  })
);

app.use(express.json());
app.use(cookieParser());

// In-memory demo users (used for login when no DB or for dev)
const users = [
  {
    id: 'u1',
    name: 'Demo User',
    email: 'demo@uc.com',
    password: 'password123',
    role: 'IT Admin',
  },
];

// In-memory demo data (used only when DATABASE_URL is not set)
let projects = [
  {
    id: 'p1',
    name: 'Network Upgrade',
    status: 'active',
    owner: 'IT Team',
    progress: 60,
  },
];

let tasks = [
  {
    id: 't1',
    title: 'Replace office switches',
    status: 'in_progress',
    assignee: 'John Doe',
    projectId: 'p1',
    dueDate: new Date().toISOString(),
  },
];

let commentsByTaskId = {
  t1: [
    {
      id: 'c1',
      taskId: 't1',
      author: 'John Doe',
      message: 'Waiting for new hardware delivery.',
      createdAt: new Date().toISOString(),
    },
  ],
};

const makeId = (prefix) => `${prefix}_${Math.random().toString(36).slice(2, 9)}`;

// ---- Auth: login + refresh (JWT cookie-based). DB users only when DB connected. ----
app.post('/auth/login', async (req, res) => {
  const { email, password } = req.body || {};
  const identifier = (email || req.body.username || '').replace(/\s+/g, ' ').trim();
  const pwd = (password || '').trim();

  if (!identifier || !pwd) {
    return res.status(401).json({ message: 'Email/username and password required' });
  }

  if (db.useDb()) {
    const dbUser = await db.dbFindUserByEmailOrUsername(identifier);
    if (!dbUser) {
      console.warn('Login failed: user not found. Run: npm run db:seed-users');
      return res.status(401).json({ message: 'Invalid email/username or password' });
    }
    const match = await bcrypt.compare(pwd, dbUser.password_hash);
    if (!match) {
      console.warn('Login failed: wrong password for user', dbUser.username);
      return res.status(401).json({ message: 'Invalid email/username or password' });
    }
    const user = {
      id: String(dbUser.user_id),
      user_id: dbUser.user_id,
      name: dbUser.username,
      username: dbUser.username,
      email: dbUser.email,
      role: dbUser.is_it_manager ? 'IT Manager' : (dbUser.is_it_developer ? 'IT Developer' : 'User'),
      is_it_developer: Boolean(dbUser.is_it_developer),
      is_it_manager: Boolean(dbUser.is_it_manager),
    };
    const payload = { id: user.id, email: user.email };
    const access = signAccessToken(payload);
    const refresh = signRefreshToken(payload);
    if (access) {
      res.cookie('access_token', access, COOKIE_OPTS);
      res.cookie('refresh_token', refresh, { ...COOKIE_OPTS, maxAge: 7 * 24 * 60 * 60 * 1000 });
    } else {
      res.cookie('access_token', 'demo-token', COOKIE_OPTS);
    }
    return res.json({ user });
  }

  const user = users.find((u) => u.email === identifier && u.password === pwd);
  if (!user) {
    return res.status(401).json({ message: 'Invalid email or password' });
  }
  const payload = { id: user.id, email: user.email };
  const access = signAccessToken(payload);
  const refresh = signRefreshToken(payload);
  if (access) {
    res.cookie('access_token', access, COOKIE_OPTS);
    res.cookie('refresh_token', refresh, { ...COOKIE_OPTS, maxAge: 7 * 24 * 60 * 60 * 1000 });
  } else {
    res.cookie('access_token', 'demo-token', COOKIE_OPTS);
  }
  const { password: _pw, ...safeUser } = user;
  res.json({ user: safeUser });
});

app.post('/auth/refresh', (req, res) => {
  const token = req.cookies?.refresh_token;
  if (!token) return res.status(401).json({ message: 'Refresh token required' });
  const decoded = verifyRefreshToken(token);
  if (!decoded) return res.status(401).json({ message: 'Invalid or expired refresh token' });
  const access = signAccessToken({ id: decoded.id, email: decoded.email });
  if (access) {
    res.cookie('access_token', access, COOKIE_OPTS);
    return res.json({ success: true });
  }
  res.cookie('access_token', 'demo-token', COOKIE_OPTS);
  res.json({ success: true });
});

app.post('/auth/refresh-token', (req, res) => {
  const token = req.cookies?.refresh_token;
  if (token) {
    const decoded = verifyRefreshToken(token);
    if (decoded) {
      const access = signAccessToken({ id: decoded.id, email: decoded.email });
      if (access) {
        res.cookie('access_token', access, COOKIE_OPTS);
        return res.json({ success: true });
      }
    }
  }
  res.cookie('access_token', 'demo-token', COOKIE_OPTS);
  res.json({ success: true });
});

// ---- IT Updates API (JWT auth when JWT_SECRET set) ----
const BASE_PATH = '/api/it-updates';
app.use(BASE_PATH, requireAuth);

// Projects (must be in table it_projects — run db/schema.sql if missing)
app.get(`${BASE_PATH}/projects`, async (req, res) => {
  try {
    if (db.useDb()) {
      const list = await db.dbGetProjects(req.query.status || null);
      if (list.length === 0) {
        console.warn('GET /projects: 0 rows. Ensure table it_projects exists (run it-updates-backend/db/schema.sql in your It_updates database).');
      } else {
        console.log('GET /projects: fetched', list.length, 'project(s) from database');
      }
      return res.json(list);
    }
    const { status } = req.query;
    const filtered = status ? projects.filter((p) => p.status === status) : projects;
    res.json(filtered);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Failed to fetch projects' });
  }
});

app.post(`${BASE_PATH}/projects`, async (req, res) => {
  try {
    if (db.useDb()) {
      const body = { ...req.body, name: req.body.name ?? req.body.project_name };
      const project = await db.dbCreateProject(body);
      if (!project) return res.status(500).json({ message: 'Failed to create project' });
      return res.status(201).json(project);
    }
    const project = {
      id: makeId('p'),
      name: req.body.name ?? req.body.project_name ?? 'Untitled Project',
      status: req.body.status ?? 'active',
      owner: req.body.owner ?? 'IT Team',
      progress: req.body.progress ?? 0,
      ...req.body,
    };
    projects.push(project);
    res.status(201).json(project);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Failed to create project' });
  }
});

app.put(`${BASE_PATH}/projects/:projectId`, async (req, res) => {
  try {
    if (db.useDb()) {
      const project = await db.dbUpdateProject(req.params.projectId, req.body);
      if (!project) return res.status(404).json({ message: 'Project not found' });
      return res.json(project);
    }
    const { projectId } = req.params;
    const idx = projects.findIndex((p) => p.id === projectId);
    if (idx === -1) return res.status(404).json({ message: 'Project not found' });
    projects[idx] = { ...projects[idx], ...req.body };
    res.json(projects[idx]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Failed to update project' });
  }
});

app.delete(`${BASE_PATH}/projects/:projectId`, async (req, res) => {
  try {
    if (db.useDb()) {
      const ok = await db.dbDeleteProject(req.params.projectId);
      if (!ok) return res.status(404).json({ message: 'Project not found' });
      return res.status(204).send();
    }
    const { projectId } = req.params;
    const before = projects.length;
    projects = projects.filter((p) => p.id !== projectId);
    if (projects.length === before) return res.status(404).json({ message: 'Project not found' });
    res.status(204).send();
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Failed to delete project' });
  }
});

// Tasks (filters: project_id, assigned_to, status, priority, task_date, from_date, to_date)
app.get(`${BASE_PATH}/tasks`, async (req, res) => {
  try {
    if (db.useDb()) {
      const filters = {
        status: req.query.status || null,
        assigned_to: req.query.assigned_to || req.query.assignee || null,
        project_id: req.query.project_id || req.query.projectId || null,
        priority: req.query.priority || null,
        task_date: req.query.task_date || null,
        from_date: req.query.from_date || null,
        to_date: req.query.to_date || null,
      };
      const list = await db.dbGetTasksSimple(filters);
      return res.json(list);
    }
    const { status, assignee, projectId } = req.query;
    let result = tasks;
    if (status) result = result.filter((t) => t.status === status);
    if (assignee) result = result.filter((t) => t.assignee === assignee);
    if (projectId) result = result.filter((t) => t.projectId === projectId);
    res.json(result);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Failed to fetch tasks' });
  }
});

app.post(`${BASE_PATH}/tasks`, async (req, res) => {
  try {
    if (db.useDb()) {
      const task = await db.dbCreateTask(req.body);
      if (!task) return res.status(500).json({ message: 'Failed to create task' });
      return res.status(201).json(task);
    }
    const task = {
      id: makeId('t'),
      title: req.body.title ?? 'New Task',
      status: req.body.status ?? 'in_progress',
      assignee: req.body.assignee ?? 'Unassigned',
      projectId: req.body.projectId ?? null,
      dueDate: req.body.dueDate ?? new Date().toISOString(),
      ...req.body,
    };
    tasks.push(task);
    res.status(201).json(task);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Failed to create task' });
  }
});

app.put(`${BASE_PATH}/tasks/:taskId`, async (req, res) => {
  try {
    if (db.useDb()) {
      const task = await db.dbUpdateTask(req.params.taskId, req.body);
      if (!task) return res.status(404).json({ message: 'Task not found' });
      return res.json(task);
    }
    const { taskId } = req.params;
    const idx = tasks.findIndex((t) => t.id === taskId);
    if (idx === -1) return res.status(404).json({ message: 'Task not found' });
    tasks[idx] = { ...tasks[idx], ...req.body };
    res.json(tasks[idx]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Failed to update task' });
  }
});

app.delete(`${BASE_PATH}/tasks/:taskId`, async (req, res) => {
  try {
    if (db.useDb()) {
      const ok = await db.dbDeleteTask(req.params.taskId);
      if (!ok) return res.status(404).json({ message: 'Task not found' });
      return res.status(204).send();
    }
    const { taskId } = req.params;
    const before = tasks.length;
    tasks = tasks.filter((t) => t.id !== taskId);
    if (tasks.length === before) return res.status(404).json({ message: 'Task not found' });
    delete commentsByTaskId[taskId];
    res.status(204).send();
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Failed to delete task' });
  }
});

// Task comments
app.get(`${BASE_PATH}/tasks/:taskId/comments`, async (req, res) => {
  try {
    if (db.useDb()) {
      const list = await db.dbGetTaskComments(req.params.taskId);
      return res.json(list);
    }
    const comments = commentsByTaskId[req.params.taskId] ?? [];
    res.json(comments);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Failed to fetch comments' });
  }
});

app.post(`${BASE_PATH}/tasks/:taskId/comments`, async (req, res) => {
  const { taskId } = req.params;
  const { message, author } = req.body;
  if (!message) return res.status(400).json({ message: 'Message is required' });
  try {
    if (db.useDb()) {
      const comment = await db.dbAddTaskComment(taskId, { ...req.body, author });
      if (!comment) return res.status(500).json({ message: 'Failed to add comment' });
      return res.status(201).json(comment);
    }
    const comment = {
      id: makeId('c'),
      taskId,
      author: author ?? 'System',
      message,
      createdAt: new Date().toISOString(),
    };
    if (!commentsByTaskId[taskId]) commentsByTaskId[taskId] = [];
    commentsByTaskId[taskId].push(comment);
    res.status(201).json(comment);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Failed to add comment' });
  }
});

// Dashboard stats — spec shape: { stats: { active_projects, active_tasks, completed_tasks }, projects, teamActivity }
app.get(`${BASE_PATH}/dashboard/stats`, async (req, res) => {
  try {
    if (db.useDb()) {
      try {
        const full = await db.dbGetDashboardStatsFull();
        return res.json(full);
      } catch {
        const legacy = await db.dbGetDashboardStats();
        return res.json({
          stats: {
            active_projects: legacy.activeProjects,
            active_tasks: legacy.totalTasks,
            completed_tasks: legacy.completedTasksToday,
          },
          projects: [],
          teamActivity: [],
          activeProjects: legacy.activeProjects,
          completedTasksToday: legacy.completedTasksToday,
        });
      }
    }
    res.json({
      stats: {
        active_projects: projects.filter((p) => p.status === 'active').length,
        active_tasks: tasks.length,
        completed_tasks: tasks.filter((t) => t.status === 'completed').length,
      },
      projects: [],
      teamActivity: [],
      activeProjects: projects.filter((p) => p.status === 'active').length,
      completedTasksToday: tasks.filter((t) => t.status === 'completed').length,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Failed to fetch dashboard stats' });
  }
});

// Team overview — users with task stats and is_it_developer, is_it_manager
app.get(`${BASE_PATH}/team-overview`, async (req, res) => {
  try {
    if (db.useDb()) {
      const list = await db.dbGetTeamOverview();
      return res.json(list);
    }
    const byAssignee = tasks.reduce((acc, task) => {
      const key = task.assignee || 'Unassigned';
      if (!acc[key]) acc[key] = { assignee: key, total_tasks: 0, in_progress_tasks: 0, completed_tasks: 0 };
      acc[key].total_tasks += 1;
      if (task.status === 'in_progress' || task.status === 'review') acc[key].in_progress_tasks += 1;
      if (task.status === 'completed') acc[key].completed_tasks += 1;
      return acc;
    }, {});
    res.json(Object.values(byAssignee));
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Failed to fetch team overview' });
  }
});

// EOD Reports
app.get(`${BASE_PATH}/eod-reports`, async (req, res) => {
  try {
    if (db.useDb()) {
      const list = await db.dbGetEodReports({ user_id: req.query.user_id, report_date: req.query.report_date });
      return res.json(list);
    }
    res.json([]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Failed to fetch EOD reports' });
  }
});

app.post(`${BASE_PATH}/eod-reports`, async (req, res) => {
  try {
    if (db.useDb()) {
      const report = await db.dbCreateEodReport(req.body);
      if (!report) return res.status(500).json({ message: 'Failed to create EOD report' });
      return res.status(201).json(report);
    }
    res.status(201).json({ id: makeId('eod'), ...req.body });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Failed to create EOD report' });
  }
});

// ── Task Requirements (subtasks) ──────────────────────────
// In-memory fallback
let requirementsByTaskId = {};
let reqIdCounter = 1;

// GET all requirements for a task
app.get(`${BASE_PATH}/tasks/:taskId/requirements`, async (req, res) => {
  const { taskId } = req.params;
  try {
    if (db.useDb()) {
      const list = await db.dbGetRequirements(taskId);
      return res.json(list);
    }
    res.json(requirementsByTaskId[taskId] || []);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Failed to fetch requirements' });
  }
});

// POST create a requirement
app.post(`${BASE_PATH}/tasks/:taskId/requirements`, async (req, res) => {
  const { taskId } = req.params;
  try {
    if (db.useDb()) {
      const req2 = await db.dbCreateRequirement(taskId, req.body);
      if (!req2) return res.status(500).json({ message: 'Failed to create requirement' });
      return res.status(201).json(req2);
    }
    const requirement = {
      id: reqIdCounter++,
      requirement_id: reqIdCounter,
      task_id: taskId,
      title: req.body.title ?? 'Untitled Requirement',
      description: req.body.description ?? null,
      status: req.body.status ?? 'pending',
      priority: req.body.priority ?? 'medium',
      due_date: req.body.due_date ?? null,
      sort_order: req.body.sort_order ?? 0,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
    if (!requirementsByTaskId[taskId]) requirementsByTaskId[taskId] = [];
    requirementsByTaskId[taskId].push(requirement);
    res.status(201).json(requirement);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Failed to create requirement' });
  }
});

// PUT update a requirement
app.put(`${BASE_PATH}/tasks/:taskId/requirements/:reqId`, async (req, res) => {
  const { taskId, reqId } = req.params;
  try {
    if (db.useDb()) {
      const updated = await db.dbUpdateRequirement(reqId, req.body);
      if (!updated) return res.status(404).json({ message: 'Requirement not found' });
      return res.json(updated);
    }
    const list = requirementsByTaskId[taskId] || [];
    const idx = list.findIndex((r) => String(r.id) === String(reqId));
    if (idx === -1) return res.status(404).json({ message: 'Requirement not found' });
    list[idx] = { ...list[idx], ...req.body, updated_at: new Date().toISOString() };
    res.json(list[idx]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Failed to update requirement' });
  }
});

// DELETE a requirement
app.delete(`${BASE_PATH}/tasks/:taskId/requirements/:reqId`, async (req, res) => {
  const { taskId, reqId } = req.params;
  try {
    if (db.useDb()) {
      const ok = await db.dbDeleteRequirement(reqId);
      if (!ok) return res.status(404).json({ message: 'Requirement not found' });
      return res.status(204).send();
    }
    const list = requirementsByTaskId[taskId] || [];
    const before = list.length;
    requirementsByTaskId[taskId] = list.filter((r) => String(r.id) !== String(reqId));
    if (requirementsByTaskId[taskId].length === before)
      return res.status(404).json({ message: 'Requirement not found' });
    res.status(204).send();
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Failed to delete requirement' });
  }
});


app.get('/', (req, res) => {
  res.send('IT Updates backend is running');
});

async function start() {
  const result = await db.testConnection();
  if (result.ok) {
    console.log('Database connected OK');
  } else {
    console.warn('Database not connected:', result.error);
    console.warn('Using in-memory data. Fix .env (DB_USER, DB_PASSWORD, DB_DATABASE, DB_HOST) and run db/schema.sql to use PostgreSQL.');
  }
  app.listen(PORT, () => {
    console.log(`IT Updates backend listening on http://localhost:${PORT}`);
  });
}
start();

