import pg from 'pg';
import dotenv from 'dotenv';
dotenv.config();

const pool = new pg.Pool({
    host: process.env.DB_HOST,
    port: process.env.DB_PORT,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_DATABASE
});

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

console.log('Connecting to:', process.env.DB_DATABASE);
pool.query(sql)
    .then(() => {
        console.log('MIGRATION_SUCCESS');
        process.exit(0);
    })
    .catch((e) => {
        console.error('MIGRATION_ERROR:', e.message);
        process.exit(1);
    });
