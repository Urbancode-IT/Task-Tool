import React, { useState } from 'react';
import { MdClose, MdDelete, MdEdit } from 'react-icons/md';
import { formatUserRowRole } from '../../utils/displayRole';

export function AdminUserDetailModal({ user, mode, onClose, onEdit, onSave, onDelete }) {
  const [form, setForm] = useState({
    username: user?.username ?? '',
    email: user?.email ?? '',
    password: '',
    is_it_developer: user?.is_it_developer ?? false,
    is_it_manager: user?.is_it_manager ?? false,
  });

  const handleSubmit = (e) => {
    e.preventDefault();
    onSave(form);
  };

  if (mode === 'view') {
    return (
      <div className="admin-modal-backdrop" onClick={onClose}>
        <div className="admin-modal" onClick={(e) => e.stopPropagation()}>
          <div className="admin-modal-header">
            <h3>User details</h3>
            <button type="button" className="admin-modal-close" onClick={onClose}>
              <MdClose size={22} />
            </button>
          </div>
          <div className="admin-user-detail-body">
            <div className="admin-user-detail-row">
              <span className="admin-user-detail-label">Username</span>
              <span>{user?.username ?? '—'}</span>
            </div>
            <div className="admin-user-detail-row">
              <span className="admin-user-detail-label">Email</span>
              <span>{user?.email ?? '—'}</span>
            </div>
            <div className="admin-user-detail-row">
              <span className="admin-user-detail-label">Roles</span>
              <span>{formatUserRowRole(user)}</span>
            </div>
          </div>
          <div className="admin-modal-actions">
            <button type="button" className="admin-btn admin-btn-danger-outline" onClick={onDelete}>
              <MdDelete size={18} /> Delete
            </button>
            <div style={{ marginLeft: 'auto', display: 'flex', gap: '0.5rem' }}>
              <button type="button" className="admin-btn admin-btn-secondary" onClick={onClose}>
                Close
              </button>
              <button type="button" className="admin-btn admin-btn-primary" onClick={onEdit}>
                <MdEdit size={18} /> Edit
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="admin-modal-backdrop" onClick={onClose}>
      <div className="admin-modal" onClick={(e) => e.stopPropagation()}>
        <div className="admin-modal-header">
          <h3>Edit user</h3>
          <button type="button" className="admin-modal-close" onClick={onClose}>
            <MdClose size={22} />
          </button>
        </div>
        <form onSubmit={handleSubmit} className="admin-user-form">
          <label>
            Username *
            <input
              value={form.username}
              onChange={(e) => setForm((f) => ({ ...f, username: e.target.value }))}
              required
            />
          </label>
          <label>
            Email (optional)
            <input
              type="email"
              value={form.email}
              onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
            />
          </label>
          <label>
            New password (leave blank to keep)
            <input
              type="password"
              value={form.password}
              onChange={(e) => setForm((f) => ({ ...f, password: e.target.value }))}
              autoComplete="new-password"
            />
          </label>
          <label className="admin-check-label">
            <input
              type="checkbox"
              checked={form.is_it_developer}
              onChange={(e) => setForm((f) => ({ ...f, is_it_developer: e.target.checked }))}
            />
            IT Developer (legacy / task assignee)
          </label>
          <label className="admin-check-label">
            <input
              type="checkbox"
              checked={form.is_it_manager}
              onChange={(e) => setForm((f) => ({ ...f, is_it_manager: e.target.checked }))}
            />
            IT Manager (legacy)
          </label>
          <p className="admin-form-hint">Use &quot;Assign roles&quot; in the table for Consultant, Digital Marketing, and Admin RBAC.</p>
          <div className="admin-modal-actions">
            <button type="button" className="admin-btn admin-btn-secondary" onClick={onClose}>
              Cancel
            </button>
            <button type="submit" className="admin-btn admin-btn-primary">
              Save
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

const ROLE_OPTIONS = [
  { value: 'it_developer', label: 'IT Developer' },
  { value: 'it_manager', label: 'IT Manager' },
  { value: 'consultant', label: 'Consultant' },
  { value: 'digital_marketing', label: 'Digital Marketing' },
  { value: 'admin', label: 'Admin' },
];

export function AdminAddUserModal({ onClose, onSave }) {
  const [form, setForm] = useState({
    username: '',
    email: '',
    password: '',
    roleCode: 'it_developer',
  });

  const handleSubmit = (e) => {
    e.preventDefault();
    onSave(form);
  };

  return (
    <div className="admin-modal-backdrop" onClick={onClose}>
      <div className="admin-modal" onClick={(e) => e.stopPropagation()}>
        <div className="admin-modal-header">
          <h3>Add user</h3>
          <button type="button" className="admin-modal-close" onClick={onClose}>
            <MdClose size={22} />
          </button>
        </div>
        <form onSubmit={handleSubmit} className="admin-user-form">
          <label>
            Username *
            <input
              value={form.username}
              onChange={(e) => setForm((f) => ({ ...f, username: e.target.value }))}
              required
            />
          </label>
          <label>
            Email (optional)
            <input
              type="email"
              value={form.email}
              onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
            />
          </label>
          <label>
            Password *
            <input
              type="password"
              value={form.password}
              onChange={(e) => setForm((f) => ({ ...f, password: e.target.value }))}
              required
              autoComplete="new-password"
            />
          </label>
          <label>
            Primary role *
            <select value={form.roleCode} onChange={(e) => setForm((f) => ({ ...f, roleCode: e.target.value }))}>
              {ROLE_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </label>
          <div className="admin-modal-actions">
            <button type="button" className="admin-btn admin-btn-secondary" onClick={onClose}>
              Cancel
            </button>
            <button type="submit" className="admin-btn admin-btn-primary">
              Add user
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
