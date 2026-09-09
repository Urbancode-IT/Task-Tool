import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  MdSave, MdClose, MdGavel, MdAccountBalance, MdReceiptLong, MdAdd, MdDelete,
  MdWarningAmber, MdInfoOutline, MdAlternateEmail, MdLocationOn, MdRestartAlt,
} from 'react-icons/md';
import adminApi from '../../api/adminApi';
import { ensureMasterSession } from './masterSession';
import { toastError, toastSuccess } from '../../utils/toast';
import { confirmDialog } from '../../utils/confirm';
import { notifyBrandingChanged } from '../../branding/BrandingContext';
import {
  CURRENCIES, INVOICE_DEFAULTS, invoiceSettingsFrom, sameInvoiceSettings,
} from '../../utils/invoiceSettings';
import './RegulatoryCompliance.css';

/**
 * Billing & Legal — the statutory identity, contact details, registered
 * address, bank details and invoice defaults that every invoice an admin generates is
 * built from.
 *
 * This is the only place these are edited. The server refuses them from a non-master
 * caller, so an admin cannot change them through the API either.
 *
 * `publicBranding()` on the server is an allowlist, so `compliance`, `bank`, `invoice`
 * and `address` never reach the unauthenticated `/api/branding` endpoint. The one
 * exception is `contact.website`, which that allowlist already publishes as the
 * fallback for the corporate website — a public URL either way. Emails, the phone
 * number and the address are not exposed.
 */

// Mirrors the server's COMPANY_VALIDATORS so a bad value is caught before publishing.
const PATTERNS = {
  gst: /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/,
  pan: /^[A-Z]{5}[0-9]{4}[A-Z]$/,
  ifsc: /^[A-Z]{4}0[A-Z0-9]{6}$/,
  swift: /^[A-Z]{6}[A-Z0-9]{2}([A-Z0-9]{3})?$/,
  sac: /^[0-9]{6,8}$/,
  email: /^[^\s@]+@[^\s@]+\.[^\s@]+$/,
  url: /^https?:\/\/[^\s.]+\.[^\s]+$/i,
  postal: /^[1-9][0-9]{5}$/,
};

const STATUTORY = [
  { key: 'registration', label: 'Registration number', hint: 'Company or LLP identification number' },
  { key: 'gst', label: 'GSTIN', pattern: 'gst', upper: true, hint: 'Printed under the seller address' },
  { key: 'pan', label: 'PAN', pattern: 'pan', upper: true, hint: 'Printed under the seller address' },
  { key: 'sac', label: 'Primary SAC', pattern: 'sac', hint: 'Default service code for new line items' },
];

const CONTACT = [
  { key: 'official_email', label: 'Official email', pattern: 'email', hint: 'Printed under the seller address' },
  { key: 'accounts_email', label: 'Accounts email', pattern: 'email', hint: 'Billing correspondence' },
  { key: 'contact_number', label: 'Contact number', hint: 'Printed under the seller address' },
  { key: 'website', label: 'Website', pattern: 'url', hint: 'Include https://' },
];

const ADDRESS = [
  { key: 'line1', label: 'Address line 1' },
  { key: 'line2', label: 'Address line 2' },
  { key: 'city', label: 'City' },
  { key: 'state', label: 'State' },
  { key: 'country', label: 'Country' },
  { key: 'postal_code', label: 'Postal code', pattern: 'postal', hint: 'Six digits' },
];

const BANK = [
  { key: 'account_name', label: 'Account name' },
  { key: 'bank_name', label: 'Bank' },
  { key: 'account_number', label: 'Account number' },
  { key: 'branch', label: 'Branch' },
  { key: 'ifsc', label: 'IFSC', pattern: 'ifsc', upper: true },
  { key: 'swift', label: 'SWIFT / BIC', pattern: 'swift', upper: true },
];

const EMPTY_COMPLIANCE = { registration: '', gst: '', pan: '', sac: '' };
const EMPTY_CONTACT = {
  official_email: '', accounts_email: '', contact_number: '', website: '',
};
const EMPTY_ADDRESS = {
  line1: '', line2: '', city: '', state: '', country: '', postal_code: '',
};
const EMPTY_BANK = {
  account_name: '', bank_name: '', account_number: '', branch: '', ifsc: '', swift: '',
};

const pick = (src, shape) => Object.fromEntries(
  Object.keys(shape).map((k) => [k, typeof src?.[k] === 'string' ? src[k] : '']),
);

const sameMap = (a, b, shape) => Object.keys(shape).every((k) => (a?.[k] || '') === (b?.[k] || ''));

/** Empty is always allowed; a filled value must match its pattern. */
const badField = (value, pattern) => {
  const v = String(value || '').trim();
  if (!v || !pattern) return false;
  return !PATTERNS[pattern].test(v);
};

function TextField({ field, value, onChange }) {
  const bad = badField(value, field.pattern);
  return (
    <label className={`rc-field ${bad ? 'invalid' : ''}`}>
      <span className="rc-field-label">{field.label}</span>
      <input
        value={value || ''}
        onChange={(e) => onChange(field.upper ? e.target.value.toUpperCase() : e.target.value)}
        spellCheck={false}
      />
      {bad
        ? <span className="rc-field-msg">Not a valid {field.label}.</span>
        : field.hint ? <span className="rc-field-hint">{field.hint}</span> : null}
    </label>
  );
}

export default function RegulatoryCompliance() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [profile, setProfile] = useState(null);

  const [compliance, setCompliance] = useState(EMPTY_COMPLIANCE);
  const [contact, setContact] = useState(EMPTY_CONTACT);
  const [address, setAddress] = useState(EMPTY_ADDRESS);
  const [bank, setBank] = useState(EMPTY_BANK);
  const [invoice, setInvoice] = useState(INVOICE_DEFAULTS);
  const [published, setPublished] = useState({
    compliance: EMPTY_COMPLIANCE,
    contact: EMPTY_CONTACT,
    address: EMPTY_ADDRESS,
    bank: EMPTY_BANK,
    invoice: INVOICE_DEFAULTS,
  });

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await adminApi.getCompanyProfile();
      const p = data?.data || data || {};
      const next = {
        compliance: pick(p.compliance, EMPTY_COMPLIANCE),
        contact: pick(p.contact, EMPTY_CONTACT),
        address: pick(p.address, EMPTY_ADDRESS),
        bank: pick(p.bank, EMPTY_BANK),
        invoice: invoiceSettingsFrom(p),
      };
      // `assets` is dropped deliberately. dbPublishCompanyProfile merges the body's
      // `assets` over the stored blob, so republishing a snapshot taken at load would
      // resurrect an asset deleted from Appearance in the meantime.
      const { assets: _assets, ...profileWithoutAssets } = p;
      setProfile(profileWithoutAssets);
      setCompliance(next.compliance);
      setContact(next.contact);
      setAddress(next.address);
      setBank(next.bank);
      setInvoice(next.invoice);
      setPublished(next);
    } catch (e) {
      toastError(e?.response?.data?.message || 'Failed to load the company profile');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const dirty = !sameMap(compliance, published.compliance, EMPTY_COMPLIANCE)
    || !sameMap(contact, published.contact, EMPTY_CONTACT)
    || !sameMap(address, published.address, EMPTY_ADDRESS)
    || !sameMap(bank, published.bank, EMPTY_BANK)
    || !sameInvoiceSettings(invoice, published.invoice);

  const errors = useMemo(() => {
    const list = [];
    STATUTORY.forEach((f) => { if (badField(compliance[f.key], f.pattern)) list.push(f.label); });
    CONTACT.forEach((f) => { if (badField(contact[f.key], f.pattern)) list.push(f.label); });
    ADDRESS.forEach((f) => { if (badField(address[f.key], f.pattern)) list.push(f.label); });
    BANK.forEach((f) => { if (badField(bank[f.key], f.pattern)) list.push(f.label); });
    invoice.sac_catalogue.forEach((r) => {
      if (badField(r.code, 'sac')) list.push(`SAC ${r.code}`);
    });
    if (!String(invoice.number_prefix || '').trim()) list.push('Invoice number prefix');
    return list;
  }, [compliance, contact, address, bank, invoice]);

  const setInv = (key, value) => setInvoice((prev) => ({ ...prev, [key]: value }));

  const setSac = (i, key, value) => setInvoice((prev) => ({
    ...prev,
    sac_catalogue: prev.sac_catalogue.map((r, idx) => (idx === i ? { ...r, [key]: value } : r)),
  }));
  const addSac = () => setInvoice((prev) => ({
    ...prev, sac_catalogue: [...prev.sac_catalogue, { code: '', label: '' }],
  }));
  const removeSac = (i) => setInvoice((prev) => ({
    ...prev, sac_catalogue: prev.sac_catalogue.filter((_, idx) => idx !== i),
  }));

  const save = async () => {
    if (!profile) return;
    if (errors.length) {
      toastError(`Fix these before publishing: ${errors.join(', ')}.`);
      return;
    }
    // Compliance, bank and invoice defaults are master-owned: without a master session
    // the server keeps the stored values and the publish would change nothing.
    if (!(await ensureMasterSession())) return;
    setSaving(true);
    try {
      // Blank catalogue rows are dropped rather than persisted.
      const cleanInvoice = {
        ...invoice,
        gst_rate: Number(invoice.gst_rate) || 0,
        sac_catalogue: invoice.sac_catalogue.filter((r) => String(r.code || '').trim()),
      };
      const next = {
        ...profile,
        compliance: { ...(profile.compliance || {}), ...compliance },
        contact: { ...(profile.contact || {}), ...contact },
        address: { ...(profile.address || {}), ...address },
        bank: { ...(profile.bank || {}), ...bank },
        invoice: cleanInvoice,
      };
      await adminApi.publishCompanyProfile(next);
      setProfile(next);
      setInvoice(cleanInvoice);
      setPublished({ compliance, contact, address, bank, invoice: cleanInvoice });
      // Invoices.jsx listens for this and refetches, so an editor already open picks
      // the new defaults up without a reload.
      notifyBrandingChanged();
      toastSuccess('Regulatory details published');
    } catch (e) {
      const list = e?.response?.data?.errors;
      toastError(
        Array.isArray(list) && list.length
          ? list.map((x) => x.message).join(' ')
          : e?.response?.data?.message || 'Failed to publish',
      );
    } finally {
      setSaving(false);
    }
  };

  /** Clear every stored value and put the invoice settings back to what ships. */
  const resetAll = async () => {
    const ok = await confirmDialog({
      title: 'Reset regulatory details to defaults?',
      message: 'Clears the statutory identity, contact details, registered address and bank '
        + 'details, and returns the invoice defaults to the shipped values. Nothing is '
        + 'applied until you press Publish.',
      confirmLabel: 'Reset',
      danger: true,
    });
    if (!ok) return;
    setCompliance(EMPTY_COMPLIANCE);
    setContact(EMPTY_CONTACT);
    setAddress(EMPTY_ADDRESS);
    setBank(EMPTY_BANK);
    setInvoice(INVOICE_DEFAULTS);
  };

  const discard = async () => {
    const ok = await confirmDialog({
      title: 'Discard changes?',
      message: 'Returns to the published regulatory details.',
      confirmLabel: 'Discard',
      danger: true,
    });
    if (ok) {
      setCompliance(published.compliance);
      setContact(published.contact);
      setAddress(published.address);
      setBank(published.bank);
      setInvoice(published.invoice);
    }
  };

  if (loading) return <div className="admin-loading">Loading regulatory details…</div>;

  const prefix = String(invoice.number_prefix || '').trim() || 'INV';

  return (
    <section className="admin-panel rc-shell">
      <header className="rc-bar">
        <div>
          <p>
            The statutory identity, bank details and invoice defaults every invoice is
            built from. Admins fill in the client and the line items; everything here is
            applied for them.
          </p>
        </div>
        <div className="rc-bar-actions">
          {dirty && <span className="rc-dirty">Unpublished</span>}
          <button type="button" className="rc-ghost" onClick={resetAll} disabled={saving}>
            <MdRestartAlt size={14} /> Reset
          </button>
          {dirty && (
            <button type="button" className="rc-ghost" onClick={discard} disabled={saving}>
              <MdClose size={14} /> Discard
            </button>
          )}
          <button
            type="button"
            className="it-updates-btn it-updates-btn-primary"
            onClick={save}
            disabled={saving || !dirty}
          >
            <MdSave size={16} /> {saving ? 'Publishing…' : dirty ? 'Publish' : 'Published'}
          </button>
        </div>
      </header>

      {errors.length > 0 && (
        <p className="rc-warn">
          <MdWarningAmber size={15} />
          Invalid: {errors.join(', ')}. Publishing is blocked until these are corrected.
        </p>
      )}

      <div className="rc-groups">
        <div className="rc-group">
          <h3 className="rc-h3"><MdGavel size={16} /> Statutory identity</h3>
          <p className="rc-note">Printed beneath the company address on every invoice.</p>
          <div className="rc-fields">
            {STATUTORY.map((f) => (
              <TextField
                key={f.key}
                field={f}
                value={compliance[f.key]}
                onChange={(v) => setCompliance((prev) => ({ ...prev, [f.key]: v }))}
              />
            ))}
          </div>
        </div>

        <div className="rc-group">
          <h3 className="rc-h3"><MdAlternateEmail size={16} /> Contact information</h3>
          <p className="rc-note">
            The official email and contact number print under the seller address on every
            invoice. The accounts email is for billing correspondence.
          </p>
          <div className="rc-fields">
            {CONTACT.map((f) => (
              <TextField
                key={f.key}
                field={f}
                value={contact[f.key]}
                onChange={(v) => setContact((prev) => ({ ...prev, [f.key]: v }))}
              />
            ))}
          </div>
        </div>

        <div className="rc-group">
          <h3 className="rc-h3"><MdLocationOn size={16} /> Registered address</h3>
          <p className="rc-note">
            Printed as the seller address, directly beneath the company name. Blank lines
            are skipped, so an unused second line leaves no gap.
          </p>
          <div className="rc-fields">
            {ADDRESS.map((f) => (
              <TextField
                key={f.key}
                field={f}
                value={address[f.key]}
                onChange={(v) => setAddress((prev) => ({ ...prev, [f.key]: v }))}
              />
            ))}
          </div>
        </div>

        <div className="rc-group">
          <h3 className="rc-h3"><MdAccountBalance size={16} /> Bank details</h3>
          <p className="rc-note">
            Shown in the invoice footer. The block is omitted entirely when the account
            name, bank and account number are all blank.
          </p>
          <div className="rc-fields">
            {BANK.map((f) => (
              <TextField
                key={f.key}
                field={f}
                value={bank[f.key]}
                onChange={(v) => setBank((prev) => ({ ...prev, [f.key]: v }))}
              />
            ))}
          </div>
        </div>

        <div className="rc-group">
          <h3 className="rc-h3"><MdReceiptLong size={16} /> Invoice defaults</h3>
          <p className="rc-note">
            Applied to every new invoice. An admin can still override the rate, currency
            and terms on an individual invoice.
          </p>
          <div className="rc-fields">
            <label className="rc-field">
              <span className="rc-field-label">Default GST rate</span>
              <input
                type="number" min="0" max="100" step="0.01"
                value={invoice.gst_rate}
                onChange={(e) => setInv('gst_rate', e.target.value)}
              />
              <span className="rc-field-hint">
                Per cent. Zero makes the document an Invoice rather than a Tax Invoice.
              </span>
            </label>

            <label className="rc-field">
              <span className="rc-field-label">Currency</span>
              <select value={invoice.currency} onChange={(e) => setInv('currency', e.target.value)}>
                {CURRENCIES.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
              <span className="rc-field-hint">Default for new invoices</span>
            </label>

            <label className="rc-field">
              <span className="rc-field-label">Invoice number prefix</span>
              <input
                value={invoice.number_prefix}
                onChange={(e) => setInv('number_prefix', e.target.value.toUpperCase())}
                spellCheck={false}
              />
              <span className="rc-field-hint">
                {`Numbers run ${prefix}-${new Date().getFullYear()}-0001. Changing it starts a
                new series; issued invoices keep the number they were given.`}
              </span>
            </label>

            <label className="rc-field">
              <span className="rc-field-label">Signatory role</span>
              <input
                value={invoice.signatory_role}
                onChange={(e) => setInv('signatory_role', e.target.value)}
              />
              <span className="rc-field-hint">Printed under the signature, below the company name</span>
            </label>

            <label className="rc-field rc-field-wide">
              <span className="rc-field-label">Default payment terms</span>
              <input
                value={invoice.payment_terms}
                onChange={(e) => setInv('payment_terms', e.target.value)}
              />
            </label>

            <label className="rc-field rc-field-wide">
              <span className="rc-field-label">Closing note</span>
              <input
                value={invoice.thanks_note}
                onChange={(e) => setInv('thanks_note', e.target.value)}
              />
              <span className="rc-field-hint">Leave blank to omit</span>
            </label>

            <label className="rc-field rc-field-wide">
              <span className="rc-field-label">Declaration</span>
              <textarea
                rows={3}
                value={invoice.declaration}
                onChange={(e) => setInv('declaration', e.target.value)}
              />
              <span className="rc-field-hint">
                Printed above the seal and signature. Leave blank to omit the block.
              </span>
            </label>
          </div>

          <h4 className="rc-h4">SAC / HSN catalogue</h4>
          <p className="rc-note">
            Offered as suggestions on every line item. The field stays free text, so a
            one-off code can still be typed.
          </p>
          <div className="rc-sacs">
            {invoice.sac_catalogue.map((row, i) => (
              /* Index-keyed deliberately: rows are edited in place and a newly added
                 blank row has no stable identity of its own. */
              <div className={`rc-sac ${badField(row.code, 'sac') ? 'invalid' : ''}`} key={i}>
                <input
                  className="rc-sac-code"
                  value={row.code}
                  placeholder="998314"
                  onChange={(e) => setSac(i, 'code', e.target.value.replace(/[^0-9]/g, ''))}
                  spellCheck={false}
                />
                <input
                  className="rc-sac-label"
                  value={row.label}
                  placeholder="Description"
                  onChange={(e) => setSac(i, 'label', e.target.value)}
                />
                <button
                  type="button"
                  className="rc-sac-del"
                  onClick={() => removeSac(i)}
                  title="Remove"
                >
                  <MdDelete size={16} />
                </button>
              </div>
            ))}
          </div>
          <button type="button" className="rc-link" onClick={addSac}>
            <MdAdd size={15} /> Add a code
          </button>
        </div>
      </div>

      <p className="rc-foot">
        <MdInfoOutline size={15} />
        This console is the only place these change, and the server rejects them from
        any other caller. None of them are exposed by the public branding endpoint.
      </p>
    </section>
  );
}
