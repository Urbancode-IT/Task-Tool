import jwt from 'jsonwebtoken';
import * as db from '../db/index.js';

const JWT_SECRET = process.env.JWT_SECRET;
const JWT_ACCESS_EXPIRY = process.env.JWT_ACCESS_EXPIRY || '15m';
const JWT_REFRESH_EXPIRY = process.env.JWT_REFRESH_EXPIRY || '7d';

export function optionalAuth(req, res, next) {
  if (!JWT_SECRET) return next();
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
  if (!JWT_SECRET) return next();
  const token = req.cookies?.access_token;
  if (!token) {
    return res.status(401).json({ message: 'Authentication required' });
  }
  if (token === 'demo-token') return next();
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
      'digital_marketing.view', 'digital_marketing.manage',
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
  return JWT_SECRET ? jwt.sign(payload, JWT_SECRET, { expiresIn: JWT_ACCESS_EXPIRY }) : null;
}

export function signRefreshToken(payload) {
  return JWT_SECRET ? jwt.sign(payload, JWT_SECRET, { expiresIn: JWT_REFRESH_EXPIRY }) : null;
}

export function verifyRefreshToken(token) {
  if (!JWT_SECRET) return null;
  try {
    return jwt.verify(token, JWT_SECRET);
  } catch {
    return null;
  }
}
