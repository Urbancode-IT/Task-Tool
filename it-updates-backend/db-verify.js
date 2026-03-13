import pg from 'pg';
import fs from 'fs';

const pool = new pg.Pool({
    host: 'localhost',
    port: 5432,
    user: 'postgres',
    password: 'admin@123',
    database: 'It_updates'
});

async function run() {
    let log = "";
    try {
        log += "Connecting to database 'It_updates'...\n";

        const res1 = await pool.query(`
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
    `);
        log += "Create Table Command: " + res1.command + "\n";

        await pool.query("CREATE INDEX IF NOT EXISTS idx_task_requirements_task_id ON it_task_requirements(task_id)");
        log += "Index idx_task_requirements_task_id ensure-created\n";

        const res2 = await pool.query("SELECT * FROM it_task_requirements");
        log += "Final Table contains " + res2.rowCount + " rows.\n";

        log += "DB Schema check passed.\n";
    } catch (err) {
        log += "CRITICAL ERROR: " + err.message + "\n";
        if (err.stack) log += err.stack + "\n";
    } finally {
        fs.writeFileSync('e:/UC Offcial projects/IT Updates/it-updates-backend/db-verify-result.txt', log);
        await pool.end();
        process.exit(0);
    }
}

run();
