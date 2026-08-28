/**
 * Due-date helpers for task cards (local calendar day).
 */

/** How many days ahead still counts as "upcoming" rather than simply far off. */
export const UPCOMING_WINDOW_DAYS = 7;

function parseDueToLocalMidnight(task) {
  const raw = task?.dueDate ?? task?.due_date;
  if (raw == null || String(raw).trim() === '') return null;
  const ymd = String(raw).trim().slice(0, 10);
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(ymd);
  if (m) {
    const y = Number(m[1]);
    const mo = Number(m[2]);
    const d = Number(m[3]);
    if (!y || !mo || !d) return null;
    return new Date(y, mo - 1, d);
  }
  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) return null;
  parsed.setHours(0, 0, 0, 0);
  return parsed;
}

function todayLocal() {
  const t = new Date();
  t.setHours(0, 0, 0, 0);
  return t;
}

/**
 * Whole days from today to the task's due date: negative when overdue, 0 when due
 * today, positive when ahead. Null when the task has no usable due date.
 *
 * Both sides are snapped to local midnight first, so the answer is a calendar-day
 * count and cannot drift by one because of the time of day or a timezone offset.
 */
export function daysUntilDue(task) {
  const due = parseDueToLocalMidnight(task);
  if (!due) return null;
  due.setHours(0, 0, 0, 0);
  return Math.round((due - todayLocal()) / 86400000);
}

/** Completed work is never chased, whatever its date says. */
function isOpen(task) {
  return Boolean(task) && task.status !== 'completed';
}

/** True when task has a due date before today and is not completed. */
export function isTaskOverdue(task) {
  if (!isOpen(task)) return false;
  const d = daysUntilDue(task);
  return d !== null && d < 0;
}

/** Open and due on today's date. */
export function isDueToday(task) {
  if (!isOpen(task)) return false;
  return daysUntilDue(task) === 0;
}

/**
 * Needs attention now: overdue or due today. These are grouped together because to
 * someone looking at their dashboard both mean "this is my problem today".
 */
export function isDueNow(task) {
  if (!isOpen(task)) return false;
  const d = daysUntilDue(task);
  return d !== null && d <= 0;
}

/** Open and due within the next `days` days, but not yet due. */
export function isUpcoming(task, days = UPCOMING_WINDOW_DAYS) {
  if (!isOpen(task)) return false;
  const d = daysUntilDue(task);
  return d !== null && d > 0 && d <= days;
}

/** "3 days overdue" / "Due today" / "Due tomorrow" / "Due in 4 days". */
export function dueLabel(task) {
  const d = daysUntilDue(task);
  if (d === null) return '';
  if (d < 0) {
    const n = Math.abs(d);
    return n === 1 ? '1 day overdue' : `${n} days overdue`;
  }
  if (d === 0) return 'Due today';
  if (d === 1) return 'Due tomorrow';
  return `Due in ${d} days`;
}

/**
 * Split a task list into the two dashboard buckets, each sorted by urgency — most
 * overdue first, then soonest due.
 */
export function splitByDue(tasks, days = UPCOMING_WINDOW_DAYS) {
  const list = Array.isArray(tasks) ? tasks : [];
  const byUrgency = (a, b) => (daysUntilDue(a) ?? 0) - (daysUntilDue(b) ?? 0);
  return {
    dueNow: list.filter((t) => isDueNow(t)).sort(byUrgency),
    upcoming: list.filter((t) => isUpcoming(t, days)).sort(byUrgency),
  };
}
