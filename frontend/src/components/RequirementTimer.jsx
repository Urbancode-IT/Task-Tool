import { useEffect, useState } from 'react';
import { MdPlayArrow, MdPause } from 'react-icons/md';
import itUpdatesApi from '../api/itUpdatesApi';

function formatTime(totalSeconds) {
  const s = Math.max(0, Math.floor(totalSeconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const pad = (n) => String(n).padStart(2, '0');
  return h > 0 ? `${h}:${pad(m)}:${pad(sec)}` : `${pad(m)}:${pad(sec)}`;
}

/**
 * Compact per-requirement timer with start / pause / resume.
 * Props: req, taskId, team, disabled, onUpdate(updatedReq)
 */
export default function RequirementTimer({ req, taskId, team, disabled = false, onUpdate }) {
  const completed = req?.status === 'completed';
  const running = Boolean(req?.timerRunning) && !completed;
  const base = Number(req?.timeSpentSeconds || 0);
  const startedAt = req?.timerStartedAt ? new Date(req.timerStartedAt).getTime() : null;
  const lockedDisabled = disabled || completed;
  const [, setTick] = useState(0);
  const [busy, setBusy] = useState(false);

  // Re-render every second while running so the displayed time advances.
  useEffect(() => {
    if (!running) return undefined;
    const id = setInterval(() => setTick((t) => t + 1), 1000);
    return () => clearInterval(id);
  }, [running]);

  const elapsed = running && startedAt ? base + (Date.now() - startedAt) / 1000 : base;

  const toggle = async () => {
    if (lockedDisabled || busy) return;
    setBusy(true);
    try {
      const action = running ? 'pause' : 'start';
      const res = await itUpdatesApi.requirementTimer(taskId, req.id, action, { team });
      if (res?.data) onUpdate?.(res.data);
    } catch {
      /* ignore */
    } finally {
      setBusy(false);
    }
  };

  const label = completed
    ? 'Completed — timer stopped'
    : disabled
      ? 'Save the task to track time'
      : running
        ? 'Pause'
        : base > 0
          ? 'Resume'
          : 'Start';

  return (
    <span className="req-timer" title={label}>
      <span className={`req-timer-time ${running ? 'req-timer-running' : ''}`}>{formatTime(elapsed)}</span>
      <button
        type="button"
        className={`req-timer-btn ${running ? 'req-timer-btn-pause' : ''}`}
        onClick={toggle}
        disabled={lockedDisabled || busy}
        aria-label={label}
      >
        {running ? <MdPause size={13} /> : <MdPlayArrow size={13} />}
      </button>
    </span>
  );
}
