import express from 'express';

import cors from 'cors';
import cookieParser from 'cookie-parser';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import bcrypt from 'bcrypt';
import crypto from 'node:crypto';
import jwt from 'jsonwebtoken';
import * as db from './db/index.js';
import { sendMail, isMailConfigured, renderMail, applyEmailBranding } from './mailer.js';
import { startEodDirectorReport, startEodMemberReminders, startEodMidnightLock } from './eodReminder.js';
import { requireMasterScope } from './middlewares/masterMiddleware.js';
import { requireAuth, attachUserPermissions, requirePermission, signAccessToken, signRefreshToken, verifyRefreshToken } from './middlewares/authMiddleware.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '.env') });

// Frontend and backend run on different domains (Netlify -> Render).
// For cross-site XHR/fetch cookie auth, cookies must be SameSite=None; Secure.
const COOKIE_OPTS = {
  httpOnly: true,
  sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'lax',
  secure: process.env.NODE_ENV === 'production',
  path: '/',
};

const app = express();

const PORT = process.env.PORT || 3001;
/**
 * `cors` does an exact string match for `Origin`.
 * If `CLIENT_ORIGIN` contains a trailing `/`, browsers send without it, so CORS breaks.
 * Also allow multiple origins separated by commas.
 */
function normalizeOrigin(value) {
  if (value == null) return '';
  const s = String(value).trim();
  if (!s) return '';
  return s.replace(/\/+$/, '');
}

function getAllowedOrigins() {
  const raw = process.env.CLIENT_ORIGIN || '';
  const fromEnv = raw
    .split(',')
    .map((part) => normalizeOrigin(part))
    .filter(Boolean);

  if (process.env.NODE_ENV !== 'production') {
    // Always allow common local frontend origins in development.
    fromEnv.push('http://localhost:5173', 'http://localhost:5174', 'http://127.0.0.1:5173', 'http://127.0.0.1:5174');
  }

  return [...new Set(fromEnv)];
}

const allowedOrigins = getAllowedOrigins();
console.log('CORS allowed origins:', allowedOrigins.join(', ') || '(none configured)');

const corsOptions = {
  origin(origin, callback) {
    // Non-browser requests may not have an Origin header.
    if (!origin) return callback(null, true);

    const normalized = normalizeOrigin(origin);
    if (allowedOrigins.includes(normalized)) return callback(null, true);

    console.warn('CORS rejected Origin:', origin, '| allowed:', allowedOrigins.join(', '));
    callback(new Error('Not allowed by CORS'));
  },
  credentials: true,
};

app.use(
  cors(corsOptions)
);

// NOTE: CORS middleware above handles preflight requests; no extra OPTIONS route needed.

// Limit raised to fit base64-encoded project documents (10 MB file ≈ ~13.4 MB base64).
app.use(express.json({ limit: '25mb' }));
app.use(cookieParser());

// Capture this API's public origin from each request so avatar/logo URLs built in
// the DB layer are absolute and point back here (the frontend runs on a different
// origin). PUBLIC_API_URL/RENDER_EXTERNAL_URL, if set, still take precedence.
app.use((req, _res, next) => {
  db.setApiBaseFromRequest(req);
  next();
});

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

/** When a task leaves Review, record reviewer (session) + comment; when entering Review, clear prior review metadata. */
function mergeTaskReviewTransition(existing, incomingBody, reqUser) {
  const body = { ...incomingBody };
  if (!existing) return body;

  const prev = existing.status;
  const next = body.status !== undefined ? body.status : prev;

  if (body.reviewComment !== undefined && body.review_comment === undefined) {
    body.review_comment = body.reviewComment;
  }

  const rawId = reqUser?.id;
  const uidNum =
    rawId != null && String(rawId).trim() !== '' && Number.isFinite(Number(rawId))
      ? Number(rawId)
      : null;

  if (prev === 'review' && (next === 'completed' || next === 'rework')) {
    body.reviewed_by = uidNum;
    body.reviewed_at = new Date().toISOString();
    const t =
      body.review_comment !== undefined ? String(body.review_comment ?? '').trim() : '';
    body.review_comment = t || null;
  } else if (next === 'review' && prev !== 'review') {
    body.reviewed_by = null;
    body.review_comment = null;
    body.reviewed_at = null;
  } else if (prev === 'review' && next !== 'review' && next !== 'completed' && next !== 'rework') {
    body.reviewed_by = null;
    body.review_comment = null;
    body.reviewed_at = null;
  }

  return body;
}

/** Legal & Finance tasks: admins, or users with the Legal & Finance RBAC role (legal_finance.view / manage). */
function requireLegalFinanceAccess(req, res) {
  const perms = req.user?.permissions || [];
  if (perms.includes('admin.access')) return true;
  if (perms.includes('legal_finance.view') || perms.includes('legal_finance.manage')) return true;
  res.status(403).json({ message: 'Legal & Finance is only available to authorised users.' });
  return false;
}

function isLegalFinanceTeamString(team) {
  const t = String(team || '').trim();
  return t === 'legal_finance';
}

function isDirectorTeamString(team) {
  const t = String(team || '').trim().toLowerCase();
  return t === 'director' || t === 'directors';
}

/** Director tasks — read access: admins or any user with a Director role permission. */
function requireDirectorRead(req, res) {
  const perms = req.user?.permissions || [];
  if (perms.includes('admin.access')) return true;
  if (perms.includes('director.view') || perms.includes('director.manage')) return true;
  res.status(403).json({ message: 'Director tasks are only available to authorised users.' });
  return false;
}

/** Director tasks — write access: only directors (director.manage) may create/change them. */
function requireDirectorManage(req, res) {
  const perms = req.user?.permissions || [];
  if (perms.includes('director.manage')) return true;
  res.status(403).json({ message: 'Only directors can manage director tasks.' });
  return false;
}

async function buildUserFromDbUser(dbUser) {
  const user = {
    id: String(dbUser.user_id),
    user_id: dbUser.user_id,
    name: dbUser.username,
    username: dbUser.username,
    email: dbUser.email,
    // Return a short, cacheable avatar URL instead of the raw base64 blob.
    profile_image: db.avatarUrlFor(dbUser.user_id, dbUser.profile_image),
    is_it_developer: Boolean(dbUser.is_it_developer),
    is_it_manager: Boolean(dbUser.is_it_manager),
    is_master_admin: Boolean(dbUser.is_master_admin),
    branch: dbUser.branch ?? null,
  };
  try {
    const [perms, roleIds] = await Promise.all([
      db.dbGetUserPermissions(dbUser.user_id),
      db.dbGetUserRoleIds(dbUser.user_id),
    ]);
    const legacy = [];
    if (user.is_it_developer || user.is_it_manager) {
      legacy.push('it_updates.view', 'it_updates.manage', 'it_updates.users');
    }
    // The master tier comes from users.is_master_admin and nothing else. master implies
    // admin, so the console can reuse the existing admin endpoints.
    if (user.is_master_admin) legacy.push('master.access', 'admin.access');
    user.permissions = [...new Set([...(Array.isArray(perms) ? perms : []), ...legacy])];
    user.roleIds = Array.isArray(roleIds) ? roleIds : [];
  } catch (_) {
    user.permissions = [];
    user.roleIds = [];
  }
  const perms = user.permissions || [];
  if (user.is_master_admin) user.role = 'Master Admin';
  else if (perms.includes('admin.access')) user.role = 'Admin';
  else if (perms.includes('director.view') || perms.includes('director.manage')) user.role = 'Director';
  else if (user.is_it_manager || perms.includes('it_updates.users')) user.role = 'IT Manager';
  else if (user.is_it_developer || (perms.includes('it_updates.manage') && perms.includes('it_updates.view')))
    user.role = 'IT Developer';
  else if (perms.includes('consultants.view') || perms.includes('consultants.manage')) user.role = 'Consultant';
  else if (perms.includes('creative_team.view') || perms.includes('creative_team.manage'))
    user.role = 'Creative Team';
  else if (perms.includes('social_media.view') || perms.includes('social_media.manage'))
    user.role = 'Social Media Management';
  else if (perms.includes('legal_finance.view') || perms.includes('legal_finance.manage'))
    user.role = 'Legal & Finance';
  else user.role = 'User';

  // EOD lock: non-admins who missed the previous working day's EOD report are locked
  // out (blurred app) until an admin approves. Evaluated on login and session restore.
  try {
    const lock = await db.dbGetUserEodLockState(dbUser.user_id, perms.includes('admin.access'));
    user.eod_locked = Boolean(lock.locked);
    user.eod_lock_date = lock.date || null;
  } catch (_) {
    user.eod_locked = false;
    user.eod_lock_date = null;
  }
  return user;
}

const asyncMw = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

// Sensitive project fields are used only by internal projects and are visible
// only to that project's owners/team members or an admin.
const PROJECT_SECRET_FIELDS = ['frontend_url', 'backend_url', 'stack', 'deploy_platform', 'hosting_platform', 'admin_credentials'];
const isInternalProject = (project) => project?.project_type !== 'external';

function clearProjectSecrets(project) {
  const copy = { ...project, secrets_visible: false };
  for (const field of PROJECT_SECRET_FIELDS) copy[field] = '';
  return copy;
}

function stripProjectSecrets(payload) {
  for (const field of PROJECT_SECRET_FIELDS) delete payload[field];
  return payload;
}

function eraseProjectSecrets(payload) {
  for (const field of PROJECT_SECRET_FIELDS) payload[field] = '';
  return payload;
}

// Resolve { isAdmin, uid, username } for the requester (username lowercased for
// case-insensitive team-member matching; skipped for admins who always pass).
async function requesterIdentity(req) {
  const isAdmin = Array.isArray(req.user?.permissions) && req.user.permissions.includes('admin.access');
  const uid = req.user?.id != null ? String(req.user.id) : null;
  let username = req.user?.username || req.user?.name ? String(req.user.username || req.user.name).toLowerCase() : null;
  if (!isAdmin && uid) {
    try {
      const u = await db.dbGetUserById(uid);
      username = u?.username ? String(u.username).toLowerCase() : null;
    } catch { /* ignore */ }
  }
  return { isAdmin, uid, username };
}

// True when the requester may see/edit a project's sensitive fields: admin, primary/
// secondary owner (by id), or a listed team member (by username).
function projectSecretsAuthorized(project, { isAdmin, uid, username }) {
  if (isAdmin) return true;
  if (uid && (String(project.owner_user_id) === uid || String(project.secondary_owner_user_id) === uid)) return true;
  const mates = Array.isArray(project.teammates)
    ? project.teammates
    : String(project.teammates_text || '').split(',').map((s) => s.trim());
  return Boolean(username && mates.some((m) => String(m).toLowerCase() === username));
}

// Blank out the sensitive fields on any project the requester is not authorized to see,
// and add `secrets_visible` so the UI knows whether to show the section.
async function gateProjectSecrets(list, req) {
  const who = await requesterIdentity(req);
  return list.map((proj) => {
    if (isInternalProject(proj) && projectSecretsAuthorized(proj, who)) {
      return { ...proj, secrets_visible: true };
    }
    return clearProjectSecrets(proj);
  });
}

// Reject assigning a task/project to a KNOWN inactive user (only active users are
// assignable). Returns true when it is OK to proceed. No-ops for empty/unknown ids.
async function assigneeActiveOrReject(res, assignedTo) {
  if (assignedTo == null || assignedTo === '') return true;
  const active = await db.dbIsUserActive(assignedTo);
  if (!active) {
    res.status(400).json({ message: 'That user is inactive and cannot be assigned tasks or projects.' });
    return false;
  }
  return true;
}

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
    const user = await buildUserFromDbUser(dbUser);
    // The master admin has its own login page and console; it must not be able to
    // sign in here, and a normal account must not be able to sign in there.
    if (user.is_master_admin) {
      return res.status(403).json({ message: 'This account must sign in from the master console.' });
    }
    // Keep the JWT payload minimal: the user id and the session scope. A JWT is signed,
    // not encrypted, so anyone who can read the cookie can decode its claims — never put
    // PII (email, name, roles) here. Everything else is loaded server-side from the id.
    const payload = { id: user.id, scope: 'app' };
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
  const payload = { id: user.id };
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

/** Resolve session from access cookie, or refresh cookie if access expired (one round-trip for the client). */
function resolveSessionFromCookies(req, res) {
  const JWT_SECRET = process.env.JWT_SECRET;
  if (!JWT_SECRET) {
    const token = req.cookies?.access_token;
    if (!token) return { ok: false, status: 401, message: 'Not authenticated' };
    return { ok: true, decoded: { id: users[0]?.id, email: users[0]?.email }, demo: true };
  }

  const accessToken = req.cookies?.access_token;
  if (accessToken === 'demo-token') {
    const u = users[0];
    return { ok: true, decoded: { id: u?.id, email: u?.email }, demo: true };
  }

  if (accessToken) {
    try {
      return { ok: true, decoded: jwt.verify(accessToken, JWT_SECRET) };
    } catch {
      // access expired — fall through to refresh
    }
  }

  const refreshToken = req.cookies?.refresh_token;
  if (!refreshToken) {
    return { ok: false, status: 401, message: 'Not authenticated' };
  }

  const refreshDecoded = verifyRefreshToken(refreshToken);
  if (!refreshDecoded) {
    return { ok: false, status: 401, message: 'Invalid or expired refresh token' };
  }

  // Preserve the scope, or a master session would silently downgrade to app scope
  // the first time its 15-minute access token expired.
  const newAccess = signAccessToken({ id: refreshDecoded.id, scope: refreshDecoded.scope || 'app' });
  if (newAccess) {
    res.cookie('access_token', newAccess, COOKIE_OPTS);
  } else {
    res.cookie('access_token', 'demo-token', COOKIE_OPTS);
  }

  return { ok: true, decoded: refreshDecoded, refreshed: true };
}

/** Current session (cookies). Used on app load — do not trust localStorage alone. */
app.get('/auth/me', asyncMw(async (req, res) => {
  const JWT_SECRET = process.env.JWT_SECRET;

  const session = resolveSessionFromCookies(req, res);
  if (!session.ok) {
    return res.status(session.status || 401).json({ message: session.message || 'Not authenticated' });
  }

  if (!JWT_SECRET || session.demo) {
    const u = users[0];
    const { password: _pw, ...safeUser } = u;
    safeUser.permissions = ['it_updates.view', 'it_updates.manage', 'it_updates.users', 'admin.access'];
    safeUser.roleIds = [];
    return res.json({ user: safeUser });
  }

  const decoded = session.decoded;

  if (db.useDb()) {
    const dbUser = await db.dbGetUserById(decoded.id);
    if (!dbUser) return res.status(401).json({ message: 'User not found' });
    const user = await buildUserFromDbUser(dbUser);
    user.scope = decoded.scope === 'master' ? 'master' : 'app';
    user.is_master = user.scope === 'master' && (user.permissions || []).includes('master.access');
    return res.json({ user });
  }

  const u = users.find((x) => x.id === decoded.id);
  if (!u) return res.status(401).json({ message: 'User not found' });
  const { password: _pw, ...safeUser } = u;
  safeUser.permissions = ['it_updates.view', 'it_updates.manage', 'it_updates.users', 'admin.access'];
  safeUser.roleIds = [];
  res.json({ user: safeUser });
}));

/** Self-service: update the signed-in user's profile picture. */
app.put('/auth/me/avatar', asyncMw(async (req, res) => {
  const session = resolveSessionFromCookies(req, res);
  if (!session.ok) {
    return res.status(session.status || 401).json({ message: session.message || 'Not authenticated' });
  }
  if (!db.useDb() || session.demo) {
    return res.status(400).json({ message: 'Profile updates require a database connection.' });
  }
  const image = req.body?.profile_image ?? req.body?.image ?? null;
  const updatedRow = await db.dbUpdateUserProfileImage(session.decoded.id, image);
  if (!updatedRow) return res.status(500).json({ message: 'Failed to update profile picture' });
  const user = await buildUserFromDbUser(updatedRow);
  res.json({ user });
}));

app.post('/auth/refresh', (req, res) => {
  const token = req.cookies?.refresh_token;
  if (!token) return res.status(401).json({ message: 'Refresh token required' });
  const decoded = verifyRefreshToken(token);
  if (!decoded) return res.status(401).json({ message: 'Invalid or expired refresh token' });
  const access = signAccessToken({ id: decoded.id, scope: decoded.scope || 'app' });
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
      const access = signAccessToken({ id: decoded.id, scope: decoded.scope || 'app' });
      if (access) {
        res.cookie('access_token', access, COOKIE_OPTS);
        return res.json({ success: true });
      }
    }
  }
  res.cookie('access_token', 'demo-token', COOKIE_OPTS);
  res.json({ success: true });
});

/**
 * Master console login. Separate from /auth/login: it accepts only accounts holding
 * master.access and stamps the session with scope 'master', which is what
 * requireMasterScope checks on every /api/master route.
 */
app.post('/auth/master-login', asyncMw(async (req, res) => {
  const identifier = String(req.body?.email || req.body?.username || '').replace(/\s+/g, ' ').trim();
  const pwd = String(req.body?.password || '').trim();
  const deny = () => res.status(401).json({ message: 'Invalid master credentials' });

  if (!identifier || !pwd) return deny();
  if (!db.useDb()) {
    return res.status(503).json({ message: 'Master console requires a database connection.' });
  }

  const dbUser = await db.dbFindUserByEmailOrUsername(identifier);
  if (!dbUser) return deny();
  if (!(await bcrypt.compare(pwd, dbUser.password_hash))) return deny();

  const user = await buildUserFromDbUser(dbUser);
  if (!user.is_master_admin) {
    // Same message as a bad password: do not reveal that the account exists but
    // lacks the tier.
    return deny();
  }

  const payload = { id: user.id, scope: 'master' };
  const access = signAccessToken(payload);
  if (!access) {
    return res.status(503).json({ message: 'Master console requires JWT_SECRET to be configured.' });
  }
  res.cookie('access_token', access, COOKIE_OPTS);
  res.cookie('refresh_token', signRefreshToken(payload), { ...COOKIE_OPTS, maxAge: 7 * 24 * 60 * 60 * 1000 });

  user.scope = 'master';
  user.is_master = true;
  // A master session is never subject to the EOD lock.
  user.eod_locked = false;
  user.eod_lock_date = null;

  // Fire and forget: an audit write must never block or fail a valid sign-in.
  db.dbCreateAuditLog({
    userId: user.user_id,
    action: 'master.login',
    resource: 'auth',
    resourceId: String(user.user_id),
    ipAddress: req.ip,
  }).catch(() => {});

  res.json({ user });
}));

// ---- IT Updates API (JWT auth; any authenticated user can access — attach permissions for UI) ----
const BASE_PATH = '/api/it-updates';
app.use(BASE_PATH, requireAuth, asyncMw(attachUserPermissions));

// Serve a user's avatar as a real, cacheable image. List/detail endpoints now
// return a short `/users/:id/avatar` URL instead of inlining the base64 blob, so
// each avatar is fetched once and reused from browser cache. Any authenticated
// user may fetch any avatar (they were already visible embedded in team/task data).
app.get(`${BASE_PATH}/users/:userId/avatar`, asyncMw(async (req, res) => {
  if (!db.useDb()) return res.status(404).end();
  const dbUser = await db.dbGetUserById(req.params.userId);
  const image = dbUser?.profile_image;
  if (!image || typeof image !== 'string' || !image.startsWith('data:')) {
    return res.status(404).end();
  }
  const match = /^data:([^;,]+)?(;base64)?,(.*)$/s.exec(image);
  if (!match) return res.status(404).end();
  const mime = match[1] || 'image/jpeg';
  const isBase64 = Boolean(match[2]);
  const buf = isBase64
    ? Buffer.from(match[3], 'base64')
    : Buffer.from(decodeURIComponent(match[3]));
  const etag = '"' + crypto.createHash('sha1').update(image).digest('hex').slice(0, 16) + '"';
  if (req.headers['if-none-match'] === etag) return res.status(304).end();
  res.setHeader('Content-Type', mime);
  // The `?v=` hash in the URL changes when the image changes, so it is safe to
  // cache aggressively and immutably.
  res.setHeader('Cache-Control', 'private, max-age=31536000, immutable');
  res.setHeader('ETag', etag);
  return res.end(buf);
}));

// Serve a project's logo as a real, cacheable image (same rationale as avatars:
// list/detail endpoints return a short `/projects/:id/logo` URL instead of the
// base64 blob).
app.get(`${BASE_PATH}/projects/:projectId/logo`, asyncMw(async (req, res) => {
  if (!db.useDb()) return res.status(404).end();
  const image = await db.dbGetProjectLogoRaw(req.params.projectId);
  if (!image || typeof image !== 'string' || !image.startsWith('data:')) {
    return res.status(404).end();
  }
  const match = /^data:([^;,]+)?(;base64)?,(.*)$/s.exec(image);
  if (!match) return res.status(404).end();
  const mime = match[1] || 'image/png';
  const isBase64 = Boolean(match[2]);
  const buf = isBase64
    ? Buffer.from(match[3], 'base64')
    : Buffer.from(decodeURIComponent(match[3]));
  const etag = '"' + crypto.createHash('sha1').update(image).digest('hex').slice(0, 16) + '"';
  if (req.headers['if-none-match'] === etag) return res.status(304).end();
  res.setHeader('Content-Type', mime);
  res.setHeader('Cache-Control', 'private, max-age=31536000, immutable');
  res.setHeader('ETag', etag);
  return res.end(buf);
}));

// Projects (must be in table it_projects — run db/schema.sql if missing)
app.get(`${BASE_PATH}/projects`, async (req, res) => {
  try {
    if (db.useDb()) {
      const projectType =
        req.query.type === 'internal' || req.query.type === 'external' ? req.query.type : null;
      const list = await db.dbGetProjects(req.query.status || null, projectType);
      if (list.length === 0) {
        console.warn('GET /projects: 0 rows. Ensure table it_projects exists (run it-updates-backend/db/schema.sql in your It_updates database).');
      } else {
        console.log('GET /projects: fetched', list.length, 'project(s) from database');
      }
      // Deployment links, stack, hosting, and admin credentials are only exposed to a
      // project's owners (primary/secondary), its team members, and admins.
      const gated = await gateProjectSecrets(list, req);
      return res.json(gated);
    }
    const { status, type } = req.query;
    const filtered = projects.filter((p) =>
      (!status || p.status === status) &&
      (!type || p.project_type === type)
    );
    res.json(await gateProjectSecrets(filtered, req));
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Failed to fetch projects' });
  }
});

app.post(`${BASE_PATH}/projects`, async (req, res) => {
  try {
    if (req.body?.project_type === 'external') stripProjectSecrets(req.body);
    if (db.useDb()) {
      if (!(await assigneeActiveOrReject(res, req.body?.owner_user_id))) return;
      if (!(await assigneeActiveOrReject(res, req.body?.secondary_owner_user_id))) return;
      const body = { ...req.body, name: req.body.name ?? req.body.project_name };
      const project = await db.dbCreateProject(body);
      if (!project) return res.status(500).json({ message: 'Failed to create project' });
      return res.status(201).json(project);
    }
    const project = {
      id: makeId('p'),
      name: req.body.name ?? req.body.project_name ?? 'Untitled Project',
      status: req.body.status ?? 'active',
      owner: req.body.owner_name ?? req.body.owner ?? 'IT Team',
      owner_name: req.body.owner_name ?? req.body.owner ?? 'IT Team',
      owner_user_id: req.body.owner_user_id ?? null,
      teammates: Array.isArray(req.body.teammates) ? req.body.teammates : [],
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
      if (req.body?.owner_user_id !== undefined && !(await assigneeActiveOrReject(res, req.body.owner_user_id))) return;
      if (req.body?.secondary_owner_user_id !== undefined && !(await assigneeActiveOrReject(res, req.body.secondary_owner_user_id))) return;
      // Only owners/team members/admins may change the sensitive deployment/credential
      // fields; strip them from the payload for anyone else so they can't be overwritten.
      const existingProj = await db.dbGetProjectById(req.params.projectId);
      const resultingType = req.body?.project_type ?? existingProj?.project_type;
      if (resultingType === 'external') {
        eraseProjectSecrets(req.body);
      } else if (existingProj && !projectSecretsAuthorized(existingProj, await requesterIdentity(req))) {
        stripProjectSecrets(req.body);
      }
      const project = await db.dbUpdateProject(req.params.projectId, req.body);
      if (!project) return res.status(404).json({ message: 'Project not found' });
      return res.json(project);
    }
    const { projectId } = req.params;
    const idx = projects.findIndex((p) => p.id === projectId);
    if (idx === -1) return res.status(404).json({ message: 'Project not found' });
    const resultingType = req.body?.project_type ?? projects[idx].project_type;
    if (resultingType === 'external') eraseProjectSecrets(req.body);
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

/* ─── Project documents: Project Documentation / BRD / Credentials ───
   Any authenticated user may upload or view (per requirement). Files are
   base64 data URLs stored in project_documents (see db/index.js). */
const PROJECT_DOC_TYPES = ['project_documentation', 'brd', 'credentials'];

// Credential documents follow the same internal-project access rule as the
// credential fields: admins and that project's owners/team members only.
async function credentialDocumentAllowed(projectId, req) {
  const project = await db.dbGetProjectById(projectId);
  return Boolean(project && isInternalProject(project) && projectSecretsAuthorized(project, await requesterIdentity(req)));
}

// List a project's document slots (metadata only, no file payload).
app.get(`${BASE_PATH}/projects/:projectId/documents`, async (req, res) => {
  try {
    if (!db.useDb()) return res.json([]);
    const list = await db.dbListProjectDocuments(req.params.projectId);
    const mayAccessCredentials = await credentialDocumentAllowed(req.params.projectId, req);
    return res.json(mayAccessCredentials ? list : list.filter((doc) => doc.doc_type !== 'credentials'));
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Failed to fetch project documents' });
  }
});

// Fetch a single document including its file data (for view/download).
app.get(`${BASE_PATH}/projects/:projectId/documents/:docType`, async (req, res) => {
  try {
    const { docType } = req.params;
    if (!PROJECT_DOC_TYPES.includes(docType)) {
      return res.status(400).json({ message: 'Invalid document type' });
    }
    if (docType === 'credentials' && !(await credentialDocumentAllowed(req.params.projectId, req))) {
      return res.status(403).json({ message: 'You are not authorized to access this project credentials.' });
    }
    if (!db.useDb()) return res.status(404).json({ message: 'Document not found' });
    const doc = await db.dbGetProjectDocument(req.params.projectId, docType);
    if (!doc || !doc.file_data) return res.status(404).json({ message: 'Document not found' });
    return res.json(doc);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Failed to fetch document' });
  }
});

// Upload / replace a document slot.
app.put(`${BASE_PATH}/projects/:projectId/documents/:docType`, async (req, res) => {
  try {
    const { docType } = req.params;
    if (!PROJECT_DOC_TYPES.includes(docType)) {
      return res.status(400).json({ message: 'Invalid document type' });
    }
    if (docType === 'credentials' && !(await credentialDocumentAllowed(req.params.projectId, req))) {
      return res.status(403).json({ message: 'You are not authorized to manage this project credentials.' });
    }
    if (!db.useDb()) return res.status(503).json({ message: 'Database unavailable' });
    const { file_name, mime_type, file_data } = req.body || {};
    if (!file_data) return res.status(400).json({ message: 'file_data is required' });
    const saved = await db.dbUpsertProjectDocument(req.params.projectId, docType, {
      file_name,
      mime_type,
      file_data,
      uploaded_by: req.user?.id ?? null,
      uploaded_by_name: req.user?.name || req.user?.username || null,
    });
    if (!saved) return res.status(500).json({ message: 'Failed to save document' });
    return res.status(201).json(saved);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Failed to save document' });
  }
});

// Remove a document slot.
app.delete(`${BASE_PATH}/projects/:projectId/documents/:docType`, async (req, res) => {
  try {
    const { docType } = req.params;
    if (!PROJECT_DOC_TYPES.includes(docType)) {
      return res.status(400).json({ message: 'Invalid document type' });
    }
    if (docType === 'credentials' && !(await credentialDocumentAllowed(req.params.projectId, req))) {
      return res.status(403).json({ message: 'You are not authorized to manage this project credentials.' });
    }
    if (!db.useDb()) return res.status(503).json({ message: 'Database unavailable' });
    const ok = await db.dbDeleteProjectDocument(req.params.projectId, docType);
    if (!ok) return res.status(404).json({ message: 'Document not found' });
    return res.status(204).send();
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Failed to delete document' });
  }
});

/* ─── Project notes/comments (with @mentions → email) ───
   Reuses the shared comment thread. Any authenticated user can read/post. */
async function projectTitleFor(projectId) {
  try {
    const proj = await db.dbGetProjectById(projectId);
    return proj?.name || proj?.project_name || `Project #${projectId}`;
  } catch {
    return `Project #${projectId}`;
  }
}

app.get(`${BASE_PATH}/projects/:projectId/comments`, async (req, res) => {
  try {
    if (!db.useDb()) return res.json([]);
    const list = await db.dbGetProjectComments(req.params.projectId);
    return res.json(list);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Failed to fetch project comments' });
  }
});

app.post(`${BASE_PATH}/projects/:projectId/comments`, async (req, res) => {
  const { projectId } = req.params;
  const { message, author } = req.body || {};
  if (!message) return res.status(400).json({ message: 'Message is required' });
  try {
    if (!db.useDb()) return res.status(503).json({ message: 'Database unavailable' });
    const comment = await db.dbAddProjectComment(projectId, { ...req.body, author });
    if (!comment) return res.status(500).json({ message: 'Failed to add comment' });
    const clientMentions = (Array.isArray(req.body.mentions) ? req.body.mentions : []).map(String);
    const htmlMentions = extractMentionUidsFromHtml(comment.message);
    const mentionIds = [...new Set([...clientMentions, ...htmlMentions])];
    if (mentionIds.length) {
      const titleOverride = await projectTitleFor(projectId);
      notifyMentions({
        taskId: projectId,
        mentionIds,
        commenterName: comment.author,
        html: comment.message,
        titleOverride,
      }).catch((e) => console.error('notifyMentions:', e.message));
    }
    return res.status(201).json(comment);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Failed to add comment' });
  }
});

app.put(`${BASE_PATH}/projects/:projectId/comments/:commentId`, async (req, res) => {
  const { projectId, commentId } = req.params;
  const userId = req.body?.user_id;
  if (!userId) return res.status(400).json({ message: 'user_id is required' });
  try {
    if (!db.useDb()) return res.status(503).json({ message: 'Database unavailable' });
    const updated = await db.dbUpdateProjectComment(commentId, userId, req.body);
    if (!updated) return res.status(403).json({ message: 'You can only edit your own comment.' });
    const newMentionIds = Array.isArray(updated.newlyMentioned) ? updated.newlyMentioned : [];
    if (newMentionIds.length) {
      const titleOverride = await projectTitleFor(projectId);
      notifyMentions({
        taskId: projectId,
        mentionIds: newMentionIds,
        commenterName: updated.author,
        html: updated.message,
        titleOverride,
      }).catch((e) => console.error('notifyMentions:', e.message));
    }
    return res.json(updated);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Failed to update comment' });
  }
});

app.delete(`${BASE_PATH}/projects/:projectId/comments/:commentId`, async (req, res) => {
  const { commentId } = req.params;
  const userId = req.query.user_id || req.body?.user_id;
  if (!userId) return res.status(400).json({ message: 'user_id is required' });
  try {
    if (!db.useDb()) return res.status(503).json({ message: 'Database unavailable' });
    const isAdmin = (req.user?.permissions || []).includes('admin.access');
    const ok = await db.dbDeleteProjectComment(commentId, userId, isAdmin);
    if (!ok) return res.status(403).json({ message: 'You can only delete your own comment.' });
    return res.status(204).send();
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Failed to delete comment' });
  }
});

app.post(`${BASE_PATH}/projects/:projectId/comments/:commentId/like`, async (req, res) => {
  const { commentId } = req.params;
  const userId = req.body?.user_id;
  if (!userId) return res.status(400).json({ message: 'user_id is required' });
  try {
    if (!db.useDb()) return res.status(503).json({ message: 'Database unavailable' });
    const result = await db.dbToggleProjectCommentLike(commentId, userId);
    if (!result) return res.status(500).json({ message: 'Failed to like comment' });
    return res.json(result);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Failed to like comment' });
  }
});

// Users — admin only (UI moved to Admin dashboard)
// Master accounts are filtered out of every admin-facing user list, so an ordinary
// admin can neither see them nor reach the edit/delete controls for them.
async function isMasterUserId(userId) {
  try {
    const ids = await db.dbGetMasterAdminUserIds();
    return ids.map(String).includes(String(userId));
  } catch {
    return false; // never fail closed on a lookup error for a read path
  }
}

/** 404 (not 403) for master targets: an admin should not learn the account exists. */
async function blockMasterTarget(req, res) {
  if (await isMasterUserId(req.params.userId)) {
    res.status(404).json({ message: 'User not found' });
    return true;
  }
  return false;
}

async function withoutMasterAccounts(list) {
  if (!Array.isArray(list) || list.length === 0) return list;
  try {
    const masterIds = new Set((await db.dbGetMasterAdminUserIds()).map(String));
    if (masterIds.size === 0) return list;
    return list.filter((u) => !masterIds.has(String(u.user_id ?? u.id)));
  } catch {
    return list;
  }
}

app.get(`${BASE_PATH}/users`, requirePermission('admin.access'), async (req, res) => {
  try {
    if (db.useDb()) {
      const list = await withoutMasterAccounts(await db.dbGetUsersWithRoles());
      return res.json(
        list.map((row) => ({
          user_id: row.user_id,
          username: row.username,
          email: row.email,
          is_it_developer: row.is_it_developer,
          is_it_manager: row.is_it_manager,
          branch: row.branch ?? null,
          is_active: row.is_active !== false,
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
                : u.role === 'Creative Team'
                  ? ['creative_team']
                  : u.role === 'Social Media Management'
                    ? ['social_media']
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
    const { username, email, password, is_it_developer, is_it_manager, branch, is_active } = req.body || {};
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
        branch: branch ?? null,
        is_active: is_active === undefined ? true : Boolean(is_active),
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
  if (await blockMasterTarget(req, res)) return;
  try {
    const { userId } = req.params;
    const { username, email, password, is_it_developer, is_it_manager, branch, is_active } = req.body || {};

    if (db.useDb()) {
      const payload = {};
      if (username !== undefined) payload.username = String(username || '').trim();
      if (email !== undefined) payload.email = email && String(email).trim() ? String(email).trim() : null;
      if (is_it_developer !== undefined) payload.is_it_developer = Boolean(is_it_developer);
      if (is_it_manager !== undefined) payload.is_it_manager = Boolean(is_it_manager);
      if (branch !== undefined) payload.branch = branch && String(branch).trim() ? String(branch).trim() : null;
      if (is_active !== undefined) payload.is_active = Boolean(is_active);
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
  if (await blockMasterTarget(req, res)) return;
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

// Directors — users holding the Director role. Used to populate assigner/assignee
// pickers for director-to-director tasks. Available to directors and admins.
app.get(`${BASE_PATH}/directors`, async (req, res) => {
  try {
    if (!requireDirectorRead(req, res)) return;
    if (db.useDb()) {
      const list = await db.dbGetUsersByRoleCode('director');
      return res.json(Array.isArray(list) ? list : []);
    }
    return res.json([]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Failed to fetch directors' });
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
        branch: req.query.branch || null,
      };
      if (isLegalFinanceTeamString(filters.team) && !requireLegalFinanceAccess(req, res)) return;
      if (isDirectorTeamString(filters.team) && !requireDirectorRead(req, res)) return;
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
      const teamForCreate = req.body?.team || req.query?.team;
      if (isLegalFinanceTeamString(teamForCreate) && !requireLegalFinanceAccess(req, res)) return;
      if (isDirectorTeamString(teamForCreate) && !requireDirectorManage(req, res)) return;
      if (!(await assigneeActiveOrReject(res, req.body?.assigned_to))) return;
      const task = await db.dbCreateTask({ ...req.body, team: teamForCreate });
      if (!task) return res.status(500).json({ message: 'Failed to create task' });
      // Notify the assignee that a card was added to them (skip self-assignment).
      const assignerId = req.user?.id != null ? parseInt(String(req.user.id), 10) : null;
      if (task.assigned_to != null && task.assigned_to !== assignerId) {
        const assignerName =
          req.user?.name ||
          req.user?.username ||
          (assignerId != null ? (await db.dbGetUsersByIds([assignerId]))[0]?.username : null) ||
          'Someone';
        notifyAssignment({ task, assignerName }).catch((e) =>
          console.error('notifyAssignment:', e.message)
        );
      }
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
    const { taskId } = req.params;
    const team = req.body?.team || req.query?.team;
    if (db.useDb()) {
      const existing = await db.dbGetTaskById(taskId, team);
      if (existing?.team === 'legal_finance' && !requireLegalFinanceAccess(req, res)) return;
      if (isLegalFinanceTeamString(team) && !requireLegalFinanceAccess(req, res)) return;
      if ((existing?.team === 'director' || isDirectorTeamString(team)) && !requireDirectorManage(req, res)) return;
      if (req.body?.assigned_to !== undefined && !(await assigneeActiveOrReject(res, req.body.assigned_to))) return;
      const body = mergeTaskReviewTransition(existing, { ...req.body, team }, req.user);
      const task = await db.dbUpdateTask(taskId, body);
      if (!task) return res.status(404).json({ message: 'Task not found' });
      return res.json(task);
    }
    const idx = tasks.findIndex((t) => t.id === taskId);
    if (idx === -1) return res.status(404).json({ message: 'Task not found' });
    const merged = mergeTaskReviewTransition(tasks[idx], req.body, req.user);
    tasks[idx] = { ...tasks[idx], ...merged };
    res.json(tasks[idx]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Failed to update task' });
  }
});

app.delete(`${BASE_PATH}/tasks/:taskId`, async (req, res) => {
  try {
    if (db.useDb()) {
      const hintTeam = req.query?.team || null;
      const existing = await db.dbGetTaskById(req.params.taskId, hintTeam);
      if (existing?.team === 'legal_finance' && !requireLegalFinanceAccess(req, res)) return;
      if (isLegalFinanceTeamString(hintTeam) && !requireLegalFinanceAccess(req, res)) return;
      if ((existing?.team === 'director' || isDirectorTeamString(hintTeam)) && !requireDirectorManage(req, res)) return;
      const ok = await db.dbDeleteTask(req.params.taskId, hintTeam);
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
      const list = await db.dbGetTaskComments(req.params.taskId, req.query.team || null);
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
      // Recipients = client-sent mentions, unioned with chips parsed from the saved
      // comment HTML. The fallback ensures a tagged person is notified even if the
      // client did not send the mentions array.
      const clientMentions = (Array.isArray(req.body.mentions) ? req.body.mentions : []).map(String);
      const htmlMentions = extractMentionUidsFromHtml(comment.message);
      const mentionIds = [...new Set([...clientMentions, ...htmlMentions])];
      if (mentionIds.length) {
        notifyMentions({
          taskId,
          team: req.body.team,
          mentionIds,
          commenterName: comment.author,
          html: comment.message,
        }).catch((e) => console.error('notifyMentions:', e.message));
      }
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

// Edit a comment (author only)
app.put(`${BASE_PATH}/tasks/:taskId/comments/:commentId`, async (req, res) => {
  const { commentId } = req.params;
  const userId = req.body?.user_id;
  if (!userId) return res.status(400).json({ message: 'user_id is required' });
  try {
    if (db.useDb()) {
      const updated = await db.dbUpdateTaskComment(commentId, userId, req.body);
      if (!updated) return res.status(403).json({ message: 'You can only edit your own comment.' });
      const newMentionIds = Array.isArray(updated.newlyMentioned) ? updated.newlyMentioned : [];
      if (newMentionIds.length) {
        notifyMentions({
          taskId: req.params.taskId,
          team: req.body.team,
          mentionIds: newMentionIds,
          commenterName: updated.author,
          html: updated.message,
        }).catch((e) => console.error('notifyMentions:', e.message));
      }
      return res.json(updated);
    }
    return res.status(400).json({ message: 'Database connection required' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Failed to update comment' });
  }
});

// Delete a comment (author only)
app.delete(`${BASE_PATH}/tasks/:taskId/comments/:commentId`, async (req, res) => {
  const { commentId } = req.params;
  const userId = req.query.user_id || req.body?.user_id;
  if (!userId) return res.status(400).json({ message: 'user_id is required' });
  try {
    if (db.useDb()) {
      const ok = await db.dbDeleteTaskComment(commentId, userId, false);
      if (!ok) return res.status(403).json({ message: 'You can only delete your own comment.' });
      return res.status(204).send();
    }
    return res.status(400).json({ message: 'Database connection required' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Failed to delete comment' });
  }
});

// Toggle a like on a comment
app.post(`${BASE_PATH}/tasks/:taskId/comments/:commentId/like`, async (req, res) => {
  const { commentId } = req.params;
  const userId = req.body?.user_id;
  if (!userId) return res.status(400).json({ message: 'user_id is required' });
  try {
    if (db.useDb()) {
      const result = await db.dbToggleCommentLike(commentId, userId);
      if (!result) return res.status(500).json({ message: 'Failed to like comment' });
      return res.json(result);
    }
    return res.status(400).json({ message: 'Database connection required' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Failed to like comment' });
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
      const teamKey = req.query.team || null;
      if (isLegalFinanceTeamString(teamKey) && !requireLegalFinanceAccess(req, res)) return;
      const list = await db.dbGetTeamOverview(teamKey);
      return res.json(list);
    }
    const byAssignee = tasks.reduce((acc, task) => {
      const key = task.assignee || 'Unassigned';
      if (!acc[key]) acc[key] = { assignee: key, total_tasks: 0, in_progress_tasks: 0, completed_tasks: 0 };
      acc[key].total_tasks += 1;
      if (
        task.status === 'todo' ||
        task.status === 'in_progress' ||
        task.status === 'review' ||
        task.status === 'rework'
      )
        acc[key].in_progress_tasks += 1;
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
      const list = await db.dbGetEodReports({ user_id: req.query.user_id, report_date: req.query.report_date, branch: req.query.branch, team: req.query.team });
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

// EOD report itself: like / edit / delete (acts like a post).
app.post(`${BASE_PATH}/eod-reports/:reportId/like`, async (req, res) => {
  const userId = req.body?.user_id;
  if (!userId) return res.status(400).json({ message: 'user_id is required' });
  try {
    if (!db.useDb()) return res.status(400).json({ message: 'Database connection required' });
    const result = await db.dbToggleEodReportLike(req.params.reportId, userId);
    if (!result) return res.status(500).json({ message: 'Failed to like report' });
    res.json(result);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Failed to like report' });
  }
});

app.put(`${BASE_PATH}/eod-reports/:reportId`, async (req, res) => {
  const userId = req.body?.user_id;
  if (!userId) return res.status(400).json({ message: 'user_id is required' });
  try {
    if (!db.useDb()) return res.status(400).json({ message: 'Database connection required' });
    const updated = await db.dbUpdateEodReport(req.params.reportId, userId, req.body);
    if (!updated) return res.status(403).json({ message: 'You can only edit your own report.' });
    res.json(updated);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Failed to update report' });
  }
});

app.delete(`${BASE_PATH}/eod-reports/:reportId`, async (req, res) => {
  const userId = req.query.user_id || req.body?.user_id;
  if (!userId) return res.status(400).json({ message: 'user_id is required' });
  try {
    if (!db.useDb()) return res.status(400).json({ message: 'Database connection required' });
    const isAdmin = (req.user?.permissions || []).includes('admin.access');
    const ok = await db.dbDeleteEodReport(req.params.reportId, userId, isAdmin);
    if (!ok) return res.status(403).json({ message: 'You can only delete your own report.' });
    res.status(204).send();
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Failed to delete report' });
  }
});

// ── EOD report comments (mention / comment / like / reply, like task comments) ──
app.get(`${BASE_PATH}/eod-reports/:reportId/comments`, async (req, res) => {
  try {
    if (!db.useDb()) return res.json([]);
    const list = await db.dbGetEodReportComments(req.params.reportId);
    res.json(list);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Failed to fetch comments' });
  }
});

app.post(`${BASE_PATH}/eod-reports/:reportId/comments`, async (req, res) => {
  const { reportId } = req.params;
  const { message, author } = req.body || {};
  if (!message) return res.status(400).json({ message: 'Message is required' });
  try {
    if (!db.useDb()) return res.status(400).json({ message: 'Database connection required' });
    const comment = await db.dbAddEodReportComment(reportId, { ...req.body, author });
    if (!comment) return res.status(500).json({ message: 'Failed to add comment' });
    const clientMentions = (Array.isArray(req.body.mentions) ? req.body.mentions : []).map(String);
    const htmlMentions = extractMentionUidsFromHtml(comment.message);
    const mentionIds = [...new Set([...clientMentions, ...htmlMentions])];
    if (mentionIds.length) {
      notifyMentions({
        taskId: reportId,
        mentionIds,
        commenterName: comment.author,
        html: comment.message,
        titleOverride: 'an EOD report',
      }).catch((e) => console.error('notifyMentions (eod):', e.message));
    }
    res.status(201).json(comment);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Failed to add comment' });
  }
});

app.put(`${BASE_PATH}/eod-reports/:reportId/comments/:commentId`, async (req, res) => {
  const { reportId, commentId } = req.params;
  const userId = req.body?.user_id;
  if (!userId) return res.status(400).json({ message: 'user_id is required' });
  try {
    if (!db.useDb()) return res.status(400).json({ message: 'Database connection required' });
    const updated = await db.dbUpdateEodReportComment(commentId, userId, req.body);
    if (!updated) return res.status(403).json({ message: 'You can only edit your own comment.' });
    const newMentionIds = Array.isArray(updated.newlyMentioned) ? updated.newlyMentioned : [];
    if (newMentionIds.length) {
      notifyMentions({
        taskId: reportId,
        mentionIds: newMentionIds,
        commenterName: updated.author,
        html: updated.message,
        titleOverride: 'an EOD report',
      }).catch((e) => console.error('notifyMentions (eod):', e.message));
    }
    res.json(updated);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Failed to update comment' });
  }
});

app.delete(`${BASE_PATH}/eod-reports/:reportId/comments/:commentId`, async (req, res) => {
  const { commentId } = req.params;
  const userId = req.query.user_id || req.body?.user_id;
  if (!userId) return res.status(400).json({ message: 'user_id is required' });
  try {
    if (!db.useDb()) return res.status(400).json({ message: 'Database connection required' });
    const isAdmin = (req.user?.permissions || []).includes('admin.access');
    const ok = await db.dbDeleteEodReportComment(commentId, userId, isAdmin);
    if (!ok) return res.status(403).json({ message: 'You can only delete your own comment.' });
    res.status(204).send();
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Failed to delete comment' });
  }
});

app.post(`${BASE_PATH}/eod-reports/:reportId/comments/:commentId/like`, async (req, res) => {
  const { commentId } = req.params;
  const userId = req.body?.user_id;
  if (!userId) return res.status(400).json({ message: 'user_id is required' });
  try {
    if (!db.useDb()) return res.status(400).json({ message: 'Database connection required' });
    const result = await db.dbToggleEodCommentLike(commentId, userId);
    if (!result) return res.status(500).json({ message: 'Failed to like comment' });
    res.json(result);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Failed to like comment' });
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
      let teamHint = req.query?.team || null;
      if (!teamHint) {
        const t = await db.dbGetTaskById(taskId, null);
        teamHint = t?.team || null;
      }
      if (isLegalFinanceTeamString(teamHint) && !requireLegalFinanceAccess(req, res)) return;
      const list = await db.dbGetRequirements(taskId, teamHint);
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
      let teamHint = req.body?.team || req.query?.team || null;
      if (!teamHint) {
        const t = await db.dbGetTaskById(taskId, null);
        teamHint = t?.team || null;
      }
      if (isLegalFinanceTeamString(teamHint) && !requireLegalFinanceAccess(req, res)) return;
      const req2 = await db.dbCreateRequirement(taskId, req.body, teamHint);
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
      let teamHint = req.body?.team || req.query?.team || null;
      if (!teamHint) {
        const t = await db.dbGetTaskById(taskId, null);
        teamHint = t?.team || null;
      }
      if (isLegalFinanceTeamString(teamHint) && !requireLegalFinanceAccess(req, res)) return;
      const updated = await db.dbUpdateRequirement(reqId, req.body, taskId, teamHint);
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

// Start / pause a requirement's timer
app.post(`${BASE_PATH}/tasks/:taskId/requirements/:reqId/timer`, async (req, res) => {
  const { taskId, reqId } = req.params;
  const action = req.body?.action;
  if (action !== 'start' && action !== 'pause') {
    return res.status(400).json({ message: "action must be 'start' or 'pause'" });
  }
  try {
    if (!db.useDb()) return res.status(400).json({ message: 'Database connection required' });
    let teamHint = req.body?.team || req.query?.team || null;
    if (!teamHint) {
      const t = await db.dbGetTaskById(taskId, null);
      teamHint = t?.team || null;
    }
    if (isLegalFinanceTeamString(teamHint) && !requireLegalFinanceAccess(req, res)) return;
    const updated = await db.dbRequirementTimer(reqId, action, taskId, teamHint);
    if (!updated) return res.status(404).json({ message: 'Requirement not found' });
    return res.json(updated);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Failed to update timer' });
  }
});

// Manually log a work session (From/To times) for a requirement when the timer
// was not used. Date comes from the task's task_date; time-only inputs ('HH:MM').
app.post(`${BASE_PATH}/tasks/:taskId/requirements/:reqId/manual-time`, async (req, res) => {
  const { taskId, reqId } = req.params;
  const from = String(req.body?.from || '').trim();
  const to = String(req.body?.to || '').trim();
  const timeRe = /^([01]\d|2[0-3]):[0-5]\d$/;
  if (!timeRe.test(from) || !timeRe.test(to)) {
    return res.status(400).json({ message: 'Provide valid From and To times (HH:MM).' });
  }
  if (to <= from) {
    return res.status(400).json({ message: 'To time must be later than From time.' });
  }
  try {
    if (!db.useDb()) return res.status(400).json({ message: 'Database connection required' });
    let teamHint = req.body?.team || req.query?.team || null;
    if (!teamHint) {
      const t = await db.dbGetTaskById(taskId, null);
      teamHint = t?.team || null;
    }
    if (isLegalFinanceTeamString(teamHint) && !requireLegalFinanceAccess(req, res)) return;
    const updated = await db.dbAddRequirementManualTime(reqId, { fromTime: from, toTime: to }, taskId, teamHint);
    if (!updated) return res.status(404).json({ message: 'Requirement not found' });
    return res.json(updated);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Failed to log manual time' });
  }
});

// ---- Member dashboard (worked hours vs 8h/day, projects, leave) ----
// Returns the requester's identity + whether they are an admin. In demo mode
// (no JWT secret) req.user is absent, so treat the session as admin.
function dashboardActor(req) {
  const u = req.user;
  if (!u) return { id: null, isAdmin: true };
  const perms = u.permissions || [];
  return { id: u.id != null ? parseInt(String(u.id), 10) : null, isAdmin: perms.includes('admin.access') };
}

// A member may view only their own dashboard; admins may view anyone's.
app.get(
  `${BASE_PATH}/members/:userId/dashboard`,
  requireAuth,
  attachUserPermissions,
  async (req, res) => {
    try {
      if (!db.useDb()) return res.json({ daily: [], byProject: [], projects: [], leaves: [], totalSeconds: 0 });
      const actor = dashboardActor(req);
      const targetId = parseInt(String(req.params.userId), 10);
      if (!actor.isAdmin && actor.id != null && actor.id !== targetId) {
        return res.status(403).json({ message: 'You can only view your own dashboard.' });
      }
      const { from, to, team, type } = req.query;
      const projectType = type === 'internal' || type === 'external' ? type : null;
      const data = await db.dbGetMemberDashboard(targetId, from || null, to || null, team || 'it', projectType);
      return res.json(data);
    } catch (err) {
      console.error('member dashboard:', err.message);
      res.status(500).json({ message: 'Failed to load dashboard' });
    }
  }
);

// List a member's leave days in a range (self or admin).
app.get(`${BASE_PATH}/leaves`, requireAuth, attachUserPermissions, async (req, res) => {
  try {
    if (!db.useDb()) return res.json([]);
    const actor = dashboardActor(req);
    const targetId = req.query.user_id ? parseInt(String(req.query.user_id), 10) : actor.id;
    if (!actor.isAdmin && actor.id != null && actor.id !== targetId) {
      return res.status(403).json({ message: 'You can only view your own leave.' });
    }
    const leaves = await db.dbGetLeaves(targetId, req.query.from || null, req.query.to || null);
    res.json(leaves);
  } catch (err) {
    console.error('get leaves:', err.message);
    res.status(500).json({ message: 'Failed to load leave' });
  }
});

// Mark a day as leave (self only — uses the authenticated user).
app.post(`${BASE_PATH}/leaves`, requireAuth, attachUserPermissions, async (req, res) => {
  try {
    if (!db.useDb()) return res.status(400).json({ message: 'Database connection required' });
    const actor = dashboardActor(req);
    const targetId = req.body?.user_id ? parseInt(String(req.body.user_id), 10) : actor.id;
    if (targetId == null) return res.status(400).json({ message: 'user_id required' });
    if (!actor.isAdmin && actor.id != null && actor.id !== targetId) {
      return res.status(403).json({ message: 'You can only set your own leave.' });
    }
    const date = req.body?.leave_date || req.body?.date;
    if (!date) return res.status(400).json({ message: 'leave_date required' });
    const ok = await db.dbSetLeave(targetId, date, true);
    res.status(ok ? 201 : 500).json({ success: ok });
  } catch (err) {
    console.error('set leave:', err.message);
    res.status(500).json({ message: 'Failed to set leave' });
  }
});

// Remove a leave day (self only).
app.delete(`${BASE_PATH}/leaves/:date`, requireAuth, attachUserPermissions, async (req, res) => {
  try {
    if (!db.useDb()) return res.status(400).json({ message: 'Database connection required' });
    const actor = dashboardActor(req);
    const targetId = req.query.user_id ? parseInt(String(req.query.user_id), 10) : actor.id;
    if (targetId == null) return res.status(400).json({ message: 'user_id required' });
    if (!actor.isAdmin && actor.id != null && actor.id !== targetId) {
      return res.status(403).json({ message: 'You can only clear your own leave.' });
    }
    const ok = await db.dbSetLeave(targetId, req.params.date, false);
    res.json({ success: ok });
  } catch (err) {
    console.error('clear leave:', err.message);
    res.status(500).json({ message: 'Failed to clear leave' });
  }
});

// DELETE a requirement
app.delete(`${BASE_PATH}/tasks/:taskId/requirements/:reqId`, async (req, res) => {
  const { taskId, reqId } = req.params;
  try {
    if (db.useDb()) {
      let teamHint = req.query?.team || null;
      if (!teamHint) {
        const t = await db.dbGetTaskById(taskId, null);
        teamHint = t?.team || null;
      }
      if (isLegalFinanceTeamString(teamHint) && !requireLegalFinanceAccess(req, res)) return;
      const ok = await db.dbDeleteRequirement(reqId, taskId, teamHint);
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

// ───────────────────────── Public branding ─────────────────────────
// The company profile drives the whole product's identity, but the profile API is
// admin-only and the login screen runs before any session exists. This exposes the
// presentational subset — name, tagline, colours, logo, favicon — with no auth.
// Banking, tax identifiers, addresses and internal contacts are deliberately excluded.
let brandingCache = null;

/**
 * Navigation customisation set from the master console.
 *
 * Three parts, all overrides only:
 *   icons    - icon name per sector id (the top bar)
 *   order    - display order, keyed by 'sectors' or by a sector id
 *   bySector - names and icons for the sections inside one sector, so the same
 *              section can be named differently in two sectors
 *
 * Validated tightly because this payload is public and drives rendering: icon names
 * must look like catalogue keys (the client only resolves names it knows) and every
 * key must look like a label id.
 */
function sanitiseNavigation(raw) {
  const empty = { icons: {}, order: {}, bySector: {} };
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return empty;
  const isLabelId = (k) => typeof k === 'string' && /^[A-Za-z0-9_.]{1,60}$/.test(k);
  const isIconName = (n) => /^[A-Za-z][A-Za-z0-9]{0,40}$/.test(n);

  const pickIcons = (src) => {
    const out = {};
    for (const [key, value] of Object.entries(src || {})) {
      if (!isLabelId(key) || typeof value !== 'string') continue;
      const name = value.trim();
      if (name && isIconName(name)) out[key] = name;
    }
    return out;
  };

  const pickLabels = (src) => {
    const out = {};
    for (const [key, value] of Object.entries(src || {})) {
      if (!isLabelId(key) || typeof value !== 'string') continue;
      const text = value.trim();
      if (text && text.length <= 60) out[key] = text;
    }
    return out;
  };

  const order = {};
  for (const [group, value] of Object.entries(raw.order || {})) {
    if (!isLabelId(group) || !Array.isArray(value)) continue;
    const ids = [...new Set(value.filter(isLabelId))].slice(0, 100);
    if (ids.length) order[group] = ids;
  }

  const bySector = {};
  for (const [sector, cfg] of Object.entries(raw.bySector || {})) {
    if (!isLabelId(sector) || !cfg || typeof cfg !== 'object' || Array.isArray(cfg)) continue;
    const labels = pickLabels(cfg.labels);
    const icons = pickIcons(cfg.icons);
    if (Object.keys(labels).length || Object.keys(icons).length) {
      bySector[sector] = { labels, icons };
    }
  }

  return { icons: pickIcons(raw.icons), order, bySector };
}

function publicBranding(data = {}) {
  const assets = data.assets || {};
  return {
    company_name: data.company_name || '',
    legal_name: data.legal_name || '',
    tagline: data.tagline || '',
    website: data.website || data.contact?.website || '',
    colors: {
      primary: data.colors?.primary || '',
      secondary: data.colors?.secondary || '',
      accent: data.colors?.accent || '',
    },
    logo: assets.logo || '',
    favicon: assets.favicon || '',
    // Module/section renames for whitelabeling. Overrides only — the client keeps
    // the coded defaults for anything not stored here.
    labels: sanitiseLabels(data.labels),
    navigation: sanitiseNavigation(data.navigation),
  };
}

/**
 * Keep the label map to plain, bounded strings. It is written by admins but rendered
 * verbatim in the app chrome, so cap the size and drop anything that is not a
 * non-empty string rather than trusting whatever the profile happens to hold.
 */
function sanitiseLabels(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const out = {};
  for (const [key, value] of Object.entries(raw)) {
    if (typeof value !== 'string') continue;
    const trimmed = value.trim();
    if (!trimmed || trimmed.length > 60) continue;
    if (!/^[\w.]{1,60}$/.test(key)) continue;
    out[key] = trimmed;
  }
  return out;
}

async function loadBranding() {
  if (brandingCache) return brandingCache;
  // Never cache a miss: at boot this can run before the pool is up, and a cached
  // empty profile would blank the brand until the next publish.
  if (!db.useDb()) return publicBranding({});
  const data = (await db.dbGetCompanyProfile())?.data || {};
  const branding = publicBranding(data);
  brandingCache = branding;
  // Email gets more than the public subset: the signature templates and the
  // contact details they merge in are internal and never served to the browser.
  applyEmailBranding({
    ...branding,
    contact: data.contact || {},
    // Per-mail subject/heading/body/button overrides, edited in the master console.
    templates: data.email_templates_by_mail || {},
    signatures: {
      member: data.email_signature || '',
      admin: data.email_signature_admin || '',
      // Per-mail overrides; a blank entry falls through to the audience default.
      byMail: Object.fromEntries(
        Object.entries(data.email_signatures_by_mail || {})
          .filter(([, v]) => typeof v === 'string' && v.trim())
      ),
    },
  });
  return branding;
}

/** Called after any profile or asset change so the next read is fresh. */
function invalidateBranding() {
  brandingCache = null;
  loadBranding().catch(() => {});
}

app.get('/api/branding', asyncMw(async (req, res) => {
  // Assets are inlined as data URLs, so the payload must never be cached stale.
  res.set('Cache-Control', 'no-store');
  res.json(await loadBranding());
}));

// Prime the cache at boot so the first email already carries the right identity.
loadBranding().catch(() => {});

// ---- Admin API (RBAC: requires admin.access) ----
const ADMIN_PATH = '/api/admin';
app.use(ADMIN_PATH, requireAuth, asyncMw(attachUserPermissions), requirePermission('admin.access'));

// ───────────────────────── Company Profile & Branding ─────────────────────────
// Single source of truth for company identity, branding, compliance, banking, and
// digital presence. `data` is published; `draft` is the auto-saved work-in-progress.

// Mirrors CURRENCIES in frontend/src/utils/invoiceSettings.js.
const INVOICE_CURRENCIES = ['INR', 'USD', 'EUR', 'GBP', 'AED'];

const COMPANY_VALIDATORS = {
  email: /^[^\s@]+@[^\s@]+\.[^\s@]+$/,
  url: /^https?:\/\/[^\s.]+\.[^\s]+$/i,
  gst: /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/,
  pan: /^[A-Z]{5}[0-9]{4}[A-Z]$/,
  ifsc: /^[A-Z]{4}0[A-Z0-9]{6}$/,
  swift: /^[A-Z]{6}[A-Z0-9]{2}([A-Z0-9]{3})?$/,
  sac: /^[0-9]{6,8}$/,
  postal: /^[1-9][0-9]{5}$/,
};

// Validate only fields that carry a value, so a partially-filled profile can still be
// saved. Returns an array of { field, message } (empty when valid).
function validateCompanyProfile(profile = {}) {
  const errors = [];
  const check = (val, type, field, label) => {
    if (val == null || String(val).trim() === '') return;
    if (!COMPANY_VALIDATORS[type].test(String(val).trim())) {
      errors.push({ field, message: `${label} is invalid.` });
    }
  };
  if (!profile.company_name || !String(profile.company_name).trim()) {
    errors.push({ field: 'company_name', message: 'Company name is required.' });
  }
  const c = profile.contact || {};
  check(c.official_email, 'email', 'official_email', 'Official email');
  check(c.accounts_email, 'email', 'accounts_email', 'Accounts email');
  check(c.website || profile.website, 'url', 'website', 'Website URL');
  const comp = profile.compliance || {};
  check(comp.gst, 'gst', 'gst', 'GST number');
  check(comp.pan, 'pan', 'pan', 'PAN number');
  check(comp.sac, 'sac', 'sac', 'SAC code');
  const bank = profile.bank || {};
  check(bank.ifsc, 'ifsc', 'ifsc', 'IFSC code');
  check(bank.swift, 'swift', 'swift', 'SWIFT code');
  const addr = profile.address || {};
  check(addr.postal_code, 'postal', 'postal_code', 'Postal code');
  const social = profile.social || {};
  ['linkedin', 'facebook', 'instagram', 'twitter', 'youtube', 'website'].forEach((k) => {
    check(social[k], 'url', `social.${k}`, `${k} URL`);
  });

  // Invoice defaults, published from the master console's Billing & Legal
  // section. Every field is optional — a blank one falls back to the value shipped in
  // frontend/src/utils/invoiceSettings.js — so only a present-but-wrong value is an error.
  const inv = profile.invoice || {};
  if (inv.gst_rate != null && String(inv.gst_rate).trim() !== '') {
    const rate = Number(inv.gst_rate);
    if (!Number.isFinite(rate) || rate < 0 || rate > 100) {
      errors.push({ field: 'invoice.gst_rate', message: 'GST rate must be between 0 and 100.' });
    }
  }
  if (inv.currency != null && String(inv.currency).trim() !== ''
      && !INVOICE_CURRENCIES.includes(String(inv.currency).trim())) {
    errors.push({ field: 'invoice.currency', message: 'Unsupported invoice currency.' });
  }
  if (inv.sac_catalogue != null) {
    if (!Array.isArray(inv.sac_catalogue)) {
      errors.push({ field: 'invoice.sac_catalogue', message: 'SAC catalogue must be a list.' });
    } else {
      inv.sac_catalogue.forEach((row, i) => {
        check(row?.code, 'sac', `invoice.sac_catalogue.${i}`, `SAC code ${i + 1}`);
      });
    }
  }
  return errors;
}

/** Display name per brand asset; also the set of asset types the API accepts. */
const ASSET_LABEL = {
  logo: 'Logo',
  favicon: 'Favicon',
  signature: 'Authorized signature',
  digital_signature: 'Digital signature',
  seal: 'Company seal',
};
const COMPANY_ASSET_TYPES = Object.keys(ASSET_LABEL);
const assetAction = (type, verb) => `${ASSET_LABEL[type] || 'Brand asset'} ${verb}`;

/**
 * Statutory identity, contact details, registered address, bank details and invoice
 * defaults are owned by the master console's Billing & Legal section. For any
 * non-master caller these keys are replaced with what is stored, whatever the request
 * body claims — so no other screen or API client can overwrite them.
 *
 * They are replaced rather than deleted because the client prefers an unpublished
 * draft over the published data; dropping them would blank the read-only display.
 */
const MASTER_OWNED_COMPANY_KEYS = ['compliance', 'contact', 'address', 'bank', 'invoice', 'social'];

function isMasterSession(req) {
  return (req.user?.permissions || []).includes('master.access') && req.user?.scope === 'master';
}

/**
 * Brand assets (logo, favicon, signatures, seal) are uploaded from the master console's
 * Appearance section. They are not part of the profile body — dbPublishCompanyProfile
 * preserves the asset blob — so ownership has to be enforced on the write endpoints
 * themselves. Reads stay open: the invoice renderer and the branding payload need them.
 */
function requireMasterSession(req, res, next) {
  if (!isMasterSession(req)) {
    return res.status(403).json({
      message: 'Brand assets are managed in the master console under Appearance.',
    });
  }
  return next();
}

async function keepMasterOwnedFields(body, req) {
  const next = { ...(body || {}) };
  if (isMasterSession(req)) return next;
  const stored = (await db.dbGetCompanyProfile())?.data || {};
  for (const k of MASTER_OWNED_COMPANY_KEYS) next[k] = stored[k];
  return next;
}

app.get(`${ADMIN_PATH}/company`, asyncMw(async (req, res) => {
  if (!db.useDb()) return res.json({ data: {}, draft: null });
  const profile = await db.dbGetCompanyProfile();
  res.json(profile);
}));

app.post(`${ADMIN_PATH}/company/draft`, asyncMw(async (req, res) => {
  if (!db.useDb()) return res.status(400).json({ message: 'A database connection is required.' });
  const draft = await keepMasterOwnedFields(req.body, req);
  const updatedAt = await db.dbSaveCompanyDraft(draft, req.user?.id ?? null);
  res.json({ status: 'saved', updated_at: updatedAt });
}));

/**
 * What changed between two published company profiles, as a flat list of field paths.
 *
 * Written to audit_log.details so the master console can answer "who changed what, and
 * when" rather than only "the profile was updated".
 *
 * Values are recorded for ordinary fields, but MASKED for the regulatory ones. The audit
 * log is readable by any admin holding admin.audit, while bank and statutory details are
 * deliberately master-only — echoing them into the log would hand them straight back.
 * Long text and base64 blobs are reduced to a "changed" marker rather than stored twice.
 */
// String prefixes rather than a regex: the dots are literal, and a regex here has been
// mis-escaped once already.
const AUDIT_MASKED_PREFIXES = ['bank.', 'compliance.'];
const AUDIT_MASKED_EXACT = [
  'contact.official_email', 'contact.accounts_email', 'contact.contact_number',
];
const AUDIT_MAX_VALUE = 80;
const AUDIT_MAX_FIELDS = 40;

function auditMasked(path) {
  return AUDIT_MASKED_PREFIXES.some((p) => path.startsWith(p))
    || AUDIT_MASKED_EXACT.includes(path);
}

/** Friendly leading word per top-level key, so a row reads as prose not as a JSON path. */
const AUDIT_LABELS = {
  colors: 'Theme colour',
  compliance: 'Statutory',
  contact: 'Contact',
  address: 'Address',
  bank: 'Bank',
  invoice: 'Invoice defaults',
  social: 'Digital presence',
  labels: 'Navigation name',
  navigation: 'Navigation',
  brand_values: 'Brand values',
  brand_kit: 'Brand kit',
  email_templates_by_mail: 'Mail template',
  email_signatures_by_mail: 'Mail sign-off',
  email_signature: 'Sign-off (team member mails)',
  email_signature_admin: 'Sign-off (admin mails)',
  company_name: 'Brand name',
  legal_name: 'Legal name',
};

function auditLabel(path) {
  const [head, ...rest] = path.split('.');
  const friendly = AUDIT_LABELS[head] || head.replace(/_/g, ' ');
  return rest.length ? `${friendly} · ${rest.join(' · ')}` : friendly;
}

function auditValue(path, v) {
  if (v === undefined || v === null || v === '') return '(empty)';
  if (auditMasked(path)) return '(hidden)';
  if (Array.isArray(v)) return `[${v.length} item${v.length === 1 ? '' : 's'}]`;
  if (typeof v === 'object') return '(updated)';
  const str = String(v);
  if (str.startsWith('data:')) return '(image)';
  return str.length > AUDIT_MAX_VALUE ? `${str.slice(0, AUDIT_MAX_VALUE)}…` : str;
}

const isPlainObject = (v) => Boolean(v) && typeof v === 'object' && !Array.isArray(v);

/**
 * Describe an array change as what was added or removed, or as a pure reorder.
 *
 * "[3 items] → [3 items]" told the reader nothing, which is the whole point of the log.
 */
function auditArray(path, a, b) {
  if (auditMasked(path)) return { from: '(hidden)', to: '(hidden)' };
  const A = Array.isArray(a) ? a : [];
  const B = Array.isArray(b) ? b : [];
  const key = (v) => (typeof v === 'object' ? JSON.stringify(v) : String(v));
  const ka = A.map(key);
  const kb = B.map(key);
  const added = kb.filter((x) => !ka.includes(x));
  const removed = ka.filter((x) => !kb.includes(x));
  const list = (xs) => xs.slice(0, 3).join(', ') + (xs.length > 3 ? ` +${xs.length - 3} more` : '');

  if (!added.length && !removed.length) {
    return { from: `${A.length} item${A.length === 1 ? '' : 's'}`, to: 'reordered' };
  }
  const parts = [];
  if (added.length) parts.push(`added ${list(added)}`);
  if (removed.length) parts.push(`removed ${list(removed)}`);
  const summary = parts.join('; ');
  return {
    from: `${A.length} item${A.length === 1 ? '' : 's'}`,
    to: summary.length > AUDIT_MAX_VALUE ? `${summary.slice(0, AUDIT_MAX_VALUE)}…` : summary,
  };
}

function diffCompanyProfile(before = {}, after = {}, prefix = '', out = []) {
  const keys = new Set([...Object.keys(before || {}), ...Object.keys(after || {})]);
  for (const key of keys) {
    if (out.length >= AUDIT_MAX_FIELDS) break;
    const path = prefix ? `${prefix}.${key}` : key;
    const a = before?.[key];
    const b = after?.[key];
    if (JSON.stringify(a ?? null) === JSON.stringify(b ?? null)) continue;

    // Recurse when EITHER side is an object, treating the missing side as empty. Requiring
    // both meant a newly added group — a first mail-template override, say — was reported
    // only as "(updated)" instead of naming the fields inside it.
    if (isPlainObject(a) || isPlainObject(b)) {
      diffCompanyProfile(isPlainObject(a) ? a : {}, isPlainObject(b) ? b : {}, path, out);
      continue;
    }

    const change = (Array.isArray(a) || Array.isArray(b))
      ? auditArray(path, a, b)
      : { from: auditValue(path, a), to: auditValue(path, b) };
    out.push({ field: path, label: auditLabel(path), ...change });
  }
  return out;
}

app.put(`${ADMIN_PATH}/company`, asyncMw(async (req, res) => {
  if (!db.useDb()) return res.status(400).json({ message: 'A database connection is required.' });
  const incoming = await keepMasterOwnedFields(req.body, req);
  const errors = validateCompanyProfile(incoming);
  if (errors.length) return res.status(400).json({ message: 'Please fix the highlighted fields.', errors });
  const before = (await db.dbGetCompanyProfile())?.data || {};
  const result = await db.dbPublishCompanyProfile(incoming, req.user?.id ?? null);
  if (!result) return res.status(500).json({ message: 'Failed to publish company profile.' });
  invalidateBranding();
  // `assets` is managed by its own endpoints and never sent in this body; excluding it
  // keeps a publish from reporting an asset change it did not make.
  const { assets: _a, ...afterNoAssets } = result.data || {};
  const { assets: _b, ...beforeNoAssets } = before;
  const changes = diffCompanyProfile(beforeNoAssets, afterNoAssets);
  db.dbCreateAuditLog({
    userId: req.user?.id ?? null,
    action: changes.length ? `Company profile updated (${changes.length} field${changes.length === 1 ? '' : 's'})` : 'Company profile published (no changes)',
    resource: 'company_profile',
    resourceId: '1',
    details: { changes },
    ipAddress: req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.socket?.remoteAddress,
  }).catch(() => {});
  res.json(result);
}));

app.post(`${ADMIN_PATH}/company/asset`, requireMasterSession, asyncMw(async (req, res) => {
  if (!db.useDb()) return res.status(400).json({ message: 'A database connection is required.' });
  const { type, dataUrl } = req.body || {};
  if (!COMPANY_ASSET_TYPES.includes(type)) return res.status(400).json({ message: 'Unknown asset type.' });
  if (typeof dataUrl !== 'string' || !dataUrl.startsWith('data:image/')) {
    return res.status(400).json({ message: 'Asset must be an image data URL.' });
  }
  if (dataUrl.length > 3 * 1024 * 1024) {
    return res.status(400).json({ message: 'Asset is too large (max ~2 MB).' });
  }
  const assets = await db.dbSetCompanyAsset(type, dataUrl, req.user?.id ?? null);
  if (!assets) return res.status(500).json({ message: 'Failed to save asset.' });
  invalidateBranding();
  db.dbCreateAuditLog({
    userId: req.user?.id ?? null,
    action: assetAction(type, 'updated'),
    resource: 'company_profile',
    resourceId: '1',
    details: { changes: [{ field: `assets.${type}`, from: '(image)', to: '(image)' }] },
    ipAddress: req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.socket?.remoteAddress,
  }).catch(() => {});
  res.json({ assets });
}));

app.delete(`${ADMIN_PATH}/company/asset/:type`, requireMasterSession, asyncMw(async (req, res) => {
  if (!db.useDb()) return res.status(400).json({ message: 'A database connection is required.' });
  const { type } = req.params;
  if (!COMPANY_ASSET_TYPES.includes(type)) return res.status(400).json({ message: 'Unknown asset type.' });
  const assets = await db.dbDeleteCompanyAsset(type, req.user?.id ?? null);
  invalidateBranding();
  db.dbCreateAuditLog({
    userId: req.user?.id ?? null,
    action: assetAction(type, 'removed'),
    resource: 'company_profile',
    resourceId: '1',
    details: { changes: [{ field: `assets.${type}`, from: '(image)', to: '(empty)' }] },
    ipAddress: req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.socket?.remoteAddress,
  }).catch(() => {});
  res.json({ assets: assets || {} });
}));

// Serve a company asset as a real, cacheable image (for cross-module/PDF usage).
app.get(`${ADMIN_PATH}/company/asset/:type`, asyncMw(async (req, res) => {
  if (!db.useDb()) return res.status(404).end();
  const image = await db.dbGetCompanyAssetRaw(req.params.type);
  if (!image || typeof image !== 'string' || !image.startsWith('data:')) return res.status(404).end();
  const match = /^data:([^;,]+)?(;base64)?,(.*)$/s.exec(image);
  if (!match) return res.status(404).end();
  const buf = match[2] ? Buffer.from(match[3], 'base64') : Buffer.from(decodeURIComponent(match[3]));
  const etag = '"' + crypto.createHash('sha1').update(image).digest('hex').slice(0, 16) + '"';
  if (req.headers['if-none-match'] === etag) return res.status(304).end();
  res.setHeader('Content-Type', match[1] || 'image/png');
  res.setHeader('Cache-Control', 'private, max-age=31536000');
  res.setHeader('ETag', etag);
  return res.end(buf);
}));

app.get(`${ADMIN_PATH}/company/activity`, asyncMw(async (req, res) => {
  if (!db.useDb()) return res.json([]);
  const list = await db.dbGetAuditLogs({ resource: 'company_profile', limit: 50 });
  res.json(list);
}));

// ─────────────────────────────── Invoices ───────────────────────────────

/**
 * Every issued invoice must carry the company seal and the director's signature,
 * so an invoice may only leave draft once both brand assets exist. Either the wet
 * or the digital signature satisfies the signature requirement.
 * Returns the human-readable names of whatever is missing.
 */
async function missingInvoiceSignoff() {
  const [seal, signature, digital] = await Promise.all([
    db.dbGetCompanyAssetRaw('seal'),
    db.dbGetCompanyAssetRaw('signature'),
    db.dbGetCompanyAssetRaw('digital_signature'),
  ]);
  const missing = [];
  if (!seal) missing.push('company seal');
  if (!signature && !digital) missing.push('director signature');
  return missing;
}

/** 400s the response when a non-draft invoice lacks its sign-off assets. */
async function blockedForSignoff(status, res) {
  const s = String(status || '').trim().toLowerCase();
  if (!s || s === 'draft') return false;
  const missing = await missingInvoiceSignoff();
  if (!missing.length) return false;
  res.status(400).json({
    message: `Upload the ${missing.join(' and ')} from the master console (Appearance) before issuing this invoice.`,
    missing_assets: missing,
  });
  return true;
}

app.get(`${ADMIN_PATH}/invoices`, asyncMw(async (req, res) => {
  if (!db.useDb()) return res.json([]);
  res.json(await db.dbGetInvoices());
}));

// Must be registered before `/invoices/:id` so it is not captured as an id.
app.get(`${ADMIN_PATH}/invoices/next-number`, asyncMw(async (req, res) => {
  const year = new Date().getFullYear();
  // The series prefix is part of the master-owned invoice settings.
  const profile = db.useDb() ? (await db.dbGetCompanyProfile())?.data : null;
  const prefix = profile?.invoice?.number_prefix;
  res.json({ invoice_number: await db.dbNextInvoiceNumber(year, prefix) });
}));

app.get(`${ADMIN_PATH}/invoices/:id`, asyncMw(async (req, res) => {
  if (!db.useDb()) return res.status(404).json({ message: 'Not found' });
  const inv = await db.dbGetInvoiceById(req.params.id);
  if (!inv) return res.status(404).json({ message: 'Invoice not found' });
  res.json(inv);
}));

app.post(`${ADMIN_PATH}/invoices`, asyncMw(async (req, res) => {
  if (!db.useDb()) return res.status(400).json({ message: 'A database connection is required.' });
  const body = { ...req.body };
  if (await blockedForSignoff(body.status, res)) return;
  if (!body.invoice_number || !String(body.invoice_number).trim()) {
    body.invoice_number = await db.dbNextInvoiceNumber(new Date().getFullYear());
  }
  const created = await db.dbCreateInvoice(body, req.user?.id ?? null);
  if (!created) return res.status(500).json({ message: 'Failed to create invoice (the number may already exist).' });
  db.dbCreateAuditLog({
    userId: req.user?.id ?? null,
    action: `Invoice ${created.invoice_number} created`,
    resource: 'invoice',
    resourceId: String(created.invoice_id),
  }).catch(() => {});
  res.status(201).json(created);
}));

app.put(`${ADMIN_PATH}/invoices/:id`, asyncMw(async (req, res) => {
  if (!db.useDb()) return res.status(400).json({ message: 'A database connection is required.' });
  if (await blockedForSignoff(req.body?.status, res)) return;
  const updated = await db.dbUpdateInvoice(req.params.id, req.body || {});
  if (!updated) return res.status(404).json({ message: 'Invoice not found' });
  res.json(updated);
}));

app.delete(`${ADMIN_PATH}/invoices/:id`, asyncMw(async (req, res) => {
  if (!db.useDb()) return res.status(400).json({ message: 'A database connection is required.' });
  const ok = await db.dbDeleteInvoice(req.params.id);
  if (!ok) return res.status(404).json({ message: 'Invoice not found' });
  res.status(204).send();
}));

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
    res.json([
      { name: 'IT Team', code: 'it' },
      { name: 'Consultants Team', code: 'consultants' },
      { name: 'Creative Team', code: 'creative_team' },
      { name: 'Social Media', code: 'social_media' },
      { name: 'Legal & Finance', code: 'legal_finance' },
    ]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Failed to fetch departments' });
  }
});

app.get(`${ADMIN_PATH}/users`, async (req, res) => {
  try {
    if (db.useDb()) {
      const list = await withoutMasterAccounts(await db.dbGetUsersWithRoles());
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
    const { username, email, password, is_it_developer, is_it_manager, branch, is_active } = req.body || {};
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
        branch: branch ?? null,
        is_active: is_active === undefined ? true : Boolean(is_active),
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
  if (await blockMasterTarget(req, res)) return;
  try {
    const { userId } = req.params;
    const { username, email, password, is_it_developer, is_it_manager, branch, is_active } = req.body || {};

    if (db.useDb()) {
      const payload = {};
      if (username !== undefined) payload.username = String(username || '').trim();
      if (email !== undefined) payload.email = email && String(email).trim() ? String(email).trim() : null;
      if (is_it_developer !== undefined) payload.is_it_developer = Boolean(is_it_developer);
      if (is_it_manager !== undefined) payload.is_it_manager = Boolean(is_it_manager);
      if (branch !== undefined) payload.branch = branch && String(branch).trim() ? String(branch).trim() : null;
      if (is_active !== undefined) payload.is_active = Boolean(is_active);
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
  if (await blockMasterTarget(req, res)) return;
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
  if (await blockMasterTarget(req, res)) return;
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

// EOD lock — list users locked for a missing EOD report (admin only).
app.get(`${ADMIN_PATH}/locked-users`, async (req, res) => {
  try {
    if (!db.useDb()) return res.json([]);
    const list = await db.dbGetLockedEodUsers();
    return res.json(list);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Failed to fetch locked users' });
  }
});

// EOD lock — approve/unlock a user (admin only).
app.post(`${ADMIN_PATH}/users/:userId/eod-unlock`, async (req, res) => {
  try {
    if (!db.useDb()) return res.status(400).json({ message: 'Database connection required' });
    const ok = await db.dbUnlockUserEod(req.params.userId);
    if (!ok) return res.status(404).json({ message: 'User not found or not locked' });
    try {
      const ip = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.socket?.remoteAddress;
      await db.dbCreateAuditLog({
        userId: req.user?.id,
        action: 'eod_unlocked',
        resource: 'user',
        resourceId: req.params.userId,
        details: null,
        ipAddress: ip,
      });
    } catch (_) {}
    return res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Failed to unlock user' });
  }
});

app.get('/', (req, res) => {
  res.send('IT Updates backend is running');
});

// ---- Master control console API ----
// Every route requires master.access AND a master-scoped session; see
// middlewares/masterMiddleware.js for why requirePermission is not used here.
const MASTER_PATH = '/api/master';
app.use(MASTER_PATH, requireAuth, asyncMw(attachUserPermissions), requireMasterScope);

/** Landing counts plus service health. */
app.get(`${MASTER_PATH}/overview`, asyncMw(async (req, res) => {
  const [counts, locked] = await Promise.all([
    db.dbGetMasterOverview(),
    db.dbGetLockedEodUsers(),
  ]);
  res.json({
    counts: counts || {},
    locked_users: locked || [],
    health: {
      database: db.useDb() ? 'connected' : 'disconnected',
      mail: isMailConfigured() ? 'configured' : 'not configured',
      jwt: process.env.JWT_SECRET ? 'configured' : 'missing',
      eod_timezone_offset_minutes: Number(process.env.EOD_TZ_OFFSET_MINUTES ?? 330),
      eod_reminder_times: process.env.EOD_REMINDER_TIMES || '17:30,19:30',
      eod_director_report_hour: Number(process.env.EOD_REPORT_HOUR ?? 20),
      app_url: appLink(),
      node_version: process.version,
      uptime_seconds: Math.round(process.uptime()),
    },
  });
}));

/** Every user with their roles. Unlike the admin list, master accounts are included. */
app.get(`${MASTER_PATH}/users`, asyncMw(async (req, res) => {
  res.json(await db.dbGetUsersWithRoles());
}));

app.get(`${MASTER_PATH}/roles`, asyncMw(async (req, res) => {
  res.json(await db.dbGetRoles());
}));

app.get(`${MASTER_PATH}/permissions`, asyncMw(async (req, res) => {
  res.json(await db.dbGetPermissions());
}));

/** Users currently locked out for a missed EOD report. */
app.get(`${MASTER_PATH}/eod-locks`, asyncMw(async (req, res) => {
  res.json(await db.dbGetLockedEodUsers());
}));

/** Clear one user's EOD lock and excuse them through the current due day. */
app.post(`${MASTER_PATH}/eod-locks/:userId/unlock`, asyncMw(async (req, res) => {
  const userId = Number(req.params.userId);
  if (!Number.isInteger(userId)) return res.status(400).json({ message: 'Invalid user id' });
  const ok = await db.dbUnlockUserEod(userId);
  if (!ok) return res.status(404).json({ message: 'User not found or not locked' });
  db.dbCreateAuditLog({
    userId: req.user?.id ? Number(req.user.id) : null,
    action: 'master.eod_unlock',
    resource: 'user',
    resourceId: String(userId),
    ipAddress: req.ip,
  }).catch(() => {});
  res.json({ success: true });
}));

/**
 * The console's change history.
 *
 * Scoped to `company_profile` on purpose: this section reports what was changed *from
 * this console*, not everything the application records. User deletions, role edits,
 * invoice creation, EOD unlocks and sign-ins all land in the same table and are not
 * changes made here, so they would only be noise.
 */
app.get(`${MASTER_PATH}/audit`, asyncMw(async (req, res) => {
  const limit = Math.min(Math.max(Number(req.query.limit) || 100, 1), 500);
  res.json(await db.dbGetAuditLogs({ limit, resource: 'company_profile' }));
}));

// ---- Email notifications (Gmail API) ----
function stripHtml(html) {
  return String(html || '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
}

// Public URL used in notification emails. CLIENT_ORIGIN is a CORS allow-list whose
// first entry may be an unrelated app, so never blindly take [0]. Prefer an explicit
// APP_URL, then the seyal.urbancode.in origin, then any non-local https origin.
function appLink() {
  const explicit = (process.env.APP_URL || '').trim();
  if (explicit) return explicit.replace(/\/+$/, '');
  const origins = (process.env.CLIENT_ORIGIN || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  const preferred =
    origins.find((o) => /seyal\.urbancode\.in/i.test(o)) ||
    origins.find((o) => /^https:\/\//i.test(o) && !/localhost|127\.0\.0\.1/i.test(o)) ||
    origins[0];
  return (preferred || 'https://seyal.urbancode.in').replace(/\/+$/, '');
}

/** Extract mentioned user ids from stored comment HTML (data-uid on .tc-mention chips). */
function extractMentionUidsFromHtml(html) {
  const ids = [];
  const re = /data-uid=["']?(\d+)/gi;
  let m;
  while ((m = re.exec(String(html || ''))) !== null) ids.push(m[1]);
  return [...new Set(ids)];
}

/** Email each mentioned user that they were tagged in a comment. Fire-and-forget. */
/** The quoted-comment / task-description block a {quote} paragraph is replaced by. */
function quoteBlock(inner) {
  if (!inner) return '';
  return '<blockquote style="margin:0;border-left:3px solid #6366f1;background:#f8fafc;'
    + 'padding:14px 18px;border-radius:0 10px 10px 0;color:#475569;">' + inner + '</blockquote>';
}

async function notifyMentions({ taskId, team, mentionIds, commenterName, html, titleOverride }) {
  if (!isMailConfigured()) {
    console.warn('[mentions] skipped: email not configured (GMAIL_* env missing).');
    return;
  }
  const users = await db.dbGetUsersByIds(mentionIds);
  const withEmail = users.filter((u) => u.email).length;
  console.log(
    `[mentions] task ${taskId}: ids=[${mentionIds.join(',')}] resolved=${users.length} withEmail=${withEmail}`
  );
  if (!users.length) return;
  let title = titleOverride || `Task #${taskId}`;
  if (!titleOverride) {
    try {
      const t = await db.dbGetTaskById(taskId, team);
      if (t?.title) title = t.title;
    } catch {
      /* ignore */
    }
  }
  const link = appLink();
  const who = commenterName || 'Someone';
  for (const u of users) {
    if (!u.email) continue;
    const mail = renderMail('mention', {
      values: { name: u.username || 'there', who, task: title },
      blocks: { quote: quoteBlock(html) },
      ctaUrl: link,
      // A real person triggered this, so {{sender_name}} can resolve.
      sender: { name: who },
    });
    const ok = await sendMail({ to: u.email, subject: mail.subject, html: mail.html });
    console.log(`[mentions] email to user ${u.user_id}: ${ok ? 'sent' : 'FAILED'}`);
  }
}

/** Email the assignee when a card/task is created and assigned to them. Fire-and-forget. */
async function notifyAssignment({ task, assignerName }) {
  if (!isMailConfigured()) {
    console.warn('[assignment] skipped: email not configured (GMAIL_* env missing).');
    return;
  }
  const assigneeId = task?.assigned_to;
  if (assigneeId == null) return; // unassigned card — nobody to notify
  const [assignee] = await db.dbGetUsersByIds([assigneeId]);
  if (!assignee?.email) {
    console.log(`[assignment] task ${task?.id}: assignee ${assigneeId} has no email — skipping.`);
    return;
  }
  const title = task?.title || `Task #${task?.id}`;
  const link = appLink();
  const who = assignerName || 'Someone';
  const mail = renderMail('task_assigned', {
    values: { name: assignee.username || 'there', who, task: title },
    blocks: { quote: quoteBlock(task?.task_description ? stripHtml(task.task_description) : '') },
    ctaUrl: link,
    sender: { name: who },
  });
  const ok = await sendMail({ to: assignee.email, subject: mail.subject, html: mail.html });
  console.log(`[assignment] email to user ${assignee.user_id}: ${ok ? 'sent' : 'FAILED'}`);
}

/** Check for tasks due soon / overdue and email assignee + assigner once per state. */
async function runDeadlineCheck() {
  if (!db.useDb() || !isMailConfigured()) return;
  try {
    const tasks = await db.dbGetDueTasksForAlerts(1);
    const link = appLink();
    for (const t of tasks) {
      if (await db.dbWasDeadlineNotified(t.task_id, t.team, t.kind)) continue;
      const dueStr = t.due_date ? new Date(t.due_date).toLocaleDateString() : '';
      const mailType = t.kind === 'overdue' ? 'task_overdue' : 'task_due_soon';
      let sentAny = false;
      for (const r of t.recipients) {
        // Rendered per recipient because {name} differs; the rest of the template is
        // identical, and resolving it is cheap string work.
        const mail = renderMail(mailType, {
          values: { name: r.name || 'there', task: t.title, date: dueStr },
          ctaUrl: link,
        });
        const ok = await sendMail({ to: r.email, subject: mail.subject, html: mail.html });
        sentAny = sentAny || ok;
      }
      if (sentAny) await db.dbMarkDeadlineNotified(t.task_id, t.team, t.kind);
    }
  } catch (err) {
    console.error('[deadline-check]', err.message);
  }
}

async function start() {
  const result = await db.testConnection();
  if (result.ok) {
    console.log('Database connected OK');
    // Debug helper for production: confirm users table is populated.
    try {
      const p = db.getPool?.();
      if (p) {
        const { rows } = await p.query('SELECT COUNT(*)::int AS total FROM users');
        console.log('DB users row count:', rows?.[0]?.total ?? 0);
      }
    } catch (e) {
      console.warn('DB users table check failed:', e.message);
    }
  } else {
    console.warn('Database not connected:', result.error);
    console.warn('Using in-memory data. Fix .env (DB_USER, DB_PASSWORD, DB_DATABASE, DB_HOST) and run db/schema.sql to use PostgreSQL.');
  }

  app.listen(PORT, () => {
    console.log(`IT Updates backend listening on http://localhost:${PORT}`);
    if (isMailConfigured()) {
      console.log('Email configured (Gmail API). Deadline alerts enabled (hourly).');
      // First run shortly after startup, then hourly.
      setTimeout(runDeadlineCheck, 30_000);
      setInterval(runDeadlineCheck, 60 * 60 * 1000);
    } else {
      console.log('Email not configured (GMAIL_* env missing). Mentions/deadline emails disabled.');
    }
    // 5:30pm / 7:30pm nudges to members who are present and still owe today's EOD.
    startEodMemberReminders(db);
    // Daily 8pm report of IT members who missed their EOD, sent to the directors.
    startEodDirectorReport(db);
    // Midnight: lock everyone who missed the working day that just closed and email
    // the list to admins. Not gated on email config — the lock must happen regardless.
    startEodMidnightLock(db);
  });
}
start();

