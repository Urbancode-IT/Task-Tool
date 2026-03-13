-- ============================================================
-- IT Updates — Seed allowed users (run in pgAdmin on It_updates DB)
-- Requires: schema.sql already run (users table exists).
-- Enable bcrypt: CREATE EXTENSION IF NOT EXISTS pgcrypto;
-- Email not added; you can add later in pgAdmin.
-- ============================================================

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- Allow email to be null (run this if you get "null value in column email violates not-null constraint")
ALTER TABLE users ALTER COLUMN email DROP NOT NULL;

-- Ensure username is unique for ON CONFLICT (run schema.sql if not already)
CREATE UNIQUE INDEX IF NOT EXISTS users_username_unique ON users (username);

-- Developers (is_it_developer = true)
INSERT INTO users (username, password_hash, is_it_developer, is_it_manager)
VALUES
  ('Atchaya Vijayakumar', crypt('Atchaya123', gen_salt('bf')), true, false),
  ('Savitha', crypt('Savitha123', gen_salt('bf')), true, false),
  ('Siva sankara pandian', crypt('Siva123', gen_salt('bf')), true, false),
  ('Jashwanth', crypt('Jash123', gen_salt('bf')), true, false),
  ('Deivendraraj', crypt('Deva123', gen_salt('bf')), true, false),
  ('Rohini', crypt('Rohini123', gen_salt('bf')), true, false),
  ('Abinash', crypt('Abinash123', gen_salt('bf')), true, false),
  ('Noorul Halisha', crypt('Halisha123', gen_salt('bf')), true, false),
  ('Suchithra', crypt('Suchithra123', gen_salt('bf')), true, false)
ON CONFLICT (username) DO UPDATE SET
  password_hash = EXCLUDED.password_hash,
  is_it_developer = EXCLUDED.is_it_developer,
  is_it_manager = EXCLUDED.is_it_manager;

-- Admins (is_it_manager = true)
INSERT INTO users (username, password_hash, is_it_developer, is_it_manager)
VALUES
  ('Pushparaj', crypt('Pushparaj123', gen_salt('bf')), false, true),
  ('Krithika', crypt('Krithika123', gen_salt('bf')), false, true),
  ('sivagaminathan', crypt('Siva123', gen_salt('bf')), false, true),
  ('Jayapradhapan', crypt('Jp123', gen_salt('bf')), false, true),
  ('Srikanth', crypt('Srikanth123', gen_salt('bf')), false, true)
ON CONFLICT (username) DO UPDATE SET
  password_hash = EXCLUDED.password_hash,
  is_it_developer = EXCLUDED.is_it_developer,
  is_it_manager = EXCLUDED.is_it_manager;
