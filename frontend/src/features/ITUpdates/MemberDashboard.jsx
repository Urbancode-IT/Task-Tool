import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  ReferenceLine, Cell, PieChart, Pie, Legend,
} from 'recharts';
import { MdEventBusy, MdEventAvailable } from 'react-icons/md';
import itUpdatesApi from '../../api/itUpdatesApi';
import PeriodFilter from '../../components/PeriodFilter';
import ProjectLogo from '../../components/ProjectLogo';
import { resolvePeriodRange } from '../../utils/taskPeriod';
import { toastError, toastSuccess } from '../../utils/toast';
import './MemberDashboard.css';

const WORK_HOURS_PER_DAY = 8;
const PROJECT_COLORS = ['#6366f1', '#06b6d4', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899', '#64748b'];

const pad = (n) => String(n).padStart(2, '0');
const toYmd = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const isWeekend = (ymd) => {
  const day = new Date(`${ymd}T00:00:00`).getDay();
  return day === 0 || day === 6;
};
const round1 = (n) => Math.round(n * 10) / 10;

/**
 * Per-member dashboard: projects assigned, worked hours per day vs the 8h/day
 * baseline, sortable by period (week/month/custom), with a self-service leave
 * toggle. Members see only themselves; admins can pick any member.
 */
export default function MemberDashboard({ currentUser, members = [], isAdmin = false }) {
  const myId = String(currentUser?.id ?? currentUser?.user_id ?? '');
  const [selectedUserId, setSelectedUserId] = useState(myId);
  const [period, setPeriod] = useState({ preset: 'week', from: '', to: '' });
  const [data, setData] = useState({ daily: [], byProject: [], projects: [], leaves: [], totalSeconds: 0, taskStats: { total: 0, completed: 0, in_progress: 0, todo: 0, review: 0, overdue: 0 } });
  const [loading, setLoading] = useState(false);
  const [leaveDate, setLeaveDate] = useState(toYmd(new Date()));
  const [savingLeave, setSavingLeave] = useState(false);

  const [from, to] = resolvePeriodRange(period);

  const load = useCallback(async () => {
    if (!selectedUserId) return;
    setLoading(true);
    try {
      const res = await itUpdatesApi.getMemberDashboard(selectedUserId, {
        from: from || undefined,
        to: to || undefined,
      });
      setData(res.data || { daily: [], byProject: [], projects: [], leaves: [], totalSeconds: 0, taskStats: { total: 0, completed: 0, in_progress: 0, todo: 0, review: 0, overdue: 0 } });
    } catch {
      toastError('Failed to load dashboard');
      setData({ daily: [], byProject: [], projects: [], leaves: [], totalSeconds: 0, taskStats: { total: 0, completed: 0, in_progress: 0, todo: 0, review: 0, overdue: 0 } });
    } finally {
      setLoading(false);
    }
  }, [selectedUserId, from, to]);

  useEffect(() => { load(); }, [load]);

  // Build a continuous day series across the selected range (capped); for the
  // unbounded "Schedule" preset, fall back to the days that actually have entries.
  const days = useMemo(() => {
    const dailyMap = Object.fromEntries(data.daily.map((d) => [d.date, d.seconds]));
    const leaveSet = new Set(data.leaves || []);
    if (!from || !to) {
      return (data.daily || []).map((d) => ({
        date: d.date,
        hours: round1(d.seconds / 3600),
        leave: leaveSet.has(d.date),
      }));
    }
    const out = [];
    const cur = new Date(`${from}T00:00:00`);
    const end = new Date(`${to}T00:00:00`);
    let guard = 0;
    while (cur <= end && guard < 370) {
      const ymd = toYmd(cur);
      out.push({ date: ymd, hours: round1((dailyMap[ymd] || 0) / 3600), leave: leaveSet.has(ymd) });
      cur.setDate(cur.getDate() + 1);
      guard += 1;
    }
    return out;
  }, [data, from, to]);

  const totalHours = useMemo(() => round1((data.totalSeconds || 0) / 3600), [data.totalSeconds]);
  const workingDays = useMemo(
    () => days.filter((d) => !d.leave && !isWeekend(d.date)).length,
    [days]
  );
  const capacityHours = workingDays * WORK_HOURS_PER_DAY;
  const utilization = capacityHours > 0 ? Math.round((totalHours / capacityHours) * 100) : 0;
  const leaveCount = days.filter((d) => d.leave).length;

  const projectChart = useMemo(
    () => (data.byProject || [])
      .filter((p) => p.seconds > 0)
      .map((p) => ({ name: p.project_name, value: round1(p.seconds / 3600) })),
    [data.byProject]
  );

  const ts = data.taskStats || { total: 0, completed: 0, in_progress: 0, todo: 0, review: 0, overdue: 0 };
  const completionRate = ts.total > 0 ? Math.round((ts.completed / ts.total) * 100) : 0;

  const onLeaveDay = (data.leaves || []).includes(leaveDate);
  const canEditLeave = isAdmin || selectedUserId === myId;

  const toggleLeave = async () => {
    if (!leaveDate || savingLeave) return;
    setSavingLeave(true);
    try {
      if (onLeaveDay) {
        await itUpdatesApi.clearLeave(leaveDate, { user_id: selectedUserId });
        toastSuccess('Leave removed');
      } else {
        await itUpdatesApi.setLeave({ leave_date: leaveDate, user_id: selectedUserId });
        toastSuccess('Marked as leave');
      }
      await load();
    } catch {
      toastError('Failed to update leave');
    } finally {
      setSavingLeave(false);
    }
  };

  const xTickFmt = (ymd) => ymd?.slice(5); // MM-DD

  return (
    <section className="it-updates-panel">
      {/* Controls */}
      <div className="md-toolbar">
        {isAdmin && (
          <label className="md-field">
            Member
            <select value={selectedUserId} onChange={(e) => setSelectedUserId(e.target.value)}>
              {!members.some((m) => String(m.user_id) === myId) && (
                <option value={myId}>Me</option>
              )}
              {members.map((m) => (
                <option key={m.user_id} value={String(m.user_id)}>
                  {m.username ?? m.assignee}
                </option>
              ))}
            </select>
          </label>
        )}
        <PeriodFilter value={period} onChange={setPeriod} />
        {canEditLeave && (
          <div className="md-leave">
            <input type="date" value={leaveDate} onChange={(e) => setLeaveDate(e.target.value)} />
            <button
              type="button"
              className={`it-updates-btn ${onLeaveDay ? 'it-updates-btn-secondary' : 'it-updates-btn-primary'}`}
              onClick={toggleLeave}
              disabled={savingLeave}
            >
              {onLeaveDay ? <MdEventAvailable size={16} /> : <MdEventBusy size={16} />}
              {onLeaveDay ? 'Cancel leave' : 'Mark leave'}
            </button>
          </div>
        )}
      </div>

      {/* Summary cards */}
      <div className="md-cards">
        <div className="md-card"><span className="md-card-label">Hours worked</span><span className="md-card-value">{totalHours}h</span></div>
        <div className="md-card"><span className="md-card-label">Capacity ({WORK_HOURS_PER_DAY}h × {workingDays}d)</span><span className="md-card-value">{capacityHours}h</span></div>
        <div className="md-card">
          <span className="md-card-label">Utilization</span>
          <span className="md-card-value" style={{ color: utilization > 100 ? '#ef4444' : utilization >= 60 ? '#10b981' : '#f59e0b' }}>{utilization}%</span>
        </div>
        <div className="md-card"><span className="md-card-label">Leave days</span><span className="md-card-value">{leaveCount}</span></div>
      </div>

      {/* Task insight cards */}
      <div className="md-cards">
        <div className="md-card md-card-accent" style={{ borderLeft: '4px solid #6366f1' }}>
          <span className="md-card-label">Tasks assigned</span>
          <span className="md-card-value">{ts.total}</span>
        </div>
        <div className="md-card md-card-accent" style={{ borderLeft: '4px solid #10b981' }}>
          <span className="md-card-label">Completed</span>
          <span className="md-card-value" style={{ color: '#10b981' }}>{ts.completed}</span>
          <span className="md-card-sub">{completionRate}% done</span>
        </div>
        <div className="md-card md-card-accent" style={{ borderLeft: '4px solid #f59e0b' }}>
          <span className="md-card-label">In progress</span>
          <span className="md-card-value" style={{ color: '#f59e0b' }}>{ts.in_progress}</span>
          {ts.review > 0 && <span className="md-card-sub">{ts.review} in review/rework</span>}
        </div>
        <div className="md-card md-card-accent" style={{ borderLeft: `4px solid ${ts.overdue > 0 ? '#ef4444' : '#cbd5e1'}` }}>
          <span className="md-card-label">Overdue</span>
          <span className="md-card-value" style={{ color: ts.overdue > 0 ? '#ef4444' : '#1e293b' }}>{ts.overdue}</span>
          {ts.todo > 0 && <span className="md-card-sub">{ts.todo} not started</span>}
        </div>
      </div>

      {/* Completion progress */}
      {ts.total > 0 && (
        <div className="md-progress-wrap">
          <div className="md-progress-head">
            <span>Task completion</span>
            <span>{ts.completed} / {ts.total} ({completionRate}%)</span>
          </div>
          <div className="md-progress-track">
            <div className="md-progress-fill" style={{ width: `${completionRate}%` }} />
          </div>
        </div>
      )}

      {loading && <div className="it-updates-loading-bar" />}

      {/* Daily hours chart */}
      <div className="md-chart-box">
        <h3 className="md-chart-title">Daily worked hours vs {WORK_HOURS_PER_DAY}h baseline</h3>
        {days.length === 0 ? (
          <p className="req-note">No tracked time in this period.</p>
        ) : (
          <ResponsiveContainer width="100%" height={300}>
            <BarChart data={days} margin={{ top: 8, right: 16, bottom: 4, left: -8 }}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} />
              <XAxis dataKey="date" tickFormatter={xTickFmt} fontSize={11} />
              <YAxis fontSize={11} allowDecimals />
              <Tooltip
                formatter={(v) => [`${v}h`, 'Worked']}
                labelFormatter={(l) => `${l}${(data.leaves || []).includes(l) ? ' · On leave' : ''}`}
              />
              <ReferenceLine y={WORK_HOURS_PER_DAY} stroke="#ef4444" strokeDasharray="4 4" label={{ value: `${WORK_HOURS_PER_DAY}h`, position: 'right', fontSize: 11, fill: '#ef4444' }} />
              <Bar dataKey="hours" radius={[4, 4, 0, 0]}>
                {days.map((d) => (
                  <Cell key={d.date} fill={d.leave ? '#cbd5e1' : d.hours > WORK_HOURS_PER_DAY ? '#ef4444' : '#6366f1'} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        )}
      </div>

      <div className="md-split">
        {/* Time per project */}
        <div className="md-chart-box">
          <h3 className="md-chart-title">Time by project</h3>
          {projectChart.length === 0 ? (
            <p className="req-note">No project time in this period.</p>
          ) : (
            <ResponsiveContainer width="100%" height={260}>
              <PieChart>
                <Pie data={projectChart} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={90} label={(e) => `${e.name}: ${e.value}h`} labelLine={false}>
                  {projectChart.map((entry, i) => (
                    <Cell key={entry.name} fill={PROJECT_COLORS[i % PROJECT_COLORS.length]} />
                  ))}
                </Pie>
                <Tooltip formatter={(v) => [`${v}h`, 'Worked']} />
                <Legend wrapperStyle={{ fontSize: 12 }} />
              </PieChart>
            </ResponsiveContainer>
          )}
        </div>

        {/* Assigned projects */}
        <div className="md-chart-box">
          <h3 className="md-chart-title">Assigned projects</h3>
          {(data.projects || []).length === 0 ? (
            <p className="req-note">Not assigned to any project.</p>
          ) : (
            <ul className="md-project-list">
              {data.projects.map((p) => (
                <li key={p.id} className="md-project-item">
                  <ProjectLogo src={p.logo} name={p.name} size={22} />
                  <span className="md-project-name">{p.name}</span>
                  <span className="md-project-status">{p.status ?? 'active'}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </section>
  );
}
