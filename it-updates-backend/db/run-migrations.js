import dotenv from 'dotenv';
import pg from 'pg';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

dotenv.config();

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function getConnectionString() {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL;
  const user = process.env.DB_USER;
  const password = process.env.DB_PASSWORD;
  const host = process.env.DB_HOST || 'localhost';
  const port = process.env.DB_PORT || '5432';
  const database = process.env.DB_DATABASE;
  if (!user || !database) return null;
  const encoded = password ? encodeURIComponent(password) : '';
  return `postgresql://${user}${encoded ? ':' + encoded : ''}@${host}:${port}/${database}`;
}

async function runSqlFile(client, filename) {
  const filepath = path.join(__dirname, filename);
  const sql = fs.readFileSync(filepath, 'utf8');
  await client.query(sql);
  console.log('  OK:', filename);
}

async function main() {
  const connectionString = getConnectionString();
  if (!connectionString) {
    console.error('Set DATABASE_URL or DB_USER, DB_HOST, DB_DATABASE, DB_PASSWORD in .env');
    process.exit(1);
  }

  const client = new pg.Client({ connectionString });
  try {
    await client.connect();
    console.log('Connected to database.\n');

    console.log('1. Running users-table.sql...');
    await runSqlFile(client, 'users-table.sql');

    console.log('\n2. Running schema.sql...');
    await runSqlFile(client, 'schema.sql');

    console.log('\n3. Running seed.sql...');
    await runSqlFile(client, 'seed.sql');

    console.log('\n4. Running requirements-migration.sql...');
    await runSqlFile(client, 'requirements-migration.sql');

    console.log('\nDone. Migrations completed.');
  } catch (err) {
    console.error('Migration failed:', err.message);
    process.exit(1);
  } finally {
    await client.end();
  }
}

main();
