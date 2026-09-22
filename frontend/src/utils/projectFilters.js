/**
 * The Projects tab's filter rule.
 *
 * Kept out of the component file so it can be exercised on its own, and so the module
 * that holds the screens keeps exporting only components.
 *
 * An empty field never filters. Status and priority fall back to the values the cards
 * display for a project that has none. The search covers the three ways a project gets
 * referred to: its name, its code and its client.
 */
export function matchesProjectFilters(project, filters = {}) {
  const p = project || {};
  const { q = '', status = '', priority = '', owner = '' } = filters;

  if (status && (p.status || 'active') !== status) return false;
  if (priority && (p.priority || 'medium') !== priority) return false;

  if (owner) {
    const owners = [p.owner_name || p.owner, p.secondary_owner_name]
      .map((n) => String(n || '').trim())
      .filter(Boolean);
    if (!owners.includes(owner)) return false;
  }

  const needle = String(q || '').trim().toLowerCase();
  if (needle) {
    const haystack = [p.name ?? p.project_name, p.project_code, p.client_name]
      .map((v) => String(v || '').toLowerCase())
      .join(' ');
    if (!haystack.includes(needle)) return false;
  }

  return true;
}

export default matchesProjectFilters;
