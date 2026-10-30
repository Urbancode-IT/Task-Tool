/**
 * Task ordering. newestFirst: by creation time, newest on top (card boards).
 * oldestFirst: the same keys reversed, so tasks read like a queue — the first one
 * added is on top and each new task joins the end (horizontal list).
 *
 * Newest task first: by creation time, then by id (higher = newer) when the time is
 * missing or tied. Returns a new array; the input is left untouched.
 */
const createdMs = (t) => {
  const ms = Date.parse(t?.created_at ?? t?.createdAt ?? '');
  return Number.isFinite(ms) ? ms : 0;
};

const idNum = (t) => Number(t?.id ?? t?.task_id) || 0;

export const newestFirst = (tasks = []) =>
  [...(tasks || [])].sort((a, b) => createdMs(b) - createdMs(a) || idNum(b) - idNum(a));

export const oldestFirst = (tasks = []) =>
  [...(tasks || [])].sort((a, b) => createdMs(a) - createdMs(b) || idNum(a) - idNum(b));
