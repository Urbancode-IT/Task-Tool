-- ============================================================
-- IT Updates — Database schema (PostgreSQL)
-- Matches spec: users (SERIAL), it_projects, it_tasks, task_comments, eod_reports
-- ============================================================

-- Users table (may already exist; ensure is_it_developer and is_it_manager)
-- email is optional (add later); login uses username when email is null
CREATE TABLE IF NOT EXISTS users (
  user_id SERIAL PRIMARY KEY,
  username VARCHAR(255) NOT NULL,
  email VARCHAR(255) UNIQUE,
  password_hash VARCHAR(255) NOT NULL,
  profile_image TEXT,
  role_id INT,
  is_it_developer BOOLEAN DEFAULT FALSE,
  is_it_manager BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

ALTER TABLE users ADD COLUMN IF NOT EXISTS is_it_developer BOOLEAN DEFAULT FALSE;
ALTER TABLE users ADD COLUMN IF NOT EXISTS is_it_manager BOOLEAN DEFAULT FALSE;
ALTER TABLE users ALTER COLUMN email DROP NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS users_username_unique ON users (username);

-- IT Projects
CREATE TABLE IF NOT EXISTS it_projects (
  project_id SERIAL PRIMARY KEY,
  project_name VARCHAR(255) NOT NULL,
  project_code VARCHAR(50) UNIQUE,
  description TEXT,
  status VARCHAR(20) DEFAULT 'active',       -- active, on_hold, completed, archived
  priority VARCHAR(20) DEFAULT 'medium',   -- low, medium, high, critical
  start_date DATE,
  end_date DATE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- IT Tasks
CREATE TABLE IF NOT EXISTS it_tasks (
  task_id SERIAL PRIMARY KEY,
  project_id INT REFERENCES it_projects(project_id) ON DELETE SET NULL,
  assigned_to INT REFERENCES users(user_id),
  assigned_by INT REFERENCES users(user_id),
  created_by INT REFERENCES users(user_id),
  task_title VARCHAR(500) NOT NULL,
  task_description TEXT,
  priority VARCHAR(20) DEFAULT 'medium',     -- low, medium, high, critical
  status VARCHAR(20) DEFAULT 'in_progress', -- in_progress, review, completed
  task_date DATE DEFAULT CURRENT_DATE,
  due_date DATE,
  completed_at TIMESTAMP,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Task Comments
CREATE TABLE IF NOT EXISTS task_comments (
  comment_id SERIAL PRIMARY KEY,
  task_id INT REFERENCES it_tasks(task_id) ON DELETE CASCADE,
  user_id INT REFERENCES users(user_id),
  comment_text TEXT NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- EOD Reports
CREATE TABLE IF NOT EXISTS eod_reports (
  report_id SERIAL PRIMARY KEY,
  user_id INT REFERENCES users(user_id),
  report_date DATE NOT NULL,
  achievements TEXT,
  blockers TEXT,
  tomorrow_plan TEXT,
  hours_worked DECIMAL(4,2),
  mood VARCHAR(20),  -- great, good, neutral, stressed, blocked
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_it_tasks_assigned_to ON it_tasks(assigned_to);
CREATE INDEX IF NOT EXISTS idx_it_tasks_project_id ON it_tasks(project_id);
CREATE INDEX IF NOT EXISTS idx_it_tasks_status ON it_tasks(status);
CREATE INDEX IF NOT EXISTS idx_it_tasks_task_date ON it_tasks(task_date);
CREATE INDEX IF NOT EXISTS idx_it_tasks_priority ON it_tasks(priority);
CREATE INDEX IF NOT EXISTS idx_task_comments_task_id ON task_comments(task_id);
CREATE INDEX IF NOT EXISTS idx_eod_reports_user_date ON eod_reports(user_id, report_date);
