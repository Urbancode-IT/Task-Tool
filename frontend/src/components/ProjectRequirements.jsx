import React, { useState } from 'react';
import { MdChecklist, MdAdd, MdClose } from 'react-icons/md';
import itUpdatesApi from '../api/itUpdatesApi';
import { toastError } from '../utils/toast';
import './ProjectRequirements.css';

/**
 * Requirements checklist for a project. Reuses the task form's `.req-section`
 * look. Persists the list to the project's `requirements` column on each change.
 */
export default function ProjectRequirements({ projectId, initial = [], onSaved }) {
  const [reqs, setReqs] = useState(Array.isArray(initial) ? initial : []);
  const [showAdd, setShowAdd] = useState(false);
  const [newTitle, setNewTitle] = useState('');
  const [expanded, setExpanded] = useState(false);

  const total = reqs.length;
  const done = reqs.filter((r) => r.done).length;
  const pct = total ? Math.round((done / total) * 100) : 0;

  const persist = async (next) => {
    const prev = reqs;
    setReqs(next);
    try {
      await itUpdatesApi.updateProject(projectId, { requirements: next });
      onSaved?.();
    } catch (err) {
      setReqs(prev);
      toastError(err?.response?.data?.message || 'Failed to save requirements.');
    }
  };

  const add = () => {
    const t = newTitle.trim();
    if (!t) return;
    persist([...reqs, { title: t, done: false }]);
    setNewTitle('');
    setShowAdd(false);
  };
  const toggle = (i) => persist(reqs.map((r, idx) => (idx === i ? { ...r, done: !r.done } : r)));
  const remove = (i) => persist(reqs.filter((_, idx) => idx !== i));

  const visible = expanded ? reqs : reqs.slice(0, 3);

  return (
    <div className="req-section">
      <div className="req-section-header">
        <div className="req-section-title-row">
          <MdChecklist size={20} className="req-section-icon" />
          <h3 className="req-section-title">Requirements</h3>
          {total > 0 && (
            <span className="req-count-badge">
              {done} of {total} completed
            </span>
          )}
        </div>
        <button
          type="button"
          className="it-updates-btn it-updates-btn-secondary req-add-btn"
          onClick={() => setShowAdd((s) => !s)}
        >
          <MdAdd size={16} />
          {showAdd ? 'Cancel' : 'Add'}
        </button>
      </div>

      {total > 0 && (
        <div className="req-progress-wrap">
          <div className="req-progress-bar">
            <div className="req-progress-fill" style={{ width: `${pct}%` }} />
          </div>
          <span className="req-progress-label">{pct}%</span>
        </div>
      )}

      {showAdd && (
        <div className="proj-req-add">
          <input
            type="text"
            value={newTitle}
            autoFocus
            placeholder="Add a requirement…"
            onChange={(e) => setNewTitle(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.isComposing) {
                e.preventDefault();
                e.stopPropagation();
                add();
              }
            }}
          />
          <button type="button" className="it-updates-btn it-updates-btn-primary" onClick={add}>
            Add
          </button>
        </div>
      )}

      {total === 0 && !showAdd && (
        <p className="req-note">No requirements yet. Click "Add" to create one.</p>
      )}

      {total > 0 && (
        <ul className="proj-req-list">
          {visible.map((r, i) => (
            <li key={i} className={`proj-req-item ${r.done ? 'done' : ''}`}>
              <label className="proj-req-check">
                <input type="checkbox" checked={!!r.done} onChange={() => toggle(i)} />
                <span>{r.title}</span>
              </label>
              <button
                type="button"
                className="proj-req-remove"
                onClick={() => remove(i)}
                title="Remove"
              >
                <MdClose size={15} />
              </button>
            </li>
          ))}
        </ul>
      )}

      {total > 3 && (
        <button
          type="button"
          className="proj-req-more"
          onClick={() => setExpanded((e) => !e)}
        >
          {expanded ? 'Show less' : `Show all ${total}`}
        </button>
      )}
    </div>
  );
}
