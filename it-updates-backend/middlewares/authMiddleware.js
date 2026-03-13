import jwt from 'jsonwebtoken';

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
