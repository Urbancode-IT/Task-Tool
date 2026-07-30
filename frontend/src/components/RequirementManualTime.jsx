import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { MdMoreTime } from 'react-icons/md';
import itUpdatesApi from '../api/itUpdatesApi';

const POP_WIDTH = 264;
/** Converts a user-entered time (e.g. 9:30 AM or 14:30) to 24-hour HH:MM. */
function normaliseTypedTime(value) {
  const match = String(value || '').trim().toUpperCase().match(/^(\d{1,2})(?::([0-5]\d))?\s*(AM|PM)?$/);
  if (!match) return '';
  const [, hourText, minuteText = '00', meridiem] = match;
  let hour = Number(hourText);
  if (meridiem) {
    if (hour < 1 || hour > 12) return '';
    hour %= 12;
    if (meridiem === 'PM') hour += 12;
  } else if (hour > 23) {
    return '';
  }
  return `${String(hour).padStart(2, '0')}:${minuteText}`;
}

function parse24(value) {
  if (!/^\d{2}:\d{2}$/.test(String(value || ''))) return { hour: '', minute: '', meridiem: '' };
  const [hours, minutes] = value.split(':').map(Number);
  return {
    hour: String(hours % 12 || 12).padStart(2, '0'),
    minute: String(minutes).padStart(2, '0'),
    meridiem: hours < 12 ? 'AM' : 'PM',
  };
}

/** Three typed time boxes: HH → MM → AM/PM. Focus advances as each part is completed. */
function TimeField({ value, onChange }) {
  const initial = parse24(value);
  const [hour, setHour] = useState(initial.hour);
  const [minute, setMinute] = useState(initial.minute);
  const [meridiem, setMeridiem] = useState(initial.meridiem || 'AM');
  const hourRef = useRef(null);
  const minuteRef = useRef(null);
  const meridiemRef = useRef(null);

  const emit = (nextHour, nextMinute, nextMeridiem) => {
    const h = Number(nextHour);
    const m = Number(nextMinute);
    if (!nextHour || !nextMinute || !nextMeridiem || h < 1 || h > 12 || m > 59) {
      onChange('');
      return;
    }
    let hours24 = h % 12;
    if (nextMeridiem === 'PM') hours24 += 12;
    onChange(`${String(hours24).padStart(2, '0')}:${String(m).padStart(2, '0')}`);
  };

  const moveBack = (event, previousRef) => {
    if (event.key === 'Backspace' && !event.currentTarget.value) {
      previousRef?.current?.focus();
    }
  };

  return (
    <div className="req-manual-time">
      <input
        ref={hourRef}
        className="req-manual-input req-manual-hour"
        type="text"
        value={hour}
        onChange={(e) => {
          const next = e.target.value.replace(/\D/g, '').slice(0, 2);
          setHour(next);
          emit(next, minute, meridiem);
          if (next.length === 2) minuteRef.current?.focus();
        }}
        placeholder="HH"
        inputMode="numeric"
        maxLength={2}
        autoComplete="off"
        aria-label="Hour"
      />
      <span className="req-manual-colon">:</span>
      <input
        ref={minuteRef}
        className="req-manual-input req-manual-minute"
        type="text"
        value={minute}
        onChange={(e) => {
          const next = e.target.value.replace(/\D/g, '').slice(0, 2);
          setMinute(next);
          emit(hour, next, meridiem);
          if (next.length === 2) meridiemRef.current?.focus();
        }}
        onKeyDown={(e) => moveBack(e, hourRef)}
        placeholder="MM"
        inputMode="numeric"
        maxLength={2}
        autoComplete="off"
        aria-label="Minute"
      />
      <button
        ref={meridiemRef}
        className="req-manual-meridiem"
        type="button"
        onClick={() => {
          const next = meridiem === 'AM' ? 'PM' : 'AM';
          setMeridiem(next);
          emit(hour, minute, next);
        }}
        onKeyDown={(e) => moveBack(e, minuteRef)}
        aria-label="AM or PM"
        title="Click to switch between AM and PM"
      >
        {meridiem}
      </button>
    </div>
  );
}

/**
 * Per-requirement "set worked time" control, for when the timer was not used.
 * Renders a small icon button; clicking opens a From/To popover that sets the
 * requirement's worked time for the task's date (date comes from the task).
 *
 * The popover is portalled to <body> with fixed positioning so it is not clipped
 * by the scrollable modal or the requirements table's overflow:hidden.
 * Props: req, taskId, team, disabled, onUpdate(updatedReq)
 */
export default function RequirementManualTime({ req, taskId, team, disabled = false, onUpdate }) {
  const completed = req?.status === 'completed';
  const lockedDisabled = disabled || completed;
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState({ top: 0, left: 0 });
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const btnRef = useRef(null);
  const popRef = useRef(null);

  const updatePos = useCallback(() => {
    const el = btnRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const left = Math.max(8, Math.min(r.right - POP_WIDTH, window.innerWidth - POP_WIDTH - 8));
    setPos({ top: r.bottom + 8, left });
  }, []);

  useEffect(() => {
    if (!open) return undefined;
    updatePos();
    const onScroll = () => updatePos();
    const onKey = (e) => { if (e.key === 'Escape') setOpen(false); };
    const onDocClick = (e) => {
      if (btnRef.current?.contains(e.target)) return;
      if (popRef.current?.contains(e.target)) return;
      setOpen(false);
    };
    window.addEventListener('resize', updatePos);
    window.addEventListener('scroll', onScroll, true);
    document.addEventListener('keydown', onKey);
    document.addEventListener('mousedown', onDocClick);
    return () => {
      window.removeEventListener('resize', updatePos);
      window.removeEventListener('scroll', onScroll, true);
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('mousedown', onDocClick);
    };
  }, [open, updatePos]);

  const reset = () => { setFrom(''); setTo(''); setError(''); };
  const close = () => { reset(); setOpen(false); };

  const save = async () => {
    setError('');
    const fromTime = normaliseTypedTime(from);
    const toTime = normaliseTypedTime(to);
    if (!from.trim() || !to.trim()) { setError('Enter both From and To times.'); return; }
    if (!fromTime || !toTime) { setError('Use a time such as 9:30 AM or 14:30.'); return; }
    if (toTime <= fromTime) { setError('To must be later than From.'); return; }
    setBusy(true);
    try {
      const res = await itUpdatesApi.requirementManualTime(taskId, req.id, { from: fromTime, to: toTime, team });
      if (res?.data) onUpdate?.(res.data);
      close();
    } catch (e) {
      setError(e?.response?.data?.message || 'Failed to save time.');
    } finally {
      setBusy(false);
    }
  };

  const title = completed
    ? 'Completed — time locked'
    : disabled
      ? 'Save the task to set time'
      : 'Set worked time (From / To)';

  return (
    <span className="req-manual">
      <button
        ref={btnRef}
        type="button"
        className="req-manual-btn"
        onClick={() => {
          if (lockedDisabled) return;
          reset();
          setOpen((v) => !v);
        }}
        disabled={lockedDisabled}
        aria-label="Set worked time"
        title={title}
      >
        <MdMoreTime size={14} />
      </button>
      {open &&
        createPortal(
          <div
            ref={popRef}
            className="req-manual-pop"
            role="dialog"
            aria-label="Set worked time"
            style={{ position: 'fixed', top: pos.top, left: pos.left, width: POP_WIDTH }}
          >
            <div className="req-manual-pop-head">
              <MdMoreTime size={16} />
              <span>Set worked time</span>
            </div>
            <p className="req-manual-help">Type <strong>HH</strong>, then <strong>MM</strong>. Click <strong>AM</strong> to switch it to <strong>PM</strong>.</p>
            <div className="req-manual-row">
              <span className="req-manual-label">From</span>
              <TimeField value={from} onChange={setFrom} />
            </div>
            <div className="req-manual-row">
              <span className="req-manual-label">To</span>
              <TimeField value={to} onChange={setTo} />
            </div>
            {error && <div className="req-manual-error">{error}</div>}
            <div className="req-manual-actions">
              <button type="button" className="req-manual-cancel" onClick={close}>
                Cancel
              </button>
              <button type="button" className="req-manual-save" onClick={save} disabled={busy}>
                {busy ? 'Saving…' : 'Save'}
              </button>
            </div>
          </div>,
          document.body
        )}
    </span>
  );
}
