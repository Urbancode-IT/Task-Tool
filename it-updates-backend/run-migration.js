import pg from 'pg';
import fs from 'fs';
const pool = new pg.Pool({ host: 'localhost', port: 5432, user: 'postgres', password: 'admin@123', database: 'It_updates' });
const sql = fs.readFileSync('db/requirements-migration.sql', 'utf8');
pool.query(sql).then(r => console.log('MIGRATION DONE')).catch(e => console.log('Error:', e.message)).finally(() => pool.end());
