import React, { useRef, useState, useEffect } from 'react';
import { MdClose, MdDelete, MdExpandMore } from 'react-icons/md';
import { escapeCloses } from '../utils/formKeys';
import { toastError } from '../utils/toast';
import ModalKebabMenu from './ModalKebabMenu';
import './LeadModal.css';

const SERVICES = [
  'Website Development',
  'E-Commerce Website',
  'CRM Development',
  'ERP Development',
  'LMS Development',
  'Mobile App (Android)',
  'Mobile App (iOS)',
  'Cross Platform App',
  'UI/UX Design',
  'Landing Page',
  'SEO',
  'AI Automation',
  'API Development',
  'Cloud Hosting',
  'Maintenance',
  'Others',
];
const LEAD_SOURCES = [
  'Website', 'Instagram', 'Facebook', 'LinkedIn', 'WhatsApp',
  'Google Ads', 'Reference', 'Cold Call', 'Walk-In', 'Email', 'Others',
];
const INDUSTRIES = [
  'Education', 'Healthcare', 'Finance', 'Retail', 'Manufacturing',
  'Construction', 'Real Estate', 'IT', 'Startup', 'Government', 'Others',
];
const CLIENT_TYPES = ['Individual', 'Startup', 'Small Business', 'Enterprise', 'Government'];

const MIN_DESC = 20;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PHONE_RE = /^[+]?[\d][\d\s-]{6,18}$/;
const URL_RE = /^(https?:\/\/)?([\w-]+\.)+[\w-]{2,}(\/\S*)?$/i;

function emptyLead() {
  return {
    business_name: '',
    client_name: '',
    mobile: '',
    email: '',
    website: '',
    location: '',
    service: '',
    additional_requirement: '',
    lead_source: '',
    industry: '',
    client_type: '',
    description: '',
    status: 'todo',
  };
}

/** Searchable single-select; shows a filterable list, closes on pick / outside click. */
function ServiceSelect({ value, onChange }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const wrapRef = useRef(null);

  useEffect(() => {
    const onDoc = (e) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, []);

  const filtered = SERVICES.filter((s) => s.toLowerCase().includes(query.trim().toLowerCase()));

  return (
    <div className="lead-select" ref={wrapRef}>
      <button type="button" className="lead-select-trigger" onClick={() => setOpen((o) => !o)}>
        <span className={value ? '' : 'lead-select-placeholder'}>
          {value || 'Select a service…'}
        </span>
        <MdExpandMore size={18} />
      </button>
      {open && (
        <div className="lead-select-menu">
          <input
            className="lead-select-search"
            autoFocus
            placeholder="Search services…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          <div className="lead-select-list">
            {filtered.map((s) => (
              <button
                type="button"
                key={s}
                className={`lead-select-option ${s === value ? 'selected' : ''}`}
                onClick={() => {
                  onChange(s);
                  setOpen(false);
                  setQuery('');
                }}
              >
                {s}
              </button>
            ))}
            {filtered.length === 0 && <div className="lead-select-empty">No match</div>}
          </div>
        </div>
      )}
    </div>
  );
}

export default function LeadModal({ lead, statusLabels = {}, statuses = [], onClose, onSave, onDelete, canDelete = false }) {
  const isEdit = Boolean(lead?.id);
  const [form, setForm] = useState(() => {
    if (!lead?.id) return emptyLead();
    const d = lead.lead_details || {};
    return {
      ...emptyLead(),
      ...d,
      business_name: lead.title || lead.task_title || d.business_name || '',
      description: lead.task_description || lead.description || d.description || '',
      status: lead.status || 'todo',
    };
  });
  const [saving, setSaving] = useState(false);
  const [saveState, setSaveState] = useState({ saving: false, saved: false });
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));

  const descLen = form.description.trim().length;

  const validate = () => {
    if (!form.business_name.trim()) return 'Business name is required.';
    if (!form.client_name.trim()) return 'Client name is required.';
    if (!form.mobile.trim()) return 'Mobile number is required.';
    if (!PHONE_RE.test(form.mobile.trim())) return 'Enter a valid mobile number.';
    if (form.email.trim() && !EMAIL_RE.test(form.email.trim())) return 'Enter a valid email address.';
    if (form.website.trim() && !URL_RE.test(form.website.trim())) return 'Enter a valid website URL.';
    if (form.service === 'Others' && !form.additional_requirement.trim())
      return 'Please describe the requirement for "Others".';
    if (descLen < MIN_DESC) return `Requirement description needs at least ${MIN_DESC} characters.`;
    return null;
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (isEdit || saving) return; // editing autosaves; submit only creates new leads
    const err = validate();
    if (err) {
      toastError(err);
      return;
    }
    setSaving(true);
    const ok = await onSave(form, { isEdit });
    setSaving(false);
    if (ok) onClose();
  };

  // Auto-save every edit of an existing lead (debounced, silent, stays open).
  const autoSaveSkip = useRef(true);
  useEffect(() => {
    if (!isEdit) return;
    if (autoSaveSkip.current) {
      autoSaveSkip.current = false;
      return;
    }
    if (validate()) return; // skip while the form is invalid
    const h = setTimeout(async () => {
      setSaveState({ saving: true, saved: false });
      let ok = false;
      try {
        ok = await onSave(form, { isEdit, silent: true });
      } catch {
        ok = false;
      }
      setSaveState({ saving: false, saved: ok });
    }, 700);
    return () => clearTimeout(h);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form]);

  return (
    <div className="it-updates-modal-backdrop">
      <div className="it-updates-modal it-updates-modal-wide" onClick={(e) => e.stopPropagation()}>
        <div className="it-updates-modal-header">
          <h2>{isEdit ? 'Lead details' : 'Add lead'}</h2>
          <div className="it-updates-modal-header-actions">
            {isEdit && canDelete && onDelete && (
              <ModalKebabMenu
                actions={[
                  { label: 'Delete lead', icon: <MdDelete size={16} />, onClick: onDelete, danger: true },
                ]}
              />
            )}
            <button type="button" className="it-updates-modal-close" onClick={onClose}>
              <MdClose size={22} />
            </button>
          </div>
        </div>
        <form onSubmit={handleSubmit} onKeyDown={escapeCloses(onClose)} className="it-updates-modal-form">
          <label>
            Business name *
            <input value={form.business_name} onChange={(e) => set('business_name', e.target.value)} required />
          </label>
          <label>
            Client name *
            <input value={form.client_name} onChange={(e) => set('client_name', e.target.value)} required />
          </label>
          <label>
            Mobile number *
            <input
              type="tel"
              value={form.mobile}
              onChange={(e) => set('mobile', e.target.value)}
              placeholder="+91 98765 43210"
              required
            />
          </label>
          <label>
            Email address
            <input
              type="email"
              value={form.email}
              onChange={(e) => set('email', e.target.value)}
              placeholder="name@company.com"
            />
          </label>
          <label>
            Company website
            <input
              type="url"
              value={form.website}
              onChange={(e) => set('website', e.target.value)}
              placeholder="https://company.com"
            />
          </label>
          <label>
            Company location (City / Country)
            <input value={form.location} onChange={(e) => set('location', e.target.value)} />
          </label>

          <label className="it-updates-form-row-full">
            Requested service
            <ServiceSelect value={form.service} onChange={(v) => set('service', v)} />
          </label>
          {form.service === 'Others' && (
            <label className="it-updates-form-row-full">
              Additional requirement
              <textarea
                rows={2}
                value={form.additional_requirement}
                onChange={(e) => set('additional_requirement', e.target.value)}
                placeholder="Describe the service you need…"
              />
            </label>
          )}

          <label>
            Lead source
            <select value={form.lead_source} onChange={(e) => set('lead_source', e.target.value)}>
              <option value="">Select…</option>
              {LEAD_SOURCES.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </label>
          <label>
            Industry
            <select value={form.industry} onChange={(e) => set('industry', e.target.value)}>
              <option value="">Select…</option>
              {INDUSTRIES.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </label>
          <label>
            Client type
            <select value={form.client_type} onChange={(e) => set('client_type', e.target.value)}>
              <option value="">Select…</option>
              {CLIENT_TYPES.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </label>
          <label>
            Stage
            <select value={form.status} onChange={(e) => set('status', e.target.value)}>
              {(statuses.length ? statuses : ['todo']).map((s) => (
                <option key={s} value={s}>{statusLabels[s] ?? s}</option>
              ))}
            </select>
          </label>

          <label className="it-updates-form-row-full">
            Requirement description *
            <textarea
              rows={4}
              value={form.description}
              onChange={(e) => set('description', e.target.value)}
              placeholder="Describe the client's requirement (min 20 characters)…"
            />
            <span className={`lead-char-counter ${descLen < MIN_DESC ? 'short' : 'ok'}`}>
              {descLen}/{MIN_DESC} min
            </span>
          </label>

          <div className="it-updates-modal-actions">
            {isEdit ? (
              <span className="it-updates-autosave-status">
                {saveState.saving
                  ? 'Saving…'
                  : saveState.saved
                    ? 'All changes saved'
                    : 'Changes save automatically'}
              </span>
            ) : (
              <button type="submit" className="it-updates-btn it-updates-btn-primary" disabled={saving}>
                {saving ? 'Saving…' : 'Add lead'}
              </button>
            )}
          </div>
        </form>
      </div>
    </div>
  );
}
