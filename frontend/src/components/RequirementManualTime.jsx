import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { MdMoreTime } from 'react-icons/md';
import itUpdatesApi from '../api/itUpdatesApi';

const POP_WIDTH = 264;
const HOURS = Array.from({ length: 12 }, (_, i) => i + 1);
const MINUTES = Array.from({ length: 60 }, (_, i) => String(i).padStart(2, '0'));

/** Parse a 24h 'HH:MM' string into { hour: '1'..'12', minute: '00'..'59', ampm }. */
function parse24(value) {
  if (!value || !/^\d{2}:\d{2}$/.test(value)) return { hour: '', minute: '', ampm: 'AM' };
  const [H, M] = value.split(':').map(Number);
  const ampm = H < 12 ? 'AM' : 'PM';
  const h12 = H % 12 === 0 ? 12 : H % 12;
  return { hour: String(h12), minute: String(M).padStart(2, '0'), ampm };
}

/** Clean 12-hour time entry using selects (no native spinner glitch). Emits 24h 'HH:MM' or ''. */
function TimeField({ value, onChange }) {
  const init = parse24(value);
  const [hour, setHour] = useState(init.hour);
  const [minute, setMinute] = useState(init.minute);
  const [ampm, setAmPm] = useState(init.ampm);

  // Reset internal parts when the parent clears the value.
  useEffect(() => {
    if (!value) {
      setHour('');
      setMinute('');
      setAmPm('AM');
    }
  }, [value]);

  const emit = (h, m, ap) => {
    if (h && m) {
      let H = Number(h) % 12;
      if (ap === 'PM') H += 12;
      onChange(`${String(H).padStart(2, '0')}:${m}`);
    } else {
      onChange('');
    }
  };

  return (
    <div className="req-manual-time">
      <select
        className="req-manual-select"
        value={hour}
        onChange={(e) => { setHour(e.target.value); emit(e.target.value, minute, ampm); }}
        aria-label="Hour"
      >
        <option value="">HH</option>
        {HOURS.map((n) => (
          <option key={n} value={String(n)}>{String(n).padStart(2, '0')}</option>
        ))}
      </select>
      <span className="req-manual-colon">:</span>
      <select
        className="req-manual-select"
        value={minute}
        onChange={(e) => { setMinute(e.target.value); emit(hour, e.target.value, ampm); }}
        aria-label="Minute"
      >
        <option value="">MM</option>
        {MINUTES.map((m) => (
          <option key={m} value={m}>{m}</option>
        ))}
      </select>
      <select
        className="req-manual-select req-manual-ampm"
        value={ampm}
        onChange={(e) => { setAmPm(e.target.value); emit(hour, minute, e.target.value); }}
        aria-label="AM or PM"
      >
        <option value="AM">AM</option>
        <option value="PM">PM</option>
      </select>
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
    if (!from || !to) { setError('Choose both From and To times.'); return; }
    if (to <= from) { setError('To must be later than From.'); return; }
    setBusy(true);
    try {
      const res = await itUpdatesApi.requirementManualTime(taskId, req.id, { from, to, team });
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
