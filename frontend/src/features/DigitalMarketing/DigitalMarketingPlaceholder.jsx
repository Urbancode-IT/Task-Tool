import React, { useState } from 'react';
import { MdCampaign, MdAdd, MdCalendarToday, MdEdit, MdDelete } from 'react-icons/md';
import './Placeholder.css';

const STORAGE_KEY = 'digital_marketing_daily_activities';

export default function DigitalMarketingPlaceholder({ currentUser }) {
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [activity, setActivity] = useState('');
  const [channel, setChannel] = useState('');
  const [status, setStatus] = useState('in_progress');
  const [entries, setEntries] = useState(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      return raw ? JSON.parse(raw) : [];
    } catch {
      return [];
    }
  });
  const [editingId, setEditingId] = useState(null);

  const persist = (next) => {
    setEntries(next);
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    } catch {
      // ignore storage issues
    }
  };

  const resetForm = () => {
    setActivity('');
    setChannel('');
    setStatus('in_progress');
    setEditingId(null);
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    if (!activity.trim()) return;

    if (editingId) {
      const next = entries.map((item) =>
        item.id === editingId
          ? { ...item, date, activity: activity.trim(), channel: channel.trim(), status }
          : item
      );
      persist(next);
    } else {
      const newEntry = {
        id: Date.now(),
        date,
        activity: activity.trim(),
        channel: channel.trim(),
        status,
        createdBy: currentUser?.username || currentUser?.email || 'Unknown',
      };
      persist([newEntry, ...entries]);
    }

    resetForm();
  };

  const handleEdit = (entry) => {
    setEditingId(entry.id);
    setDate(entry.date);
    setActivity(entry.activity);
    setChannel(entry.channel || '');
    setStatus(entry.status || 'in_progress');
  };

  const handleDelete = (id) => {
    const next = entries.filter((item) => item.id !== id);
    persist(next);
    if (editingId === id) resetForm();
  };

  const STATUS_LABELS = {
    planned: 'Planned',
    in_progress: 'In Progress',
    completed: 'Completed',
  };

  return (
    <div className="placeholder-module">
      <div className="placeholder-card">
        <div className="placeholder-card-header">
          <div className="placeholder-card-title-row">
            <MdCampaign size={40} className="placeholder-icon" />
            <div>
              <h1 className="placeholder-title">Digital Marketing Dashboard</h1>
              <p className="placeholder-desc">
                Track daily digital marketing activities like campaigns, posts, and optimisations.
              </p>
            </div>
          </div>
          {currentUser && (
            <div className="placeholder-user-pill">
              <span>{currentUser.username || currentUser.email}</span>
            </div>
          )}
        </div>

        <form className="dm-activity-form" onSubmit={handleSubmit}>
          <div className="dm-form-row">
            <label>
              <span>Date</span>
              <div className="dm-input-with-icon">
                <MdCalendarToday size={16} />
                <input
                  type="date"
                  value={date}
                  onChange={(e) => setDate(e.target.value)}
                  required
                />
              </div>
            </label>
            <label>
              <span>Channel</span>
              <input
                type="text"
                value={channel}
                onChange={(e) => setChannel(e.target.value)}
                placeholder="e.g. Instagram, Google Ads, Email"
              />
            </label>
            <label>
              <span>Status</span>
              <select value={status} onChange={(e) => setStatus(e.target.value)}>
                <option value="planned">Planned</option>
                <option value="in_progress">In Progress</option>
                <option value="completed">Completed</option>
              </select>
            </label>
          </div>
          <label className="dm-form-full">
            <span>Activity details</span>
            <textarea
              value={activity}
              onChange={(e) => setActivity(e.target.value)}
              placeholder="Describe what you worked on today (campaigns launched, posts scheduled, optimisation, etc.)"
              rows={3}
              required
            />
          </label>
          <div className="dm-form-actions">
            {editingId && (
              <button
                type="button"
                className="dm-btn dm-btn-secondary"
                onClick={resetForm}
              >
                Cancel edit
              </button>
            )}
            <button type="submit" className="dm-btn dm-btn-primary">
              <MdAdd size={18} />
              <span>{editingId ? 'Update activity' : 'Add activity'}</span>
            </button>
          </div>
        </form>

        <div className="dm-activity-list">
          <h2 className="dm-section-title">Recent daily activities</h2>
          {entries.length === 0 ? (
            <div className="dm-empty-state">
              No activities logged yet. Use the form above to track today&apos;s work.
            </div>
          ) : (
            <ul className="dm-activity-items">
              {entries.map((entry) => (
                <li key={entry.id} className="dm-activity-item">
                  <div className="dm-activity-main">
                    <div className="dm-activity-header">
                      <span className="dm-activity-date">
                        {new Date(entry.date).toLocaleDateString()}
                      </span>
                      {entry.channel && (
                        <span className="dm-activity-channel">{entry.channel}</span>
                      )}
                      <span className={`dm-activity-status status-${entry.status}`}>
                        {STATUS_LABELS[entry.status] || entry.status}
                      </span>
                    </div>
                    <p className="dm-activity-text">{entry.activity}</p>
                    <div className="dm-activity-meta">
                      <span>By {entry.createdBy}</span>
                    </div>
                  </div>
                  <div className="dm-activity-actions">
                    <button
                      type="button"
                      className="dm-icon-btn"
                      onClick={() => handleEdit(entry)}
                      title="Edit"
                    >
                      <MdEdit size={18} />
                    </button>
                    <button
                      type="button"
                      className="dm-icon-btn dm-icon-btn-danger"
                      onClick={() => handleDelete(entry.id)}
                      title="Delete"
                    >
                      <MdDelete size={18} />
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
