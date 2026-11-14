import React, { useMemo, useState } from 'react';
import { MdAdd } from 'react-icons/md';
import itUpdatesApi from '../api/itUpdatesApi';
import EodDateRange from './EodDateRange';
import EodReportCard from './EodReportCard';
import { filterEodByRange, eodRangeActive, EMPTY_EOD_RANGE } from '../utils/eodRange';

const EOD_PAGE_SIZE = 20;

// Comment thread on a report goes to the EOD-report comment endpoints.
const EOD_COMMENT_API = {
  getComments: (id) => itUpdatesApi.getEodReportComments(id),
  addComment: (id, body) => itUpdatesApi.addEodReportComment(id, body),
  updateComment: (id, commentId, body) => itUpdatesApi.updateEodReportComment(id, commentId, body),
  deleteComment: (id, commentId, userId) => itUpdatesApi.deleteEodReportComment(id, commentId, userId),
  likeComment: (id, commentId, userId) => itUpdatesApi.likeEodReportComment(id, commentId, userId),
};

/**
 * The "EOD Updates" page shared by every team board: Submit EOD button, search /
 * member / branch / date filters, and the team's reports as cards (like, comment,
 * edit, delete), 20 per page. The board owns the report list and reloads it after a
 * submit; this panel filters, pages and renders it.
 *
 * onPageChange: called after Previous / Next so the board can scroll its list to the top.
 */
export default function EodUpdatesPanel({ reports = [], setReports, currentUser, members = [], onSubmitClick, onPageChange }) {
  const [range, setRangeState] = useState(EMPTY_EOD_RANGE);
  const [rawPage, setPage] = useState(0);
  // A filter change starts again at page 1.
  const setRange = (next) => {
    setRangeState(next);
    setPage(0);
  };

  const filtered = useMemo(() => filterEodByRange(reports, range), [reports, range]);
  const pageCount = Math.max(1, Math.ceil(filtered.length / EOD_PAGE_SIZE));
  // Stay on a real page when the list shrinks (a report deleted, a reload).
  const page = Math.min(rawPage, pageCount - 1);
  const paged = useMemo(() => filtered.slice(page * EOD_PAGE_SIZE, (page + 1) * EOD_PAGE_SIZE), [filtered, page]);

  const isAdmin = (currentUser?.permissions || []).includes('admin.access');
  const mentionMembers = useMemo(
    () => members.map((u) => ({ id: u.user_id, name: u.username, image: u.profile_image })),
    [members]
  );
  const goTo = (next) => {
    setPage(next);
    onPageChange?.();
  };

  return (
    <section className="it-updates-panel it-updates-panel-full">
      <div className="it-updates-panel-header">
        <button type="button" className="it-updates-btn it-updates-btn-primary" onClick={onSubmitClick}>
          <MdAdd size={18} />
          Submit EOD
        </button>
        <EodDateRange value={range} onChange={setRange} reports={reports} />
      </div>
      <p className="it-updates-eod-intro">
        View end-of-day reports submitted by the team. Use the <strong>EOD</strong> button in the header to submit your own report.
      </p>
      <div className="it-updates-eod-list">
        {filtered.length === 0 ? (
          <div className="it-updates-empty">
            {eodRangeActive(range)
              ? 'No EOD reports match these filters.'
              : 'No EOD reports yet. Click "Submit EOD" or the EOD button in the header to add one.'}
          </div>
        ) : (
          paged.map((report) => (
            <EodReportCard
              key={report.report_id ?? report.id}
              report={report}
              currentUser={currentUser}
              isAdmin={isAdmin}
              members={mentionMembers}
              commentApi={EOD_COMMENT_API}
              onUpdate={(updated) => setReports((prev) => prev.map((r) => (r.report_id === updated.report_id ? updated : r)))}
              onDelete={(id) => setReports((prev) => prev.filter((r) => r.report_id !== id))}
            />
          ))
        )}
      </div>
      {filtered.length > EOD_PAGE_SIZE && (
        <div className="it-updates-pagination">
          <span className="it-updates-pagination-info">
            {page * EOD_PAGE_SIZE + 1}–{Math.min((page + 1) * EOD_PAGE_SIZE, filtered.length)} of {filtered.length}
          </span>
          <div className="it-updates-pagination-actions">
            <button
              type="button"
              className="it-updates-btn it-updates-btn-secondary"
              onClick={() => goTo(Math.max(0, page - 1))}
              disabled={page === 0}
            >
              Previous
            </button>
            <span className="it-updates-pagination-page">
              Page {page + 1} of {pageCount}
            </span>
            <button
              type="button"
              className="it-updates-btn it-updates-btn-secondary"
              onClick={() => goTo(Math.min(pageCount - 1, page + 1))}
              disabled={page >= pageCount - 1}
            >
              Next
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
