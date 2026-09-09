import jwt from 'jsonwebtoken';
import crypto from 'node:crypto';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import * as db from '../db/index.js';

// The secret is resolved when this module loads, which happens before server.js runs
// its own dotenv call, so load the .env here too. dotenv never overrides a variable
// the hosting platform already set.
dotenv.config({ path: path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '.env'), quiet: true });

/**
 * The token signing secret, resolved once at startup. It must always exist.
 *
 * A missing secret used to make every auth check pass (an early `return next()`), so a
 * configuration mistake became a complete authentication bypass. Auth now fails closed:
 *   - production: the process refuses to start without a strong JWT_SECRET;
 *   - development: an ephemeral random secret is generated, so tokens are still verified
 *     cryptographically. Sessions simply do not survive a restart.
 */
const MIN_SECRET_LENGTH = 32;

function resolveJwtSecret() {
  const configured = (process.env.JWT_SECRET || '').trim();
  const isProduction = process.env.NODE_ENV === 'production';

  if (configured) {
    if (configured.length < MIN_SECRET_LENGTH) {
      if (isProduction) {
        console.error('FATAL: JWT_SECRET must be at least ' + MIN_SECRET_LENGTH + ' characters. Refusing to start.');
        process.exit(1);
      }
      console.warn('WARNING: JWT_SECRET is shorter than ' + MIN_SECRET_LENGTH + ' characters. Set a longer secret before deploying.');
    }
    return configured;
  }

  if (isProduction) {
    console.error('FATAL: JWT_SECRET is not set. Authentication cannot be enforced. Refusing to start.');
    console.error('Generate one with: node -e "console.log(require(\'crypto\').randomBytes(48).toString(\'hex\'))"');
    process.exit(1);
  }

  console.warn('WARNING: JWT_SECRET is not set. Generated a temporary development secret; all sessions end when this process restarts. Set JWT_SECRET in backend/.env.');
  return crypto.randomBytes(48).toString('hex');
}

export const JWT_SECRET = resolveJwtSecret();
const JWT_ACCESS_EXPIRY = process.env.JWT_ACCESS_EXPIRY || '15m';
const JWT_REFRESH_EXPIRY = process.env.JWT_REFRESH_EXPIRY || '7d';

export function optionalAuth(req, res, next) {
  const token = req.cookies?.access_token;
  if (!token) return next();
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.user = decoded;
    next();
  } catch {
    next();
  }
}

export function requireAuth(req, res, next) {
  const token = req.cookies?.access_token;
  if (!token) {
    return res.status(401).json({ message: 'Authentication required' });
  }
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.user = decoded;
    next();
  } catch {
    return res.status(401).json({ message: 'Invalid or expired token' });
  }
}

/** Attach permissions (and roles) to req.user. Call after requireAuth. */
export async function attachUserPermissions(req, res, next) {
  if (!req.user?.id) return next();
  req.user.permissions = [];
  req.user.roleIds = [];

  if (!db.useDb()) {
    // No DB: give full access (demo mode)
    req.user.permissions = [
      'it_updates.view', 'it_updates.manage', 'it_updates.users',
      'consultants.view', 'consultants.manage',
      'creative_team.view', 'creative_team.manage',
      'social_media.view', 'social_media.manage',
      'admin.access', 'admin.users', 'admin.roles', 'admin.audit',
    ];
    return next();
  }

  const userId = req.user.id;

  // Load RBAC permissions via role_permissions tables
  try {
    const rbacPerms = await db.dbGetUserPermissions(userId);
    if (Array.isArray(rbacPerms) && rbacPerms.length > 0) {
      req.user.permissions = rbacPerms;
    }
  } catch (_) {}

  // Fallback: if no RBAC perms found, use legacy is_it_developer flag
  if (!req.user.permissions || req.user.permissions.length === 0) {
    try {
      const dbUser = await db.dbGetUserById(userId);
      if (dbUser?.is_it_developer || dbUser?.is_it_manager) {
        req.user.permissions = ['it_updates.view', 'it_updates.manage', 'it_updates.users'];
      }
    } catch (_) {}
  }

  // Load role IDs
  try {
    req.user.roleIds = await db.dbGetUserRoleIds(userId);
  } catch (_) {}

  // The master tier lives on users.is_master_admin, never in role_permissions, so it
  // has to be read from the row. master implies admin.
  try {
    const dbUser = await db.dbGetUserById(userId);
    req.user.is_master_admin = Boolean(dbUser?.is_master_admin);
    if (req.user.is_master_admin) {
      req.user.permissions = [...new Set([...req.user.permissions, 'master.access', 'admin.access'])];
    }
  } catch (_) {
    req.user.is_master_admin = false;
  }

  next();
}

/** Require one of the given permissions (or admin.access). */
export function requirePermission(...permissions) {
  return (req, res, next) => {
    const userPerms = req.user?.permissions || [];
    if (userPerms.includes('admin.access')) return next();
    const has = permissions.some((p) => userPerms.includes(p));
    if (has) return next();
    return res.status(403).json({ message: 'Insufficient permissions' });
  };
}

export function signAccessToken(payload) {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: JWT_ACCESS_EXPIRY });
}

export function signRefreshToken(payload) {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: JWT_REFRESH_EXPIRY });
}

export function verifyRefreshToken(token) {
  try {
    return jwt.verify(token, JWT_SECRET);
  } catch {
    return null;
  }
}
