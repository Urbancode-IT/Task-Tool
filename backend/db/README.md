# IT Updates — Database setup

The app **only reads projects from the table `it_projects`**. If you added rows to a different table (e.g. `projects`), they will not show in the UI.

## 1. Create tables

In your **It_updates** database (pgAdmin or psql), run:

**`schema.sql`** — creates `it_projects`, `it_tasks`, `task_comments`, `users` (if missing), `eod_reports`.

## 2. Seed allowed users (login)

From `it-updates-backend` run:

```bash
npm run db:seed-users
```

This creates/updates the 14 allowed users (developers and admins) with hashed passwords. Only these users can log in. They can sign in with **username** or **email** (e.g. `Atchaya Vijayakumar` or `atchayavijayakumar@itupdates.local`) and their password.

## 3. Add project data

Either run **`seed.sql`** to insert sample projects, or add rows manually into **`it_projects`** with at least:

- `project_name` (required)
- `project_code` (optional, unique)
- `description`, `status`, `priority`, `start_date`, `end_date` (optional)

Example:

```sql
INSERT INTO it_projects (project_name, project_code, status, priority)
VALUES ('My Project', 'MY-PROJ', 'active', 'medium');
```

## 4. Backend .env

In `it-updates-backend`, set in `.env`:

- `DB_HOST`, `DB_PORT`, `DB_USER`, `DB_PASSWORD`, `DB_DATABASE=It_updates`

Restart the backend. You should see in the terminal either "Database connected OK" or "GET /projects: fetched N project(s) from database" when the UI loads.
