-- ============================================================
-- IT Updates — Optional seed data
-- Run after schema.sql. Uncomment and run on IT_Updates server.
-- ============================================================

INSERT INTO it_projects (project_name, project_code, description, status, priority, start_date)
VALUES
  ('UC Website', 'UC-WEB', 'Urban Code company website project', 'active', 'high', CURRENT_DATE),
  ('JZ Website', 'JZ-WEB', 'JZ website development project', 'active', 'medium', CURRENT_DATE),
  ('Zen', 'ZEN-CRM', 'Zen CRM application project', 'active', 'critical', CURRENT_DATE),
  ('Kattraan', 'KATTRAAN', 'Kattraan project', 'active', 'medium', CURRENT_DATE),
  ('Progiz', 'PROGIZ', 'Progiz project', 'active', 'medium', CURRENT_DATE),
  ('Bookwik', 'BOOKWIK', 'Bookwik project', 'active', 'medium', CURRENT_DATE),
  ('Compiler', 'COMPILER', 'Compiler project', 'active', 'high', CURRENT_DATE),
  ('In-Out', 'IN-OUT', 'In-Out tracking project', 'active', 'medium', CURRENT_DATE)
ON CONFLICT (project_code) DO NOTHING;
