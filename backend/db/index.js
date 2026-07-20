import pg from 'pg';
import dotenv from 'dotenv';
import path from 'path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '..', '.env') });

/**
 * Images (avatars, project logos) are stored as base64 `data:` URLs. Inlining that
 * blob into every task/comment/team/project row bloats each API response and
 * defeats browser caching (the same image is re-sent on every fetch). Instead we
 * return a short, cacheable URL that points at a media-serving endpoint. The `?v=`
 * hash changes whenever the underlying image changes, so a new image busts the
 * cache while an unchanged one is served from disk cache across every request.
 *
 * The URL must be ABSOLUTE and point at the API origin — the frontend usually runs
 * on a different origin, so a root-relative `/api/...` would resolve against the
 * frontend host and 404. The origin is resolved in this order:
 *   1. PUBLIC_API_URL / RENDER_EXTERNAL_URL env (explicit override), else
 *   2. the origin captured from the incoming request (host + proto headers).
 * (2) makes it work with zero configuration in dev and on any host.
 */
let capturedApiBase = '';
export function setApiBaseFromRequest(req) {
  try {
    const proto = String(req.headers['x-forwarded-proto'] || req.protocol || 'http')
      .split(',')[0]
      .trim();
    const host = String(req.headers['x-forwarded-host'] || req.headers.host || '')
      .split(',')[0]
      .trim();
    if (host) capturedApiBase = `${proto}://${host}`;
  } catch {
    /* ignore — fall back to env/empty base */
  }
}
function publicApiBase() {
  const env = (process.env.PUBLIC_API_URL || process.env.RENDER_EXTERNAL_URL || '').replace(/\/+$/, '');
  if (env) return env;
  return capturedApiBase.replace(/\/+$/, '');
}
export function mediaHash(image) {
  return crypto.createHash('sha1').update(image).digest('hex').slice(0, 12);
}
export function avatarUrlFor(userId, image) {
  if (!image || userId == null) return null;
  // Non-data strings are already URLs (e.g. externally hosted) — pass through.
  if (typeof image !== 'string' || !image.startsWith('data:')) return image;
  return `${publicApiBase()}/api/it-updates/users/${userId}/avatar?v=${mediaHash(image)}`;
}
export function projectLogoUrlFor(projectId, logo) {
  if (!logo || projectId == null) return null;
  // Non-data strings are already URLs (e.g. /urban-code-logo.svg) — pass through.
  if (typeof logo !== 'string' || !logo.startsWith('data:')) return logo;
  return `${publicApiBase()}/api/it-updates/projects/${projectId}/logo?v=${mediaHash(logo)}`;
}

const toNullableDate = (val) => (val === '' || val === undefined ? null : val);
const toNullableInt = (val) => {
  if (val === '' || val === undefined || val === null) return null;
  const n = Number(val);
  return Number.isFinite(n) ? Math.trunc(n) : null;
};
const normalizeTeammatesInput = (val) => {
  if (Array.isArray(val)) {
    return [...new Set(val.map((v) => String(v || '').trim()).filter(Boolean))];
  }
  if (typeof val === 'string') {
    return [...new Set(val.split(',').map((v) => v.trim()).filter(Boolean))];
  }
  return [];
};
const teammatesToText = (val) => normalizeTeammatesInput(val).join(', ');
const teammatesFromText = (val) => normalizeTeammatesInput(val);

// Project requirements checklist: stored as a JSON array of { title, done } in a
// TEXT column. Serialize/parse defensively so a bad value never breaks a query.
const projectReqsToText = (val) => {
  if (val == null) return null;
  let arr = val;
  if (typeof val === 'string') {
    try {
      arr = JSON.parse(val);
    } catch {
      return null;
    }
  }
  if (!Array.isArray(arr)) return null;
  const cleaned = arr
    .map((r) => ({
      title: String(r?.title ?? '').trim(),
      done: Boolean(r?.done),
    }))
    .filter((r) => r.title);
  return JSON.stringify(cleaned);
};
const projectReqsFromText = (val) => {
  if (!val) return [];
  try {
    const arr = JSON.parse(val);
    if (!Array.isArray(arr)) return [];
    return arr
      .map((r) => ({ title: String(r?.title ?? '').trim(), done: Boolean(r?.done) }))
      .filter((r) => r.title);
  } catch {
    return [];
  }
};

const { Pool } = pg;

// Return DATE columns (OID 1082) as raw 'YYYY-MM-DD' strings rather than JS Date
// objects. The default parser builds a Date at the server's LOCAL midnight; when the
// API serializes it to JSON (toISOString → UTC) in a timezone ahead of UTC (e.g. IST),
// the calendar day shifts back by one, so a task dated "today" renders under "yesterday".
// TIMESTAMP / TIMESTAMPTZ columns use different OIDs and keep their default parsers.
pg.types.setTypeParser(1082, (val) => val);

let pool = null;
// Tracks whether Postgres is actually reachable (set by testConnection on startup).
// This avoids "env is set but DB is unreachable" causing hard 401 login failures.
let dbAvailability = null;

function getConnectionString() {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL;
  const user = 'postgres';
  const password = '1234';
  const host = process.env.DB_HOST || 'localhost';
  const port = process.env.DB_PORT || '5432';
  const database = 'seyal';
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
  if (dbAvailability !== null) return dbAvailability;
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

/** Get user by id (for permission resolution when RBAC tables missing). */
export async function dbGetUserById(userId) {
  const p = getPool();
  if (!p) return null;
  const id = parseInt(String(userId), 10);
  if (!Number.isFinite(id)) return null;
  try {
    const { rows } = await p.query(
      'SELECT user_id, username, email, profile_image, is_it_developer, is_it_manager, branch FROM users WHERE user_id = $1',
      [id]
    );
    const row = rows[0];
    if (!row) return null;
    return {
      ...row,
      is_it_developer: row.is_it_developer === true || row.is_it_developer === 1,
      is_it_manager: row.is_it_manager === true || row.is_it_manager === 1,
    };
  } catch (err) {
    console.error('dbGetUserById:', err.message);
    return null;
  }
}

/**
 * Whether a user is active (assignable). Fails open (returns true) when there is no
 * DB, no id, an unknown user, or on error — so it only ever blocks a KNOWN inactive
 * user and never breaks legitimate operations.
 */
export async function dbIsUserActive(userId) {
  const p = getPool();
  if (!p || userId == null || userId === '') return true;
  const id = parseInt(String(userId), 10);
  if (!Number.isFinite(id)) return true;
  try {
    const { rows } = await p.query('SELECT is_active FROM users WHERE user_id = $1', [id]);
    if (!rows.length) return true;
    return rows[0].is_active !== false;
  } catch (err) {
    console.error('dbIsUserActive:', err.message);
    return true;
  }
}

/** Get permissions for a user. Uses RBAC tables if present; merges with legacy is_it_developer/is_it_manager so IT staff always have it_updates access. */
export async function dbGetUserPermissionsOrLegacy(userId) {
  let perms = [];
  try {
    perms = await dbGetUserPermissions(userId);
  } catch (_) { }
  const user = await dbGetUserById(userId);
  const legacy = [];
  if (user?.is_it_developer || user?.is_it_manager) {
    legacy.push('it_updates.view', 'it_updates.manage', 'it_updates.users');
  }
  const combined = [...new Set([...(Array.isArray(perms) ? perms : []), ...legacy])];
  return combined.length > 0 ? combined : legacy;
}

/** List all users (safe fields only). */
export async function dbGetUsers() {
  const p = getPool();
  if (!p) return [];
  try {
    const { rows } = await p.query(
      `SELECT user_id, username, email, is_it_developer, is_it_manager, created_at
       FROM users
       ORDER BY username`
    );
    return rows;
  } catch (err) {
    console.error('dbGetUsers:', err.message);
    return [];
  }
}

/** Create a user. Returns created row (without password_hash) or null. */
export async function dbCreateUser({ username, email, password_hash, is_it_developer, is_it_manager, branch, is_active }) {
  const p = getPool();
  if (!p) return null;
  const emailVal = email && String(email).trim() ? String(email).trim() : null;
  const branchVal = branch && String(branch).trim() ? String(branch).trim() : null;
  try {
    const { rows } = await p.query(
      `INSERT INTO users (username, email, password_hash, is_it_developer, is_it_manager, branch, is_active)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING user_id, username, email, is_it_developer, is_it_manager, branch, is_active, created_at`,
      [
        String(username || '').trim(),
        emailVal,
        password_hash,
        Boolean(is_it_developer),
        Boolean(is_it_manager),
        branchVal,
        // New users are active unless explicitly created inactive.
        is_active === undefined ? true : Boolean(is_active),
      ]
    );
    return rows[0] || null;
  } catch (err) {
    console.error('dbCreateUser:', err.message);
    return null;
  }
}

/** Update a user. password_hash optional. Returns updated row or null. */
export async function dbUpdateUser(userId, { username, email, password_hash, is_it_developer, is_it_manager, branch, is_active }) {
  const p = getPool();
  if (!p) return null;
  const id = parseInt(userId, 10);
  if (!Number.isFinite(id)) return null;
  try {
    const updates = [];
    const values = [];
    let i = 1;
    if (username !== undefined) {
      updates.push(`username = $${i++}`);
      values.push(String(username || '').trim());
    }
    if (email !== undefined) {
      updates.push(`email = $${i++}`);
      values.push(email && String(email).trim() ? String(email).trim() : null);
    }
    if (password_hash !== undefined && password_hash !== null) {
      updates.push(`password_hash = $${i++}`);
      values.push(password_hash);
    }
    if (is_it_developer !== undefined) {
      updates.push(`is_it_developer = $${i++}`);
      values.push(Boolean(is_it_developer));
    }
    if (is_it_manager !== undefined) {
      updates.push(`is_it_manager = $${i++}`);
      values.push(Boolean(is_it_manager));
    }
    if (branch !== undefined) {
      updates.push(`branch = $${i++}`);
      values.push(branch && String(branch).trim() ? String(branch).trim() : null);
    }
    if (is_active !== undefined) {
      updates.push(`is_active = $${i++}`);
      values.push(Boolean(is_active));
    }
    if (updates.length === 0) {
      const { rows } = await p.query(
        `SELECT user_id, username, email, is_it_developer, is_it_manager, branch, is_active, created_at FROM users WHERE user_id = $1`,
        [id]
      );
      return rows[0] || null;
    }
    values.push(id);
    const { rows } = await p.query(
      `UPDATE users SET ${updates.join(', ')} WHERE user_id = $${i} RETURNING user_id, username, email, is_it_developer, is_it_manager, branch, is_active, created_at`,
      values
    );
    return rows[0] || null;
  } catch (err) {
    console.error('dbUpdateUser:', err.message);
    return null;
  }
}

/** Update only the profile image for a user (self-service avatar). Returns updated row or null. */
export async function dbUpdateUserProfileImage(userId, image) {
  const p = getPool();
  if (!p) return null;
  const id = parseInt(String(userId), 10);
  if (!Number.isFinite(id)) return null;
  try {
    const { rows } = await p.query(
      `UPDATE users SET profile_image = $1 WHERE user_id = $2
       RETURNING user_id, username, email, profile_image, is_it_developer, is_it_manager`,
      [image || null, id]
    );
    return rows[0] || null;
  } catch (err) {
    console.error('dbUpdateUserProfileImage:', err.message);
    return null;
  }
}

/** Delete a user. Returns true if deleted. */
export async function dbDeleteUser(userId) {
  const p = getPool();
  if (!p) return false;
  const id = parseInt(userId, 10);
  if (!Number.isFinite(id)) return false;
  try {
    const { rowCount } = await p.query('DELETE FROM users WHERE user_id = $1', [id]);
    return rowCount > 0;
  } catch (err) {
    console.error('dbDeleteUser:', err.message);
    return false;
  }
}

/** Auto-create tables if missing. */
export async function dbEnsureTables() {
  const p = getPool();
  if (!p) return;

  // ── Rename: "Digital Marketing" → "Creative Team" ──────────────────────────
  // Physically rename the team's tables and migrate the team string stored in
  // log/notification rows. Idempotent: only renames when the old table exists and
  // the new one does not, so it runs at most once per database.
  const renamePairs = [
    ['digital_marketing_tasks', 'creative_team_tasks'],
    ['digital_marketing_task_requirements', 'creative_team_task_requirements'],
  ];
  for (const [oldName, newName] of renamePairs) {
    try {
      const { rows } = await p.query(
        `SELECT to_regclass('public.${oldName}') AS old_t, to_regclass('public.${newName}') AS new_t`
      );
      if (rows?.[0]?.old_t && !rows?.[0]?.new_t) {
        await p.query(`ALTER TABLE ${oldName} RENAME TO ${newName}`);
        console.log(`DB: renamed ${oldName} → ${newName}.`);
      }
    } catch (err) {
      console.warn(`dbEnsureTables: rename ${oldName}:`, err.message);
    }
  }
  try {
    await p.query("UPDATE requirement_time_logs SET team = 'creative_team' WHERE team = 'digital_marketing'");
    await p.query("UPDATE task_deadline_notifications SET team = 'creative_team' WHERE team = 'digital_marketing'");
  } catch (err) {
    console.warn('dbEnsureTables: migrate team strings:', err.message);
  }

  // Keep project fields in sync for ownership + teammates.
  try {
    await p.query(`
      ALTER TABLE it_projects
      ADD COLUMN IF NOT EXISTS owner_user_id INT,
      ADD COLUMN IF NOT EXISTS owner_name VARCHAR(200),
      ADD COLUMN IF NOT EXISTS teammates TEXT,
      ADD COLUMN IF NOT EXISTS project_url TEXT,
      ADD COLUMN IF NOT EXISTS logo TEXT,
      ADD COLUMN IF NOT EXISTS project_type VARCHAR(20) DEFAULT 'internal',
      ADD COLUMN IF NOT EXISTS client_name VARCHAR(200),
      ADD COLUMN IF NOT EXISTS requirements TEXT;
    `);
    // Backfill any pre-existing rows so they show under Internal Projects.
    await p.query(`UPDATE it_projects SET project_type = 'internal' WHERE project_type IS NULL;`);
  } catch (err) {
    console.warn('dbEnsureTables: project ownership columns check failed:', err.message);
  }

  // Per-project documents: three slots (project_documentation, brd, credentials).
  // Files are stored inline as base64 data URLs in a TEXT column, matching the
  // established pattern (profile_image, it_projects.logo). One current row per
  // (project_id, doc_type); re-uploading replaces it.
  try {
    await p.query(`
      CREATE TABLE IF NOT EXISTS project_documents (
        doc_id SERIAL PRIMARY KEY,
        project_id INT NOT NULL REFERENCES it_projects(project_id) ON DELETE CASCADE,
        doc_type VARCHAR(40) NOT NULL,
        file_name TEXT,
        mime_type TEXT,
        file_data TEXT,
        uploaded_by INT,
        uploaded_by_name TEXT,
        uploaded_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE (project_id, doc_type)
      );
    `);
  } catch (err) {
    console.warn('dbEnsureTables: project_documents table check failed:', err.message);
  }

  // Project notes/comments — same model as EOD-report comments (replies, @mentions,
  // likes). Mentions trigger email via notifyMentions, so members can post updates.
  try {
    await p.query(`
      CREATE TABLE IF NOT EXISTS project_comments (
        comment_id SERIAL PRIMARY KEY,
        project_id INT NOT NULL REFERENCES it_projects(project_id) ON DELETE CASCADE,
        user_id INT,
        comment_text TEXT,
        parent_id INT,
        mentions TEXT,
        edited_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
      );
    `);
    await p.query('CREATE INDEX IF NOT EXISTS idx_project_comments_project ON project_comments(project_id);');
    await p.query(`
      CREATE TABLE IF NOT EXISTS project_comment_likes (
        comment_id INT NOT NULL REFERENCES project_comments(comment_id) ON DELETE CASCADE,
        user_id INT NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
        created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (comment_id, user_id)
      );
    `);
  } catch (err) {
    console.warn('dbEnsureTables: project_comments table check failed:', err.message);
  }

  // Flag distinguishing Client CRM cards (created in the External CRM board) from
  // ordinary tasks, so moving a project between sectors never mixes them.
  try {
    await p.query('ALTER TABLE it_tasks ADD COLUMN IF NOT EXISTS is_crm BOOLEAN DEFAULT false;');
    // Lead details (Client CRM) stored as a JSON string: business/client/contact
    // info, requested service, lead source, industry, client type, etc.
    await p.query('ALTER TABLE it_tasks ADD COLUMN IF NOT EXISTS lead_details TEXT;');
  } catch (err) {
    console.warn('dbEnsureTables: it_tasks.is_crm / lead_details check failed:', err.message);
  }

  // Profile pictures are stored inline as data URLs, so the column must be TEXT
  // (not a narrow VARCHAR) to avoid truncation.
  try {
    await p.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS profile_image TEXT;`);
    await p.query(`ALTER TABLE users ALTER COLUMN profile_image TYPE TEXT;`);
    // EOD lock: users who miss an EOD report get locked out until an admin approves.
    await p.query(`ALTER TABLE users
      ADD COLUMN IF NOT EXISTS eod_locked BOOLEAN DEFAULT false,
      ADD COLUMN IF NOT EXISTS eod_lock_date DATE,
      ADD COLUMN IF NOT EXISTS eod_excused_through DATE;`);
    // Branch the user belongs to (Tirunelveli / Velachery / Pallikaranai).
    await p.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS branch TEXT;`);
    // Active/inactive: only active users can be assigned tasks/projects and are subject
    // to (and reported for) the EOD requirement. Existing users default to active.
    await p.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS is_active BOOLEAN DEFAULT true;`);
    await p.query(`UPDATE users SET is_active = true WHERE is_active IS NULL;`);
  } catch (err) {
    console.warn('dbEnsureTables: users.profile_image check failed:', err.message);
  }

  // Rich comments: replies (parent_id), edited flag, @mentions, and likes.
  try {
    await p.query(`
      ALTER TABLE task_comments
      ADD COLUMN IF NOT EXISTS parent_id INT,
      ADD COLUMN IF NOT EXISTS edited_at TIMESTAMPTZ,
      ADD COLUMN IF NOT EXISTS mentions TEXT,
      ADD COLUMN IF NOT EXISTS team VARCHAR(40) DEFAULT 'it';
    `);
    await p.query("UPDATE task_comments SET team = 'it' WHERE team IS NULL OR team = '';");
    // Comments are shared across every team's task table (consultant/creative/social/
    // legal_finance/director/it), namespaced by the `team` column. Any leftover foreign
    // key from task_comments.task_id to it_tasks is wrong for that design and blocks
    // comments on non-IT tasks (e.g. director tasks). Drop it if present.
    await p.query(`
      DO $$
      DECLARE r record;
      BEGIN
        FOR r IN
          SELECT con.conname
            FROM pg_constraint con
            JOIN pg_class rel  ON rel.oid  = con.conrelid
            JOIN pg_class fref ON fref.oid = con.confrelid
           WHERE rel.relname = 'task_comments'
             AND con.contype = 'f'
             AND fref.relname = 'it_tasks'
        LOOP
          EXECUTE format('ALTER TABLE task_comments DROP CONSTRAINT %I', r.conname);
        END LOOP;
      END $$;
    `);
    await p.query(`
      CREATE TABLE IF NOT EXISTS comment_likes (
        comment_id INT NOT NULL REFERENCES task_comments(comment_id) ON DELETE CASCADE,
        user_id INT NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
        created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (comment_id, user_id)
      );
    `);
  } catch (err) {
    console.warn('dbEnsureTables: task_comments enrichments failed:', err.message);
  }

  // EOD report comments — same model as task comments (replies, mentions, likes).
  try {
    await p.query(`
      CREATE TABLE IF NOT EXISTS eod_report_comments (
        comment_id SERIAL PRIMARY KEY,
        report_id INT NOT NULL,
        user_id INT,
        comment_text TEXT,
        parent_id INT,
        mentions TEXT,
        edited_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
      );
    `);
    await p.query('CREATE INDEX IF NOT EXISTS idx_eod_comments_report ON eod_report_comments(report_id);');
    await p.query(`
      CREATE TABLE IF NOT EXISTS eod_comment_likes (
        comment_id INT NOT NULL REFERENCES eod_report_comments(comment_id) ON DELETE CASCADE,
        user_id INT NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
        created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (comment_id, user_id)
      );
    `);
    // The EOD report itself can be liked and edited (acts like a post).
    await p.query('ALTER TABLE eod_reports ADD COLUMN IF NOT EXISTS edited_at TIMESTAMPTZ;');
    // Scope each report to the module it was submitted from so a member's EOD only
    // shows in that sector. Existing rows predate the split and belong to the IT
    // module (the only one with an EOD flow originally), so default them to 'it'.
    await p.query("ALTER TABLE eod_reports ADD COLUMN IF NOT EXISTS team TEXT DEFAULT 'it';");
    await p.query("UPDATE eod_reports SET team = 'it' WHERE team IS NULL;");
    await p.query(`
      CREATE TABLE IF NOT EXISTS eod_report_likes (
        report_id INT NOT NULL,
        user_id INT NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
        created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (report_id, user_id)
      );
    `);
  } catch (err) {
    console.warn('dbEnsureTables: eod_report_comments failed:', err.message);
  }

  // Dedupe table so each deadline alert (per task/team/kind) is emailed only once.
  try {
    await p.query(`
      CREATE TABLE IF NOT EXISTS task_deadline_notifications (
        task_id INT NOT NULL,
        team VARCHAR(40) NOT NULL,
        kind VARCHAR(20) NOT NULL,
        created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (task_id, team, kind)
      );
    `);
  } catch (err) {
    console.warn('dbEnsureTables: task_deadline_notifications failed:', err.message);
  }

  // Per-requirement time tracking (start/pause/resume timer).
  for (const tbl of [
    'it_task_requirements',
    'consultant_task_requirements',
    'creative_team_task_requirements',
    'social_media_task_requirements',
    'legal_finance_task_requirements',
    'director_task_requirements',
  ]) {
    try {
      const { rows } = await p.query(
        "SELECT EXISTS (SELECT FROM information_schema.tables WHERE table_schema = 'public' AND table_name = $1) AS ex",
        [tbl]
      );
      if (!rows[0]?.ex) continue;
      await p.query(
        `ALTER TABLE ${tbl}
         ADD COLUMN IF NOT EXISTS time_spent_seconds INT DEFAULT 0,
         ADD COLUMN IF NOT EXISTS timer_started_at TIMESTAMPTZ;`
      );
    } catch (err) {
      console.warn(`dbEnsureTables: ${tbl} timer columns:`, err.message);
    }
  }

  const taskTablesForReview = [
    'it_tasks',
    'consultant_tasks',
    'creative_team_tasks',
    'social_media_tasks',
    'legal_finance_tasks',
  ];
  for (const tbl of taskTablesForReview) {
    try {
      const { rows } = await p.query(
        "SELECT EXISTS (SELECT FROM information_schema.tables WHERE table_schema = 'public' AND table_name = $1)",
        [tbl]
      );
      if (!rows[0]?.exists) continue;
      await p.query(`
        ALTER TABLE ${tbl}
        ADD COLUMN IF NOT EXISTS reviewed_by INT REFERENCES users(user_id),
        ADD COLUMN IF NOT EXISTS review_comment TEXT,
        ADD COLUMN IF NOT EXISTS reviewed_at TIMESTAMPTZ;
      `);
    } catch (err) {
      console.warn(`dbEnsureTables: ${tbl} review columns:`, err.message);
    }
  }

  // Campaign/content columns apply to both the Creative Team and Social Media tables.
  for (const tbl of ['creative_team_tasks', 'social_media_tasks']) {
    try {
      const { rows } = await p.query(
        "SELECT EXISTS (SELECT FROM information_schema.tables WHERE table_schema = 'public' AND table_name = $1) AS ex",
        [tbl]
      );
      if (!rows?.[0]?.ex) continue;
      await p.query(`
        ALTER TABLE ${tbl}
        ADD COLUMN IF NOT EXISTS campaign_name VARCHAR(255),
        ADD COLUMN IF NOT EXISTS content_type VARCHAR(100),
        ADD COLUMN IF NOT EXISTS channel VARCHAR(100),
        ADD COLUMN IF NOT EXISTS design_link TEXT,
        ADD COLUMN IF NOT EXISTS content_doc_link TEXT,
        ADD COLUMN IF NOT EXISTS publish_link TEXT,
        ADD COLUMN IF NOT EXISTS target_date DATE,
        ADD COLUMN IF NOT EXISTS publish_date DATE;
      `);
    } catch (err) {
      console.warn(`dbEnsureTables: ${tbl} campaign columns:`, err.message);
    }
  }

  // If base tables aren't present yet (e.g. `it_tasks`), creating a FK table will fail.
  // This is a symptom that `schema.sql` / migrations weren't applied to the DB.
  let hasItTasks = false;
  try {
    const { rows } = await p.query(
      "SELECT to_regclass('public.it_tasks') AS it_tasks_regclass;"
    );
    hasItTasks = Boolean(rows?.[0]?.it_tasks_regclass);
  } catch (err) {
    console.warn('dbEnsureTables: table existence check failed:', err.message);
  }

  if (!hasItTasks) {
    console.warn('dbEnsureTables: skipping it_task_requirements because it_tasks does not exist yet');
    return;
  }

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

  try {
    await p.query(`
      CREATE TABLE IF NOT EXISTS legal_finance_tasks (
        task_id SERIAL PRIMARY KEY,
        project_id INT REFERENCES it_projects(project_id) ON DELETE SET NULL,
        assigned_to INT REFERENCES users(user_id) ON DELETE SET NULL,
        assigned_by INT REFERENCES users(user_id) ON DELETE SET NULL,
        created_by INT REFERENCES users(user_id) ON DELETE SET NULL,
        task_title VARCHAR(500) NOT NULL DEFAULT 'New Task',
        task_description TEXT,
        priority VARCHAR(20) DEFAULT 'medium',
        status VARCHAR(20) DEFAULT 'in_progress',
        task_date DATE,
        due_date DATE,
        created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
        completed_at TIMESTAMPTZ,
        reviewed_by INT REFERENCES users(user_id) ON DELETE SET NULL,
        review_comment TEXT,
        reviewed_at TIMESTAMPTZ
      );
      CREATE INDEX IF NOT EXISTS idx_legal_finance_tasks_assigned ON legal_finance_tasks(assigned_to);
      CREATE INDEX IF NOT EXISTS idx_legal_finance_tasks_status ON legal_finance_tasks(status);
    `);
    console.log('DB: legal_finance_tasks table ensured.');
  } catch (err) {
    console.warn('dbEnsureTables: legal_finance_tasks:', err.message);
  }

  try {
    await p.query(`
      CREATE TABLE IF NOT EXISTS legal_finance_task_requirements (
        requirement_id SERIAL PRIMARY KEY,
        task_id INT NOT NULL REFERENCES legal_finance_tasks(task_id) ON DELETE CASCADE,
        title VARCHAR(500) NOT NULL,
        description TEXT,
        status VARCHAR(20) DEFAULT 'pending',
        priority VARCHAR(20) DEFAULT 'medium',
        due_date DATE,
        sort_order INT DEFAULT 0,
        created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
      );
      CREATE INDEX IF NOT EXISTS idx_lf_task_requirements_task_id ON legal_finance_task_requirements(task_id);
    `);
    console.log('DB: legal_finance_task_requirements table ensured.');
  } catch (err) {
    console.warn('dbEnsureTables: legal_finance_task_requirements:', err.message);
  }

  // Director tasks — directors assign tasks to one another from the Management tab.
  // Same base shape as it_tasks / legal_finance_tasks.
  try {
    await p.query(`
      CREATE TABLE IF NOT EXISTS director_tasks (
        task_id SERIAL PRIMARY KEY,
        project_id INT REFERENCES it_projects(project_id) ON DELETE SET NULL,
        assigned_to INT REFERENCES users(user_id) ON DELETE SET NULL,
        assigned_by INT REFERENCES users(user_id) ON DELETE SET NULL,
        created_by INT REFERENCES users(user_id) ON DELETE SET NULL,
        task_title VARCHAR(500) NOT NULL DEFAULT 'New Task',
        task_description TEXT,
        priority VARCHAR(20) DEFAULT 'medium',
        status VARCHAR(20) DEFAULT 'in_progress',
        task_date DATE,
        due_date DATE,
        created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
        completed_at TIMESTAMPTZ,
        reviewed_by INT REFERENCES users(user_id) ON DELETE SET NULL,
        review_comment TEXT,
        reviewed_at TIMESTAMPTZ
      );
      CREATE INDEX IF NOT EXISTS idx_director_tasks_assigned ON director_tasks(assigned_to);
      CREATE INDEX IF NOT EXISTS idx_director_tasks_status ON director_tasks(status);
    `);
    console.log('DB: director_tasks table ensured.');
  } catch (err) {
    console.warn('dbEnsureTables: director_tasks:', err.message);
  }

  try {
    await p.query(`
      CREATE TABLE IF NOT EXISTS director_task_requirements (
        requirement_id SERIAL PRIMARY KEY,
        task_id INT NOT NULL REFERENCES director_tasks(task_id) ON DELETE CASCADE,
        title VARCHAR(500) NOT NULL,
        description TEXT,
        status VARCHAR(20) DEFAULT 'pending',
        priority VARCHAR(20) DEFAULT 'medium',
        due_date DATE,
        sort_order INT DEFAULT 0,
        created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
      );
      CREATE INDEX IF NOT EXISTS idx_director_task_requirements_task_id ON director_task_requirements(task_id);
    `);
    console.log('DB: director_task_requirements table ensured.');
  } catch (err) {
    console.warn('dbEnsureTables: director_task_requirements:', err.message);
  }

  // Social Media — a full clone of the Creative Team task model (incl. campaign/content
  // fields). Created here like legal_finance since it is a brand-new team.
  try {
    await p.query(`
      CREATE TABLE IF NOT EXISTS social_media_tasks (
        task_id SERIAL PRIMARY KEY,
        project_id INT REFERENCES it_projects(project_id) ON DELETE SET NULL,
        assigned_to INT REFERENCES users(user_id) ON DELETE SET NULL,
        assigned_by INT REFERENCES users(user_id) ON DELETE SET NULL,
        created_by INT REFERENCES users(user_id) ON DELETE SET NULL,
        task_title VARCHAR(500) NOT NULL DEFAULT 'New Task',
        task_description TEXT,
        priority VARCHAR(20) DEFAULT 'medium',
        status VARCHAR(20) DEFAULT 'in_progress',
        task_date DATE,
        due_date DATE,
        created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
        completed_at TIMESTAMPTZ,
        reviewed_by INT REFERENCES users(user_id) ON DELETE SET NULL,
        review_comment TEXT,
        reviewed_at TIMESTAMPTZ,
        campaign_name VARCHAR(255),
        content_type VARCHAR(100),
        channel VARCHAR(100),
        design_link TEXT,
        content_doc_link TEXT,
        publish_link TEXT,
        target_date DATE,
        publish_date DATE
      );
      CREATE INDEX IF NOT EXISTS idx_social_media_tasks_assigned ON social_media_tasks(assigned_to);
      CREATE INDEX IF NOT EXISTS idx_social_media_tasks_status ON social_media_tasks(status);
    `);
    console.log('DB: social_media_tasks table ensured.');
  } catch (err) {
    console.warn('dbEnsureTables: social_media_tasks:', err.message);
  }

  try {
    await p.query(`
      CREATE TABLE IF NOT EXISTS social_media_task_requirements (
        requirement_id SERIAL PRIMARY KEY,
        task_id INT NOT NULL REFERENCES social_media_tasks(task_id) ON DELETE CASCADE,
        title VARCHAR(500) NOT NULL,
        description TEXT,
        status VARCHAR(20) DEFAULT 'pending',
        priority VARCHAR(20) DEFAULT 'medium',
        due_date DATE,
        sort_order INT DEFAULT 0,
        created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
      );
      CREATE INDEX IF NOT EXISTS idx_sm_task_requirements_task_id ON social_media_task_requirements(task_id);
    `);
    console.log('DB: social_media_task_requirements table ensured.');
  } catch (err) {
    console.warn('dbEnsureTables: social_media_task_requirements:', err.message);
  }

  // Per-requirement timer columns — FINAL pass. The earlier ADD COLUMN block runs
  // before the requirement tables are created (it_task_requirements /
  // legal_finance_task_requirements are CREATEd above), so on a fresh database those
  // tables would otherwise be created without the timer columns. Re-run the ALTER here,
  // after creation, so the columns are guaranteed to exist on every requirement table.
  for (const tbl of [
    'it_task_requirements',
    'consultant_task_requirements',
    'creative_team_task_requirements',
    'social_media_task_requirements',
    'legal_finance_task_requirements',
    'director_task_requirements',
  ]) {
    try {
      const { rows } = await p.query(
        "SELECT EXISTS (SELECT FROM information_schema.tables WHERE table_schema = 'public' AND table_name = $1) AS ex",
        [tbl]
      );
      if (!rows[0]?.ex) continue;
      await p.query(
        `ALTER TABLE ${tbl}
         ADD COLUMN IF NOT EXISTS time_spent_seconds INT DEFAULT 0,
         ADD COLUMN IF NOT EXISTS timer_started_at TIMESTAMPTZ;`
      );
    } catch (err) {
      console.warn(`dbEnsureTables: ${tbl} timer columns (final pass):`, err.message);
    }
  }

  // Member dashboard: per-session time logs (so worked time can be summed per day,
  // across weeks/months) and self-service leave days.
  try {
    await p.query(`
      CREATE TABLE IF NOT EXISTS requirement_time_logs (
        id SERIAL PRIMARY KEY,
        user_id INT,
        requirement_id INT NOT NULL,
        task_id INT,
        team TEXT,
        seconds INT NOT NULL DEFAULT 0,
        work_date DATE NOT NULL,
        started_at TIMESTAMPTZ,
        ended_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
        created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
      );
    `);
    await p.query('CREATE INDEX IF NOT EXISTS idx_rtl_user_date ON requirement_time_logs(user_id, work_date);');
    await p.query('CREATE INDEX IF NOT EXISTS idx_rtl_req ON requirement_time_logs(requirement_id);');
    console.log('DB: requirement_time_logs table ensured.');
  } catch (err) {
    console.warn('dbEnsureTables: requirement_time_logs:', err.message);
  }

  try {
    await p.query(`
      CREATE TABLE IF NOT EXISTS member_leaves (
        id SERIAL PRIMARY KEY,
        user_id INT NOT NULL,
        leave_date DATE NOT NULL,
        created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
        UNIQUE (user_id, leave_date)
      );
    `);
    await p.query('CREATE INDEX IF NOT EXISTS idx_member_leaves_user ON member_leaves(user_id, leave_date);');
    console.log('DB: member_leaves table ensured.');
  } catch (err) {
    console.warn('dbEnsureTables: member_leaves:', err.message);
  }
}

/** Ensure Legal & Finance department, permissions, role, and role_permissions exist (RBAC tables required). */
export async function dbEnsureLegalFinanceRbac() {
  const p = getPool();
  if (!p) return;
  try {
    await p.query('SELECT 1 FROM departments LIMIT 1');
  } catch {
    return;
  }
  try {
    await p.query(`
      INSERT INTO departments (name, code, description)
      SELECT 'Legal & Finance', 'legal_finance', 'Legal and finance workspace'
      WHERE NOT EXISTS (SELECT 1 FROM departments WHERE code = 'legal_finance')
    `);
    await p.query(`
      INSERT INTO permissions (code, name, module, description)
      SELECT 'legal_finance.view', 'View Legal & Finance', 'legal_finance', 'Access Legal & Finance module'
      WHERE NOT EXISTS (SELECT 1 FROM permissions WHERE code = 'legal_finance.view')
    `);
    await p.query(`
      INSERT INTO permissions (code, name, module, description)
      SELECT 'legal_finance.manage', 'Manage Legal & Finance', 'legal_finance', 'Create and edit Legal & Finance tasks'
      WHERE NOT EXISTS (SELECT 1 FROM permissions WHERE code = 'legal_finance.manage')
    `);
    await p.query(`
      INSERT INTO roles (name, code, department_id, description)
      SELECT 'Legal & Finance', 'legal_finance', d.department_id, 'Legal & Finance team member'
      FROM departments d
      WHERE d.code = 'legal_finance'
        AND NOT EXISTS (SELECT 1 FROM roles WHERE code = 'legal_finance')
    `);
    await p.query(`
      INSERT INTO role_permissions (role_id, permission_id)
      SELECT r.role_id, p.permission_id
      FROM roles r
      CROSS JOIN permissions p
      WHERE r.code = 'legal_finance'
        AND p.code IN ('legal_finance.view', 'legal_finance.manage')
        AND NOT EXISTS (
          SELECT 1 FROM role_permissions rp
          WHERE rp.role_id = r.role_id AND rp.permission_id = p.permission_id
        )
    `);
    console.log('DB: Legal & Finance RBAC (role + permissions) ensured.');
  } catch (err) {
    console.warn('dbEnsureLegalFinanceRbac:', err.message);
  }
}

/**
 * Rename the "Digital Marketing" RBAC rows to "Creative Team" (idempotent), and ensure
 * the Creative Team + Social Media departments/permissions/roles exist. UPDATEs preserve
 * role_permissions and user_roles links because those reference rows by id, not code.
 */
export async function dbEnsureCreativeAndSocialRbac() {
  const p = getPool();
  if (!p) return;
  try {
    await p.query('SELECT 1 FROM departments LIMIT 1');
  } catch {
    return;
  }

  // Run each statement independently so one failure never blocks the rest — in
  // particular, a hiccup while renaming Digital Marketing must not prevent the
  // Social Media role from being created.
  const run = async (label, sql, params = []) => {
    try {
      await p.query(sql, params);
    } catch (err) {
      console.warn(`dbEnsureCreativeAndSocialRbac [${label}]:`, err.message);
    }
  };

  // 1) Rename Digital Marketing → Creative Team in place (no-op once renamed).
  await run('rename dept', "UPDATE departments SET name = 'Creative Team', code = 'creative_team' WHERE code = 'digital_marketing'");
  await run('rename role', "UPDATE roles SET name = 'Creative Team', code = 'creative_team' WHERE code = 'digital_marketing'");
  await run('rename perm view', "UPDATE permissions SET code = 'creative_team.view', name = 'View Creative Team', module = 'creative_team' WHERE code = 'digital_marketing.view'");
  await run('rename perm manage', "UPDATE permissions SET code = 'creative_team.manage', name = 'Manage Creative Team', module = 'creative_team' WHERE code = 'digital_marketing.manage'");

  // Display-name update: "Social Media" → "Social Media Management" (code unchanged).
  await run('social dept name', "UPDATE departments SET name = 'Social Media Management' WHERE code = 'social_media'");
  await run('social role name', "UPDATE roles SET name = 'Social Media Management' WHERE code = 'social_media'");
  await run('social perm view name', "UPDATE permissions SET name = 'View Social Media Management' WHERE code = 'social_media.view'");
  await run('social perm manage name', "UPDATE permissions SET name = 'Manage Social Media Management' WHERE code = 'social_media.manage'");

  // 2) Ensure each team's department / permissions / role / links exist.
  const teams = [
    { code: 'creative_team', label: 'Creative Team' },
    { code: 'social_media', label: 'Social Media Management' },
  ];
  for (const t of teams) {
    await run(`${t.code} dept`,
      `INSERT INTO departments (name, code, description)
       SELECT $1::text, $2::text, $3::text
       WHERE NOT EXISTS (SELECT 1 FROM departments WHERE code = $2::text)`,
      [t.label, t.code, `${t.label} workspace`]
    );
    await run(`${t.code} perm view`,
      `INSERT INTO permissions (code, name, module, description)
       SELECT $1::text, $2::text, $3::text, $4::text
       WHERE NOT EXISTS (SELECT 1 FROM permissions WHERE code = $1::text)`,
      [`${t.code}.view`, `View ${t.label}`, t.code, `Access ${t.label} module`]
    );
    await run(`${t.code} perm manage`,
      `INSERT INTO permissions (code, name, module, description)
       SELECT $1::text, $2::text, $3::text, $4::text
       WHERE NOT EXISTS (SELECT 1 FROM permissions WHERE code = $1::text)`,
      [`${t.code}.manage`, `Manage ${t.label}`, t.code, `Create and edit ${t.label} tasks`]
    );
    await run(`${t.code} role`,
      `INSERT INTO roles (name, code, department_id, description)
       SELECT $1::text, $2::text, d.department_id, $3::text
       FROM departments d
       WHERE d.code = $2::text
         AND NOT EXISTS (SELECT 1 FROM roles WHERE code = $2::text)`,
      [t.label, t.code, `${t.label} team member`]
    );
    await run(`${t.code} role_permissions`,
      `INSERT INTO role_permissions (role_id, permission_id)
       SELECT r.role_id, pm.permission_id
       FROM roles r
       CROSS JOIN permissions pm
       WHERE r.code = $1::text
         AND pm.code IN ($2::text, $3::text)
         AND NOT EXISTS (
           SELECT 1 FROM role_permissions rp
           WHERE rp.role_id = r.role_id AND rp.permission_id = pm.permission_id
         )`,
      [t.code, `${t.code}.view`, `${t.code}.manage`]
    );
  }
  console.log('DB: Creative Team + Social Media RBAC ensured.');
}

/**
 * Ensure the Director department, permissions, role, and role_permissions exist.
 * Directors assign tasks to one another from the Management tab; director.manage
 * gates task creation, director.view gates read access.
 */
export async function dbEnsureDirectorRbac() {
  const p = getPool();
  if (!p) return;
  try {
    await p.query('SELECT 1 FROM departments LIMIT 1');
  } catch {
    return;
  }
  try {
    await p.query(`
      INSERT INTO departments (name, code, description)
      SELECT 'Director', 'director', 'Director-level workspace'
      WHERE NOT EXISTS (SELECT 1 FROM departments WHERE code = 'director')
    `);
    await p.query(`
      INSERT INTO permissions (code, name, module, description)
      SELECT 'director.view', 'View Director Tasks', 'director', 'View director-to-director tasks'
      WHERE NOT EXISTS (SELECT 1 FROM permissions WHERE code = 'director.view')
    `);
    await p.query(`
      INSERT INTO permissions (code, name, module, description)
      SELECT 'director.manage', 'Manage Director Tasks', 'director', 'Create and assign director-to-director tasks'
      WHERE NOT EXISTS (SELECT 1 FROM permissions WHERE code = 'director.manage')
    `);
    await p.query(`
      INSERT INTO roles (name, code, department_id, description)
      SELECT 'Director', 'director', d.department_id, 'Director'
      FROM departments d
      WHERE d.code = 'director'
        AND NOT EXISTS (SELECT 1 FROM roles WHERE code = 'director')
    `);
    await p.query(`
      INSERT INTO role_permissions (role_id, permission_id)
      SELECT r.role_id, p.permission_id
      FROM roles r
      CROSS JOIN permissions p
      WHERE r.code = 'director'
        AND p.code IN ('director.view', 'director.manage')
        AND NOT EXISTS (
          SELECT 1 FROM role_permissions rp
          WHERE rp.role_id = r.role_id AND rp.permission_id = p.permission_id
        )
    `);
    console.log('DB: Director RBAC (role + permissions) ensured.');
  } catch (err) {
    console.warn('dbEnsureDirectorRbac:', err.message);
  }
}

/** Get users that hold a given role code (e.g. 'director'). */
export async function dbGetUsersByRoleCode(code) {
  const p = getPool();
  if (!p) return [];
  try {
    const { rows } = await p.query(
      `SELECT DISTINCT u.user_id, u.username, u.email, u.profile_image
       FROM users u
       INNER JOIN user_roles ur ON ur.user_id = u.user_id
       INNER JOIN roles r ON r.role_id = ur.role_id
       WHERE r.code = $1
       ORDER BY u.username`,
      [code]
    );
    return rows.map((r) => ({
      ...r,
      profile_image: avatarUrlFor(r.user_id, r.profile_image),
    }));
  } catch (err) {
    console.error('dbGetUsersByRoleCode:', err.message);
    return [];
  }
}

/** Test DB connection on startup. Returns { ok: true } or { ok: false, error: string }. */
export async function testConnection() {
  const p = getPool();
  if (!p) {
    const user = process.env.DB_USER;
    const database = process.env.DB_DATABASE;
    if (!user || !database) {
      dbAvailability = false;
      return { ok: false, error: 'Missing DB_USER or DB_DATABASE in .env' };
    }
    dbAvailability = false;
    return { ok: false, error: 'Could not create pool (check .env)' };
  }
  try {
    const client = await p.connect();
    await client.query('SELECT 1');
    client.release();
    // Also ensure requirements table + Legal & Finance RBAC role for admin Assign roles UI
    await dbEnsureTables();
    await dbEnsureLegalFinanceRbac();
    await dbEnsureCreativeAndSocialRbac();
    await dbEnsureDirectorRbac();
    dbAvailability = true;
    return { ok: true };
  } catch (err) {
    dbAvailability = false;
    return { ok: false, error: err.message };
  }
}

// Map DB rows to API shape
export async function dbGetProjects(status = null, projectType = null) {
  const p = getPool();
  if (!p) return [];
  try {
    const conds = [];
    const params = [];
    if (status) {
      params.push(status);
      conds.push(`status = $${params.length}`);
    }
    if (projectType) {
      params.push(projectType);
      conds.push(`project_type = $${params.length}`);
    }
    const where = conds.length ? ` WHERE ${conds.join(' AND ')}` : '';
    const query = `SELECT * FROM it_projects${where} ORDER BY project_id`;
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
        project_url: r.project_url || '',
        logo: projectLogoUrlFor(r.project_id, r.logo),
        description: r.description,
        status: r.status,
        priority: r.priority,
        start_date: r.start_date,
        end_date: r.end_date,
        owner: r.owner_name || 'IT Team',
        owner_name: r.owner_name || 'IT Team',
        owner_user_id: r.owner_user_id ?? null,
        teammates: teammatesFromText(r.teammates),
        teammates_text: r.teammates || '',
        project_type: r.project_type || 'internal',
        client_name: r.client_name || '',
        requirements: projectReqsFromText(r.requirements),
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
    `INSERT INTO it_projects (
      project_name, project_code, project_url, logo, description, status, priority, start_date, end_date, owner_user_id, owner_name, teammates, project_type, client_name, requirements
    )
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
     RETURNING *`,
    [
      data.name ?? data.project_name ?? 'Untitled Project',
      data.project_code ?? null,
      data.project_url ?? null,
      data.logo ?? null,
      data.description ?? null,
      data.status ?? 'active',
      data.priority ?? 'medium',
      toNullableDate(data.start_date),
      toNullableDate(data.end_date),
      toNullableInt(data.owner_user_id),
      data.owner_name ?? data.owner ?? null,
      teammatesToText(data.teammates ?? data.teammates_text),
      data.project_type === 'external' ? 'external' : 'internal',
      data.client_name ?? null,
      projectReqsToText(data.requirements),
    ]
  );
  if (!row) return null;
  return {
    id: String(row.project_id),
    name: row.project_name,
    project_code: row.project_code,
    project_url: row.project_url || '',
    logo: projectLogoUrlFor(row.project_id, row.logo),
    description: row.description,
    status: row.status,
    priority: row.priority,
    start_date: row.start_date,
    end_date: row.end_date,
    owner: row.owner_name || 'IT Team',
    owner_name: row.owner_name || 'IT Team',
    owner_user_id: row.owner_user_id ?? null,
    teammates: teammatesFromText(row.teammates),
    teammates_text: row.teammates || '',
    project_type: row.project_type || 'internal',
    client_name: row.client_name || '',
    requirements: projectReqsFromText(row.requirements),
    progress: 0,
  };
}

export async function dbUpdateProject(projectId, data) {
  const p = getPool();
  if (!p) return null;
  const allowed = [
    'project_name',
    'project_code',
    'project_url',
    'logo',
    'description',
    'status',
    'priority',
    'start_date',
    'end_date',
    'owner_user_id',
    'owner_name',
    'teammates',
    'project_type',
    'client_name',
    'requirements',
  ];
  const updates = [];
  const values = [];
  let i = 1;
  for (const [k, v] of Object.entries(data)) {
    let col = k === 'name' ? 'project_name' : k;
    if (col === 'owner') col = 'owner_name';
    if (col === 'teammates_text') col = 'teammates';
    // Never overwrite the stored logo with its own serving URL (a client that
    // round-trips the value we handed it). Only real images (data: URLs) or an
    // explicit clear (null) should change the column.
    if (col === 'logo' && typeof v === 'string' && v.includes('/api/it-updates/projects/')) {
      continue;
    }
    if (allowed.includes(col) && v !== undefined) {
      updates.push(`${col} = $${i}`);
      const val =
        col === 'start_date' || col === 'end_date' || col === 'due_date' || col === 'task_date'
          ? toNullableDate(v)
          : col === 'owner_user_id'
            ? toNullableInt(v)
            : col === 'teammates'
              ? teammatesToText(v)
              : col === 'requirements'
                ? projectReqsToText(v)
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
    project_url: row.project_url || '',
    logo: projectLogoUrlFor(row.project_id, row.logo),
    description: row.description,
    status: row.status,
    priority: row.priority,
    start_date: row.start_date,
    end_date: row.end_date,
    owner: row.owner_name || 'IT Team',
    owner_name: row.owner_name || 'IT Team',
    owner_user_id: row.owner_user_id ?? null,
    teammates: teammatesFromText(row.teammates),
    teammates_text: row.teammates || '',
    project_type: row.project_type || 'internal',
    client_name: row.client_name || '',
    requirements: projectReqsFromText(row.requirements),
    progress: 0,
  };
}

/** Raw stored logo (base64 data URL or plain URL) for the logo-serving endpoint. */
export async function dbGetProjectLogoRaw(projectId) {
  const p = getPool();
  if (!p) return null;
  try {
    const { rows } = await p.query('SELECT logo FROM it_projects WHERE project_id = $1', [projectId]);
    return rows[0]?.logo ?? null;
  } catch (err) {
    console.error('dbGetProjectLogoRaw:', err.message);
    return null;
  }
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
    project_url: row.project_url || '',
    logo: projectLogoUrlFor(row.project_id, row.logo),
    description: row.description,
    status: row.status,
    priority: row.priority,
    start_date: row.start_date,
    end_date: row.end_date,
    owner: row.owner_name || 'IT Team',
    owner_name: row.owner_name || 'IT Team',
    owner_user_id: row.owner_user_id ?? null,
    teammates: teammatesFromText(row.teammates),
    teammates_text: row.teammates || '',
    project_type: row.project_type || 'internal',
    client_name: row.client_name || '',
    requirements: projectReqsFromText(row.requirements),
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

/* ─── Project documents (project_documentation / brd / credentials) ─── */

// The three document slots every project can carry.
export const PROJECT_DOC_TYPES = ['project_documentation', 'brd', 'credentials'];

// List a project's documents as lightweight metadata (no base64 payload) so the
// board/detail loads fast. Use dbGetProjectDocument to fetch the actual file.
export async function dbListProjectDocuments(projectId) {
  const p = getPool();
  if (!p) return [];
  const id = toNullableInt(projectId);
  if (id == null) return [];
  try {
    const { rows } = await p.query(
      `SELECT doc_id, project_id, doc_type, file_name, mime_type,
              uploaded_by, uploaded_by_name, uploaded_at,
              (file_data IS NOT NULL) AS has_file
       FROM project_documents WHERE project_id = $1`,
      [id]
    );
    return rows;
  } catch (err) {
    console.error('dbListProjectDocuments:', err.message);
    return [];
  }
}

// Fetch a single document including its base64 file_data (for view/download).
export async function dbGetProjectDocument(projectId, docType) {
  const p = getPool();
  if (!p) return null;
  const id = toNullableInt(projectId);
  if (id == null || !PROJECT_DOC_TYPES.includes(docType)) return null;
  try {
    const { rows } = await p.query(
      `SELECT doc_id, project_id, doc_type, file_name, mime_type, file_data,
              uploaded_by, uploaded_by_name, uploaded_at
       FROM project_documents WHERE project_id = $1 AND doc_type = $2`,
      [id, docType]
    );
    return rows[0] || null;
  } catch (err) {
    console.error('dbGetProjectDocument:', err.message);
    return null;
  }
}

// Insert or replace a document slot. Returns the stored metadata (no file_data).
export async function dbUpsertProjectDocument(projectId, docType, doc = {}) {
  const p = getPool();
  if (!p) return null;
  const id = toNullableInt(projectId);
  if (id == null || !PROJECT_DOC_TYPES.includes(docType)) return null;
  try {
    const { rows } = await p.query(
      `INSERT INTO project_documents
         (project_id, doc_type, file_name, mime_type, file_data, uploaded_by, uploaded_by_name, uploaded_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, CURRENT_TIMESTAMP)
       ON CONFLICT (project_id, doc_type) DO UPDATE SET
         file_name = EXCLUDED.file_name,
         mime_type = EXCLUDED.mime_type,
         file_data = EXCLUDED.file_data,
         uploaded_by = EXCLUDED.uploaded_by,
         uploaded_by_name = EXCLUDED.uploaded_by_name,
         uploaded_at = CURRENT_TIMESTAMP
       RETURNING doc_id, project_id, doc_type, file_name, mime_type,
                 uploaded_by, uploaded_by_name, uploaded_at,
                 (file_data IS NOT NULL) AS has_file`,
      [
        id,
        docType,
        doc.file_name ?? null,
        doc.mime_type ?? null,
        doc.file_data ?? null,
        toNullableInt(doc.uploaded_by),
        doc.uploaded_by_name ?? null,
      ]
    );
    return rows[0] || null;
  } catch (err) {
    console.error('dbUpsertProjectDocument:', err.message);
    return null;
  }
}

export async function dbDeleteProjectDocument(projectId, docType) {
  const p = getPool();
  if (!p) return false;
  const id = toNullableInt(projectId);
  if (id == null || !PROJECT_DOC_TYPES.includes(docType)) return false;
  try {
    const { rowCount } = await p.query(
      'DELETE FROM project_documents WHERE project_id = $1 AND doc_type = $2',
      [id, docType]
    );
    return rowCount > 0;
  } catch (err) {
    console.error('dbDeleteProjectDocument:', err.message);
    return false;
  }
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
    const normalizedTeam = resolveTeamFromInput(filters.team);
    const taskTable = taskTableForTeam(normalizedTeam);
    const reqTable = reqTableForTeam(normalizedTeam);

    const { rows: tableCheck } = await p.query(
      "SELECT EXISTS (SELECT FROM information_schema.tables WHERE table_schema = 'public' AND table_name = $1)",
      [reqTable]
    );
    const hasReqs = tableCheck[0]?.exists;

    // Only join the projects table when this task table actually has a project_id column.
    const { rows: projColCheck } = await p.query(
      "SELECT EXISTS (SELECT FROM information_schema.columns WHERE table_schema = 'public' AND table_name = $1 AND column_name = 'project_id') AS exists",
      [taskTable]
    );
    const hasProject = projColCheck[0]?.exists;

    let query = `
      SELECT t.*,
             u_assigned.username AS assignee_username,
             u_assigned.profile_image AS assignee_profile_image,
             u_assigned.branch AS assignee_branch,
             u_by.username AS assigned_by_username,
             u_by.profile_image AS assigned_by_profile_image,
             u_review.username AS reviewer_username${hasProject ? ',\n             pr.project_name AS project_name,\n             pr.logo AS project_logo' : ''}
      FROM ${taskTable} t
      LEFT JOIN users u_assigned ON t.assigned_to = u_assigned.user_id
      LEFT JOIN users u_by ON t.assigned_by = u_by.user_id
      LEFT JOIN users u_review ON t.reviewed_by = u_review.user_id${hasProject ? '\n      LEFT JOIN it_projects pr ON pr.project_id = t.project_id' : ''}
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
    // Branch filter: by the assignee's branch.
    if (filters.branch) {
      whereParts.push(`u_assigned.branch = $${i++}`);
      params.push(filters.branch);
    }

    // Overdue filter: due_date in past and not completed
    // Accept truthy values: overdue=true, overdue=1, overdue_only=true
    const overdueFlag =
      filters.overdue === true ||
      String(filters.overdue).toLowerCase() === 'true' ||
      String(filters.overdue).toLowerCase() === '1' ||
      String(filters.overdue_only).toLowerCase() === 'true';
    if (overdueFlag) {
      whereParts.push(`t.due_date IS NOT NULL`);
      whereParts.push(`t.due_date < CURRENT_DATE`);
      whereParts.push(`t.status <> 'completed'`);
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
         FROM ${reqTable}
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
      assignee_branch: r.assignee_branch ?? null,
      assigned_by: r.assigned_by,
      assigned_by_name: r.assigned_by_username,
      assignee_profile_image: avatarUrlFor(r.assigned_to, r.assignee_profile_image),
      assigned_by_profile_image: avatarUrlFor(r.assigned_by, r.assigned_by_profile_image),
      projectId: r.project_id ? String(r.project_id) : null,
      project_id: r.project_id,
      project_name: r.project_name ?? null,
      project_logo: projectLogoUrlFor(r.project_id, r.project_logo),
      dueDate: r.due_date,
      task_date: r.task_date,
      created_at: r.created_at,
      completed_at: r.completed_at,
      req_total: reqStats[r.task_id]?.total || 0,
      req_completed: reqStats[r.task_id]?.completed || 0,
      reviewed_by: r.reviewed_by ?? null,
      reviewed_by_username: r.reviewer_username ?? null,
      review_comment: r.review_comment ?? null,
      reviewed_at: r.reviewed_at ?? null,
      campaign_name: r.campaign_name ?? null,
      content_type: r.content_type ?? null,
      channel: r.channel ?? null,
      design_link: r.design_link ?? null,
      content_doc_link: r.content_doc_link ?? null,
      publish_link: r.publish_link ?? null,
      target_date: r.target_date ?? null,
      publish_date: r.publish_date ?? null,
      is_crm: Boolean(r.is_crm),
      lead_details: (() => {
        if (!r.lead_details) return null;
        try {
          return typeof r.lead_details === 'string' ? JSON.parse(r.lead_details) : r.lead_details;
        } catch {
          return null;
        }
      })(),
      team: normalizedTeam,
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

/** Admin dashboard: pending/review + overdue (deadline missed) summary. */
export async function dbGetAdminPendingSummary() {
  const p = getPool();
  if (!p) {
    return {
      pending_count: 0,
      review_count: 0,
      overdue_count: 0,
      overdue_tasks: [],
    };
  }
  try {
    const [{ rows: pendingRows }, { rows: overdueRows }] = await Promise.all([
      p.query(
        `SELECT
           COUNT(*) FILTER (WHERE status IN ('todo','in_progress','review','rework'))::int AS pending_count,
           COUNT(*) FILTER (WHERE status = 'review')::int AS review_count
         FROM it_tasks`
      ),
      p.query(
        `SELECT
           t.task_id,
           t.task_title,
           t.status,
           t.priority,
           t.due_date,
           u.username AS assignee_username
         FROM it_tasks t
         LEFT JOIN users u ON t.assigned_to = u.user_id
         WHERE t.due_date IS NOT NULL
           AND t.due_date < CURRENT_DATE
           AND t.status <> 'completed'
         ORDER BY t.due_date ASC
         LIMIT 100`
      ),
    ]);

    const pending = pendingRows?.[0] || {};
    const overdueTasks = (overdueRows || []).map((r) => ({
      task_id: r.task_id,
      task_title: r.task_title,
      status: r.status,
      priority: r.priority,
      due_date: r.due_date,
      assignee: r.assignee_username || 'Unassigned',
    }));

    return {
      pending_count: Number(pending.pending_count || 0),
      review_count: Number(pending.review_count || 0),
      overdue_count: overdueTasks.length,
      overdue_tasks: overdueTasks,
    };
  } catch (err) {
    console.error('dbGetAdminPendingSummary:', err.message);
    return {
      pending_count: 0,
      review_count: 0,
      overdue_count: 0,
      overdue_tasks: [],
    };
  }
}

function resolveTeamFromInput(team) {
  const t = String(team || '').trim().toLowerCase();
  if (t === 'consultant') return 'consultant';
  // 'digital_marketing'/'digital' are legacy aliases for the renamed Creative Team.
  if (t === 'creative_team' || t === 'creative' || t === 'digital_marketing' || t === 'digital') return 'creative_team';
  if (t === 'social_media' || t === 'social') return 'social_media';
  if (t === 'legal_finance' || t === 'legal-finance' || t === 'legalfinance') return 'legal_finance';
  if (t === 'director' || t === 'directors') return 'director';
  return 'it';
}

function taskTableForTeam(team) {
  if (team === 'consultant') return 'consultant_tasks';
  if (team === 'creative_team') return 'creative_team_tasks';
  if (team === 'social_media') return 'social_media_tasks';
  if (team === 'legal_finance') return 'legal_finance_tasks';
  if (team === 'director') return 'director_tasks';
  return 'it_tasks';
}

function reqTableForTeam(team) {
  if (team === 'consultant') return 'consultant_task_requirements';
  if (team === 'creative_team') return 'creative_team_task_requirements';
  if (team === 'social_media') return 'social_media_task_requirements';
  if (team === 'legal_finance') return 'legal_finance_task_requirements';
  if (team === 'director') return 'director_task_requirements';
  return 'it_task_requirements';
}

async function detectTaskTeamById(taskId) {
  const p = getPool();
  if (!p) return 'it';
  const id = parseInt(String(taskId), 10);
  if (!Number.isFinite(id)) return 'it';
  const checks = [
    { team: 'consultant', table: 'consultant_tasks' },
    { team: 'creative_team', table: 'creative_team_tasks' },
    { team: 'social_media', table: 'social_media_tasks' },
    { team: 'legal_finance', table: 'legal_finance_tasks' },
    { team: 'director', table: 'director_tasks' },
    { team: 'it', table: 'it_tasks' },
  ];
  for (const c of checks) {
    try {
      const { rows } = await p.query(
        "SELECT EXISTS (SELECT FROM information_schema.tables WHERE table_schema = 'public' AND table_name = $1) AS ex",
        [c.table]
      );
      if (!rows[0]?.ex) continue;
      const { rowCount } = await p.query(`SELECT 1 FROM ${c.table} WHERE task_id = $1 LIMIT 1`, [id]);
      if (rowCount > 0) return c.team;
    } catch {
      // ignore table-specific detection failures
    }
  }
  return 'it';
}

export async function dbCreateTask(data) {
  const p = getPool();
  if (!p) return null;
  const team = resolveTeamFromInput(data?.team);
  const taskTable = taskTableForTeam(team);
  // Helper: convert empty strings to null for integer columns
  const toNullableInt = (v) => (v === '' || v === undefined || v === null ? null : v);
  const insertColumns = [
    'project_id',
    'assigned_to',
    'assigned_by',
    'created_by',
    'task_title',
    'task_description',
    'priority',
    'status',
    'task_date',
    'due_date',
  ];
  const insertValues = [
    toNullableInt(data.projectId ?? data.project_id),
    toNullableInt(data.assigned_to),
    toNullableInt(data.assigned_by),
    toNullableInt(data.created_by ?? data.assigned_by),
    data.title ?? data.task_title ?? 'New Task',
    data.task_description ?? data.description ?? null,
    data.priority ?? 'medium',
    data.status ?? 'in_progress',
    toNullableDate(data.task_date ?? data.taskDate) ?? new Date().toISOString().slice(0, 10),
    toNullableDate(data.dueDate ?? data.due_date),
  ];
  if (team === 'creative_team' || team === 'social_media') {
    insertColumns.push(
      'campaign_name',
      'content_type',
      'channel',
      'design_link',
      'content_doc_link',
      'publish_link',
      'target_date',
      'publish_date'
    );
    insertValues.push(
      data.campaign_name ?? null,
      data.content_type ?? null,
      data.channel ?? null,
      data.design_link ?? null,
      data.content_doc_link ?? null,
      data.publish_link ?? null,
      toNullableDate(data.target_date),
      toNullableDate(data.publish_date)
    );
  }
  // it_tasks carries the CRM flag (Client CRM cards vs ordinary tasks) and,
  // for leads, a JSON blob of the lead-specific fields.
  if (team === 'it') {
    insertColumns.push('is_crm', 'lead_details');
    insertValues.push(
      Boolean(data.is_crm),
      data.lead_details != null ? JSON.stringify(data.lead_details) : null
    );
  }
  const placeholders = insertValues.map((_, idx) => `$${idx + 1}`).join(', ');
  const {
    rows: [row],
  } = await p.query(
    `INSERT INTO ${taskTable} (${insertColumns.join(', ')})
     VALUES (${placeholders})
     RETURNING *`,
    insertValues
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
    team,
  };
}

export async function dbUpdateTask(taskId, data) {
  const p = getPool();
  if (!p) return null;
  const team = resolveTeamFromInput(data?.team || await detectTaskTeamById(taskId));
  const taskTable = taskTableForTeam(team);
  const allowed = [
    'task_title',
    'task_description',
    'priority',
    'status',
    'due_date',
    'task_date',
    'assigned_to',
    'assigned_by',
    'project_id',
    'reviewed_by',
    'review_comment',
    'reviewed_at',
  ];
  if (team === 'creative_team' || team === 'social_media') {
    allowed.push(
      'campaign_name',
      'content_type',
      'channel',
      'design_link',
      'content_doc_link',
      'publish_link',
      'target_date',
      'publish_date'
    );
  }
  if (team === 'it') {
    allowed.push('lead_details');
  }
  const updates = [];
  const values = [];
  let i = 1;
  const map = {
    title: 'task_title',
    description: 'task_description',
    dueDate: 'due_date',
    projectId: 'project_id',
    reviewComment: 'review_comment',
    reviewedBy: 'reviewed_by',
    reviewedAt: 'reviewed_at',
    targetDate: 'target_date',
    publishDate: 'publish_date',
  };
  for (const [k, v] of Object.entries(data)) {
    const col = map[k] || k;
    if (allowed.includes(col) && v !== undefined) {
      updates.push(`${col} = $${i}`);
      let val;
      if (col === 'start_date' || col === 'end_date' || col === 'due_date' || col === 'task_date' || col === 'target_date' || col === 'publish_date') {
        val = toNullableDate(v);
      } else if (col === 'reviewed_at') {
        val = v === '' || v == null ? null : v;
      } else if (col === 'assigned_to' || col === 'assigned_by' || col === 'project_id' || col === 'reviewed_by') {
        val = v === '' ? null : v;
      } else if (col === 'review_comment') {
        val = v === '' || v == null ? null : String(v);
      } else if (col === 'lead_details') {
        val = v == null ? null : typeof v === 'string' ? v : JSON.stringify(v);
      } else {
        val = v;
      }
      values.push(val);
      i++;
    }
  }
  if (updates.length === 0) return dbGetTaskById(taskId, team);
  updates.push('updated_at = CURRENT_TIMESTAMP');
  if (data.status === 'completed') {
    updates.push('completed_at = CURRENT_TIMESTAMP');
  } else if (data.status !== undefined && data.status !== 'completed') {
    updates.push('completed_at = NULL');
  }
  values.push(taskId);
  const { rows } = await p.query(
    `UPDATE ${taskTable} SET ${updates.join(', ')} WHERE task_id = $${i} RETURNING *`,
    values
  );
  if (!rows[0]) return null;
  return dbGetTaskById(taskId, team);
}

export async function dbGetTaskById(taskId, teamInput = null) {
  const p = getPool();
  if (!p) return null;
  const team = resolveTeamFromInput(teamInput || await detectTaskTeamById(taskId));
  const taskTable = taskTableForTeam(team);
  const { rows } = await p.query(
    `SELECT t.*, u_rev.username AS reviewer_username
     FROM ${taskTable} t
     LEFT JOIN users u_rev ON t.reviewed_by = u_rev.user_id
     WHERE t.task_id = $1`,
    [taskId]
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
    completed_at: row.completed_at ?? null,
    reviewed_by: row.reviewed_by ?? null,
    reviewed_by_username: row.reviewer_username ?? null,
    review_comment: row.review_comment ?? null,
    reviewed_at: row.reviewed_at ?? null,
    campaign_name: row.campaign_name ?? null,
    content_type: row.content_type ?? null,
    channel: row.channel ?? null,
    design_link: row.design_link ?? null,
    content_doc_link: row.content_doc_link ?? null,
    publish_link: row.publish_link ?? null,
    target_date: row.target_date ?? null,
    publish_date: row.publish_date ?? null,
    team,
  };
}

export async function dbDeleteTask(taskId, teamInput = null) {
  const p = getPool();
  if (!p) return false;
  const team = resolveTeamFromInput(teamInput || await detectTaskTeamById(taskId));
  const taskTable = taskTableForTeam(team);
  // Remove this task's comments (namespaced by team). comment_likes cascade via their
  // FK to task_comments. Done explicitly because task_comments no longer has an FK to
  // the task tables to cascade on delete.
  try {
    await p.query(`DELETE FROM task_comments WHERE task_id = $1 AND COALESCE(team, 'it') = $2`, [taskId, team]);
  } catch (err) {
    console.warn('dbDeleteTask: comment cleanup failed:', err.message);
  }
  const { rowCount } = await p.query(`DELETE FROM ${taskTable} WHERE task_id = $1`, [
    taskId,
  ]);
  return rowCount > 0;
}

function mapCommentRow(r) {
  const likedIds = Array.isArray(r.liked_user_ids)
    ? r.liked_user_ids.filter((v) => v != null).map((v) => String(v))
    : [];
  return {
    id: String(r.comment_id),
    taskId: String(r.task_id),
    userId: r.user_id != null ? String(r.user_id) : null,
    author: r.author_username || 'User',
    authorImage: avatarUrlFor(r.user_id, r.author_profile_image),
    message: r.comment_text,
    createdAt: r.created_at,
    editedAt: r.edited_at ?? null,
    parentId: r.parent_id != null ? String(r.parent_id) : null,
    mentions: r.mentions
      ? String(r.mentions).split(',').map((s) => s.trim()).filter(Boolean)
      : [],
    likeCount: Number(r.like_count || 0),
    likedUserIds: likedIds,
  };
}

export async function dbGetTaskComments(taskId, teamInput = null) {
  const p = getPool();
  if (!p) return [];
  const team = resolveTeamFromInput(teamInput);
  const { rows } = await p.query(
    `SELECT c.*,
            u.username AS author_username,
            u.profile_image AS author_profile_image,
            (SELECT COUNT(*) FROM comment_likes l WHERE l.comment_id = c.comment_id) AS like_count,
            (SELECT COALESCE(ARRAY_AGG(l.user_id), '{}') FROM comment_likes l WHERE l.comment_id = c.comment_id) AS liked_user_ids
     FROM task_comments c
     LEFT JOIN users u ON c.user_id = u.user_id
     WHERE c.task_id = $1 AND COALESCE(c.team, 'it') = $2
     ORDER BY c.created_at`,
    [taskId, team]
  );
  return rows.map(mapCommentRow);
}

function normalizeMentions(mentions) {
  if (Array.isArray(mentions)) {
    return [...new Set(mentions.map((v) => String(v).trim()).filter(Boolean))].join(',');
  }
  if (typeof mentions === 'string') return mentions.trim() || null;
  return null;
}

export async function dbAddTaskComment(taskId, data) {
  const p = getPool();
  if (!p) return null;
  const team = resolveTeamFromInput(data?.team);
  const parentId =
    data.parent_id != null && String(data.parent_id).trim() !== ''
      ? parseInt(String(data.parent_id), 10)
      : null;
  const {
    rows: [row],
  } = await p.query(
    `INSERT INTO task_comments (task_id, user_id, comment_text, parent_id, mentions, team)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING *`,
    [
      taskId,
      data.user_id || null,
      data.message ?? data.comment_text ?? '',
      Number.isFinite(parentId) ? parentId : null,
      normalizeMentions(data.mentions),
      team,
    ]
  );
  if (!row) return null;
  let authorName = data.author || null;
  let authorImage = null;
  if (row.user_id != null) {
    try {
      const { rows: [u] } = await p.query(
        'SELECT username, profile_image FROM users WHERE user_id = $1',
        [row.user_id]
      );
      authorName = authorName || u?.username || null;
      authorImage = u?.profile_image ?? null;
    } catch {
      /* ignore */
    }
  }
  return mapCommentRow({
    ...row,
    author_username: authorName,
    author_profile_image: authorImage,
    like_count: 0,
    liked_user_ids: [],
  });
}

/** Edit a comment. Only the author may edit. Returns updated comment or null. */
export async function dbUpdateTaskComment(commentId, userId, data) {
  const p = getPool();
  if (!p) return null;
  // Capture the mentions present before the edit so the caller can notify only
  // members who were newly tagged during this edit.
  const { rows: priorRows } = await p.query(
    'SELECT mentions FROM task_comments WHERE comment_id = $1 AND user_id = $2',
    [commentId, userId]
  );
  const priorMentions = priorRows[0]?.mentions
    ? String(priorRows[0].mentions).split(',').map((s) => s.trim()).filter(Boolean)
    : [];
  const { rows } = await p.query(
    `UPDATE task_comments
     SET comment_text = $1, mentions = $2, edited_at = CURRENT_TIMESTAMP
     WHERE comment_id = $3 AND user_id = $4
     RETURNING *`,
    [data.message ?? data.comment_text ?? '', normalizeMentions(data.mentions), commentId, userId]
  );
  const row = rows[0];
  if (!row) return null;
  const { rows: [enriched] } = await p.query(
    `SELECT c.*,
            u.username AS author_username,
            u.profile_image AS author_profile_image,
            (SELECT COUNT(*) FROM comment_likes l WHERE l.comment_id = c.comment_id) AS like_count,
            (SELECT COALESCE(ARRAY_AGG(l.user_id), '{}') FROM comment_likes l WHERE l.comment_id = c.comment_id) AS liked_user_ids
     FROM task_comments c LEFT JOIN users u ON c.user_id = u.user_id
     WHERE c.comment_id = $1`,
    [row.comment_id]
  );
  const mapped = mapCommentRow(enriched);
  // Members tagged in this edit who were not tagged before (for mail notification).
  const priorSet = new Set(priorMentions);
  mapped.newlyMentioned = mapped.mentions.filter((id) => !priorSet.has(id));
  return mapped;
}

/** Delete a comment (and its replies). Author only, unless isAdmin. Returns true if deleted. */
export async function dbDeleteTaskComment(commentId, userId, isAdmin = false) {
  const p = getPool();
  if (!p) return false;
  const id = parseInt(String(commentId), 10);
  if (!Number.isFinite(id)) return false;
  // Remove replies first to satisfy any FK expectations.
  await p.query('DELETE FROM task_comments WHERE parent_id = $1', [id]);
  const { rowCount } = isAdmin
    ? await p.query('DELETE FROM task_comments WHERE comment_id = $1', [id])
    : await p.query('DELETE FROM task_comments WHERE comment_id = $1 AND user_id = $2', [id, userId]);
  return rowCount > 0;
}

/** Resolve a list of user ids to { user_id, username, email } (for mention emails). */
export async function dbGetUsersByIds(ids) {
  const p = getPool();
  if (!p) return [];
  const intIds = (Array.isArray(ids) ? ids : [])
    .map((v) => parseInt(String(v), 10))
    .filter((n) => Number.isFinite(n));
  if (intIds.length === 0) return [];
  try {
    const { rows } = await p.query(
      'SELECT user_id, username, email FROM users WHERE user_id = ANY($1::int[])',
      [intIds]
    );
    return rows;
  } catch (err) {
    console.error('dbGetUsersByIds:', err.message);
    return [];
  }
}

const DEADLINE_TEAMS = [
  { team: 'it', table: 'it_tasks' },
  { team: 'consultant', table: 'consultant_tasks' },
  { team: 'creative_team', table: 'creative_team_tasks' },
  { team: 'social_media', table: 'social_media_tasks' },
  { team: 'legal_finance', table: 'legal_finance_tasks' },
];

/**
 * Tasks that are due within `withinDays` days or already overdue and not completed.
 * Returns rows with assignee/assigner emails for alerting.
 */
export async function dbGetDueTasksForAlerts(withinDays = 1) {
  const p = getPool();
  if (!p) return [];
  const out = [];
  for (const { team, table } of DEADLINE_TEAMS) {
    try {
      const { rows: exists } = await p.query(
        "SELECT EXISTS (SELECT FROM information_schema.tables WHERE table_schema = 'public' AND table_name = $1) AS ex",
        [table]
      );
      if (!exists[0]?.ex) continue;
      const { rows } = await p.query(
        `SELECT t.task_id, t.task_title, t.due_date, t.status,
                ua.username AS assignee_name, ua.email AS assignee_email,
                ub.username AS assigner_name, ub.email AS assigner_email
         FROM ${table} t
         LEFT JOIN users ua ON ua.user_id = t.assigned_to
         LEFT JOIN users ub ON ub.user_id = t.assigned_by
         WHERE t.due_date IS NOT NULL
           AND t.status <> 'completed'
           AND t.due_date <= CURRENT_DATE + ($1::int)`,
        [withinDays]
      );
      rows.forEach((r) => {
        const due = r.due_date ? new Date(r.due_date) : null;
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const kind = due && due < today ? 'overdue' : 'due_soon';
        out.push({
          team,
          task_id: r.task_id,
          title: r.task_title,
          due_date: r.due_date,
          kind,
          recipients: [
            { name: r.assignee_name, email: r.assignee_email },
            { name: r.assigner_name, email: r.assigner_email },
          ].filter((x) => x.email),
        });
      });
    } catch (err) {
      console.warn(`dbGetDueTasksForAlerts(${table}):`, err.message);
    }
  }
  return out;
}

/** True if this exact deadline alert was already recorded. */
export async function dbWasDeadlineNotified(taskId, team, kind) {
  const p = getPool();
  if (!p) return true; // fail safe: do not spam if we cannot check
  try {
    const { rowCount } = await p.query(
      'SELECT 1 FROM task_deadline_notifications WHERE task_id = $1 AND team = $2 AND kind = $3',
      [taskId, team, kind]
    );
    return rowCount > 0;
  } catch (err) {
    console.warn('dbWasDeadlineNotified:', err.message);
    return true;
  }
}

/** Record that a deadline alert was sent. */
export async function dbMarkDeadlineNotified(taskId, team, kind) {
  const p = getPool();
  if (!p) return;
  try {
    await p.query(
      `INSERT INTO task_deadline_notifications (task_id, team, kind)
       VALUES ($1, $2, $3) ON CONFLICT DO NOTHING`,
      [taskId, team, kind]
    );
  } catch (err) {
    console.warn('dbMarkDeadlineNotified:', err.message);
  }
}

/** Toggle a like for a comment by a user. Returns { liked, likeCount }. */
export async function dbToggleCommentLike(commentId, userId) {
  const p = getPool();
  if (!p) return null;
  const cId = parseInt(String(commentId), 10);
  const uId = parseInt(String(userId), 10);
  if (!Number.isFinite(cId) || !Number.isFinite(uId)) return null;
  const { rowCount } = await p.query(
    'DELETE FROM comment_likes WHERE comment_id = $1 AND user_id = $2',
    [cId, uId]
  );
  let liked = false;
  if (rowCount === 0) {
    await p.query(
      'INSERT INTO comment_likes (comment_id, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
      [cId, uId]
    );
    liked = true;
  }
  const { rows } = await p.query(
    'SELECT COUNT(*)::int AS n FROM comment_likes WHERE comment_id = $1',
    [cId]
  );
  return { liked, likeCount: Number(rows[0]?.n || 0) };
}

// ── EOD report comments (same shape as task comments; report_id aliased to task_id
//    so the shared mapCommentRow / frontend component work unchanged) ──
export async function dbGetEodReportComments(reportId) {
  const p = getPool();
  if (!p) return [];
  const { rows } = await p.query(
    `SELECT c.*, c.report_id AS task_id,
            u.username AS author_username,
            u.profile_image AS author_profile_image,
            (SELECT COUNT(*) FROM eod_comment_likes l WHERE l.comment_id = c.comment_id) AS like_count,
            (SELECT COALESCE(ARRAY_AGG(l.user_id), '{}') FROM eod_comment_likes l WHERE l.comment_id = c.comment_id) AS liked_user_ids
     FROM eod_report_comments c
     LEFT JOIN users u ON c.user_id = u.user_id
     WHERE c.report_id = $1
     ORDER BY c.created_at`,
    [reportId]
  );
  return rows.map(mapCommentRow);
}

export async function dbAddEodReportComment(reportId, data) {
  const p = getPool();
  if (!p) return null;
  const parentId =
    data.parent_id != null && String(data.parent_id).trim() !== ''
      ? parseInt(String(data.parent_id), 10)
      : null;
  const { rows: [row] } = await p.query(
    `INSERT INTO eod_report_comments (report_id, user_id, comment_text, parent_id, mentions)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING *`,
    [
      reportId,
      data.user_id || null,
      data.message ?? data.comment_text ?? '',
      Number.isFinite(parentId) ? parentId : null,
      normalizeMentions(data.mentions),
    ]
  );
  if (!row) return null;
  let authorName = data.author || null;
  let authorImage = null;
  if (row.user_id != null) {
    try {
      const { rows: [u] } = await p.query(
        'SELECT username, profile_image FROM users WHERE user_id = $1',
        [row.user_id]
      );
      authorName = authorName || u?.username || null;
      authorImage = u?.profile_image ?? null;
    } catch { /* ignore */ }
  }
  return mapCommentRow({
    ...row,
    task_id: row.report_id,
    author_username: authorName,
    author_profile_image: authorImage,
    like_count: 0,
    liked_user_ids: [],
  });
}

export async function dbUpdateEodReportComment(commentId, userId, data) {
  const p = getPool();
  if (!p) return null;
  const { rows: priorRows } = await p.query(
    'SELECT mentions FROM eod_report_comments WHERE comment_id = $1 AND user_id = $2',
    [commentId, userId]
  );
  const priorMentions = priorRows[0]?.mentions
    ? String(priorRows[0].mentions).split(',').map((s) => s.trim()).filter(Boolean)
    : [];
  const { rows } = await p.query(
    `UPDATE eod_report_comments
     SET comment_text = $1, mentions = $2, edited_at = CURRENT_TIMESTAMP
     WHERE comment_id = $3 AND user_id = $4
     RETURNING *`,
    [data.message ?? data.comment_text ?? '', normalizeMentions(data.mentions), commentId, userId]
  );
  const row = rows[0];
  if (!row) return null;
  const { rows: [enriched] } = await p.query(
    `SELECT c.*, c.report_id AS task_id,
            u.username AS author_username,
            u.profile_image AS author_profile_image,
            (SELECT COUNT(*) FROM eod_comment_likes l WHERE l.comment_id = c.comment_id) AS like_count,
            (SELECT COALESCE(ARRAY_AGG(l.user_id), '{}') FROM eod_comment_likes l WHERE l.comment_id = c.comment_id) AS liked_user_ids
     FROM eod_report_comments c LEFT JOIN users u ON c.user_id = u.user_id
     WHERE c.comment_id = $1`,
    [row.comment_id]
  );
  const mapped = mapCommentRow(enriched);
  const priorSet = new Set(priorMentions);
  mapped.newlyMentioned = mapped.mentions.filter((id) => !priorSet.has(id));
  return mapped;
}

export async function dbDeleteEodReportComment(commentId, userId, isAdmin = false) {
  const p = getPool();
  if (!p) return false;
  const id = parseInt(String(commentId), 10);
  if (!Number.isFinite(id)) return false;
  await p.query('DELETE FROM eod_report_comments WHERE parent_id = $1', [id]);
  const { rowCount } = isAdmin
    ? await p.query('DELETE FROM eod_report_comments WHERE comment_id = $1', [id])
    : await p.query('DELETE FROM eod_report_comments WHERE comment_id = $1 AND user_id = $2', [id, userId]);
  return rowCount > 0;
}

export async function dbToggleEodCommentLike(commentId, userId) {
  const p = getPool();
  if (!p) return null;
  const cId = parseInt(String(commentId), 10);
  const uId = parseInt(String(userId), 10);
  if (!Number.isFinite(cId) || !Number.isFinite(uId)) return null;
  const { rowCount } = await p.query(
    'DELETE FROM eod_comment_likes WHERE comment_id = $1 AND user_id = $2',
    [cId, uId]
  );
  let liked = false;
  if (rowCount === 0) {
    await p.query(
      'INSERT INTO eod_comment_likes (comment_id, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
      [cId, uId]
    );
    liked = true;
  }
  const { rows } = await p.query(
    'SELECT COUNT(*)::int AS n FROM eod_comment_likes WHERE comment_id = $1',
    [cId]
  );
  return { liked, likeCount: Number(rows[0]?.n || 0) };
}

// ── Project comments/notes (same shape as task/EOD comments; project_id aliased to
//    task_id so the shared mapCommentRow / frontend TaskComments work unchanged) ──
export async function dbGetProjectComments(projectId) {
  const p = getPool();
  if (!p) return [];
  const { rows } = await p.query(
    `SELECT c.*, c.project_id AS task_id,
            u.username AS author_username,
            u.profile_image AS author_profile_image,
            (SELECT COUNT(*) FROM project_comment_likes l WHERE l.comment_id = c.comment_id) AS like_count,
            (SELECT COALESCE(ARRAY_AGG(l.user_id), '{}') FROM project_comment_likes l WHERE l.comment_id = c.comment_id) AS liked_user_ids
     FROM project_comments c
     LEFT JOIN users u ON c.user_id = u.user_id
     WHERE c.project_id = $1
     ORDER BY c.created_at`,
    [projectId]
  );
  return rows.map(mapCommentRow);
}

export async function dbAddProjectComment(projectId, data) {
  const p = getPool();
  if (!p) return null;
  const parentId =
    data.parent_id != null && String(data.parent_id).trim() !== ''
      ? parseInt(String(data.parent_id), 10)
      : null;
  const { rows: [row] } = await p.query(
    `INSERT INTO project_comments (project_id, user_id, comment_text, parent_id, mentions)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING *`,
    [
      projectId,
      data.user_id || null,
      data.message ?? data.comment_text ?? '',
      Number.isFinite(parentId) ? parentId : null,
      normalizeMentions(data.mentions),
    ]
  );
  if (!row) return null;
  let authorName = data.author || null;
  let authorImage = null;
  if (row.user_id != null) {
    try {
      const { rows: [u] } = await p.query(
        'SELECT username, profile_image FROM users WHERE user_id = $1',
        [row.user_id]
      );
      authorName = authorName || u?.username || null;
      authorImage = u?.profile_image ?? null;
    } catch { /* ignore */ }
  }
  return mapCommentRow({
    ...row,
    task_id: row.project_id,
    author_username: authorName,
    author_profile_image: authorImage,
    like_count: 0,
    liked_user_ids: [],
  });
}

export async function dbUpdateProjectComment(commentId, userId, data) {
  const p = getPool();
  if (!p) return null;
  const { rows: priorRows } = await p.query(
    'SELECT mentions FROM project_comments WHERE comment_id = $1 AND user_id = $2',
    [commentId, userId]
  );
  const priorMentions = priorRows[0]?.mentions
    ? String(priorRows[0].mentions).split(',').map((s) => s.trim()).filter(Boolean)
    : [];
  const { rows } = await p.query(
    `UPDATE project_comments
     SET comment_text = $1, mentions = $2, edited_at = CURRENT_TIMESTAMP
     WHERE comment_id = $3 AND user_id = $4
     RETURNING *`,
    [data.message ?? data.comment_text ?? '', normalizeMentions(data.mentions), commentId, userId]
  );
  const row = rows[0];
  if (!row) return null;
  const { rows: [enriched] } = await p.query(
    `SELECT c.*, c.project_id AS task_id,
            u.username AS author_username,
            u.profile_image AS author_profile_image,
            (SELECT COUNT(*) FROM project_comment_likes l WHERE l.comment_id = c.comment_id) AS like_count,
            (SELECT COALESCE(ARRAY_AGG(l.user_id), '{}') FROM project_comment_likes l WHERE l.comment_id = c.comment_id) AS liked_user_ids
     FROM project_comments c LEFT JOIN users u ON c.user_id = u.user_id
     WHERE c.comment_id = $1`,
    [row.comment_id]
  );
  const mapped = mapCommentRow(enriched);
  const priorSet = new Set(priorMentions);
  mapped.newlyMentioned = mapped.mentions.filter((id) => !priorSet.has(id));
  return mapped;
}

export async function dbDeleteProjectComment(commentId, userId, isAdmin = false) {
  const p = getPool();
  if (!p) return false;
  const id = parseInt(String(commentId), 10);
  if (!Number.isFinite(id)) return false;
  await p.query('DELETE FROM project_comments WHERE parent_id = $1', [id]);
  const { rowCount } = isAdmin
    ? await p.query('DELETE FROM project_comments WHERE comment_id = $1', [id])
    : await p.query('DELETE FROM project_comments WHERE comment_id = $1 AND user_id = $2', [id, userId]);
  return rowCount > 0;
}

export async function dbToggleProjectCommentLike(commentId, userId) {
  const p = getPool();
  if (!p) return null;
  const cId = parseInt(String(commentId), 10);
  const uId = parseInt(String(userId), 10);
  if (!Number.isFinite(cId) || !Number.isFinite(uId)) return null;
  const { rowCount } = await p.query(
    'DELETE FROM project_comment_likes WHERE comment_id = $1 AND user_id = $2',
    [cId, uId]
  );
  let liked = false;
  if (rowCount === 0) {
    await p.query(
      'INSERT INTO project_comment_likes (comment_id, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
      [cId, uId]
    );
    liked = true;
  }
  const { rows } = await p.query(
    'SELECT COUNT(*)::int AS n FROM project_comment_likes WHERE comment_id = $1',
    [cId]
  );
  return { liked, likeCount: Number(rows[0]?.n || 0) };
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
      p.query("SELECT COUNT(*) AS n FROM it_tasks WHERE status IN ('todo', 'in_progress', 'review', 'rework')"),
      p.query("SELECT COUNT(*) AS n FROM it_tasks WHERE status = 'completed'"),
      p.query(`
        SELECT p.project_id, p.project_name, p.priority, p.logo,
               COUNT(t.task_id) AS total_tasks,
               COUNT(t.task_id) FILTER (WHERE t.status = 'completed') AS completed_tasks
        FROM it_projects p
        LEFT JOIN it_tasks t ON t.project_id = p.project_id
        WHERE p.status = 'active'
        GROUP BY p.project_id, p.project_name, p.priority, p.logo
        ORDER BY p.project_id
      `),
      p.query(`
        SELECT u.user_id, COALESCE(u.username, u.email) AS username, u.profile_image,
               COUNT(t.task_id) AS total_assigned,
               COUNT(t.task_id) FILTER (WHERE t.status IN ('todo', 'in_progress', 'review', 'rework')) AS in_progress_count,
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
      logo: projectLogoUrlFor(r.project_id, r.logo),
      total_tasks: Number(r.total_tasks ?? 0),
      completed_tasks: Number(r.completed_tasks ?? 0),
      completion_percentage: r.total_tasks > 0
        ? Math.round((Number(r.completed_tasks) / Number(r.total_tasks)) * 100)
        : 0,
    }));
    const teamActivity = (teamRows.rows || []).map((r) => ({
      user_id: r.user_id,
      username: r.username,
      profile_image: avatarUrlFor(r.user_id, r.profile_image),
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

export async function dbGetTeamOverview(team = null) {
  const p = getPool();
  if (!p) return [];
  try {
    const normalizedTeam = resolveTeamFromInput(team);
    const taskJoinTable = taskTableForTeam(normalizedTeam);

    let teamWhereClause = '';
    const params = [];

    if (team === 'it') {
      teamWhereClause = `WHERE (
            COALESCE(u.is_it_developer, false) = true
            OR COALESCE(u.is_it_manager, false) = true
            OR EXISTS (
              SELECT 1
              FROM user_roles ur
              JOIN roles r ON r.role_id = ur.role_id
              WHERE ur.user_id = u.user_id
                AND r.code = ANY($1)
            )
          )`;
      params.push(['it_developer', 'it_manager', 'admin']);
    } else if (team === 'legal_finance') {
      teamWhereClause = `WHERE EXISTS (
              SELECT 1
              FROM user_roles ur
              JOIN roles r ON r.role_id = ur.role_id
              WHERE ur.user_id = u.user_id
                AND r.code IN ('legal_finance', 'admin')
            )`;
    } else if (team) {
      teamWhereClause = `WHERE EXISTS (
              SELECT 1
              FROM user_roles ur
              JOIN roles r ON r.role_id = ur.role_id
              WHERE ur.user_id = u.user_id
                AND r.code = $1
            )`;
      params.push(team);
    }

    const { rows } = await p.query(
      `
        SELECT u.user_id, COALESCE(u.username, u.email) AS username, u.profile_image,
               u.is_it_developer, u.is_it_manager, u.is_active,
               EXISTS (
                 SELECT 1
                 FROM user_roles ur_dev
                 JOIN roles r_dev ON r_dev.role_id = ur_dev.role_id
                 WHERE ur_dev.user_id = u.user_id AND r_dev.code = 'it_developer'
               ) AS rbac_it_developer,
               EXISTS (
                 SELECT 1
                 FROM user_roles ur_mgr
                 JOIN roles r_mgr ON r_mgr.role_id = ur_mgr.role_id
                 WHERE ur_mgr.user_id = u.user_id AND r_mgr.code IN ('it_manager', 'admin')
               ) AS rbac_it_manager,
               COUNT(t.task_id) AS total_tasks,
               COUNT(t.task_id) FILTER (WHERE t.status = 'completed') AS completed_tasks,
               COUNT(t.task_id) FILTER (WHERE t.status IN ('todo', 'in_progress', 'review', 'rework')) AS in_progress_tasks
        FROM users u
        LEFT JOIN ${taskJoinTable} t ON t.assigned_to = u.user_id
        ${teamWhereClause}
        GROUP BY u.user_id, u.username, u.email, u.profile_image, u.is_it_developer, u.is_it_manager, u.is_active
        ORDER BY total_tasks DESC
      `,
      params
    );
    return rows.map((r) => ({
      user_id: r.user_id,
      username: r.username,
      profile_image: avatarUrlFor(r.user_id, r.profile_image),
      // IT dashboard "Assign to" / developers list uses is_it_developer; RBAC-only IT Developer
      // must count too (admin "Assign roles" does not always set users.is_it_developer).
      is_it_developer: Boolean(r.is_it_developer) || Boolean(r.rbac_it_developer),
      is_it_manager: Boolean(r.is_it_manager) || Boolean(r.rbac_it_manager),
      // Default to active when the column is null (older rows) so nobody is hidden by accident.
      is_active: r.is_active !== false,
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
               COUNT(*) AS total,
               COUNT(*) FILTER (WHERE t.status IN ('todo', 'in_progress', 'review', 'rework')) AS open_tasks,
               COUNT(*) FILTER (WHERE t.status = 'completed') AS completed
        FROM it_tasks t GROUP BY t.assigned_to
      `);
      return rows.map((r) => ({
        assignee: r.assignee || 'Unassigned',
        total_tasks: Number(r.total),
        in_progress_tasks: Number(r.open_tasks),
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
      `INSERT INTO eod_reports (user_id, report_date, achievements, blockers, tomorrow_plan, hours_worked, mood, team)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING *`,
      [
        data.user_id ?? null,
        // Default to the local (IST) calendar day so a report counts for the same day
        // the EOD lock enforces. See todayInEodTz / dbGetUserEodLockState.
        data.report_date ?? todayInEodTz(),
        data.achievements ?? null,
        data.blockers ?? null,
        data.tomorrow_plan ?? null,
        data.hours_worked ?? null,
        data.mood ?? null,
        // Module the report was submitted from; defaults to 'it' for backward compat.
        data.team ?? 'it',
      ]
    );
    return row ? { id: row.report_id, ...row } : null;
  } catch (err) {
    console.error('dbCreateEodReport:', err.message);
    return null;
  }
}

export async function dbGetEodReports(filters = {}) {
  const p = getPool();
  if (!p) return [];
  try {
    let query = `
      SELECT e.*, e.report_date::text AS report_date_text,
             u.username, u.profile_image AS author_profile_image, u.branch,
             (SELECT COUNT(*) FROM eod_report_likes l WHERE l.report_id = e.report_id) AS like_count,
             (SELECT COALESCE(ARRAY_AGG(l.user_id), '{}') FROM eod_report_likes l WHERE l.report_id = e.report_id) AS liked_user_ids,
             (SELECT COUNT(*) FROM eod_report_comments c WHERE c.report_id = e.report_id) AS comment_count
      FROM eod_reports e
      LEFT JOIN users u ON e.user_id = u.user_id
      WHERE 1=1
    `;
    const params = [];
    let i = 1;
    if (filters.user_id != null) { query += ` AND e.user_id = $${i}`; params.push(filters.user_id); i++; }
    if (filters.report_date) { query += ` AND e.report_date = $${i}`; params.push(filters.report_date); i++; }
    if (filters.branch) { query += ` AND u.branch = $${i}`; params.push(filters.branch); i++; }
    // Scope to the module the report was submitted from (nulls treated as 'it').
    if (filters.team) { query += ` AND COALESCE(e.team, 'it') = $${i}`; params.push(filters.team); i++; }
    query += ' ORDER BY e.report_date DESC, e.report_id DESC';
    const { rows } = await p.query(query, params);
    return rows.map((r) => ({
      report_id: r.report_id,
      user_id: r.user_id,
      username: r.username,
      author_profile_image: avatarUrlFor(r.user_id, r.author_profile_image),
      branch: r.branch ?? null,
      report_date: r.report_date_text ?? r.report_date,
      achievements: r.achievements,
      blockers: r.blockers,
      tomorrow_plan: r.tomorrow_plan,
      hours_worked: r.hours_worked,
      mood: r.mood,
      edited_at: r.edited_at ?? null,
      created_at: r.created_at,
      like_count: Number(r.like_count || 0),
      liked_user_ids: Array.isArray(r.liked_user_ids) ? r.liked_user_ids.filter((v) => v != null).map(String) : [],
      comment_count: Number(r.comment_count || 0),
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

/** Toggle a like on the EOD report itself. Returns { liked, likeCount }. */
export async function dbToggleEodReportLike(reportId, userId) {
  const p = getPool();
  if (!p) return null;
  const rId = parseInt(String(reportId), 10);
  const uId = parseInt(String(userId), 10);
  if (!Number.isFinite(rId) || !Number.isFinite(uId)) return null;
  const { rowCount } = await p.query(
    'DELETE FROM eod_report_likes WHERE report_id = $1 AND user_id = $2',
    [rId, uId]
  );
  let liked = false;
  if (rowCount === 0) {
    await p.query(
      'INSERT INTO eod_report_likes (report_id, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
      [rId, uId]
    );
    liked = true;
  }
  const { rows } = await p.query(
    'SELECT COUNT(*)::int AS n FROM eod_report_likes WHERE report_id = $1',
    [rId]
  );
  return { liked, likeCount: Number(rows[0]?.n || 0) };
}

/** Edit an EOD report's work summary. Author only. Returns updated row or null. */
export async function dbUpdateEodReport(reportId, userId, data) {
  const p = getPool();
  if (!p) return null;
  try {
    const { rows } = await p.query(
      `UPDATE eod_reports
          SET achievements = $1, edited_at = CURRENT_TIMESTAMP
        WHERE report_id = $2 AND user_id = $3
        RETURNING report_id`,
      [data.achievements ?? data.message ?? '', reportId, userId]
    );
    if (!rows[0]) return null;
    const list = await dbGetEodReports({});
    return list.find((r) => String(r.report_id) === String(reportId)) || null;
  } catch (err) {
    console.error('dbUpdateEodReport:', err.message);
    return null;
  }
}

/** Delete an EOD report (and its comments/likes). Author only, unless isAdmin. */
export async function dbDeleteEodReport(reportId, userId, isAdmin = false) {
  const p = getPool();
  if (!p) return false;
  const id = parseInt(String(reportId), 10);
  if (!Number.isFinite(id)) return false;
  try {
    await p.query('DELETE FROM eod_report_comments WHERE report_id = $1', [id]);
    await p.query('DELETE FROM eod_report_likes WHERE report_id = $1', [id]);
    const { rowCount } = isAdmin
      ? await p.query('DELETE FROM eod_reports WHERE report_id = $1', [id])
      : await p.query('DELETE FROM eod_reports WHERE report_id = $1 AND user_id = $2', [id, userId]);
    return rowCount > 0;
  } catch (err) {
    console.error('dbDeleteEodReport:', err.message);
    return false;
  }
}

// ── EOD lock: enforce daily EOD reports ───────────────────
// The most recent working day before `todayStr`, skipping weekends and the user's
// leave days. Returns 'YYYY-MM-DD' or null.
function prevWorkingDay(todayStr, leaveSet) {
  const d = new Date(`${todayStr}T00:00:00Z`);
  for (let i = 0; i < 21; i++) {
    d.setUTCDate(d.getUTCDate() - 1);
    const dow = d.getUTCDay(); // 0 Sun … 6 Sat
    // Saturday is a working day; only Sunday is off.
    if (dow === 0) continue;
    const s = d.toISOString().slice(0, 10);
    if (leaveSet.has(s)) continue;
    return s;
  }
  return null;
}

// The EOD day boundary ("12:00 at night") is local, not UTC. Default is IST (+05:30);
// override with EOD_TZ_OFFSET_MINUTES if the team is elsewhere. Returns the current
// wall-clock date in that timezone as 'YYYY-MM-DD', independent of the server's TZ.
const EOD_TZ_OFFSET_MIN = Number(process.env.EOD_TZ_OFFSET_MINUTES ?? 330);
function todayInEodTz() {
  const shifted = new Date(Date.now() + EOD_TZ_OFFSET_MIN * 60_000);
  return shifted.toISOString().slice(0, 10);
}

/**
 * Resolve a user's EOD lock state. Admins are never locked.
 *
 * A user has until local midnight (see todayInEodTz) to file each day's EOD report.
 * The current day is therefore never a lock reason. Once a day has fully passed, if its
 * report is missing the user is locked and the lock is persisted (so the admin "locked
 * users" list and unlock flow work). An existing lock stays until an admin unlock clears
 * it. Days that are weekends, on the user's leave list, before the account existed, or
 * already excused by a prior admin unlock are never locked. Returns { locked, date }.
 */
export async function dbGetUserEodLockState(userId, isAdmin) {
  const p = getPool();
  if (!p || isAdmin) return { locked: false };
  try {
    const { rows } = await p.query(
      `SELECT eod_locked,
              eod_lock_date::text       AS eod_lock_date,
              eod_excused_through::text AS eod_excused_through,
              created_at::date::text    AS created_date,
              is_active
         FROM users WHERE user_id = $1`,
      [userId]
    );
    const u = rows[0];
    if (!u) return { locked: false };

    // Inactive users are exempt from the EOD requirement — never lock them, and clear
    // any stale lock so they are not stuck behind the lock screen.
    if (u.is_active === false) {
      if (u.eod_locked) {
        await p.query('UPDATE users SET eod_locked = false, eod_lock_date = NULL WHERE user_id = $1', [userId]);
      }
      return { locked: false };
    }

    // Already locked → stays locked until an admin unlock clears it.
    if (u.eod_locked) return { locked: true, date: u.eod_lock_date };

    // The day to enforce is the most recent completed working day before today; today
    // itself is still open until local midnight, so it is never enforced here.
    const { rows: leaveRows } = await p.query(
      'SELECT leave_date::text AS d FROM member_leaves WHERE user_id = $1',
      [userId]
    );
    const leaveSet = new Set(leaveRows.map((r) => r.d));
    const dueDay = prevWorkingDay(todayInEodTz(), leaveSet);
    if (!dueDay) return { locked: false };

    // Never lock for days before the account existed.
    if (u.created_date && dueDay < u.created_date) return { locked: false };

    // Never re-lock a date an admin already excused (this is what stops a revoked user
    // from being locked again for the same date).
    if (u.eod_excused_through && dueDay <= u.eod_excused_through) return { locked: false };

    // Locked only when no report exists for that working day.
    const { rowCount } = await p.query(
      'SELECT 1 FROM eod_reports WHERE user_id = $1 AND report_date = $2 LIMIT 1',
      [userId, dueDay]
    );
    if (rowCount > 0) return { locked: false };

    // Persist the lock so it survives and shows in the admin locked-users list.
    await p.query(
      'UPDATE users SET eod_locked = true, eod_lock_date = $2 WHERE user_id = $1',
      [userId, dueDay]
    );
    return { locked: true, date: dueDay };
  } catch (err) {
    console.error('dbGetUserEodLockState:', err.message);
    return { locked: false };
  }
}

/**
 * IT-team members (Internal + External Projects, gated by it_updates.view) who have
 * NOT submitted an EOD report for the given working day. Admins are excluded (they are
 * never required to file), and members on approved leave that day are excluded too.
 * Used by the 8pm daily reminder that reports absentees to the directors.
 */
export async function dbGetItMembersMissingEod(dateStr) {
  const p = getPool();
  if (!p) return [];
  try {
    const { rows } = await p.query(
      `SELECT DISTINCT u.user_id, u.username, u.email
         FROM users u
         JOIN user_roles ur       ON ur.user_id = u.user_id
         JOIN role_permissions rp ON rp.role_id = ur.role_id
         JOIN permissions pm      ON pm.permission_id = rp.permission_id
        WHERE pm.code = 'it_updates.view'
          AND COALESCE(u.is_active, true) = true
          AND u.user_id NOT IN (
                SELECT ur2.user_id
                  FROM user_roles ur2
                  JOIN role_permissions rp2 ON rp2.role_id = ur2.role_id
                  JOIN permissions pm2      ON pm2.permission_id = rp2.permission_id
                 WHERE pm2.code = 'admin.access'
              )
          AND NOT EXISTS (
                SELECT 1 FROM eod_reports e
                 WHERE e.user_id = u.user_id AND e.report_date = $1
              )
          AND NOT EXISTS (
                SELECT 1 FROM member_leaves ml
                 WHERE ml.user_id = u.user_id AND ml.leave_date = $1
              )
        ORDER BY u.username`,
      [dateStr]
    );
    return rows;
  } catch (err) {
    console.error('dbGetItMembersMissingEod:', err.message);
    return [];
  }
}

/** Users currently locked for a missing EOD report. */
export async function dbGetLockedEodUsers() {
  const p = getPool();
  if (!p) return [];
  try {
    const { rows } = await p.query(
      `SELECT user_id, username, email, eod_lock_date::text AS eod_lock_date
         FROM users WHERE eod_locked = true ORDER BY username`
    );
    return rows;
  } catch (err) {
    console.error('dbGetLockedEodUsers:', err.message);
    return [];
  }
}

/** Admin approval: clear a user's EOD lock and excuse the missed day so it does not re-lock. */
export async function dbUnlockUserEod(userId) {
  const p = getPool();
  if (!p) return false;
  try {
    // Excuse the user through the CURRENT due day, not just the day they happened to be
    // locked for. If days passed between the lock and the admin's unlock, the current due
    // day (prevWorkingDay of today) is newer than eod_lock_date; excusing only up to the
    // old date would let the next session-restore immediately re-lock them for the newer
    // missed day — which is why an unlocked user kept reappearing in the locked list.
    const { rows: leaveRows } = await p.query(
      'SELECT leave_date::text AS d FROM member_leaves WHERE user_id = $1',
      [userId]
    );
    const leaveSet = new Set(leaveRows.map((r) => r.d));
    const dueDay = prevWorkingDay(todayInEodTz(), leaveSet) || todayInEodTz();

    const { rowCount } = await p.query(
      `UPDATE users
          SET eod_excused_through = GREATEST(
                COALESCE(eod_excused_through, DATE '1970-01-01'),
                COALESCE(eod_lock_date, DATE '1970-01-01'),
                $2::date
              ),
              eod_locked = false,
              eod_lock_date = NULL
        WHERE user_id = $1`,
      [userId, dueDay]
    );
    return rowCount > 0;
  } catch (err) {
    console.error('dbUnlockUserEod:', err.message);
    return false;
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
  // Time tracking: accumulated seconds + running-since timestamp (null when paused).
  timeSpentSeconds: Number(r.time_spent_seconds || 0),
  timerStartedAt: r.timer_started_at ?? null,
  timerRunning: Boolean(r.timer_started_at),
});

/** Start or pause a requirement's timer. action: 'start' | 'pause'. Returns updated requirement. */
export async function dbRequirementTimer(reqId, action, taskId = null, teamInput = null) {
  const p = getPool();
  if (!p) return null;
  try {
    const team = resolveTeamFromInput(teamInput || (taskId ? await detectTaskTeamById(taskId) : null));
    const reqTable = reqTableForTeam(team);
    const taskTable = taskTableForTeam(team);
    if (action === 'start') {
      await p.query(
        `UPDATE ${reqTable}
         SET timer_started_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
         WHERE requirement_id = $1 AND timer_started_at IS NULL`,
        [reqId]
      );
    } else if (action === 'pause') {
      // Record this work session (started -> now) attributed to the task's assignee,
      // so the member dashboard can sum worked time per day. Then bank the seconds.
      try {
        await p.query(
          `INSERT INTO requirement_time_logs (user_id, requirement_id, task_id, team, seconds, work_date, started_at, ended_at)
           SELECT t.assigned_to, r.requirement_id, r.task_id, $2,
                  GREATEST(0, FLOOR(EXTRACT(EPOCH FROM (CURRENT_TIMESTAMP - r.timer_started_at)))::int),
                  CURRENT_DATE, r.timer_started_at, CURRENT_TIMESTAMP
           FROM ${reqTable} r
           LEFT JOIN ${taskTable} t ON t.task_id = r.task_id
           WHERE r.requirement_id = $1 AND r.timer_started_at IS NOT NULL`,
          [reqId, team]
        );
      } catch (logErr) {
        console.warn('dbRequirementTimer: time-log insert skipped:', logErr.message);
      }
      await p.query(
        `UPDATE ${reqTable}
         SET time_spent_seconds = COALESCE(time_spent_seconds, 0)
               + GREATEST(0, FLOOR(EXTRACT(EPOCH FROM (CURRENT_TIMESTAMP - timer_started_at)))::int),
             timer_started_at = NULL,
             updated_at = CURRENT_TIMESTAMP
         WHERE requirement_id = $1 AND timer_started_at IS NOT NULL`,
        [reqId]
      );
    }
    const { rows } = await p.query(`SELECT * FROM ${reqTable} WHERE requirement_id = $1`, [reqId]);
    return rows[0] ? mapRequirement(rows[0]) : null;
  } catch (err) {
    console.error('dbRequirementTimer:', err.message);
    return null;
  }
}

/**
 * Set a requirement's worked time from a manual From/To entry (when the timer was
 * not used). fromTime/toTime are clock times ('HH:MM'); the work date is taken from
 * the task's task_date. The entered interval is the single source of truth: it
 * REPLACES the requirement's tracked time (it does not accumulate), and replaces
 * that requirement's time logs so the member dashboard reflects exactly what was
 * entered. Any running timer is stopped.
 */
export async function dbAddRequirementManualTime(reqId, { fromTime, toTime }, taskId = null, teamInput = null) {
  const p = getPool();
  if (!p) return null;
  const team = resolveTeamFromInput(teamInput || (taskId ? await detectTaskTeamById(taskId) : null));
  const reqTable = reqTableForTeam(team);
  const taskTable = taskTableForTeam(team);
  try {
    // Clear prior logged time for this requirement so the entered interval is not
    // added on top of earlier entries (no summing across edits).
    await p.query('DELETE FROM requirement_time_logs WHERE requirement_id = $1', [reqId]);
    // Record the entered session, deriving date + assignee from the requirement's task.
    const { rows: ins } = await p.query(
      `INSERT INTO requirement_time_logs
         (user_id, requirement_id, task_id, team, seconds, work_date, started_at, ended_at)
       SELECT t.assigned_to, r.requirement_id, r.task_id, $4,
              GREATEST(0, EXTRACT(EPOCH FROM ($3::time - $2::time))::int),
              COALESCE(t.task_date, CURRENT_DATE),
              COALESCE(t.task_date, CURRENT_DATE) + $2::time,
              COALESCE(t.task_date, CURRENT_DATE) + $3::time
         FROM ${reqTable} r
         JOIN ${taskTable} t ON t.task_id = r.task_id
        WHERE r.requirement_id = $1
       RETURNING seconds`,
      [reqId, fromTime, toTime, team]
    );
    if (!ins[0]) return null; // requirement / task not found
    const seconds = Number(ins[0].seconds || 0);
    const { rows } = await p.query(
      `UPDATE ${reqTable}
          SET time_spent_seconds = $2,
              timer_started_at = NULL,
              updated_at = CURRENT_TIMESTAMP
        WHERE requirement_id = $1
        RETURNING *`,
      [reqId, seconds]
    );
    return rows[0] ? mapRequirement(rows[0]) : null;
  } catch (err) {
    console.error('dbAddRequirementManualTime:', err.message);
    return null;
  }
}

const EMPTY_TASK_STATS = { total: 0, completed: 0, in_progress: 0, todo: 0, review: 0, overdue: 0 };
const EMPTY_DASHBOARD = { daily: [], byProject: [], projects: [], leaves: [], totalSeconds: 0, taskStats: { ...EMPTY_TASK_STATS } };

/**
 * Member dashboard data: worked seconds per day, per-project breakdown, the projects
 * the member is assigned to, and leave days — all within [from, to] (yyyy-mm-dd).
 */
export async function dbGetMemberDashboard(userId, from, to, team = 'it', projectType = null) {
  const p = getPool();
  if (!p) return EMPTY_DASHBOARD;
  const uid = parseInt(String(userId), 10);
  if (!Number.isFinite(uid)) return EMPTY_DASHBOARD;
  const taskTable = taskTableForTeam(team);
  const hasProjects = team === 'it'; // only it_tasks carries project_id + it_projects exists
  const params = [uid, from || '0001-01-01', to || '9999-12-31'];
  // Scope the dashboard to a project sector so Internal and External differ.
  // Internal also counts tasks with no project; External only external projects.
  const scoped = hasProjects && (projectType === 'internal' || projectType === 'external');
  const projMatch =
    projectType === 'external'
      ? "pr.project_type = 'external'"
      : "COALESCE(pr.project_type, 'internal') = 'internal'";
  try {
    const dailySql = scoped
      ? `SELECT to_char(l.work_date, 'YYYY-MM-DD') AS date, SUM(l.seconds)::int AS seconds
         FROM requirement_time_logs l
         LEFT JOIN ${taskTable} t ON t.task_id = l.task_id
         LEFT JOIN it_projects pr ON pr.project_id = t.project_id
         WHERE l.user_id = $1 AND l.work_date BETWEEN $2 AND $3 AND ${projMatch}
         GROUP BY l.work_date ORDER BY l.work_date`
      : `SELECT to_char(work_date, 'YYYY-MM-DD') AS date, SUM(seconds)::int AS seconds
         FROM requirement_time_logs
         WHERE user_id = $1 AND work_date BETWEEN $2 AND $3
         GROUP BY work_date ORDER BY work_date`;
    const { rows: dailyRows } = await p.query(dailySql, params);
    let byProject = [];
    let projects = [];
    if (hasProjects) {
      const { rows: bp } = await p.query(
        `SELECT COALESCE(pr.project_id::text, 'none') AS project_id,
                COALESCE(pr.project_name, 'No project') AS project_name,
                SUM(l.seconds)::int AS seconds
         FROM requirement_time_logs l
         LEFT JOIN ${taskTable} t ON t.task_id = l.task_id
         LEFT JOIN it_projects pr ON pr.project_id = t.project_id
         WHERE l.user_id = $1 AND l.work_date BETWEEN $2 AND $3 ${scoped ? `AND ${projMatch}` : ''}
         GROUP BY pr.project_id, pr.project_name
         ORDER BY seconds DESC`,
        params
      );
      byProject = bp.map((r) => ({
        project_id: r.project_id,
        project_name: r.project_name,
        seconds: Number(r.seconds || 0),
      }));
      const { rows: pj } = await p.query(
        `SELECT DISTINCT pr.project_id AS id, pr.project_name AS name, pr.status, pr.logo
         FROM ${taskTable} t
         JOIN it_projects pr ON pr.project_id = t.project_id
         WHERE t.assigned_to = $1 ${scoped ? `AND ${projMatch}` : ''}
         ORDER BY pr.project_name`,
        [uid]
      );
      projects = pj.map((r) => ({ id: String(r.id), name: r.name, status: r.status, logo: projectLogoUrlFor(r.id, r.logo) }));
    }
    const { rows: leaveRows } = await p.query(
      `SELECT to_char(leave_date, 'YYYY-MM-DD') AS d FROM member_leaves
       WHERE user_id = $1 AND leave_date BETWEEN $2 AND $3 ORDER BY leave_date`,
      params
    );
    // Task insights for the member, scoped to the period by task date.
    let taskStats = { ...EMPTY_TASK_STATS };
    try {
      const { rows: ts } = await p.query(
        `SELECT
           COUNT(*)::int AS total,
           COUNT(*) FILTER (WHERE t.status = 'completed')::int AS completed,
           COUNT(*) FILTER (WHERE t.status = 'in_progress')::int AS in_progress,
           COUNT(*) FILTER (WHERE t.status = 'todo')::int AS todo,
           COUNT(*) FILTER (WHERE t.status IN ('review', 'rework'))::int AS review,
           COUNT(*) FILTER (WHERE t.due_date IS NOT NULL AND t.due_date < CURRENT_DATE AND t.status <> 'completed')::int AS overdue
         FROM ${taskTable} t
         ${hasProjects ? 'LEFT JOIN it_projects pr ON pr.project_id = t.project_id' : ''}
         WHERE t.assigned_to = $1
           AND COALESCE(t.task_date, t.created_at::date) BETWEEN $2 AND $3
           ${scoped ? `AND ${projMatch}` : ''}`,
        params
      );
      if (ts[0]) {
        taskStats = {
          total: Number(ts[0].total || 0),
          completed: Number(ts[0].completed || 0),
          in_progress: Number(ts[0].in_progress || 0),
          todo: Number(ts[0].todo || 0),
          review: Number(ts[0].review || 0),
          overdue: Number(ts[0].overdue || 0),
        };
      }
    } catch (tsErr) {
      console.warn('dbGetMemberDashboard taskStats:', tsErr.message);
    }
    const daily = dailyRows.map((r) => ({ date: r.date, seconds: Number(r.seconds || 0) }));
    const totalSeconds = daily.reduce((s, d) => s + d.seconds, 0);
    return { daily, byProject, projects, leaves: leaveRows.map((r) => r.d), totalSeconds, taskStats };
  } catch (err) {
    console.error('dbGetMemberDashboard:', err.message);
    return EMPTY_DASHBOARD;
  }
}

export async function dbGetLeaves(userId, from, to) {
  const p = getPool();
  if (!p) return [];
  const uid = parseInt(String(userId), 10);
  if (!Number.isFinite(uid)) return [];
  try {
    const { rows } = await p.query(
      `SELECT to_char(leave_date, 'YYYY-MM-DD') AS d FROM member_leaves
       WHERE user_id = $1 AND leave_date BETWEEN $2 AND $3 ORDER BY leave_date`,
      [uid, from || '0001-01-01', to || '9999-12-31']
    );
    return rows.map((r) => r.d);
  } catch (err) {
    console.error('dbGetLeaves:', err.message);
    return [];
  }
}

/** Toggle a member's leave for a single day. `on=true` adds it, `on=false` removes it. */
export async function dbSetLeave(userId, date, on) {
  const p = getPool();
  if (!p) return false;
  const uid = parseInt(String(userId), 10);
  if (!Number.isFinite(uid) || !date) return false;
  try {
    if (on) {
      await p.query(
        `INSERT INTO member_leaves (user_id, leave_date) VALUES ($1, $2)
         ON CONFLICT (user_id, leave_date) DO NOTHING`,
        [uid, date]
      );
    } else {
      await p.query('DELETE FROM member_leaves WHERE user_id = $1 AND leave_date = $2', [uid, date]);
    }
    return true;
  } catch (err) {
    console.error('dbSetLeave:', err.message);
    return false;
  }
}

export async function dbGetRequirements(taskId, teamInput = null) {
  const p = getPool();
  if (!p) return [];
  try {
    const team = resolveTeamFromInput(teamInput || await detectTaskTeamById(taskId));
    const reqTable = reqTableForTeam(team);
    // Check if table exists
    const { rows: tableCheck } = await p.query(
      "SELECT EXISTS (SELECT FROM information_schema.tables WHERE table_name = $1)",
      [reqTable]
    );
    if (!tableCheck[0]?.exists) return [];

    const { rows } = await p.query(
      `SELECT * FROM ${reqTable} WHERE task_id = $1 ORDER BY sort_order, requirement_id`,
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

export async function dbCreateRequirement(taskId, data, teamInput = null) {
  const p = getPool();
  if (!p) return null;
  try {
    const team = resolveTeamFromInput(teamInput || data?.team || await detectTaskTeamById(taskId));
    const reqTable = reqTableForTeam(team);
    // DB schema uses VARCHAR(500) for title; clamp to prevent 500 errors.
    const normalizedTitle = String(data?.title ?? 'Untitled Requirement').trim();
    const safeTitle = (normalizedTitle || 'Untitled Requirement').slice(0, 500);
    // Get next sort_order
    const { rows: maxRows } = await p.query(
      `SELECT COALESCE(MAX(sort_order), -1) + 1 AS next FROM ${reqTable} WHERE task_id = $1`,
      [parseInt(taskId, 10)]
    );
    const nextOrder = maxRows[0]?.next ?? 0;

    const { rows: [row] } = await p.query(
      `INSERT INTO ${reqTable} (task_id, title, description, status, priority, due_date, sort_order)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING *`,
      [
        parseInt(taskId, 10),
        safeTitle,
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

export async function dbUpdateRequirement(reqId, data, taskId = null, teamInput = null) {
  const p = getPool();
  if (!p) return null;
  const team = resolveTeamFromInput(teamInput || data?.team || (taskId ? await detectTaskTeamById(taskId) : null));
  const reqTable = reqTableForTeam(team);
  const allowed = ['title', 'description', 'status', 'priority', 'due_date', 'sort_order'];
  const updates = [];
  const values = [];
  let i = 1;
  for (const [k, v] of Object.entries(data)) {
    if (allowed.includes(k) && v !== undefined) {
      updates.push(`${k} = $${i}`);
      const val =
        k === 'due_date'
          ? toNullableDate(v)
          : k === 'title'
            ? String(v ?? '').trim().slice(0, 500)
            : v;
      values.push(val);
      i++;
    }
  }
  if (data.status === 'completed') {
    // Ticking a requirement complete seizes its timer: bank any running time and stop it.
    updates.push(
      `time_spent_seconds = COALESCE(time_spent_seconds, 0) + CASE WHEN timer_started_at IS NOT NULL THEN GREATEST(0, FLOOR(EXTRACT(EPOCH FROM (CURRENT_TIMESTAMP - timer_started_at)))::int) ELSE 0 END`
    );
    updates.push('timer_started_at = NULL');
  }
  if (updates.length === 0) return dbGetRequirementById(reqId);
  updates.push('updated_at = CURRENT_TIMESTAMP');
  values.push(reqId);
  try {
    const { rows } = await p.query(
      `UPDATE ${reqTable} SET ${updates.join(', ')} WHERE requirement_id = $${i} RETURNING *`,
      values
    );
    return rows[0] ? mapRequirement(rows[0]) : null;
  } catch (err) {
    console.error('dbUpdateRequirement:', err.message);
    return null;
  }
}

export async function dbDeleteRequirement(reqId, taskId = null, teamInput = null) {
  const p = getPool();
  if (!p) return false;
  try {
    const team = resolveTeamFromInput(teamInput || (taskId ? await detectTaskTeamById(taskId) : null));
    const reqTable = reqTableForTeam(team);
    const { rowCount } = await p.query(
      `DELETE FROM ${reqTable} WHERE requirement_id = $1`,
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

// ─── RBAC ───────────────────────────────────────────────────────────────

/** Get all permissions (for admin config). */
export async function dbGetPermissions() {
  const p = getPool();
  if (!p) return [];
  try {
    const { rows } = await p.query(
      'SELECT permission_id, code, name, module, description FROM permissions ORDER BY module, code'
    );
    return rows;
  } catch (err) {
    console.error('dbGetPermissions:', err.message);
    return [];
  }
}

/** Get all roles with department name. */
export async function dbGetRoles() {
  const p = getPool();
  if (!p) return [];
  try {
    const { rows } = await p.query(
      `SELECT r.role_id, r.name, r.code, r.department_id, r.description, d.name AS department_name, d.code AS department_code
       FROM roles r LEFT JOIN departments d ON r.department_id = d.department_id
       ORDER BY r.name`
    );
    return rows;
  } catch (err) {
    console.error('dbGetRoles:', err.message);
    return [];
  }
}

/** Get permission IDs for a role. */
export async function dbGetRolePermissionIds(roleId) {
  const p = getPool();
  if (!p) return [];
  try {
    const { rows } = await p.query(
      'SELECT permission_id FROM role_permissions WHERE role_id = $1',
      [roleId]
    );
    return rows.map((r) => r.permission_id);
  } catch (err) {
    console.error('dbGetRolePermissionIds:', err.message);
    return [];
  }
}

/** Get permissions for a role (full permission rows). */
export async function dbGetRolePermissions(roleId) {
  const p = getPool();
  if (!p) return [];
  try {
    const { rows } = await p.query(
      `SELECT p.permission_id, p.code, p.name, p.module FROM permissions p
       INNER JOIN role_permissions rp ON p.permission_id = rp.permission_id
       WHERE rp.role_id = $1 ORDER BY p.module, p.code`,
      [roleId]
    );
    return rows;
  } catch (err) {
    console.error('dbGetRolePermissions:', err.message);
    return [];
  }
}

/** Get role codes for a user (from user_roles). */
export async function dbGetUserRoleIds(userId) {
  const p = getPool();
  if (!p) return [];
  try {
    const { rows } = await p.query(
      'SELECT role_id FROM user_roles WHERE user_id = $1',
      [userId]
    );
    return rows.map((r) => r.role_id);
  } catch (err) {
    console.error('dbGetUserRoleIds:', err.message);
    return [];
  }
}

/** Get distinct permission codes for a user (all roles combined). */
export async function dbGetUserPermissions(userId) {
  const p = getPool();
  if (!p) return [];
  try {
    const { rows } = await p.query(
      `SELECT DISTINCT p.code FROM permissions p
       INNER JOIN role_permissions rp ON p.permission_id = rp.permission_id
       INNER JOIN user_roles ur ON ur.role_id = rp.role_id
       WHERE ur.user_id = $1 ORDER BY p.code`,
      [userId]
    );
    return rows.map((r) => r.code);
  } catch (err) {
    console.error('dbGetUserPermissions:', err.message);
    return [];
  }
}

/** Assign a role to a user. */
export async function dbAssignUserRole(userId, roleId, assignedBy = null) {
  const p = getPool();
  if (!p) return false;
  try {
    await p.query(
      'INSERT INTO user_roles (user_id, role_id, assigned_by) VALUES ($1, $2, $3) ON CONFLICT (user_id, role_id) DO NOTHING',
      [userId, roleId, assignedBy]
    );
    return true;
  } catch (err) {
    console.error('dbAssignUserRole:', err.message);
    return false;
  }
}

/** Remove a role from a user. */
export async function dbRemoveUserRole(userId, roleId) {
  const p = getPool();
  if (!p) return false;
  try {
    const { rowCount } = await p.query(
      'DELETE FROM user_roles WHERE user_id = $1 AND role_id = $2',
      [userId, roleId]
    );
    return rowCount > 0;
  } catch (err) {
    console.error('dbRemoveUserRole:', err.message);
    return false;
  }
}

/** Set all roles for a user (replaces existing). */
export async function dbSetUserRoles(userId, roleIds, assignedBy = null) {
  const p = getPool();
  if (!p) return false;
  try {
    await p.query('DELETE FROM user_roles WHERE user_id = $1', [userId]);
    for (const roleId of roleIds) {
      await p.query(
        'INSERT INTO user_roles (user_id, role_id, assigned_by) VALUES ($1, $2, $3) ON CONFLICT (user_id, role_id) DO NOTHING',
        [userId, roleId, assignedBy]
      );
    }
    return true;
  } catch (err) {
    console.error('dbSetUserRoles:', err.message);
    return false;
  }
}

/** Set permissions for a role (replaces existing). */
export async function dbSetRolePermissions(roleId, permissionIds) {
  const p = getPool();
  if (!p) return false;
  try {
    await p.query('DELETE FROM role_permissions WHERE role_id = $1', [roleId]);
    for (const permId of permissionIds) {
      await p.query(
        'INSERT INTO role_permissions (role_id, permission_id) VALUES ($1, $2) ON CONFLICT (role_id, permission_id) DO NOTHING',
        [roleId, permId]
      );
    }
    return true;
  } catch (err) {
    console.error('dbSetRolePermissions:', err.message);
    return false;
  }
}

/** Create audit log entry. */
export async function dbCreateAuditLog({ userId, action, resource, resourceId = null, details = null, ipAddress = null }) {
  const p = getPool();
  if (!p) return null;
  try {
    const { rows } = await p.query(
      `INSERT INTO audit_log (user_id, action, resource, resource_id, details, ip_address)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING audit_id, created_at`,
      [userId, action, resource, resourceId, details ? JSON.stringify(details) : null, ipAddress]
    );
    return rows[0] || null;
  } catch (err) {
    console.error('dbCreateAuditLog:', err.message);
    return null;
  }
}

/** Get audit log with optional filters. */
export async function dbGetAuditLogs(filters = {}) {
  const p = getPool();
  if (!p) return [];
  const { userId, resource, limit = 100, offset = 0 } = filters;
  try {
    const params = [];
    let i = 1;
    let sql = `SELECT a.audit_id, a.user_id, a.action, a.resource, a.resource_id, a.details, a.ip_address, a.created_at, u.username
               FROM audit_log a LEFT JOIN users u ON a.user_id = u.user_id WHERE 1=1`;
    if (userId) {
      params.push(userId);
      sql += ` AND a.user_id = $${i++}`;
    }
    if (resource) {
      params.push(resource);
      sql += ` AND a.resource = $${i++}`;
    }
    params.push(limit, offset);
    sql += ` ORDER BY a.created_at DESC LIMIT $${i} OFFSET $${i + 1}`;
    const { rows } = await p.query(sql, params);
    return rows;
  } catch (err) {
    console.error('dbGetAuditLogs:', err.message);
    return [];
  }
}

/** Get departments. */
export async function dbGetDepartments() {
  const p = getPool();
  if (!p) return [];
  try {
    const { rows } = await p.query(
      'SELECT department_id, name, code, description FROM departments ORDER BY name'
    );
    return rows;
  } catch (err) {
    console.error('dbGetDepartments:', err.message);
    return [];
  }
}

/** Get users with their role names (for admin user list). */
export async function dbGetUsersWithRoles() {
  const p = getPool();
  if (!p) return [];
  try {
    const { rows } = await p.query(
      `SELECT u.user_id, u.username, u.email, u.profile_image, u.is_it_developer, u.is_it_manager, u.branch, u.is_active, u.created_at,
              COALESCE(array_agg(r.name) FILTER (WHERE r.role_id IS NOT NULL), '{}') AS role_names,
              COALESCE(array_agg(r.code) FILTER (WHERE r.role_id IS NOT NULL), '{}') AS role_codes
       FROM users u
       LEFT JOIN user_roles ur ON u.user_id = ur.user_id
       LEFT JOIN roles r ON ur.role_id = r.role_id
       GROUP BY u.user_id ORDER BY u.username`
    );
    return rows.map((row) => ({
      ...row,
      role_names: Array.isArray(row.role_names) ? row.role_names : (row.role_names || []),
      role_codes: Array.isArray(row.role_codes) ? row.role_codes : (row.role_codes || []),
    }));
  } catch (err) {
    console.error('dbGetUsersWithRoles:', err.message);
    return [];
  }
}
