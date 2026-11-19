/**
 * Chat statuses. A person picks one of the first four; "offline" is shown instead
 * whenever they have no Seyal tab open, whatever they picked.
 */
export const CHAT_STATUS_META = {
  available: { label: 'Available', color: '#22c55e' },
  busy: { label: 'Busy', color: '#ef4444' },
  away: { label: 'Away', color: '#f59e0b' },
  dnd: { label: 'Do not disturb', color: '#b91c1c' },
  offline: { label: 'Offline', color: '#94a3b8' },
};

/** The statuses a person can choose, in menu order. */
export const CHAT_STATUS_CHOICES = ['available', 'busy', 'away', 'dnd'];

/** What to show for a user: their chosen status while online, otherwise 'offline'. */
export function shownStatus(presence, userId) {
  const entry = presence?.[userId];
  if (!entry || !entry.online) return 'offline';
  return CHAT_STATUS_META[entry.status] ? entry.status : 'available';
}
