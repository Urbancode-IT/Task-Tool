/**
 * Period / time-interval filtering for tasks.
 *
 * A period value looks like: { preset: 'all'|'today'|'week'|'month', from: '', to: '' }
 * A custom `from`/`to` (yyyy-mm-dd) always overrides the preset.
 */

export const PERIOD_PRESETS = [
  { key: 'all', label: 'All' },
  { key: 'today', label: 'Today' },
  { key: 'week', label: 'This week' },
  { key: 'month', label: 'This month' },
];

export const EMPTY_PERIOD = { preset: 'all', from: '', to: '' };

const pad = (n) => String(n).padStart(2, '0');
const toYmd = (date) => `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;

/** Resolve a preset key to an inclusive [fromYmd, toYmd] range, or null for 'all'. */
export function presetRange(preset, now = new Date()) {
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  switch (preset) {
    case 'today':
      return [toYmd(today), toYmd(today)];
    case 'week': {
      // Week starts Monday.
      const day = (today.getDay() + 6) % 7; // 0 = Monday
      const monday = new Date(today);
      monday.setDate(today.getDate() - day);
      const sunday = new Date(monday);
      sunday.setDate(monday.getDate() + 6);
      return [toYmd(monday), toYmd(sunday)];
    }
    case 'month': {
      const first = new Date(today.getFullYear(), today.getMonth(), 1);
      const last = new Date(today.getFullYear(), today.getMonth() + 1, 0);
      return [toYmd(first), toYmd(last)];
    }
    default:
      return null;
  }
}

/** Pick the most relevant date off a task for period filtering. */
export function getTaskPeriodDate(task) {
  const raw =
    task?.task_date ??
    task?.dueDate ??
    task?.due_date ??
    task?.target_date ??
    task?.publish_date ??
    null;
  return raw ? String(raw).slice(0, 10) : null;
}

/** Resolve a period value to an inclusive [from, to] range (either side may be ''). */
export function resolvePeriodRange(period) {
  if (!period) return ['', ''];
  let from = period.from || '';
  let to = period.to || '';
  if (!from && !to && period.preset && period.preset !== 'all') {
    const r = presetRange(period.preset);
    if (r) [from, to] = r;
  }
  return [from, to];
}

/** True when the task's date falls inside the period. */
export function taskInPeriod(task, period) {
  const [from, to] = resolvePeriodRange(period);
  if (!from && !to) return true;
  const d = getTaskPeriodDate(task);
  if (!d) return false;
  if (from && d < from) return false;
  if (to && d > to) return false;
  return true;
}
