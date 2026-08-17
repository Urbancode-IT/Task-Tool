/**
 * Every renameable name in the product, in one catalogue.
 *
 * Whitelabeling: a deployment can rename any module or section without a code
 * change. The defaults below stay in code and are always the fallback, so an empty
 * or unreachable profile renders exactly as it does today. The database stores only
 * the overrides — a map of `{ id: 'New name' }` on the published company profile.
 *
 * Section names are shared by id, not per module: renaming `section.eod_updates`
 * renames it everywhere it appears, which is the point — the same section should not
 * be called two different things in two sectors.
 *
 * Adding a name here is all that is needed for it to appear in the admin editor.
 */

/** Top-bar sectors. Ids match the module keys in MainLayout. */
export const MODULE_LABELS = [
  { id: 'module.it_updates', default: 'Internal Projects' },
  { id: 'module.external_projects', default: 'External Projects' },
  { id: 'module.consultants', default: 'Consultants' },
  { id: 'module.creative_team', default: 'Creative Team' },
  { id: 'module.social_media', default: 'Social Media Management' },
  { id: 'module.legal_finance', default: 'Legal & Finance' },
  { id: 'module.admin', default: 'Management' },
];

/** Sidebar sections inside a sector. */
export const SECTION_LABELS = [
  { id: 'section.home', default: 'Home' },
  { id: 'section.dashboard', default: 'Dashboard' },
  { id: 'section.my_dashboard', default: 'My Dashboard' },
  { id: 'section.my_tasks', default: 'My Tasks' },
  { id: 'section.all_tasks', default: 'All Tasks' },
  { id: 'section.projects', default: 'Projects' },
  { id: 'section.overview', default: 'Overview' },
  { id: 'section.eod_updates', default: 'EOD Updates' },
  { id: 'section.calendar', default: 'Calendar' },
  { id: 'section.link_hub', default: 'Link Hub' },
  { id: 'section.client_crm', default: 'Client CRM' },
];

/** Sections inside the Management sector. */
export const ADMIN_SECTION_LABELS = [
  { id: 'section.admin_dashboard', default: 'Dashboard' },
  { id: 'section.review_tasks', default: 'Review Tasks' },
  { id: 'section.overdue_tasks', default: 'Overdue Tasks' },
  { id: 'section.admin_overview', default: 'Overview' },
  { id: 'section.users', default: 'Users' },
  { id: 'section.departments', default: 'Departments' },
  { id: 'section.locked_users', default: 'Locked Users' },
  { id: 'section.company', default: 'Company & Branding' },
  { id: 'section.invoices', default: 'Invoices' },
  { id: 'section.credentials', default: 'UC Credentials' },
];

/**
 * Task board column names. Ids end in the status key the database stores, which is
 * never renamed — only the text shown above the column changes.
 */
export const STATUS_LABEL_ITEMS = [
  { id: 'status.todo', default: 'To do' },
  { id: 'status.prospect', default: 'Prospect' },
  { id: 'status.in_progress', default: 'In Progress' },
  { id: 'status.review', default: 'Review' },
  { id: 'status.rework', default: 'Rework' },
  { id: 'status.completed', default: 'Completed' },
];

/** External Projects relabels the same statuses as a client pipeline. */
export const EXTERNAL_STATUS_LABEL_ITEMS = [
  { id: 'status.external.todo', default: 'Incoming Leads' },
  { id: 'status.external.prospect', default: 'Prospect' },
  { id: 'status.external.in_progress', default: 'Converted Clients' },
  { id: 'status.external.review', default: 'In Progress' },
  { id: 'status.external.rework', default: 'Dropped Clients' },
  { id: 'status.external.completed', default: 'Delivered projects' },
];

/** Grouped for the admin editor. */
export const LABEL_GROUPS = [
  { title: 'Sectors', hint: 'Names in the top bar', items: MODULE_LABELS },
  { title: 'Sections', hint: 'Sidebar names inside a sector', items: SECTION_LABELS },
  { title: 'Management sections', hint: 'Sidebar names inside Management', items: ADMIN_SECTION_LABELS },
  { title: 'Task board columns', hint: 'Column names on every task board', items: STATUS_LABEL_ITEMS },
  { title: 'External Projects columns', hint: 'Client pipeline column names', items: EXTERNAL_STATUS_LABEL_ITEMS },
];

/** Flat id → default, for resolving a label without scanning the groups. */
export const LABEL_DEFAULTS = Object.fromEntries(
  [
    ...MODULE_LABELS, ...SECTION_LABELS, ...ADMIN_SECTION_LABELS,
    ...STATUS_LABEL_ITEMS, ...EXTERNAL_STATUS_LABEL_ITEMS,
  ].map((l) => [l.id, l.default])
);

/**
 * Rename a `{ status: 'Text' }` map from the catalogue.
 *
 * The status keys are database values and are never touched; only the displayed
 * text is swapped. `prefix` selects the standard or the External Projects set.
 * @param {Record<string,string>} map
 * @param {(id: string, fallback?: string) => string} label
 * @param {'status'|'status.external'} [prefix]
 */
export const applyStatusLabels = (map, label, prefix = 'status') =>
  Object.fromEntries(
    Object.entries(map).map(([status, text]) => [status, label(`${prefix}.${status}`, text)])
  );

/* ── Non-hook access ──────────────────────────────────────────────────────────
 * Status names are read from module-scope helpers and from sub-components that
 * cannot call a hook, so BrandingProvider mirrors the overrides here. Rendering
 * still updates: publishing changes the context value, which re-renders the tree.
 */
let overrides = {};

/** Called by BrandingProvider whenever the published labels change. */
export function setLabelOverrides(next) {
  overrides = next && typeof next === 'object' ? next : {};
}

/** Resolve a label id outside React: override → catalogue default → fallback. */
export const getLabel = (id, fallback) => overrides[id] || LABEL_DEFAULTS[id] || fallback || '';

/**
 * The display name for one task status, keeping the module's own text as the
 * fallback so an unconfigured install reads exactly as before.
 * @param {Record<string,string>} map the module's STATUS_LABELS
 * @param {string} key the status value stored in the database
 */
export const statusTextFor = (map, key, prefix = 'status') =>
  getLabel(`${prefix}.${key}`, map?.[key]) || map?.[key] || key;

/**
 * Apply overrides to a list of nav items carrying a `labelId`.
 * Items without a `labelId`, or with no override stored, keep their coded label.
 */
export const applyLabels = (items, label) =>
  items.map((item) => (item.labelId ? { ...item, label: label(item.labelId, item.label) } : item));
