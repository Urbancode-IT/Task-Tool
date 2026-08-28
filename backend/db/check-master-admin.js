/**
 * Diagnose a failing master-console sign-in.
 *
 *   DATABASE_URL="<connection string>" node db/check-master-admin.js --email you@example.com
 *   DATABASE_URL="<connection string>" node db/check-master-admin.js --email you@example.com --password '...'
 *
 * `POST /auth/master-login` answers "Invalid master credentials" for four different
 * reasons on purpose, so the endpoint cannot be used to discover which accounts exist.
 * That is right for a public endpoint and useless for debugging, which is what this is
 * for: run it against the same database the API uses and it names the actual cause.
 *
 * Read-only. It prints nothing secret — no hash, no password, no connection string.
 * `--password` is optional; supply it only to check the hash comparison, and prefer
 * MASTER_ADMIN_PASSWORD in the environment over a shell argument, which lands in your
 * shell history.
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
const password = arg('password') || process.env.MASTER_ADMIN_PASSWORD || '';

const ok = (m) => console.log(`  PASS  ${m}`);
const bad = (m, fix) => {
  console.log(`  FAIL  ${m}`);
  if (fix) console.log(`        -> ${fix}`);
};

async function main() {
  if (!email) {
    console.error('\n  An --email is required (or set MASTER_ADMIN_EMAIL).\n');
    process.exit(1);
  }

  const conn = await db.testConnection();
  if (!conn?.ok) {
    console.error(`\n  Database not reachable: ${conn?.error || 'unknown error'}`);
    console.error('  Set DATABASE_URL to the database the API itself uses — note that');
    console.error('  DB_USER / DB_PASSWORD / DB_DATABASE are ignored by getConnectionString().\n');
    process.exit(1);
  }

  const pool = db.getPool();
  console.log(`\n  Checking ${email}\n`);

  // 0. The column the whole tier hangs on. dbEnsureTables() adds it at boot, but its
  //    DDL is wrapped in a catch that only warns, so it can be silently absent.
  const { rows: col } = await pool.query(
    `SELECT 1 FROM information_schema.columns
      WHERE table_name = 'users' AND column_name = 'is_master_admin'`
  );
  if (!col.length) {
    bad('users.is_master_admin does not exist',
      'the boot migration did not run; the seed script adds the column itself');
    process.exit(1);
  }
  ok('users.is_master_admin exists');

  // 1. Does the account exist at all, in THIS database?
  const { rows } = await pool.query(
    `SELECT user_id, username, email, password_hash,
            COALESCE(is_master_admin, false) AS is_master_admin
       FROM users WHERE lower(trim(email)) = lower(trim($1))`,
    [email]
  );
  if (!rows.length) {
    bad(`no account with that email in this database`,
      'seed it here: npm run db:seed-master-admin -- --email ... --username ... --password ...');
    const { rows: n } = await pool.query('SELECT count(*)::int AS n FROM users');
    console.log(`\n  (this database holds ${n[0].n} user account(s) — if that number looks`);
    console.log('   wrong, DATABASE_URL is pointing at the wrong database)\n');
    process.exit(1);
  }
  const u = rows[0];
  ok(`account found — user #${u.user_id}, username "${u.username}"`);

  // 2. The tier itself. This is the case that looks exactly like a wrong password.
  if (u.is_master_admin) ok('is_master_admin is true');
  else {
    bad('is_master_admin is FALSE — this is why sign-in fails',
      'grant it: npm run db:seed-master-admin -- --email ' + email);
  }

  // 3. Only if asked: does the password actually match?
  if (!password) {
    console.log('  SKIP  password not checked (pass --password to verify it)');
  } else if (!u.password_hash) {
    bad('the account has no password hash stored', 're-run the seed script with --password');
  } else if (await bcrypt.compare(password, u.password_hash)) {
    ok('password matches the stored hash');
  } else {
    bad('password does NOT match the stored hash',
      're-run the seed script with --password to reset it');
  }

  console.log('');
}

main()
  .catch((err) => {
    console.error(`\n  Check failed: ${err.message}\n`);
    process.exit(1);
  })
  .finally(async () => {
    await db.getPool()?.end().catch(() => {});
  });
