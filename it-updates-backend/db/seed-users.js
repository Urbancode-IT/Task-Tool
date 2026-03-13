/**
 * Seed allowed users into the `users` table.
 * Run from it-updates-backend: node db/seed-users.js
 * Ensure schema.sql has been run first (creates users table).
 */
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import bcrypt from 'bcrypt';
import { getPool } from './index.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '..', '.env') });

const DEVELOPERS = [
  { username: 'Atchaya Vijayakumar', password: 'Atchaya123' },
  { username: 'Savitha', password: 'Savitha123' },
  { username: 'Siva sankara pandian', password: 'Siva123' },
  { username: 'Jashwanth', password: 'Jash123' },
  { username: 'Deivendraraj', password: 'Deva123' },
  { username: 'Rohini', password: 'Rohini123' },
  { username: 'Abinash', password: 'Abinash123' },
  { username: 'Noorul Halisha', password: 'Halisha123' },
  { username: 'Suchithra', password: 'Suchithra123' },
];

const ADMINS = [
  { username: 'Pushparaj', password: 'Pushparaj123' },
  { username: 'Krithika', password: 'Krithika123' },
  { username: 'sivagaminathan', password: 'Siva123' },
  { username: 'Jayapradhapan', password: 'Jp123' },
  { username: 'Srikanth', password: 'Srikanth123' },
];

async function main() {
  const pool = getPool();
  if (!pool) {
    console.error('Database not connected. Set DB_* in .env and ensure PostgreSQL is running.');
    process.exit(1);
  }

  const rounds = 10;
  let inserted = 0;
  let skipped = 0;

  for (const { username, password } of [...DEVELOPERS, ...ADMINS]) {
    const isDeveloper = DEVELOPERS.some((d) => d.username === username);
    const isManager = ADMINS.some((a) => a.username === username);
    const password_hash = await bcrypt.hash(password, rounds);

    try {
      await pool.query(
        `INSERT INTO users (username, password_hash, is_it_developer, is_it_manager)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (username) DO UPDATE SET
           password_hash = EXCLUDED.password_hash,
           is_it_developer = EXCLUDED.is_it_developer,
           is_it_manager = EXCLUDED.is_it_manager`,
        [username, password_hash, isDeveloper, isManager]
      );
      inserted++;
      console.log('OK:', username);
    } catch (err) {
      console.error('Error for', username, err.message);
      skipped++;
    }
  }

  console.log('\nDone. Inserted/updated:', inserted, 'Skipped:', skipped);
  console.log('Login with username and password. Add email later in pgAdmin if needed.');
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
