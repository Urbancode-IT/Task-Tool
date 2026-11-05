import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { MdChevronLeft, MdChevronRight, MdRefresh, MdSync, MdSyncProblem, MdWarningAmber } from 'react-icons/md';
import itUpdatesApi from '../../api/itUpdatesApi';
import { toastError } from '../../utils/toast';
import './Attendance.css';

// Today as yyyy-mm-dd in India time, the day the team works to.
const todayIst = () => new Date(Date.now() + 330 * 60000).toISOString().slice(0, 10);
const shiftDay = (ymd, delta) => {
  const d = new Date(`${ymd}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + delta);
  return d.toISOString().slice(0, 10);
};
const longDate = (ymd) =>
  new Date(`${ymd}T00:00:00Z`).toLocaleDateString(undefined, {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  });
const ago = (iso) => {
  if (!iso) return null;
  const mins = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins} min ago`;
  const hours = Math.round(mins / 60);
  if (hours < 48) return `${hours} h ago`;
  return new Date(iso).toLocaleString();
};

const KIND_LABEL = { leave: 'On leave', absent: 'Absent' };
const SOURCE_LABEL = { inout: 'In Out', manual: 'Seyal' };

function Person({ person }) {
  const initial = (person.username || '?')[0].toUpperCase();
  return (
    <span className="att-person">
      {person.profile_image ? (
        <img className="att-avatar" src={person.profile_image} alt="" />
      ) : (
        <span className="att-avatar">{initial}</span>
      )}
      <span className="att-person-text">
        <strong>{person.username}</strong>
        <span>{person.email || '—'}</span>
      </span>
    </span>
  );
}

/**
 * Admin → Attendance. Shows who is on leave or absent on a day, whether that came from
 * the In Out attendance app or was entered in Seyal, and the state of the In Out link
 * (last update received, people In Out sent whose email matches no Seyal user).
 */
export default function Attendance() {
  const [date, setDate] = useState(todayIst);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [kindFilter, setKindFilter] = useState('');

  const load = useCallback(async (day) => {
    setLoading(true);
    try {
      const { data: res } = await itUpdatesApi.getAttendance(day);
      setData(res);
    } catch (err) {
      toastError(err?.response?.data?.message || 'Could not load attendance');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load(date);
  }, [date, load]);

  const away = useMemo(() => data?.away || [], [data]);
  const counts = useMemo(
    () => ({
      leave: away.filter((p) => p.kind === 'leave').length,
      absent: away.filter((p) => p.kind === 'absent').length,
      inout: away.filter((p) => p.source === 'inout').length,
    }),
    [away]
  );
  const shown = kindFilter ? away.filter((p) => p.kind === kindFilter) : away;
  const sync = data?.sync || {};
  const configured = data?.configured !== false;

  return (
    <section className="admin-panel admin-panel-inline att">
      <div className="att-toolbar">
        <div className="att-day">
          <button type="button" className="att-icon-btn" onClick={() => setDate((d) => shiftDay(d, -1))} aria-label="Previous day">
            <MdChevronLeft size={22} />
          </button>
          <input type="date" value={date} onChange={(e) => e.target.value && setDate(e.target.value)} aria-label="Day" />
          <button type="button" className="att-icon-btn" onClick={() => setDate((d) => shiftDay(d, 1))} aria-label="Next day">
            <MdChevronRight size={22} />
          </button>
          {date !== todayIst() ? (
            <button type="button" className="admin-btn" onClick={() => setDate(todayIst())}>
              Today
            </button>
          ) : null}
        </div>
        <button type="button" className="admin-btn" onClick={() => load(date)} disabled={loading}>
          <MdRefresh size={18} /> Refresh
        </button>
      </div>

      <h3 className="att-title">{longDate(date)}</h3>

      <div className={`att-sync ${!configured ? 'off' : sync.last_received_at ? 'ok' : 'idle'}`}>
        {configured ? <MdSync size={20} /> : <MdSyncProblem size={20} />}
        <div>
          <strong>In Out connection</strong>
          <span>
            {!configured
              ? 'Not switched on: INOUT_WEBHOOK_SECRET is not set on the server.'
              : sync.last_received_at
                ? `Last update received ${ago(sync.last_received_at)} · ${sync.last_24h} update(s) in the last 24 hours.`
                : 'Switched on, but nothing has been received from In Out yet.'}
          </span>
        </div>
      </div>

      {sync.unmatched?.length ? (
        <div className="att-unmatched">
          <MdWarningAmber size={20} />
          <div>
            <strong>In Out sent attendance for people Seyal could not match</strong>
            <span>
              Their email in In Out matches no Seyal user, so their leave is not shown here. Make the email the same in both
              apps: {sync.unmatched.join(', ')}
            </span>
          </div>
        </div>
      ) : null}

      <div className="att-cards">
        <button type="button" className={`att-card${kindFilter === '' ? ' active' : ''}`} onClick={() => setKindFilter('')}>
          <span>Away</span>
          <strong>{away.length}</strong>
        </button>
        <button type="button" className={`att-card leave${kindFilter === 'leave' ? ' active' : ''}`} onClick={() => setKindFilter('leave')}>
          <span>On leave</span>
          <strong>{counts.leave}</strong>
        </button>
        <button type="button" className={`att-card absent${kindFilter === 'absent' ? ' active' : ''}`} onClick={() => setKindFilter('absent')}>
          <span>Absent</span>
          <strong>{counts.absent}</strong>
        </button>
        <div className="att-card plain">
          <span>From In Out</span>
          <strong>{counts.inout}</strong>
        </div>
      </div>

      {loading && !data ? (
        <div className="admin-loading">Loading…</div>
      ) : shown.length ? (
        <div className="admin-table-wrap">
          <table className="admin-table">
            <thead>
              <tr>
                <th>Person</th>
                <th>Branch</th>
                <th>Status</th>
                <th>Reason / type</th>
                <th>From</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((p) => (
                <tr key={p.user_id}>
                  <td>
                    <Person person={p} />
                  </td>
                  <td>{p.branch || '—'}</td>
                  <td>
                    <span className={`att-badge ${p.kind}`}>{KIND_LABEL[p.kind] || p.kind}</span>
                  </td>
                  <td>{p.note || '—'}</td>
                  <td>
                    <span className={`att-source ${p.source}`}>{SOURCE_LABEL[p.source] || p.source}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="admin-empty">
          {kindFilter ? `Nobody is ${KIND_LABEL[kindFilter].toLowerCase()} on this day.` : 'Everyone is in on this day. Nobody is on leave or absent.'}
        </div>
      )}
    </section>
  );
}
