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

const ASSET_META = [
  { key: 'logo', label: 'Primary Logo' },
  { key: 'favicon', label: 'Favicon' },
  { key: 'signature', label: 'Authorized Signature' },
  { key: 'digital_signature', label: 'Digital Signature' },
  { key: 'seal', label: 'Company Seal' },
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
const DEFAULT_SIGNATURE =
  '{{sender_name}}\n{{sender_title}}\n{{company_name}}\n{{phone}} · {{website}}';

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
});

function CollapsibleSection({ title, subtitle, defaultOpen = true, badge, children }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <section className={`cb-section ${open ? 'open' : ''}`}>
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

  const baselineRef = useRef('');

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
      loadActivity();
    } catch (e) {
      toastError(e?.response?.data?.message || 'Failed to upload asset');
    }
  };
  const removeAsset = async (type) => {
    try {
      const { data } = await adminApi.deleteCompanyAsset(type);
      setAssets(data?.assets || {});
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
  const signaturePreview = useMemo(() => {
    const map = {
      sender_name: 'Priya Sharma', sender_title: 'Account Manager',
      company_name: profile.company_name || 'Your Company',
      phone: profile.contact.contact_number || '+91 00000 00000',
      website: profile.contact.website || profile.website || 'www.example.com',
    };
    return String(profile.email_signature || '').replace(/\{\{(\w+)\}\}/g, (_, k) => map[k] ?? `{{${k}}}`);
  }, [profile.email_signature, profile.company_name, profile.contact.contact_number, profile.contact.website, profile.website]);

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
        {/* ── Left: editor ── */}
        <div className="cb-editor">
          <CollapsibleSection title="Brand Identity" subtitle="Company information and organization statements">
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

          <CollapsibleSection title="Regulatory & Compliance" defaultOpen={false}>
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

          <CollapsibleSection title="Contact Information" defaultOpen={false}>
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
            {formattedAddress && (
              <div className="cb-address-preview">
                <span className="cb-field-label">Formatted address</span>
                <pre>{formattedAddress}</pre>
              </div>
            )}
          </CollapsibleSection>

          <CollapsibleSection title="Bank Details" subtitle="Auto-populated onto invoices" defaultOpen={false}>
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

          <CollapsibleSection title="Visual Identity" subtitle="Logos, signatures, seal and brand colours" defaultOpen={false}>
            <div className="cb-assets">
              {ASSET_META.map((a) => (
                <div key={a.key} className="cb-asset">
                  <span className="cb-field-label">{a.label}</span>
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

          <CollapsibleSection title="Brand Kit" defaultOpen={false}>
            <div className="cb-grid-2">
              <Field label="Brand Kit URL"><input value={profile.brand_kit.url} onChange={(e) => setNested('brand_kit', 'url', e.target.value)} placeholder="https://…" /></Field>
              <Field label="External Design Guidelines"><input value={profile.brand_kit.guidelines} onChange={(e) => setNested('brand_kit', 'guidelines', e.target.value)} placeholder="https://…" /></Field>
            </div>
          </CollapsibleSection>

          <CollapsibleSection title="Digital Presence" subtitle="Social media links" defaultOpen={false}>
            <div className="cb-grid-2">
              {SOCIALS.map((s) => (
                <Field key={s.key} label={s.label} error={errors[`social.${s.key}`]}>
                  <input value={profile.social[s.key]} onChange={(e) => setNested('social', s.key, e.target.value)} placeholder="https://…" />
                </Field>
              ))}
            </div>
          </CollapsibleSection>

          <CollapsibleSection title="Email Signature Template" subtitle="Supports merge fields" defaultOpen={false}>
            <p className="cb-merge-hint">
              Merge fields: {'{{sender_name}}'} {'{{sender_title}}'} {'{{company_name}}'} {'{{phone}}'} {'{{website}}'}
            </p>
            <Field label="Template">
              <textarea rows={5} value={profile.email_signature} onChange={(e) => setTop('email_signature', e.target.value)} />
            </Field>
            <div className="cb-sign-preview">
              <span className="cb-field-label">Live preview</span>
              <pre>{signaturePreview}</pre>
            </div>
          </CollapsibleSection>
        </div>

        {/* ── Right: live preview + activity ── */}
        <aside className="cb-side">
          <div className="cb-preview" style={{ '--cb-primary': profile.colors.primary, '--cb-secondary': profile.colors.secondary, '--cb-accent': profile.colors.accent }}>
            <div className="cb-preview-head">Live Brand Preview</div>
            <div className="cb-preview-card">
              <div className="cb-preview-bar" />
              <div className="cb-preview-logo">
                {assets.logo ? <img src={assets.logo} alt="Logo" /> : <span>{(profile.company_name || 'C')[0]}</span>}
              </div>
              <div className="cb-preview-name">{profile.company_name || 'Your Company'}</div>
              {profile.tagline && <div className="cb-preview-tag">{profile.tagline}</div>}
              {profile.story && <p className="cb-preview-desc">{profile.story}</p>}
              <div className="cb-preview-swatches">
                <span style={{ background: profile.colors.primary }} title="Primary" />
                <span style={{ background: profile.colors.secondary }} title="Secondary" />
                <span style={{ background: profile.colors.accent }} title="Accent" />
              </div>
            </div>
          </div>

          <div className="cb-timeline">
            <div className="cb-timeline-head"><MdHistory size={17} /> Activity Timeline</div>
            {activity.length === 0 ? (
              <p className="cb-muted">No activity yet.</p>
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
        </aside>
      </div>
    </div>
  );
}
