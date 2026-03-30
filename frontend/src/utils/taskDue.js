/**
 * Due-date helpers for task cards (local calendar day).
 */

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

/** True when task has a due date before today and is not completed. */
export function isTaskOverdue(task) {
  if (!task || task.status === 'completed') return false;
  const due = parseDueToLocalMidnight(task);
  if (!due) return false;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  due.setHours(0, 0, 0, 0);
  return due < today;
}
