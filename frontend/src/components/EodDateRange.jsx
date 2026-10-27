import React from 'react';
import { EMPTY_EOD_RANGE, eodRangeActive } from '../utils/eodRange';

/**
 * From / To date filter for the EOD Updates page. Each date limits the other, so the
 * range can never be backwards; pick the same day in both to see a single day.
 */
export default function EodDateRange({ value = EMPTY_EOD_RANGE, onChange }) {
  const set = (patch) => onChange({ ...value, ...patch });
  return (
    <div className="it-updates-eod-filter">
      <label className="it-updates-eod-range">
        <span>From</span>
        <input
          type="date"
          value={value.from}
          max={value.to || undefined}
          onChange={(e) => set({ from: e.target.value })}
          aria-label="Reports from"
        />
      </label>
      <label className="it-updates-eod-range">
        <span>To</span>
        <input
          type="date"
          value={value.to}
          min={value.from || undefined}
          onChange={(e) => set({ to: e.target.value })}
          aria-label="Reports to"
        />
      </label>
      {eodRangeActive(value) && (
        <button type="button" className="it-updates-btn it-updates-btn-secondary" onClick={() => onChange(EMPTY_EOD_RANGE)}>
          Clear
        </button>
      )}
    </div>
  );
}
