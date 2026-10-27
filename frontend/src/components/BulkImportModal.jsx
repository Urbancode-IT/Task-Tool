import React, { useRef, useState } from 'react';
import { MdClose, MdDownload, MdUploadFile } from 'react-icons/md';
import { readTaskCsv, taskCsvTemplate, MAX_IMPORT_ROWS } from '../utils/taskCsv';
import { escapeCloses } from '../utils/formKeys';
import './BulkImportModal.css';

/**
 * Bulk import for My Tasks: pick a CSV, check every row in a preview, then import the
 * rows without problems. Tasks are assigned to the current user unless an admin names
 * someone in the Assignee / Assigned by columns.
 *
 *   onImport(rows) — async; rows are API payloads; resolves { created, failed } or null
 *   statuses / statusLabel / projects — what the module accepts (see readTaskCsv)
 *   assignees / assigners — admins only: who the people columns may name
 */
export default function BulkImportModal({ onClose, onImport, statuses, statusLabel, projects, assignees, assigners, currentUser }) {
  const fileRef = useRef(null);
  const [fileName, setFileName] = useState('');
  const [parsed, setParsed] = useState(null); // { rows, error }
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);

  const valid = parsed?.rows?.filter((r) => !r.errors.length) || [];
  const invalid = parsed?.rows?.filter((r) => r.errors.length) || [];

  const downloadTemplate = () => {
    const csv = taskCsvTemplate({ withProject: Boolean(projects), statusExample: statusLabel(statuses?.[0] || 'todo') });
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'seyal-task-import-template.csv';
    a.click();
    URL.revokeObjectURL(url);
  };

  const readFile = async (file) => {
    if (!file) return;
    setResult(null);
    setFileName(file.name);
    if (!/\.csv$/i.test(file.name)) {
      setParsed({ rows: [], error: 'Choose a .csv file. In Excel or Google Sheets use File → Save as / Download → CSV.' });
      return;
    }
    const text = await file.text();
    setParsed(readTaskCsv(text, { statuses, statusLabel, projects, assignees, assigners, currentUser }));
  };

  const runImport = async () => {
    if (!valid.length || busy) return;
    setBusy(true);
    const res = await onImport(valid.map((r) => r.data));
    setBusy(false);
    if (res) setResult(res);
  };

  return (
    <div className="it-updates-modal-backdrop">
      <div
        className="it-updates-modal bim-modal"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={escapeCloses(onClose)}
        role="dialog"
        aria-label="Import tasks"
      >
        <div className="it-updates-modal-header">
          <h2>Import tasks</h2>
          <button type="button" className="it-updates-modal-close" onClick={onClose} aria-label="Close">
            <MdClose size={22} />
          </button>
        </div>

        <div className="bim-body">
          {result ? (
            <div className="bim-result">
              <p>
                <strong>{result.created}</strong> task{result.created === 1 ? '' : 's'} imported and assigned to you.
              </p>
              {result.failed?.length ? (
                <p className="bim-warn">
                  {result.failed.length} could not be saved: rows{' '}
                  {result.failed.map((f) => valid[f.row - 1]?.line ?? f.row).join(', ')}.
                </p>
              ) : null}
              {invalid.length ? (
                <p className="bim-muted">{invalid.length} row(s) with problems were skipped.</p>
              ) : null}
              <div className="it-updates-modal-actions">
                <button type="button" className="it-updates-btn it-updates-btn-primary" onClick={onClose}>
                  Done
                </button>
              </div>
            </div>
          ) : (
            <>
              <p className="bim-intro">
                Add up to {MAX_IMPORT_ROWS} tasks from a CSV file. The template's columns follow a task row:
                Title{projects ? ', Project' : ''}, Status, Due date, Priority, Assignee and Assigned by, then Start
                date and Description. <strong>Title</strong>, <strong>Assignee</strong> and{' '}
                <strong>Assigned by</strong> are required on every row; the rest are optional.{' '}
                {assignees
                  ? 'Name people by email or username, or write "Me" for yourself.'
                  : 'Tasks you import are your own, so write "Me" (or your email) in Assignee and Assigned by.'}
              </p>
              <div className="bim-actions">
                <button type="button" className="it-updates-btn it-updates-btn-secondary" onClick={downloadTemplate}>
                  <MdDownload size={17} /> Download template
                </button>
                <button
                  type="button"
                  className="it-updates-btn it-updates-btn-secondary"
                  onClick={() => fileRef.current?.click()}
                >
                  <MdUploadFile size={17} /> {fileName ? 'Choose another file' : 'Choose CSV file'}
                </button>
                <input
                  ref={fileRef}
                  type="file"
                  accept=".csv,text/csv"
                  hidden
                  onChange={(e) => {
                    readFile(e.target.files?.[0]);
                    e.target.value = '';
                  }}
                />
                {fileName ? <span className="bim-file">{fileName}</span> : null}
              </div>

              {parsed?.error ? <div className="bim-error">{parsed.error}</div> : null}

              {parsed?.rows?.length ? (
                <>
                  <div className="bim-summary">
                    <span className="bim-ok">{valid.length} ready</span>
                    {invalid.length ? <span className="bim-bad">{invalid.length} with problems</span> : null}
                  </div>
                  <div className="bim-table-wrap">
                    <table className="bim-table">
                      <thead>
                        <tr>
                          <th>Row</th>
                          <th>Title</th>
                          {projects ? <th>Project</th> : null}
                          <th>Status</th>
                          <th>Due</th>
                          <th>Priority</th>
                          <th>Assignee</th>
                          <th>Assigned by</th>
                          <th>Problems</th>
                        </tr>
                      </thead>
                      <tbody>
                        {parsed.rows.map((r) => (
                          <tr key={r.line} className={r.errors.length ? 'bim-row-bad' : ''}>
                            <td>{r.line}</td>
                            <td className="bim-title">{r.data.title || '—'}</td>
                            {projects ? <td>{r.show.project || '—'}</td> : null}
                            <td>{r.data.status ? statusLabel(r.data.status) : '—'}</td>
                            <td>{r.data.dueDate || '—'}</td>
                            <td className="bim-cap">{r.data.priority}</td>
                            <td>{r.show.assignee}</td>
                            <td>{r.show.assigner}</td>
                            <td>{r.errors.join('; ') || '✓'}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </>
              ) : null}

              <div className="it-updates-modal-actions">
                <button type="button" className="it-updates-btn it-updates-btn-secondary" onClick={onClose}>
                  Cancel
                </button>
                <button
                  type="button"
                  className="it-updates-btn it-updates-btn-primary"
                  onClick={runImport}
                  disabled={!valid.length || busy}
                >
                  {busy ? 'Importing…' : `Import ${valid.length || ''} task${valid.length === 1 ? '' : 's'}`}
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
