/**
 * Create or update the master admin account.
 *
 *   npm run db:seed-master-admin -- --email admin@urbancode.in --username UrbanCode --password '...'
 *
 * Values may also come from MASTER_ADMIN_EMAIL / MASTER_ADMIN_USERNAME /
 * MASTER_ADMIN_PASSWORD in the environment. Nothing is hardcoded here on purpose:
 * a password committed to the repository stays in git history forever.
 *
 * Run again with a new password to rotate it. Pass --revoke to clear the flag
 * without deleting the account.
 */
import 'dotenv/config';
import bcrypt from 'bcrypt';
import * as db from './index.js';

function arg(name) {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 && process.argv[i + 1] && !process.argv[i + 1].startsWith('--')
    ? process.argv[i + 1]
    : undefined;
}

const email = (arg('email') || process.env.MASTER_ADMIN_EMAIL || '').trim();
const username = (arg('username') || process.env.MASTER_ADMIN_USERNAME || '').trim();
const password = arg('password') || process.env.MASTER_ADMIN_PASSWORD || '';
const revoke = process.argv.includes('--revoke');

const die = (msg) => {
  console.error(`\n  ${msg}\n`);
  process.exit(1);
};

async function main() {
  if (!email) die('An --email is required (or set MASTER_ADMIN_EMAIL).');

  const conn = await db.testConnection();
  if (!conn?.ok) die(`Database not reachable: ${conn?.error || 'unknown error'}`);

  const pool = db.getPool();
  // Standalone-safe: the server adds this on boot, but the script may run first.
  await pool.query('ALTER TABLE users ADD COLUMN IF NOT EXISTS is_master_admin BOOLEAN DEFAULT false');

  const { rows: found } = await pool.query(
    'SELECT user_id, username FROM users WHERE lower(email) = lower($1)',
    [email]
  );

  if (revoke) {
    if (!found.length) die(`No account found for ${email}.`);
    await db.dbSetMasterAdmin(found[0].user_id, false);
    console.log(`\n  Master tier revoked from ${email} (user #${found[0].user_id}).`);
    console.log('  The account itself is untouched.\n');
    return;
  }

  if (!password && !found.length) die('A --password is required when creating a new account.');
  if (password && password.length < 8) die('Password must be at least 8 characters.');

  let userId;
  let action;

  if (found.length) {
    userId = found[0].user_id;
    action = 'updated';
    if (password) {
      const hash = await bcrypt.hash(password, 10);
      await pool.query('UPDATE users SET password_hash = $2 WHERE user_id = $1', [userId, hash]);
    }
    if (username && username !== found[0].username) {
      await pool.query('UPDATE users SET username = $2 WHERE user_id = $1', [userId, username]);
    }
    await pool.query('UPDATE users SET is_active = true WHERE user_id = $1', [userId]);
  } else {
    const hash = await bcrypt.hash(password, 10);
    const { rows } = await pool.query(
      `INSERT INTO users (username, email, password_hash, is_active)
       VALUES ($1, $2, $3, true) RETURNING user_id`,
      [username || 'Master Admin', email, hash]
    );
    userId = rows[0].user_id;
    action = 'created';
  }

  await db.dbSetMasterAdmin(userId, true);

  const { rows: check } = await pool.query(
    'SELECT username, email, is_master_admin, is_active FROM users WHERE user_id = $1',
    [userId]
  );
  const u = check[0];

  console.log(`\n  Master admin ${action}.`);
  console.log(`    user_id         ${userId}`);
  console.log(`    username        ${u.username}`);
  console.log(`    email           ${u.email}`);
  console.log(`    is_master_admin ${u.is_master_admin}`);
  console.log(`    is_active       ${u.is_active}`);
  console.log('\n  Sign in at /master. This account cannot use the normal login.\n');
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('\n  seed-master-admin failed:', err.message, '\n');
    process.exit(1);
  });
