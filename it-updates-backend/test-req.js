import pg from 'pg';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';

dotenv.config();
const __dirname = path.dirname(fileURLToPath(import.meta.url));

const connectionString = `postgresql://${process.env.DB_USER}:${process.env.DB_PASSWORD}@${process.env.DB_HOST}:${process.env.DB_PORT}/${process.env.DB_DATABASE}`;

async function run() {
    const client = new pg.Client({ connectionString });
    try {
        await client.connect();
        console.log('Connected.');
        const sql = fs.readFileSync(path.join(__dirname, 'db', 'requirements-migration.sql'), 'utf8');
        await client.query(sql);
        console.log('MIGRATION SUCCESSFUL');
        const res = await client.query("SELECT count(*) FROM it_task_requirements");
        console.log('Current requirements count:', res.rows[0].count);
    } catch (err) {
        console.error('FAILED:', err.message);
    } finally {
        await client.end();
    }
}
run();
