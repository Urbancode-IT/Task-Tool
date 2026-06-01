import React, { useEffect, useRef, useState } from 'react';
import { MdCalendarToday, MdExpandMore } from 'react-icons/md';
import { PERIOD_PRESETS } from '../utils/taskPeriod';

/**
 * Period / time-interval filter rendered as a dropdown button. The menu lists the
 * presets and a final "Custom range…" option that reveals From–To date inputs.
 * value: { preset, from, to } ; onChange receives the next value.
 */
export default function PeriodFilter({ value, onChange }) {
  const v = value || { preset: 'all', from: '', to: '' };
  const customActive = Boolean(v.from || v.to);
  const [open, setOpen] = useState(false);
  const [showCustom, setShowCustom] = useState(customActive);
  const wrapRef = useRef(null);

  useEffect(() => {
    const onClickOutside = (e) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener('mousedown', onClickOutside);
    return () => document.removeEventListener('mousedown', onClickOutside);
  }, []);

  const currentLabel = customActive
    ? v.from && v.to
      ? `${v.from} → ${v.to}`
      : v.from
        ? `From ${v.from}`
        : `Until ${v.to}`
    : PERIOD_PRESETS.find((p) => p.key === (v.preset || 'all'))?.label || 'All';

  const selectPreset = (preset) => {
    onChange({ preset, from: '', to: '' });
    setShowCustom(false);
    setOpen(false);
  };

  const setRange = (patch) => onChange({ ...v, preset: 'custom', ...patch });

  return (
    <div className="it-updates-period-filter" ref={wrapRef}>
      <button
        type="button"
        className="it-updates-period-trigger"
        onClick={() => setOpen((o) => !o)}
      >
        <MdCalendarToday size={15} className="it-updates-period-trigger-icon" />
        <span className="it-updates-period-trigger-label">{currentLabel}</span>
        <MdExpandMore size={16} />
      </button>
      {open && (
        <div className="it-updates-period-menu">
          {PERIOD_PRESETS.map((p) => (
            <button
              key={p.key}
              type="button"
              className={
                'it-updates-period-option' +
                (!customActive && (v.preset || 'all') === p.key ? ' active' : '')
              }
              onClick={() => selectPreset(p.key)}
            >
              {p.label}
            </button>
          ))}
          <button
            type="button"
            className={'it-updates-period-option' + (customActive ? ' active' : '')}
            onClick={() => setShowCustom((s) => !s)}
          >
            Custom range…
          </button>
          {showCustom && (
            <div className="it-updates-period-range">
              <label>
                From
                <input
                  type="date"
                  value={v.from || ''}
                  onChange={(e) => setRange({ from: e.target.value })}
                />
              </label>
              <label>
                To
                <input
                  type="date"
                  value={v.to || ''}
                  onChange={(e) => setRange({ to: e.target.value })}
                />
              </label>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
