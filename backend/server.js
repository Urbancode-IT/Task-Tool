import express from 'express';

import cors from 'cors';
import cookieParser from 'cookie-parser';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import bcrypt from 'bcrypt';
import * as db from './db/index.js';
import { requireAuth, attachUserPermissions, requirePermission, signAccessToken, signRefreshToken, verifyRefreshToken } from './middlewares/authMiddleware.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '.env') });

const COOKIE_OPTS = { httpOnly: true, sameSite: 'lax', secure: process.env.NODE_ENV === 'production' };

const app = express();

const PORT = process.env.PORT || 3000;
const CLIENT_ORIGIN = process.env.CLIENT_ORIGIN || 'http://localhost:5173';

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
      is_it_developer: Boolean(dbUser.is_it_developer),
      is_it_manager: Boolean(dbUser.is_it_manager),
    };
    try {
      user.permissions = await db.dbGetUserPermissionsOrLegacy(dbUser.user_id);
      user.roleIds = await db.dbGetUserRoleIds(dbUser.user_id);
    } catch (_) {
      user.permissions = [];
      user.roleIds = [];
    }
    const perms = user.permissions || [];
    if (perms.includes('admin.access')) user.role = 'Admin';
    else if (user.is_it_manager || perms.includes('it_updates.users')) user.role = 'IT Manager';
    else if (user.is_it_developer || (perms.includes('it_updates.manage') && perms.includes('it_updates.view')))
      user.role = 'IT Developer';
    else if (perms.includes('consultants.view') || perms.includes('consultants.manage')) user.role = 'Consultant';
    else if (perms.includes('digital_marketing.view') || perms.includes('digital_marketing.manage'))
      user.role = 'Digital Marketing';
    else user.role = 'User';
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
  safeUser.permissions = ['it_updates.view', 'it_updates.manage', 'it_updates.users', 'admin.access'];
  safeUser.roleIds = [];
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

// Async middleware wrapper for Express
const asyncMw = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

// ---- IT Updates API (JWT auth; any authenticated user can access — attach permissions for UI) ----
const BASE_PATH = '/api/it-updates';
app.use(BASE_PATH, requireAuth, asyncMw(attachUserPermissions));

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

// Users — admin only (UI moved to Admin dashboard)
app.get(`${BASE_PATH}/users`, requirePermission('admin.access'), async (req, res) => {
  try {
    if (db.useDb()) {
      const list = await db.dbGetUsersWithRoles();
      return res.json(
        list.map((row) => ({
          user_id: row.user_id,
          username: row.username,
          email: row.email,
          is_it_developer: row.is_it_developer,
          is_it_manager: row.is_it_manager,
          created_at: row.created_at,
          role_names: row.role_names || [],
          role_codes: row.role_codes || [],
        }))
      );
    }
    const safe = users.map((u) => ({
      user_id: u.id,
      username: u.name || u.email,
      email: u.email,
      is_it_developer: u.role === 'IT Developer',
      is_it_manager: u.role === 'IT Manager' || u.role === 'IT Admin',
      role_names: [u.role].filter(Boolean),
      role_codes:
        u.role === 'IT Admin'
          ? ['admin']
          : u.role === 'IT Manager'
            ? ['it_manager']
            : u.role === 'IT Developer'
              ? ['it_developer']
              : u.role === 'Consultant'
                ? ['consultant']
                : u.role === 'Digital Marketing'
                  ? ['digital_marketing']
                  : [],
    }));
    res.json(safe);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Failed to fetch users' });
  }
});

app.post(`${BASE_PATH}/users`, requirePermission('admin.access'), async (req, res) => {
  try {
    const { username, email, password, is_it_developer, is_it_manager } = req.body || {};
    const name = (username || '').trim();
    if (!name) return res.status(400).json({ message: 'Username is required' });
    const pwd = (password || '').trim();
    if (!pwd) return res.status(400).json({ message: 'Password is required' });

    if (db.useDb()) {
      const password_hash = await bcrypt.hash(pwd, 10);
      const created = await db.dbCreateUser({
        username: name,
        email: email && String(email).trim() ? String(email).trim() : null,
        password_hash,
        is_it_developer: Boolean(is_it_developer),
        is_it_manager: Boolean(is_it_manager),
      });
      if (!created) return res.status(500).json({ message: 'Failed to create user (maybe username already exists)' });
      return res.status(201).json(created);
    }
    const newUser = {
      id: makeId('u'),
      name,
      email: (email || '').trim() || undefined,
      password: pwd,
      role: is_it_manager ? 'IT Manager' : (is_it_developer ? 'IT Developer' : 'User'),
    };
    users.push(newUser);
    res.status(201).json({
      user_id: newUser.id,
      username: newUser.name,
      email: newUser.email,
      is_it_developer: newUser.role === 'IT Developer',
      is_it_manager: newUser.role === 'IT Manager',
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Failed to create user' });
  }
});

app.put(`${BASE_PATH}/users/:userId`, requirePermission('admin.access'), async (req, res) => {
  try {
    const { userId } = req.params;
    const { username, email, password, is_it_developer, is_it_manager } = req.body || {};

    if (db.useDb()) {
      const payload = {};
      if (username !== undefined) payload.username = String(username || '').trim();
      if (email !== undefined) payload.email = email && String(email).trim() ? String(email).trim() : null;
      if (is_it_developer !== undefined) payload.is_it_developer = Boolean(is_it_developer);
      if (is_it_manager !== undefined) payload.is_it_manager = Boolean(is_it_manager);
      if (password && String(password).trim()) {
        payload.password_hash = await bcrypt.hash(String(password).trim(), 10);
      }
      const updated = await db.dbUpdateUser(userId, payload);
      if (!updated) return res.status(404).json({ message: 'User not found' });
      return res.json(updated);
    }
    const idx = users.findIndex((u) => String(u.id) === String(userId));
    if (idx === -1) return res.status(404).json({ message: 'User not found' });
    if (username !== undefined) users[idx].name = String(username || '').trim();
    if (email !== undefined) users[idx].email = (email || '').trim() || undefined;
    if (password && String(password).trim()) users[idx].password = String(password).trim();
    if (is_it_manager !== undefined || is_it_developer !== undefined) {
      const manager = is_it_manager !== undefined ? is_it_manager : (users[idx].role === 'IT Manager' || users[idx].role === 'IT Admin');
      const dev = is_it_developer !== undefined ? is_it_developer : (users[idx].role === 'IT Developer');
      users[idx].role = manager ? 'IT Manager' : (dev ? 'IT Developer' : 'User');
    }
    res.json({
      user_id: users[idx].id,
      username: users[idx].name,
      email: users[idx].email,
      is_it_developer: users[idx].role === 'IT Developer',
      is_it_manager: users[idx].role === 'IT Manager',
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Failed to update user' });
  }
});

app.delete(`${BASE_PATH}/users/:userId`, requirePermission('admin.access'), async (req, res) => {
  try {
    const { userId } = req.params;
    if (db.useDb()) {
      const ok = await db.dbDeleteUser(userId);
      if (!ok) return res.status(404).json({ message: 'User not found' });
      return res.status(204).send();
    }
    const before = users.length;
    users = users.filter((u) => String(u.id) !== String(userId));
    if (users.length === before) return res.status(404).json({ message: 'User not found' });
    res.status(204).send();
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Failed to delete user' });
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
        team: req.query.team || null,
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
      const task = await db.dbCreateTask({ ...req.body, team: req.body?.team || req.query?.team });
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
      const task = await db.dbUpdateTask(req.params.taskId, { ...req.body, team: req.body?.team || req.query?.team });
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
      const ok = await db.dbDeleteTask(req.params.taskId, req.query?.team || null);
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
      const list = await db.dbGetTeamOverview(req.query.team || null);
      return res.json(list);
    }
    const byAssignee = tasks.reduce((acc, task) => {
      const key = task.assignee || 'Unassigned';
      if (!acc[key]) acc[key] = { assignee: key, total_tasks: 0, in_progress_tasks: 0, completed_tasks: 0 };
      acc[key].total_tasks += 1;
      if (task.status === 'in_progress' || task.status === 'review' || task.status === 'rework') acc[key].in_progress_tasks += 1;
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
      const list = await db.dbGetRequirements(taskId, req.query?.team || null);
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
      const req2 = await db.dbCreateRequirement(taskId, req.body, req.body?.team || req.query?.team || null);
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
      const updated = await db.dbUpdateRequirement(reqId, req.body, taskId, req.body?.team || req.query?.team || null);
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
      const ok = await db.dbDeleteRequirement(reqId, taskId, req.query?.team || null);
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

// ---- Admin API (RBAC: requires admin.access) ----
const ADMIN_PATH = '/api/admin';
app.use(ADMIN_PATH, requireAuth, asyncMw(attachUserPermissions), requirePermission('admin.access'));

app.get(`${ADMIN_PATH}/permissions`, async (req, res) => {
  try {
    if (db.useDb()) {
      const list = await db.dbGetPermissions();
      return res.json(list);
    }
    res.json([
      { code: 'it_updates.view', name: 'View IT Updates', module: 'it_updates' },
      { code: 'it_updates.manage', name: 'Manage IT Updates', module: 'it_updates' },
      { code: 'admin.access', name: 'Admin Access', module: 'admin' },
    ]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Failed to fetch permissions' });
  }
});

app.get(`${ADMIN_PATH}/roles`, async (req, res) => {
  try {
    if (db.useDb()) {
      const list = await db.dbGetRoles();
      return res.json(list);
    }
    res.json([{ role_id: 1, name: 'Admin', code: 'admin' }, { role_id: 2, name: 'IT Manager', code: 'it_manager' }, { role_id: 3, name: 'IT Developer', code: 'it_developer' }]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Failed to fetch roles' });
  }
});

app.get(`${ADMIN_PATH}/roles/:roleId/permissions`, async (req, res) => {
  try {
    if (db.useDb()) {
      const list = await db.dbGetRolePermissions(req.params.roleId);
      return res.json(list);
    }
    res.json([]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Failed to fetch role permissions' });
  }
});

app.put(`${ADMIN_PATH}/roles/:roleId/permissions`, async (req, res) => {
  try {
    const permissionIds = Array.isArray(req.body.permission_ids) ? req.body.permission_ids : [];
    if (db.useDb()) {
      await db.dbSetRolePermissions(req.params.roleId, permissionIds);
      const ip = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.socket?.remoteAddress;
      await db.dbCreateAuditLog({
        userId: req.user?.id,
        action: 'role_permissions_updated',
        resource: 'role',
        resourceId: req.params.roleId,
        details: { permission_ids: permissionIds },
        ipAddress: ip,
      });
      const list = await db.dbGetRolePermissions(req.params.roleId);
      return res.json(list);
    }
    res.json([]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Failed to update role permissions' });
  }
});

app.get(`${ADMIN_PATH}/tasks/pending-summary`, async (req, res) => {
  try {
    if (db.useDb()) {
      const summary = await db.dbGetAdminPendingSummary();
      return res.json(summary);
    }
    // Fallback for demo mode (no DB): no deadlines available
    return res.json({ pending_count: 0, review_count: 0, overdue_count: 0, overdue_tasks: [] });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Failed to fetch pending summary' });
  }
});

app.get(`${ADMIN_PATH}/tasks`, async (req, res) => {
  try {
    if (db.useDb()) {
      const list = await db.dbGetTasksSimple({
        status: req.query.status || undefined,
        team: req.query.team || undefined,
        overdue: req.query.overdue,
      });
      return res.json(list);
    }
    return res.json([]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Failed to fetch tasks' });
  }
});

app.get(`${ADMIN_PATH}/departments`, async (req, res) => {
  try {
    if (db.useDb()) {
      const list = await db.dbGetDepartments();
      return res.json(list);
    }
    res.json([{ name: 'IT Team', code: 'it' }, { name: 'Consultants Team', code: 'consultants' }, { name: 'Digital Marketing Team', code: 'digital_marketing' }]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Failed to fetch departments' });
  }
});

app.get(`${ADMIN_PATH}/users`, async (req, res) => {
  try {
    if (db.useDb()) {
      const list = await db.dbGetUsersWithRoles();
      return res.json(list);
    }
    const safe = users.map((u) => ({ user_id: u.id, username: u.name || u.email, email: u.email, role_names: [u.role], role_codes: [u.role === 'IT Admin' ? 'admin' : u.role === 'IT Manager' ? 'it_manager' : 'it_developer'] }));
    res.json(safe);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Failed to fetch users' });
  }
});

app.post(`${ADMIN_PATH}/users`, async (req, res) => {
  try {
    const { username, email, password, is_it_developer, is_it_manager } = req.body || {};
    const name = (username || '').trim();
    if (!name) return res.status(400).json({ message: 'Username is required' });
    const pwd = (password || '').trim();
    if (!pwd) return res.status(400).json({ message: 'Password is required' });

    if (db.useDb()) {
      const password_hash = await bcrypt.hash(pwd, 10);
      const created = await db.dbCreateUser({
        username: name,
        email: email && String(email).trim() ? String(email).trim() : null,
        password_hash,
        is_it_developer: Boolean(is_it_developer),
        is_it_manager: Boolean(is_it_manager),
      });
      if (!created) return res.status(500).json({ message: 'Failed to create user (maybe username already exists)' });
      const list = await db.dbGetUsersWithRoles();
      const row = list.find((u) => String(u.user_id) === String(created.user_id));
      return res.status(201).json(row || created);
    }
    const newUser = {
      id: makeId('u'),
      name,
      email: (email || '').trim() || undefined,
      password: pwd,
      role: is_it_manager ? 'IT Manager' : is_it_developer ? 'IT Developer' : 'User',
    };
    users.push(newUser);
    res.status(201).json({
      user_id: newUser.id,
      username: newUser.name,
      email: newUser.email,
      is_it_developer: newUser.role === 'IT Developer',
      is_it_manager: newUser.role === 'IT Manager',
      role_names: [newUser.role],
      role_codes: [],
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Failed to create user' });
  }
});

app.put(`${ADMIN_PATH}/users/:userId`, async (req, res) => {
  try {
    const { userId } = req.params;
    const { username, email, password, is_it_developer, is_it_manager } = req.body || {};

    if (db.useDb()) {
      const payload = {};
      if (username !== undefined) payload.username = String(username || '').trim();
      if (email !== undefined) payload.email = email && String(email).trim() ? String(email).trim() : null;
      if (is_it_developer !== undefined) payload.is_it_developer = Boolean(is_it_developer);
      if (is_it_manager !== undefined) payload.is_it_manager = Boolean(is_it_manager);
      if (password && String(password).trim()) {
        payload.password_hash = await bcrypt.hash(String(password).trim(), 10);
      }
      const updated = await db.dbUpdateUser(userId, payload);
      if (!updated) return res.status(404).json({ message: 'User not found' });
      const list = await db.dbGetUsersWithRoles();
      const row = list.find((u) => String(u.user_id) === String(userId));
      return res.json(row || updated);
    }
    const idx = users.findIndex((u) => String(u.id) === String(userId));
    if (idx === -1) return res.status(404).json({ message: 'User not found' });
    if (username !== undefined) users[idx].name = String(username || '').trim();
    if (email !== undefined) users[idx].email = (email || '').trim() || undefined;
    if (password && String(password).trim()) users[idx].password = String(password).trim();
    if (is_it_manager !== undefined || is_it_developer !== undefined) {
      const manager = is_it_manager !== undefined ? is_it_manager : users[idx].role === 'IT Manager' || users[idx].role === 'IT Admin';
      const dev = is_it_developer !== undefined ? is_it_developer : users[idx].role === 'IT Developer';
      users[idx].role = manager ? 'IT Manager' : dev ? 'IT Developer' : 'User';
    }
    res.json({
      user_id: users[idx].id,
      username: users[idx].name,
      email: users[idx].email,
      is_it_developer: users[idx].role === 'IT Developer',
      is_it_manager: users[idx].role === 'IT Manager',
      role_names: [users[idx].role],
      role_codes: [],
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Failed to update user' });
  }
});

app.delete(`${ADMIN_PATH}/users/:userId`, async (req, res) => {
  try {
    const { userId } = req.params;
    if (db.useDb()) {
      const ok = await db.dbDeleteUser(userId);
      if (!ok) return res.status(404).json({ message: 'User not found' });
      try {
        const ip = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.socket?.remoteAddress;
        await db.dbCreateAuditLog({
          userId: req.user?.id,
          action: 'user_deleted',
          resource: 'user',
          resourceId: userId,
          details: null,
          ipAddress: ip,
        });
      } catch (_) {}
      return res.status(204).send();
    }
    const before = users.length;
    const next = users.filter((u) => String(u.id) !== String(userId));
    if (next.length === before) return res.status(404).json({ message: 'User not found' });
    users.length = 0;
    users.push(...next);
    res.status(204).send();
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Failed to delete user' });
  }
});

app.put(`${ADMIN_PATH}/users/:userId/roles`, async (req, res) => {
  try {
    const roleIds = Array.isArray(req.body.role_ids) ? req.body.role_ids.map((id) => parseInt(id, 10)).filter(Number.isFinite) : [];
    if (db.useDb()) {
      await db.dbSetUserRoles(req.params.userId, roleIds, req.user?.id);
      const ip = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.socket?.remoteAddress;
      await db.dbCreateAuditLog({
        userId: req.user?.id,
        action: 'user_roles_updated',
        resource: 'user',
        resourceId: req.params.userId,
        details: { role_ids: roleIds },
        ipAddress: ip,
      });
      const list = await db.dbGetUsersWithRoles();
      const user = list.find((u) => String(u.user_id) === String(req.params.userId));
      return res.json(user || {});
    }
    res.json({});
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Failed to update user roles' });
  }
});

app.get(`${ADMIN_PATH}/audit-log`, async (req, res) => {
  try {
    if (db.useDb()) {
      const list = await db.dbGetAuditLogs({
        userId: req.query.user_id || undefined,
        resource: req.query.resource || undefined,
        limit: Math.min(parseInt(req.query.limit, 10) || 100, 500),
        offset: parseInt(req.query.offset, 10) || 0,
      });
      return res.json(list);
    }
    res.json([]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Failed to fetch audit log' });
  }
});

// Log audit event (e.g. from frontend for significant actions)
app.post(`${ADMIN_PATH}/audit-log`, async (req, res) => {
  try {
    const { action, resource, resource_id, details } = req.body || {};
    if (!action || !resource) return res.status(400).json({ message: 'action and resource required' });
    if (db.useDb()) {
      const ip = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.socket?.remoteAddress;
      await db.dbCreateAuditLog({
        userId: req.user?.id,
        action: String(action),
        resource: String(resource),
        resourceId: resource_id ?? null,
        details: details ?? null,
        ipAddress: ip,
      });
      return res.status(201).json({ success: true });
    }
    res.status(201).json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Failed to create audit entry' });
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

