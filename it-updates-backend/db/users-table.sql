-- ============================================================
-- Optional: minimal users table for IT Updates (standalone use)
-- Run this BEFORE schema.sql if your IT_Updates database has no users table.
-- ============================================================

CREATE TABLE IF NOT EXISTS users (
  user_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(255),
  email VARCHAR(255) UNIQUE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Optional: add IT role flags (schema.sql also adds these if users exists)
ALTER TABLE users ADD COLUMN IF NOT EXISTS is_it_developer BOOLEAN DEFAULT FALSE;
ALTER TABLE users ADD COLUMN IF NOT EXISTS is_it_manager BOOLEAN DEFAULT FALSE;
