-- ============================================================
-- IT Updates — Task Requirements (subtasks) migration
-- Adds it_task_requirements table: each task can have N requirements
-- Run: psql -U <user> -d <database> -f db/requirements-migration.sql
-- ============================================================

CREATE TABLE IF NOT EXISTS it_task_requirements (
  requirement_id SERIAL PRIMARY KEY,
  task_id        INT NOT NULL REFERENCES it_tasks(task_id) ON DELETE CASCADE,
  title          VARCHAR(500) NOT NULL,
  description    TEXT,
  status         VARCHAR(20) DEFAULT 'pending',    -- pending, in_progress, completed
  priority       VARCHAR(20) DEFAULT 'medium',      -- low, medium, high, critical
  due_date       DATE,
  sort_order     INT DEFAULT 0,
  created_at     TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at     TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Indexes for efficient querying
CREATE INDEX IF NOT EXISTS idx_task_requirements_task_id ON it_task_requirements(task_id);
CREATE INDEX IF NOT EXISTS idx_task_requirements_status ON it_task_requirements(status);
