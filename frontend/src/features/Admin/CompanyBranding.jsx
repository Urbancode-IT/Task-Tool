import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  MdExpandMore,
  MdCloudUpload,
  MdDelete,
  MdCheckCircle,
  MdSync,
  MdErrorOutline,
  MdAdd,
  MdClose,
  MdHistory,
} from 'react-icons/md';
import adminApi from '../../api/adminApi';
import { toastSuccess, toastError } from '../../utils/toast';
import { notifyBrandingChanged } from '../../branding/BrandingContext';
import { LABEL_GROUPS, LABEL_DEFAULTS } from '../../branding/labels';
import './CompanyBranding.css';

// ── Validation (mirrors the server-side validators) ──
const RX = {
  email: /^[^\s@]+@[^\s@]+\.[^\s@]+$/,
  url: /^https?:\/\/[^\s.]+\.[^\s]+$/i,
  gst: /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/,
  pan: /^[A-Z]{5}[0-9]{4}[A-Z]$/,
  ifsc: /^[A-Z]{4}0[A-Z0-9]{6}$/,
  swift: /^[A-Z]{6}[A-Z0-9]{2}([A-Z0-9]{3})?$/,
  sac: /^[0-9]{6,8}$/,
  postal: /^[1-9][0-9]{5}$/,
};
const invalid = (val, type) => Boolean(val && String(val).trim()) && !RX[type].test(String(val).trim());

// The seal and a signature are mandatory on an issued invoice; either signature slot
// satisfies that requirement, which is why neither is flagged required on its own.
const ASSET_META = [
  { key: 'logo', label: 'Primary Logo' },
  { key: 'favicon', label: 'Favicon' },
  { key: 'signature', label: 'Director Signature', hint: 'Scanned wet signature' },
  { key: 'digital_signature', label: 'Digital Signature', hint: 'Used in place of the scan' },
  { key: 'seal', label: 'Company Seal', hint: 'Required on every invoice' },
];
const SOCIALS = [
  { key: 'linkedin', label: 'LinkedIn' },
  { key: 'facebook', label: 'Facebook' },
  { key: 'instagram', label: 'Instagram' },
  { key: 'twitter', label: 'Twitter / X' },
  { key: 'youtube', label: 'YouTube' },
  { key: 'website', label: 'Corporate Website' },
];
const VALUE_SUGGESTIONS = [
  'Innovation', 'Integrity', 'Excellence', 'Customer Success', 'Lifelong Learning',
  'Industry Relevance', 'Collaboration', 'Quality First', 'Continuous Improvement', 'Social Impact',
];
const MAX_VALUES = 10;
// Two signatures, split by who receives the mail. `email_signature` keeps its
// original key so existing published profiles carry over as the member template.
const DEFAULT_SIGNATURE =
  '{{sender_name}}\n{{sender_title}}\n{{company_name}}\n{{phone}} · {{website}}';
const DEFAULT_ADMIN_SIGNATURE =
  '{{company_name}} · Automated report\n{{phone}} · {{website}}';

// The two audience defaults. A mail with no override of its own uses these.
const SIGNATURE_SECTIONS = [
  { key: 'email_signature', label: 'Team member mails', covers: 'Default for every mail sent to a member' },
  { key: 'email_signature_admin', label: 'Admin mails', covers: 'Default for every mail sent to admins' },
];

/**
 * Every mail the system sends, with the format it already uses.
 *
 * `subject`, `heading`, `body` and `cta` mirror the sending code in
 * backend/server.js and backend/eodReminder.js; values filled in at send time are
 * shown in braces. Keys must match MAIL_TYPES in backend/mailer.js.
 */
const MAIL_TYPES = [
  {
    key: 'mention', audience: 'member', label: 'Comment mention',
    when: 'Someone @mentions a member in a comment',
    subject: '{who} mentioned you on "{task}"',
    heading: 'You were mentioned in a comment',
    body: ['Hi {name},', '{who} mentioned you in a comment on {task}:', '“the comment text”'],
    cta: 'Open task',
  },
  {
    key: 'task_assigned', audience: 'member', label: 'Task assigned',
    when: 'A task is assigned to a member',
    subject: '{who} assigned you a task: "{task}"',
    heading: 'A task was assigned to you',
    body: ['Hi {name},', '{who} assigned you a new task: {task}.', '“the task description”'],
    cta: 'Open task',
  },
  {
    key: 'task_due_soon', audience: 'member', label: 'Task due soon',
    when: 'A task is approaching its deadline',
    subject: 'Due soon: "{task}"',
    heading: 'Task due soon',
    body: ['Hi {name},', 'The task {task} is due on {date}.'],
    cta: 'Open task',
  },
  {
    key: 'task_overdue', audience: 'member', label: 'Task overdue',
    when: 'A task has passed its deadline',
    subject: 'Overdue: "{task}"',
    heading: 'Task overdue',
    body: ['Hi {name},', 'The task {task} is overdue (was due {date}).'],
    cta: 'Open task',
  },
  {
    key: 'eod_reminder', audience: 'member', label: 'EOD reminder',
    when: 'Evening nudge to file a pending EOD report',
    subject: 'Reminder: your EOD report for {date} is pending',
    heading: 'Reminder: submit your EOD report for {date}',
    body: [
      'Hi {name},',
      'Your EOD report for {date} has not been submitted yet (checked at {time}).',
      'Reports are due by midnight. If the day closes without one, your account is locked until an admin unlocks it.',
    ],
    cta: 'Submit EOD report',
  },
  {
    key: 'eod_pending_report', audience: 'admin', label: 'EOD pending summary',
    when: '8pm list of members still missing an EOD',
    subject: 'EOD not submitted ({count}) — {date}',
    heading: 'EOD not submitted — {date}',
    body: [
      'The following IT team members have not submitted an EOD report for {date} as of 20:00:',
      'table of #, Name, Email',
      'Total pending: {count}.',
    ],
    cta: 'Open {company}',
  },
  {
    key: 'eod_defaulters_locked', audience: 'admin', label: 'EOD defaulters locked',
    when: 'Midnight list of accounts locked for a missed EOD',
    subject: 'EOD defaulters locked ({count}) — {date}',
    heading: 'EOD defaulters locked — {date}',
    body: [
      'These members did not file an EOD report for {date}. Their accounts have been locked and they cannot sign in until an admin revokes the lock.',
      'list of name — email',
      'Total locked: {count}.',
    ],
    cta: 'Open {company}',
  },
];

// A blank profile so every controlled input has a defined value.
const emptyProfile = () => ({
  company_name: '', legal_name: '', tagline: '', website: '',
  mission: '', vision: '', story: '',
  brand_values: [],
  compliance: { registration: '', gst: '', pan: '', sac: '' },
  contact: { official_email: '', accounts_email: '', contact_number: '', website: '' },
  address: { line1: '', line2: '', city: '', state: '', country: '', postal_code: '' },
  bank: { account_name: '', bank_name: '', account_number: '', branch: '', ifsc: '', swift: '' },
  colors: { primary: '#2563eb', secondary: '#0f172a', accent: '#f59e0b' },
  brand_kit: { url: '', guidelines: '' },
  social: { linkedin: '', facebook: '', instagram: '', twitter: '', youtube: '', website: '' },
  email_signature: DEFAULT_SIGNATURE,
  email_signature_admin: DEFAULT_ADMIN_SIGNATURE,
  // Per-mail signature overrides, keyed by MAIL_TYPES[].key. Blank = use the default.
  email_signatures_by_mail: {},
  // Sector/section renames, keyed by label id. Only overrides are stored.
  labels: {},
});

/**
 * `preview` names which panel the right column should show while this section has
 * focus, so the admin only ever sees the preview for what they are editing.
 */
function CollapsibleSection({ title, subtitle, defaultOpen = true, badge, preview, onEnter, children }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <section
      className={`cb-section ${open ? 'open' : ''}`}
      onFocus={() => preview && onEnter?.(preview)}
    >
      <button type="button" className="cb-section-head" onClick={() => setOpen((o) => !o)}>
        <div>
          <span className="cb-section-title">{title}</span>
          {subtitle && <span className="cb-section-sub">{subtitle}</span>}
        </div>
        <div className="cb-section-head-right">
          {badge != null && <span className="cb-badge">{badge}</span>}
          <MdExpandMore className="cb-chevron" size={22} />
        </div>
      </button>
      {open && <div className="cb-section-body">{children}</div>}
    </section>
  );
}

function Field({ label, error, hint, children }) {
  return (
    <label className={`cb-field ${error ? 'cb-field-error' : ''}`}>
      <span className="cb-field-label">{label}</span>
      {children}
      {error ? <span className="cb-field-msg">{error}</span> : hint ? <span className="cb-field-hint">{hint}</span> : null}
    </label>
  );
}

export default function CompanyBranding() {
  const [profile, setProfile] = useState(emptyProfile());
  const [assets, setAssets] = useState({});
  const [loading, setLoading] = useState(true);
  const [ready, setReady] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [saveStatus, setSaveStatus] = useState('idle'); // idle | saving | saved | error | restored
  const [lastUpdated, setLastUpdated] = useState(null);
  const [updatedBy, setUpdatedBy] = useState(null);
  const [activity, setActivity] = useState([]);
  const [newValue, setNewValue] = useState('');
  const [errors, setErrors] = useState({});
  // The pinned column shows one panel at a time. Activity is the resting state; it
  // flips to the preview the moment a field is focused, and the tabs switch back.
  const [sidePanel, setSidePanel] = useState('activity'); // activity | preview
  // Which section's preview to show; set by focusing a section in the form column.
  const [previewSection, setPreviewSection] = useState('brand');
  // Within Email Signatures, only the mail being edited is previewed.
  const [activeMail, setActiveMail] = useState(MAIL_TYPES[0].key);

  const baselineRef = useRef('');

  // Mirrors the invoice sign-off guard: seal plus either signature slot.
  const missingInvoiceAssets = useMemo(() => {
    const m = [];
    if (!assets.seal) m.push('Company Seal');
    if (!assets.signature && !assets.digital_signature) m.push('Director Signature');
    return m;
  }, [assets]);

  const loadActivity = useCallback(() => {
    adminApi.getCompanyActivity().then((r) => setActivity(Array.isArray(r.data) ? r.data : [])).catch(() => {});
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { data } = await adminApi.getCompanyProfile();
        if (cancelled) return;
        const base = emptyProfile();
        const published = data?.data || {};
        const draft = data?.draft || null;
        // Prefer an unpublished draft ("restore unsaved changes"), else the published data.
        const src = draft || published;
        const merged = {
          ...base,
          ...src,
          compliance: { ...base.compliance, ...(src.compliance || {}) },
          contact: { ...base.contact, ...(src.contact || {}) },
          address: { ...base.address, ...(src.address || {}) },
          bank: { ...base.bank, ...(src.bank || {}) },
          colors: { ...base.colors, ...(src.colors || {}) },
          brand_kit: { ...base.brand_kit, ...(src.brand_kit || {}) },
          social: { ...base.social, ...(src.social || {}) },
          brand_values: Array.isArray(src.brand_values) ? src.brand_values : [],
          email_signature: src.email_signature || DEFAULT_SIGNATURE,
          email_signature_admin: src.email_signature_admin || DEFAULT_ADMIN_SIGNATURE,
          email_signatures_by_mail: { ...(src.email_signatures_by_mail || {}) },
          labels: { ...(src.labels || {}) },
        };
        delete merged.assets;
        setProfile(merged);
        setAssets(published.assets || {});
        setLastUpdated(data?.updated_at || null);
        setUpdatedBy(data?.updated_by_name || null);
        baselineRef.current = JSON.stringify(merged);
        if (draft) setSaveStatus('restored');
      } catch {
        toastError('Failed to load the company profile.');
      } finally {
        if (!cancelled) {
          setLoading(false);
          setReady(true);
          loadActivity();
        }
      }
    })();
    return () => { cancelled = true; };
  }, [loadActivity]);

  // Auto-save the draft ~1.5s after the last change (only real edits, never the load).
  useEffect(() => {
    if (!ready) return;
    const cur = JSON.stringify(profile);
    if (cur === baselineRef.current) return;
    setSaveStatus('saving');
    const t = setTimeout(async () => {
      try {
        const { data } = await adminApi.saveCompanyDraft(profile);
        baselineRef.current = cur;
        setSaveStatus('saved');
        if (data?.updated_at) setLastUpdated(data.updated_at);
      } catch {
        setSaveStatus('error');
      }
    }, 1500);
    return () => clearTimeout(t);
  }, [profile, ready]);

  // ── field setters ──
  const setTop = (k, v) => setProfile((p) => ({ ...p, [k]: v }));
  const setNested = (group, k, v) => setProfile((p) => ({ ...p, [group]: { ...p[group], [k]: v } }));
  // A cleared override drops out entirely, so the mail falls back to its audience default.
  const setMailSignature = (key, v) => setProfile((p) => {
    const byMail = { ...p.email_signatures_by_mail };
    if (v.trim()) byMail[key] = v;
    else delete byMail[key];
    return { ...p, email_signatures_by_mail: byMail };
  });
  // A cleared field drops the override entirely, so the coded default returns.
  const setLabel = (id, v) => setProfile((p) => {
    const labels = { ...p.labels };
    if (v.trim()) labels[id] = v;
    else delete labels[id];
    return { ...p, labels };
  });

  // ── brand values CRUD ──
  const addValue = (raw) => {
    const v = String(raw || '').trim();
    if (!v) return;
    setProfile((p) => {
      if (p.brand_values.length >= MAX_VALUES) return p;
      if (p.brand_values.some((x) => x.toLowerCase() === v.toLowerCase())) return p;
      return { ...p, brand_values: [...p.brand_values, v] };
    });
    setNewValue('');
  };
  const removeValue = (i) => setProfile((p) => ({ ...p, brand_values: p.brand_values.filter((_, idx) => idx !== i) }));

  // ── assets ──
  const handleAsset = async (type, file) => {
    if (!file) return;
    if (!file.type.startsWith('image/')) return toastError('Please choose an image file.');
    if (file.size > 2 * 1024 * 1024) return toastError('Image is too large. Please choose one under 2 MB.');
    const dataUrl = await new Promise((res) => {
      const r = new FileReader();
      r.onload = () => res(String(r.result || ''));
      r.readAsDataURL(file);
    });
    try {
      const { data } = await adminApi.uploadCompanyAsset(type, dataUrl);
      setAssets(data?.assets || {});
      toastSuccess('Asset uploaded');
      notifyBrandingChanged();
      loadActivity();
    } catch (e) {
      toastError(e?.response?.data?.message || 'Failed to upload asset');
    }
  };
  const removeAsset = async (type) => {
    try {
      const { data } = await adminApi.deleteCompanyAsset(type);
      setAssets(data?.assets || {});
      notifyBrandingChanged();
      loadActivity();
    } catch {
      toastError('Failed to remove asset');
    }
  };

  // ── validation ──
  const computeErrors = useCallback((p) => {
    const e = {};
    if (!p.company_name.trim()) e.company_name = 'Company name is required.';
    if (invalid(p.contact.official_email, 'email')) e['contact.official_email'] = 'Invalid email.';
    if (invalid(p.contact.accounts_email, 'email')) e['contact.accounts_email'] = 'Invalid email.';
    if (invalid(p.website, 'url')) e.website = 'Must start with http:// or https://';
    if (invalid(p.contact.website, 'url')) e['contact.website'] = 'Invalid URL.';
    if (invalid(p.compliance.gst, 'gst')) e['compliance.gst'] = 'Invalid GSTIN.';
    if (invalid(p.compliance.pan, 'pan')) e['compliance.pan'] = 'Invalid PAN.';
    if (invalid(p.compliance.sac, 'sac')) e['compliance.sac'] = 'SAC must be 6–8 digits.';
    if (invalid(p.bank.ifsc, 'ifsc')) e['bank.ifsc'] = 'Invalid IFSC.';
    if (invalid(p.bank.swift, 'swift')) e['bank.swift'] = 'Invalid SWIFT/BIC.';
    if (invalid(p.address.postal_code, 'postal')) e['address.postal_code'] = 'Invalid postal code.';
    SOCIALS.forEach((s) => { if (invalid(p.social[s.key], 'url')) e[`social.${s.key}`] = 'Invalid URL.'; });
    return e;
  }, []);

  const publish = async () => {
    const e = computeErrors(profile);
    setErrors(e);
    if (Object.keys(e).length) {
      toastError('Please fix the highlighted fields before publishing.');
      return;
    }
    setPublishing(true);
    try {
      const { data } = await adminApi.publishCompanyProfile(profile);
      baselineRef.current = JSON.stringify(profile);
      setSaveStatus('saved');
      if (data?.updated_at) setLastUpdated(data.updated_at);
      toastSuccess('Company profile published');
      // Repaint the shell, login screen, tab title, colours and invoices at once.
      notifyBrandingChanged();
      loadActivity();
    } catch (err) {
      const serverErrors = err?.response?.data?.errors;
      if (Array.isArray(serverErrors)) {
        setErrors(serverErrors.reduce((acc, x) => ({ ...acc, [x.field]: x.message }), {}));
      }
      toastError(err?.response?.data?.message || 'Failed to publish');
    } finally {
      setPublishing(false);
    }
  };

  // ── derived snapshot stats ──
  const touchpoints = useMemo(
    () => SOCIALS.filter((s) => String(profile.social[s.key] || '').trim()).length,
    [profile.social]
  );
  const assetCount = useMemo(() => Object.values(assets).filter(Boolean).length, [assets]);
  const renamedCount = useMemo(() => Object.keys(profile.labels || {}).length, [profile.labels]);
  // Resolves merge fields the same way the server does when sending.
  const previewSignature = useCallback((template) => {
    const map = {
      sender_name: 'Priya Sharma', sender_title: 'Account Manager',
      company_name: profile.company_name || 'Your Company',
      phone: profile.contact.contact_number || '+91 00000 00000',
      website: profile.contact.website || profile.website || 'www.example.com',
    };
    return String(template || '').replace(/\{\{(\w+)\}\}/g, (_, k) => map[k] ?? `{{${k}}}`);
  }, [profile.company_name, profile.contact.contact_number, profile.contact.website, profile.website]);

  const formattedAddress = useMemo(() => {
    const a = profile.address;
    return [a.line1, a.line2, [a.city, a.state].filter(Boolean).join(', '), [a.country, a.postal_code].filter(Boolean).join(' ')]
      .filter((x) => x && String(x).trim()).join('\n');
  }, [profile.address]);

  const fmtTime = (t) => (t ? new Date(t).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }) : '—');

  const saveBadge = {
    idle: { text: 'Up to date', cls: 'ok', icon: <MdCheckCircle size={15} /> },
    saving: { text: 'Saving…', cls: 'busy', icon: <MdSync size={15} className="cb-spin" /> },
    saved: { text: 'Saved', cls: 'ok', icon: <MdCheckCircle size={15} /> },
    error: { text: 'Save failed', cls: 'err', icon: <MdErrorOutline size={15} /> },
    restored: { text: 'Draft restored', cls: 'warn', icon: <MdHistory size={15} /> },
  }[saveStatus];

  if (loading) return <div className="admin-loading">Loading company profile…</div>;

  return (
    <div className="cb-root">
      {/* Snapshot cards */}
      <div className="cb-cards">
        <div className="cb-card">
          <span className="cb-card-label">Company</span>
          <span className="cb-card-value">{profile.company_name || 'Unnamed'}</span>
        </div>
        <div className={`cb-card cb-card-status ${saveBadge.cls}`}>
          <span className="cb-card-label">Auto-save</span>
          <span className="cb-card-value cb-status-value">{saveBadge.icon}{saveBadge.text}</span>
        </div>
        <div className="cb-card">
          <span className="cb-card-label">Brand Values</span>
          <span className="cb-card-value">{profile.brand_values.length} / {MAX_VALUES}</span>
        </div>
        <div className="cb-card">
          <span className="cb-card-label">Digital Touchpoints</span>
          <span className="cb-card-value">{touchpoints}</span>
        </div>
        <div className="cb-card">
          <span className="cb-card-label">Brand Assets</span>
          <span className="cb-card-value">{assetCount} / {ASSET_META.length}</span>
        </div>
        <div className="cb-card">
          <span className="cb-card-label">Last Updated</span>
          <span className="cb-card-value cb-card-small">{fmtTime(lastUpdated)}{updatedBy ? ` · ${updatedBy}` : ''}</span>
        </div>
      </div>

      <div className="cb-toolbar">
        <span className={`cb-save-pill ${saveBadge.cls}`}>{saveBadge.icon}{saveBadge.text}</span>
        <button type="button" className="admin-btn admin-btn-primary" onClick={publish} disabled={publishing}>
          {publishing ? 'Publishing…' : 'Publish'}
        </button>
      </div>

      <div className="cb-layout">
        {/* ── Left: editor. Focusing any field flips the side panel to the preview,
               so the admin sees the effect of what they are typing. ── */}
        <div className="cb-editor" onFocus={() => setSidePanel('preview')}>
          <CollapsibleSection preview="brand" onEnter={setPreviewSection} title="Brand Identity" subtitle="Company information and organization statements">
            <div className="cb-grid-2">
              <Field label="Company / Trading Name *" error={errors.company_name}>
                <input value={profile.company_name} onChange={(e) => setTop('company_name', e.target.value)} placeholder="e.g. Seyal Technologies" />
              </Field>
              <Field label="Legal Name">
                <input value={profile.legal_name} onChange={(e) => setTop('legal_name', e.target.value)} placeholder="Registered legal entity name" />
              </Field>
              <Field label="Brand Tagline">
                <input value={profile.tagline} onChange={(e) => setTop('tagline', e.target.value)} placeholder="A short brand promise" />
              </Field>
              <Field label="Website URL" error={errors.website}>
                <input value={profile.website} onChange={(e) => setTop('website', e.target.value)} placeholder="https://example.com" />
              </Field>
            </div>
            <Field label={`Mission Statement (${profile.mission.length})`}>
              <textarea rows={2} value={profile.mission} onChange={(e) => setTop('mission', e.target.value)} />
            </Field>
            <Field label={`Vision Statement (${profile.vision.length})`}>
              <textarea rows={2} value={profile.vision} onChange={(e) => setTop('vision', e.target.value)} />
            </Field>
            <Field label={`Company Story / Description (${profile.story.length})`}>
              <textarea rows={3} value={profile.story} onChange={(e) => setTop('story', e.target.value)} />
            </Field>

            <div className="cb-values">
              <span className="cb-field-label">Brand Value Pillars ({profile.brand_values.length}/{MAX_VALUES})</span>
              <div className="cb-chips">
                {profile.brand_values.map((v, i) => (
                  <span key={`${v}-${i}`} className="cb-chip">
                    {v}
                    <button type="button" onClick={() => removeValue(i)} aria-label={`Remove ${v}`}><MdClose size={14} /></button>
                  </span>
                ))}
              </div>
              {profile.brand_values.length < MAX_VALUES && (
                <div className="cb-value-add">
                  <input
                    value={newValue}
                    onChange={(e) => setNewValue(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addValue(newValue); } }}
                    placeholder="Add a value and press Enter"
                    list="cb-value-suggestions"
                  />
                  <datalist id="cb-value-suggestions">
                    {VALUE_SUGGESTIONS.map((s) => <option key={s} value={s} />)}
                  </datalist>
                  <button type="button" className="admin-btn admin-btn-secondary" onClick={() => addValue(newValue)}><MdAdd size={16} /> Add</button>
                </div>
              )}
            </div>
          </CollapsibleSection>

          <CollapsibleSection preview="compliance" onEnter={setPreviewSection} title="Regulatory & Compliance" defaultOpen={false}>
            <div className="cb-grid-2">
              <Field label="Registration Number">
                <input value={profile.compliance.registration} onChange={(e) => setNested('compliance', 'registration', e.target.value)} />
              </Field>
              <Field label="GST Number" error={errors['compliance.gst']} hint="15-character GSTIN">
                <input value={profile.compliance.gst} onChange={(e) => setNested('compliance', 'gst', e.target.value.toUpperCase())} />
              </Field>
              <Field label="PAN Number" error={errors['compliance.pan']}>
                <input value={profile.compliance.pan} onChange={(e) => setNested('compliance', 'pan', e.target.value.toUpperCase())} />
              </Field>
              <Field label="SAC Code" error={errors['compliance.sac']}>
                <input value={profile.compliance.sac} onChange={(e) => setNested('compliance', 'sac', e.target.value)} />
              </Field>
            </div>
          </CollapsibleSection>

          <CollapsibleSection preview="address" onEnter={setPreviewSection} title="Contact Information" defaultOpen={false}>
            <div className="cb-grid-2">
              <Field label="Official Email" error={errors['contact.official_email']}>
                <input value={profile.contact.official_email} onChange={(e) => setNested('contact', 'official_email', e.target.value)} />
              </Field>
              <Field label="Accounts Email" error={errors['contact.accounts_email']}>
                <input value={profile.contact.accounts_email} onChange={(e) => setNested('contact', 'accounts_email', e.target.value)} />
              </Field>
              <Field label="Contact Number">
                <input value={profile.contact.contact_number} onChange={(e) => setNested('contact', 'contact_number', e.target.value)} />
              </Field>
              <Field label="Website" error={errors['contact.website']}>
                <input value={profile.contact.website} onChange={(e) => setNested('contact', 'website', e.target.value)} />
              </Field>
            </div>
            <div className="cb-grid-2">
              <Field label="Address Line 1"><input value={profile.address.line1} onChange={(e) => setNested('address', 'line1', e.target.value)} /></Field>
              <Field label="Address Line 2"><input value={profile.address.line2} onChange={(e) => setNested('address', 'line2', e.target.value)} /></Field>
              <Field label="City"><input value={profile.address.city} onChange={(e) => setNested('address', 'city', e.target.value)} /></Field>
              <Field label="State"><input value={profile.address.state} onChange={(e) => setNested('address', 'state', e.target.value)} /></Field>
              <Field label="Country"><input value={profile.address.country} onChange={(e) => setNested('address', 'country', e.target.value)} /></Field>
              <Field label="Postal Code" error={errors['address.postal_code']}>
                <input value={profile.address.postal_code} onChange={(e) => setNested('address', 'postal_code', e.target.value)} />
              </Field>
            </div>
          </CollapsibleSection>

          <CollapsibleSection preview="bank" onEnter={setPreviewSection} title="Bank Details" subtitle="Auto-populated onto invoices" defaultOpen={false}>
            <div className="cb-grid-2">
              <Field label="Account Name"><input value={profile.bank.account_name} onChange={(e) => setNested('bank', 'account_name', e.target.value)} /></Field>
              <Field label="Bank Name"><input value={profile.bank.bank_name} onChange={(e) => setNested('bank', 'bank_name', e.target.value)} /></Field>
              <Field label="Account Number"><input value={profile.bank.account_number} onChange={(e) => setNested('bank', 'account_number', e.target.value)} /></Field>
              <Field label="Branch"><input value={profile.bank.branch} onChange={(e) => setNested('bank', 'branch', e.target.value)} /></Field>
              <Field label="IFSC" error={errors['bank.ifsc']}>
                <input value={profile.bank.ifsc} onChange={(e) => setNested('bank', 'ifsc', e.target.value.toUpperCase())} />
              </Field>
              <Field label="SWIFT" error={errors['bank.swift']}>
                <input value={profile.bank.swift} onChange={(e) => setNested('bank', 'swift', e.target.value.toUpperCase())} />
              </Field>
            </div>
          </CollapsibleSection>

          {/* Keyed on `ready` so it remounts once the assets arrive and can open itself when something mandatory is missing. */}
          <CollapsibleSection preview="brand" onEnter={setPreviewSection}
            key={ready ? 'vi-ready' : 'vi-loading'}
            title="Visual Identity"
            subtitle="Logos, director signature, company seal and brand colours"
            defaultOpen={missingInvoiceAssets.length > 0}
            badge={missingInvoiceAssets.length ? 'Required for invoices' : undefined}
          >
            {missingInvoiceAssets.length > 0 && (
              <p className="cb-asset-warn" role="alert">
                Upload the {missingInvoiceAssets.join(' and ')} below. Invoices cannot be issued or printed until both are present.
              </p>
            )}
            <div className="cb-assets">
              {ASSET_META.map((a) => (
                <div key={a.key} className="cb-asset">
                  <span className="cb-field-label">{a.label}</span>
                  {a.hint && <span className="cb-field-hint">{a.hint}</span>}
                  <div className="cb-asset-box">
                    {assets[a.key] ? (
                      <>
                        <img src={assets[a.key]} alt={a.label} />
                        <button type="button" className="cb-asset-remove" onClick={() => removeAsset(a.key)} aria-label="Remove"><MdDelete size={15} /></button>
                      </>
                    ) : (
                      <label className="cb-asset-drop">
                        <MdCloudUpload size={22} />
                        <span>Upload</span>
                        <input type="file" accept="image/*" hidden onChange={(e) => { handleAsset(a.key, e.target.files?.[0]); e.target.value = ''; }} />
                      </label>
                    )}
                  </div>
                </div>
              ))}
            </div>
            {/* Uploads publish on the spot; colours ride the draft and only go live
                on Publish. Saying so avoids "the logo changed but the theme did not". */}
            <p className="cb-colors-note">
              Logo, signature and seal apply as soon as they are uploaded. Colours are part of the
              profile draft — press <strong>Publish</strong> for them to take effect across the app.
            </p>
            <div className="cb-colors">
              {['primary', 'secondary', 'accent'].map((c) => (
                <Field key={c} label={`${c[0].toUpperCase()}${c.slice(1)} Color`}>
                  <div className="cb-color-row">
                    <input type="color" value={profile.colors[c]} onChange={(e) => setNested('colors', c, e.target.value)} />
                    <input className="cb-color-hex" value={profile.colors[c]} onChange={(e) => setNested('colors', c, e.target.value)} />
                  </div>
                </Field>
              ))}
            </div>
          </CollapsibleSection>

          <CollapsibleSection preview="names" onEnter={setPreviewSection}
            title="Names & Sections"
            subtitle="Rename any sector or section for whitelabeling"
            defaultOpen={false}
            badge={renamedCount || undefined}
          >
            <p className="cb-merge-hint">
              Leave a field blank to keep the standard name shown as its placeholder.
              Renames apply everywhere the section appears, once published.
            </p>
            {LABEL_GROUPS.map((group) => (
              <div key={group.title} className="cb-label-group">
                <span className="cb-field-label">{group.title}</span>
                <span className="cb-field-hint">{group.hint}</span>
                <div className="cb-grid-2">
                  {group.items.map((item) => (
                    <Field key={item.id} label={item.default}>
                      <input
                        value={profile.labels[item.id] ?? ''}
                        maxLength={60}
                        placeholder={item.default}
                        onChange={(e) => setLabel(item.id, e.target.value)}
                      />
                    </Field>
                  ))}
                </div>
              </div>
            ))}
          </CollapsibleSection>

          <CollapsibleSection preview="brand" onEnter={setPreviewSection} title="Brand Kit" defaultOpen={false}>
            <div className="cb-grid-2">
              <Field label="Brand Kit URL"><input value={profile.brand_kit.url} onChange={(e) => setNested('brand_kit', 'url', e.target.value)} placeholder="https://…" /></Field>
              <Field label="External Design Guidelines"><input value={profile.brand_kit.guidelines} onChange={(e) => setNested('brand_kit', 'guidelines', e.target.value)} placeholder="https://…" /></Field>
            </div>
          </CollapsibleSection>

          <CollapsibleSection preview="social" onEnter={setPreviewSection} title="Digital Presence" subtitle="Social media links" defaultOpen={false}>
            <div className="cb-grid-2">
              {SOCIALS.map((s) => (
                <Field key={s.key} label={s.label} error={errors[`social.${s.key}`]}>
                  <input value={profile.social[s.key]} onChange={(e) => setNested('social', s.key, e.target.value)} placeholder="https://…" />
                </Field>
              ))}
            </div>
          </CollapsibleSection>

          <CollapsibleSection preview="mail" onEnter={setPreviewSection} title="Email Signatures" subtitle="One per audience — supports merge fields" defaultOpen={false}>
            <p className="cb-merge-hint">
              Merge fields: {'{{sender_name}}'} {'{{sender_title}}'} {'{{company_name}}'} {'{{phone}}'} {'{{website}}'}
              {' — '}
              {'{{sender_name}}'} and {'{{sender_title}}'} resolve only where a mail has a human sender;
              on automated mails those lines are dropped.
            </p>
            {/* Previews live in the pinned right column so they stay visible while
                the textarea below is being edited. */}
            {SIGNATURE_SECTIONS.map((s) => (
              <div key={s.key} className="cb-sign-block">
                <Field label={s.label} hint={s.covers}>
                  <textarea
                    rows={4}
                    value={profile[s.key]}
                    // Preview a mail that inherits this default, so its effect is visible.
                    onFocus={() => setActiveMail(
                      (MAIL_TYPES.find((m) => m.audience === (s.key === 'email_signature_admin' ? 'admin' : 'member')) || MAIL_TYPES[0]).key
                    )}
                    onChange={(e) => setTop(s.key, e.target.value)}
                  />
                </Field>
              </div>
            ))}

            <p className="cb-sign-divider">Per-mail overrides</p>
            <p className="cb-merge-hint">
              Leave a mail blank to use its audience default above. Anything entered here is
              what goes out on that specific mail.
            </p>
            {MAIL_TYPES.map((m) => (
              <div key={m.key} className="cb-sign-block">
                <Field label={m.label} hint={m.when}>
                  <p className="cb-mail-format">
                    <span>Subject</span> {m.subject}
                  </p>
                  <textarea
                    rows={3}
                    value={profile.email_signatures_by_mail[m.key] ?? ''}
                    onFocus={() => setActiveMail(m.key)}
                    placeholder={
                      m.audience === 'admin'
                        ? 'Uses the Admin mails default'
                        : 'Uses the Team member mails default'
                    }
                    onChange={(e) => setMailSignature(m.key, e.target.value)}
                  />
                </Field>
              </div>
            ))}
          </CollapsibleSection>

        </div>

        {/* ── Right: one preview card, nothing else. History lives in the form column
               so the pinned panel stays a single, quiet thing to glance at. ── */}
        <aside className="cb-side">
          <div className="cb-side-tabs" role="tablist">
            {[['activity', 'Activity'], ['preview', 'Live preview']].map(([key, text]) => (
              <button
                key={key}
                type="button"
                role="tab"
                aria-selected={sidePanel === key}
                className={`cb-side-tab ${sidePanel === key ? 'active' : ''}`}
                onClick={() => setSidePanel(key)}
              >
                {text}
              </button>
            ))}
          </div>

          {/* Only the section being edited is previewed. `previewSection` is set by
              focusing a section in the form column. */}
          {sidePanel === 'preview' ? (
          <div className="cb-preview" style={{ '--cb-primary': profile.colors.primary, '--cb-secondary': profile.colors.secondary, '--cb-accent': profile.colors.accent }}>
            {previewSection === 'brand' && (
              <div className="cb-preview-card">
                <div className="cb-preview-bar" />
                <div className="cb-preview-logo">
                  {assets.logo ? <img src={assets.logo} alt="Logo" /> : <span>{(profile.company_name || 'C')[0]}</span>}
                </div>
                <div className="cb-preview-name">{profile.company_name || 'Your Company'}</div>
                {profile.tagline && <div className="cb-preview-tag">{profile.tagline}</div>}
                <div className="cb-preview-swatches">
                  <span style={{ background: profile.colors.primary }} title="Primary" />
                  <span style={{ background: profile.colors.secondary }} title="Secondary" />
                  <span style={{ background: profile.colors.accent }} title="Accent" />
                </div>
              </div>
            )}

            {previewSection === 'address' && (
              <div className="cb-preview-row">
                <span className="cb-preview-row-label">Formatted address</span>
                <pre>{formattedAddress || '—'}</pre>
              </div>
            )}

            {previewSection === 'compliance' && (
              <div className="cb-preview-row">
                <span className="cb-preview-row-label">Shown on invoices</span>
                <pre>{[
                  profile.compliance.gst && `GSTIN ${profile.compliance.gst}`,
                  profile.compliance.pan && `PAN ${profile.compliance.pan}`,
                  profile.compliance.registration && `Reg. ${profile.compliance.registration}`,
                  profile.compliance.sac && `SAC ${profile.compliance.sac}`,
                ].filter(Boolean).join('\n') || '—'}</pre>
              </div>
            )}

            {previewSection === 'bank' && (
              <div className="cb-preview-row">
                <span className="cb-preview-row-label">Invoice bank block</span>
                <pre>{[
                  profile.bank.account_name && `Account Name: ${profile.bank.account_name}`,
                  profile.bank.bank_name && `Bank: ${profile.bank.bank_name}`,
                  profile.bank.account_number && `A/C: ${profile.bank.account_number}`,
                  profile.bank.branch && `Branch: ${profile.bank.branch}`,
                  profile.bank.ifsc && `IFSC: ${profile.bank.ifsc}`,
                  profile.bank.swift && `SWIFT: ${profile.bank.swift}`,
                ].filter(Boolean).join('\n') || '—'}</pre>
              </div>
            )}

            {previewSection === 'social' && (
              <div className="cb-preview-row">
                <span className="cb-preview-row-label">Digital presence</span>
                <pre>{SOCIALS.map((s) => profile.social[s.key] && `${s.label}: ${profile.social[s.key]}`)
                  .filter(Boolean).join('\n') || '—'}</pre>
              </div>
            )}

            {previewSection === 'names' && (
              <div className="cb-preview-row">
                <span className="cb-preview-row-label">Renamed ({renamedCount})</span>
                <pre>{Object.entries(profile.labels).map(([id, v]) => `${LABEL_DEFAULTS[id] || id} → ${v}`)
                  .join('\n') || 'Nothing renamed yet.'}</pre>
              </div>
            )}

            {/* Each mail in the shape it actually goes out, with its signature resolved
                the way the server resolves it: own template if set, else the audience
                default. Values filled in at send time are shown in braces. */}
            {previewSection === 'mail' && (() => {
              const m = MAIL_TYPES.find((x) => x.key === activeMail) || MAIL_TYPES[0];
              const own = profile.email_signatures_by_mail[m.key];
              return (
                <div className="cb-preview-row">
                  <span className="cb-preview-row-label">
                    {m.label}
                    <em className="cb-mail-source">
                      {own ? 'custom signature' : `inherits ${m.audience === 'admin' ? 'Admin' : 'Team member'} default`}
                    </em>
                  </span>
                  <div className="cb-mail">
                    <div className="cb-mail-subject">{m.subject}</div>
                    <div className="cb-mail-heading">{m.heading}</div>
                    {m.body.map((line, i) => <p key={i} className="cb-mail-line">{line}</p>)}
                    <span className="cb-mail-cta">{m.cta.replace('{company}', profile.company_name || 'Your Company')}</span>
                    <pre className="cb-mail-sign">
                      {previewSignature(
                        own || profile[m.audience === 'admin' ? 'email_signature_admin' : 'email_signature']
                      ) || '—'}
                    </pre>
                  </div>
                </div>
              );
            })()}
          </div>
          ) : (
          <div className="cb-timeline">
            {activity.length === 0 ? (
              <p className="cb-muted cb-timeline-empty">No activity yet.</p>
            ) : (
              <ul>
                {activity.map((a) => (
                  <li key={a.audit_id}>
                    <span className="cb-tl-action">{a.action}</span>
                    <span className="cb-tl-meta">{a.username || 'System'} · {fmtTime(a.created_at)}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
          )}
        </aside>
      </div>
    </div>
  );
}
