/**
 * Human-readable role from RBAC permissions + legacy flags.
 * Admin is shown for anyone with admin.access, regardless of which module they're viewing.
 */
export function getDisplayRole(user) {
  if (!user) return '';
  const p = Array.isArray(user.permissions) ? user.permissions : [];
  if (p.includes('admin.access')) return 'Admin';
  if (user.is_it_manager || p.includes('it_updates.users')) return 'IT Manager';
  if (user.is_it_developer) return 'IT Developer';
  if (p.includes('it_updates.manage') && p.includes('it_updates.view')) return 'IT Developer';
  if (p.includes('consultants.view') || p.includes('consultants.manage')) return 'Consultant';
  if (p.includes('digital_marketing.view') || p.includes('digital_marketing.manage'))
    return 'Digital Marketing';
  return user.role && user.role !== 'User' ? user.role : 'User';
}
