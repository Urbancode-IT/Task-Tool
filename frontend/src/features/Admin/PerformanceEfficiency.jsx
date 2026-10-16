import React, { useEffect, useState } from 'react';
import adminApi from '../../api/adminApi';

const TEAM_LABELS = {
  it: 'Projects',
  consultant: 'Consultants',
  creative_team: 'Creative Team',
  social_media: 'Social Media',
  legal_finance: 'Legal & Finance',
  director: 'Management',
};

const scoreClass = (s) => (s >= 85 ? 'perf-score-good' : s >= 60 ? 'perf-score-fair' : 'perf-score-poor');

const fmtDate = (ymd) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(ymd || '');
  if (!m) return '—';
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])).toLocaleDateString(undefined, {
    day: 'numeric',
    month: 'short',
  });
};

/**
 * Efficiency score per member for tasks completed in the selected period. Each task
 * starts at 100 and loses points for revisions after the first (Rework returns plus
 * due-date extensions) and for each day it finished after its original due date.
 * The rules come from the server so this text and the maths never disagree.
 */
export default function PerformanceEfficiency({ filters, refreshKey }) {
  const [expanded, setExpanded] = useState(() => new Set());
  const { from, to, team } = filters || {};
  // The report is stored with the request it answers; until the answer for the current
  // filters arrives, the table shows as loading.
  const requestKey = JSON.stringify([from, to, team, refreshKey]);
  const [result, setResult] = useState({ key: null, report: null });
  const loading = result.key !== requestKey;
  const report = result.report;

  useEffect(() => {
    let alive = true;
    const params = {};
    if (from) params.from = from;
    if (to) params.to = to;
    if (team) params.team = team;
    adminApi
      .getPerformanceReport(params)
      .then((res) => alive && setResult({ key: requestKey, report: res.data || null }))
      .catch(() => alive && setResult({ key: requestKey, report: null }));
    return () => {
      alive = false;
    };
  }, [from, to, team, requestKey]);

  const rules = report?.rules;
  const members = report?.members || [];
  const toggle = (id) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  return (
    <div className="perf-eff">
      <h3 className="perf-eff-title">Efficiency</h3>
      <p className="admin-panel-subtitle">
        Tasks completed between the two dates. Each starts at {rules?.start ?? 100} points and loses{' '}
        {rules?.revisionPenalty ?? 10} for every revision after the first — a return to Rework or a later
        due date — and {rules?.lateDayPenalty ?? 5} for each day it finished after its original due date.
      </p>
      {loading ? (
        <div className="admin-loading">Loading…</div>
      ) : !members.length ? (
        <div className="it-updates-empty">No tasks completed in this period.</div>
      ) : (
        <div className="admin-table-wrap">
          <table className="admin-table">
            <thead>
              <tr>
                <th>Member</th>
                <th className="inv-num">Completed</th>
                <th className="inv-num">On time</th>
                <th className="inv-num">Reworks</th>
                <th className="inv-num">Due extensions</th>
                <th className="inv-num">Days late</th>
                <th className="inv-num">Score</th>
                <th className="admin-th-actions"></th>
              </tr>
            </thead>
            <tbody>
              {members.map((m) => {
                const open = expanded.has(m.user_id);
                return (
                  <React.Fragment key={m.user_id}>
                    <tr>
                      <td>{m.username}</td>
                      <td className="inv-num">{m.completed}</td>
                      <td className="inv-num">
                        {m.on_time}/{m.completed}
                      </td>
                      <td className="inv-num">{m.rework_count}</td>
                      <td className="inv-num">{m.extension_count}</td>
                      <td className="inv-num">{m.days_late}</td>
                      <td className="inv-num">
                        <span className={`perf-score ${scoreClass(m.score)}`}>{m.score}</span>
                      </td>
                      <td className="admin-td-actions">
                        <button
                          type="button"
                          className="it-updates-btn it-updates-btn-secondary"
                          onClick={() => toggle(m.user_id)}
                        >
                          {open ? 'Hide' : 'Details'}
                        </button>
                      </td>
                    </tr>
                    {open && (
                      <tr className="admin-time-detail-row">
                        <td colSpan={8}>
                          <div className="admin-time-detail-label">
                            Lowest-scoring tasks{m.completed > m.tasks.length ? ` (${m.tasks.length} of ${m.completed})` : ''}
                          </div>
                          <table className="perf-task-table">
                            <thead>
                              <tr>
                                <th>Task</th>
                                <th>Original due</th>
                                <th>Final due</th>
                                <th>Completed</th>
                                <th className="inv-num">Reworks</th>
                                <th className="inv-num">Extensions</th>
                                <th className="inv-num">Days late</th>
                                <th className="inv-num">Score</th>
                              </tr>
                            </thead>
                            <tbody>
                              {m.tasks.map((t) => (
                                <tr key={`${t.team}-${t.task_id}`}>
                                  <td>
                                    {t.title}
                                    <span className="admin-time-sub"> · {TEAM_LABELS[t.team] || t.team}</span>
                                  </td>
                                  <td>{fmtDate(t.original_due)}</td>
                                  <td>{fmtDate(t.due_date)}</td>
                                  <td>{fmtDate(t.completed_on)}</td>
                                  <td className="inv-num">{t.rework_count}</td>
                                  <td className="inv-num">{t.extension_count}</td>
                                  <td className="inv-num">{t.days_late}</td>
                                  <td className="inv-num">
                                    <span className={`perf-score ${scoreClass(t.score)}`}>{t.score}</span>
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
