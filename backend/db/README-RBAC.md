# RBAC (Role-Based Access Control) Setup

## Overview

The application supports multiple teams and an Admin role:

- **IT Team** — IT Updates module (tasks, projects, EOD)
- **Consultants Team** — Consultants module (placeholder for now)
- **Digital Marketing Team** — Digital Marketing module (placeholder for now)
- **Admin** — User management, role/permission configuration, audit log

## Database setup

1. Run the main schema if not already done:
   ```bash
   psql -U your_user -d your_database -f db/schema.sql
   ```

2. Run the RBAC schema (from the backend directory):
   ```bash
   npm run db:rbac
   ```
   Or with psql: `psql -U your_user -d your_database -f db/schema-rbac.sql`

3. (Optional) To give a user full admin access, either:
   - Create a user with username `admin` and run `schema-rbac.sql` (it assigns the Admin role to that user), or
   - Log in as a user who has at least one role, then use the **Admin** panel (if you have `admin.access`) to assign the **Admin** role to the desired user.

## Permissions

- `it_updates.view` — Access IT Updates module
- `it_updates.manage` — Create/edit tasks, projects, EOD
- `it_updates.users` — Manage users in IT context
- `consultants.view` / `consultants.manage` — Consultants module
- `digital_marketing.view` / `digital_marketing.manage` — Digital Marketing module
- `admin.access` — Access admin panel
- `admin.users` / `admin.roles` / `admin.audit` — Admin sub-capabilities

Admins have all permissions. Team members only see and access their assigned modules.

## Audit log

Admins can view the audit log in **Admin → Audit log**. To record events from the app, call `POST /api/admin/audit-log` with `{ action, resource, resource_id?, details? }` (requires `admin.access`).
