import React, { useMemo } from 'react';
import { MdSearch } from 'react-icons/md';
import MemberPicker from './MemberPicker';
import { EMPTY_EOD_RANGE, eodFilterOptions, eodRangeActive } from '../utils/eodRange';

/**
 * Filters for the EOD Updates page: a search box (author, branch and report text),
 * member and branch pickers built from the loaded reports, and a From / To date range.
 * Each date limits the other, so the range can never be backwards; pick the same day in
 * both to see a single day.
 */
export default function EodDateRange({ value = EMPTY_EOD_RANGE, onChange, reports = [] }) {
  const set = (patch) => onChange({ ...EMPTY_EOD_RANGE, ...value, ...patch });
  const { members, branches } = useMemo(() => eodFilterOptions(reports), [reports]);
  return (
    <div className="it-updates-eod-filter">
      <label className="it-updates-eod-search">
        <MdSearch size={18} aria-hidden="true" />
        <input
          type="search"
          value={value.q || ''}
          onChange={(e) => set({ q: e.target.value })}
          placeholder="Search EOD reports"
          aria-label="Search EOD reports"
        />
      </label>
      {members.length ? (
        // Searchable: type a name to narrow the list; arrow keys and Enter pick.
        <div className="it-updates-eod-member">
          <MemberPicker
            members={members}
            by="id"
            value={value.member || ''}
            onChange={(id) => set({ member: id || '' })}
            emptyLabel="All members"
            placeholder="All members"
            searchPlaceholder="Search members…"
            ariaLabel="Member"
          />
        </div>
      ) : null}
      {branches.length ? (
        <select value={value.branch || ''} onChange={(e) => set({ branch: e.target.value })} aria-label="Branch">
          <option value="">All branches</option>
          {branches.map((b) => (
            <option key={b} value={b}>
              {b}
            </option>
          ))}
        </select>
      ) : null}
      <label className="it-updates-eod-range">
        <span>From</span>
        <input
          type="date"
          value={value.from || ''}
          max={value.to || undefined}
          onChange={(e) => set({ from: e.target.value })}
          aria-label="Reports from"
        />
      </label>
      <label className="it-updates-eod-range">
        <span>To</span>
        <input
          type="date"
          value={value.to || ''}
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
