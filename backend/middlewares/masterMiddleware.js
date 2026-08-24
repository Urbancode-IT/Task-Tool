// Guard for the master control console.
//
// Deliberately does NOT use requirePermission from authMiddleware: that helper
// short-circuits on admin.access, so every ordinary admin would pass a
// master.access check. The master tier has to be verified on its own terms.
//
// Two conditions must both hold:
//   1. the account carries master.access, and
//   2. the session was opened at the master login (JWT scope claim === 'master').
//
// Condition 2 means a master account that somehow held an app-scoped cookie still
// cannot drive the master API with it.

export function requireMasterScope(req, res, next) {
  const perms = req.user?.permissions || [];
  const scope = req.user?.scope;

  if (!perms.includes('master.access')) {
    return res.status(403).json({ message: 'Master console access required.' });
  }
  if (scope !== 'master') {
    return res.status(403).json({
      message: 'This session was not opened from the master console. Sign in at /master.',
    });
  }
  return next();
}

export default requireMasterScope;
