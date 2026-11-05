import React, { useEffect, useState } from 'react';
import { MdAccessTime } from 'react-icons/md';
import './TaskAge.css';

const MINUTE = 60000;

// One shared clock for every card on screen, ticking once a minute.
const listeners = new Set();
let timer = null;
function subscribe(fn) {
  listeners.add(fn);
  if (!timer) timer = setInterval(() => listeners.forEach((l) => l(Date.now())), MINUTE);
  return () => {
    listeners.delete(fn);
    if (!listeners.size) {
      clearInterval(timer);
      timer = null;
    }
  };
}

/** "45m", "3h 20m", "2d 5h", "3w 2d" — the two largest units. */
function formatAge(ms) {
  const mins = Math.max(0, Math.floor(ms / MINUTE));
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return mins % 60 ? `${hours}h ${mins % 60}m` : `${hours}h`;
  const days = Math.floor(hours / 24);
  if (days < 14) return hours % 24 ? `${days}d ${hours % 24}h` : `${days}d`;
  const weeks = Math.floor(days / 7);
  return days % 7 ? `${weeks}w ${days % 7}d` : `${weeks}w`;
}

/**
 * How long a task card has existed. Open tasks count up live from created_at; a
 * completed task shows the time it took (created → completed) and stops counting.
 */
export default function TaskAge({ task }) {
  const [now, setNow] = useState(Date.now);
  const created = new Date(task?.created_at).getTime();
  const completed = task?.status === 'completed' ? new Date(task?.completed_at).getTime() : NaN;
  const done = Number.isFinite(completed);

  useEffect(() => (done ? undefined : subscribe(setNow)), [done]);

  if (!Number.isFinite(created)) return null;
  const age = formatAge((done ? completed : now) - created);
  const when = new Date(created).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
  const title = done ? `Created ${when} · completed in ${age}` : `Created ${when} · open for ${age}`;

  return (
    <span className={`task-age${done ? ' task-age--done' : ''}`} title={title}>
      <MdAccessTime size={12} aria-hidden="true" />
      {done ? `Done in ${age}` : age}
    </span>
  );
}
