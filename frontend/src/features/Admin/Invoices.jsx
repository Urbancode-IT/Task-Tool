import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { MdAdd, MdArrowBack, MdPrint, MdDelete, MdEdit, MdContentCopy, MdWarning } from 'react-icons/md';
import adminApi from '../../api/adminApi';
import { toastSuccess, toastError } from '../../utils/toast';
import { confirmDialog } from '../../utils/confirm';
import { amountInWords } from '../../utils/amountInWords';
import { formatPlaceOfSupply } from '../../utils/gstStates';
import {
  allocatePaise, fromPaise, multiplyPaise, percentOfPaise, sanitizeDecimalInput, toPaise,
} from '../../utils/money';
import { BRANDING_EVENT } from '../../branding/BrandingContext';
import {
  FALLBACK_SAC, INVOICE_DEFAULTS, defaultSacFrom, invoiceSettingsFrom,
} from '../../utils/invoiceSettings';
import './Invoices.css';

const CURRENCY_SYMBOL = { INR: '₹', USD: '$', EUR: '€', GBP: '£', AED: 'AED ' };
const money = (amount, currency = 'INR') => {
  const n = Number(amount) || 0;
  const sym = CURRENCY_SYMBOL[currency] ?? `${currency} `;
  return `${sym}${n.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
};

const qty2 = (v) => (Number(v) || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
// Bare number, no symbol — the document's table and totals carry the currency in the header.
const plain = (amount) =>
  (Number(amount) || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmtDate = (d) => {
  if (!d) return '—';
  const dt = new Date(d);
  if (Number.isNaN(dt.getTime())) return String(d);
  const p = (n) => String(n).padStart(2, '0');
  return `${p(dt.getDate())}/${p(dt.getMonth() + 1)}/${dt.getFullYear()}`;
};

// Suggestions only; every field stays free-text so one-off engagements are still billable.
const SERVICE_SUGGESTIONS = [
  'Website design & development',
  'Landing page design & development',
  'E-commerce store development',
  'Web application development',
  'UI/UX design',
  'Frontend development',
  'Backend / API development',
  'CMS setup & content migration',
  'Website redesign / revamp',
  'Responsive & cross-browser fixes',
  'Third-party / payment gateway integration',
  'Website maintenance & support (monthly retainer)',
  'Bug fixing & change requests (hourly)',
  'Domain & hosting setup',
  'SEO setup & performance optimisation',
  'Technical consulting (hourly)',
];
// The service code, tax rate, currency and terms below are whatever the master
// console published under Billing & Legal; the arguments are only the
// fallbacks used before the company profile has loaded.
const blankItem = (sac = FALLBACK_SAC) => ({ description: '', hsn_sac: sac, qty: 1, rate: 0 });
const emptyInvoice = (settings = INVOICE_DEFAULTS, sac = FALLBACK_SAC) => ({
  invoice_number: '',
  invoice_date: new Date().toISOString().slice(0, 10),
  due_date: '',
  client_name: '', client_address: '', client_email: '', client_gst: '', place_of_supply: '',
  is_inter_state: false,
  gst_rate: settings.gst_rate,
  currency: settings.currency,
  items: [blankItem(sac)],
  discount: 0,
  notes: '',
  terms: settings.payment_terms,
  status: 'draft',
});

// A line's amount is what the document prints, so it is fixed at whole paise here:
// the subtotal is then the sum of the printed amounts and the two always reconcile.
const lineGrossPaise = (it) => multiplyPaise(it?.qty, it?.rate);
const lineGross = (it) => fromPaise(lineGrossPaise(it));

/**
 * The company seal and the director's signature are mandatory on an issued invoice.
 * Mirrors the server's blockedForSignoff guard — either signature asset will do.
 */
function signoffAssets(company) {
  const a = company?.assets || {};
  return { seal: a.seal || '', sign: a.digital_signature || a.signature || '' };
}
function missingSignoff(company) {
  const { seal, sign } = signoffAssets(company);
  const missing = [];
  if (!seal) missing.push('company seal');
  if (!sign) missing.push('director signature');
  return missing;
}
const signoffMessage = (missing) =>
  `Ask a master administrator to upload the ${missing.join(' and ')} (master console → Appearance) before issuing this invoice.`;

// Money math — mirrors the server's computeInvoiceTotals.
// Everything is computed in whole paise, so nothing is truncated and no floating-point
// error creeps in: a subtotal of 16,399.49 is taxed as 16,399.49 and gives 19,351.40.
function computeTotals(inv) {
  const grossPaise = (inv.items || []).reduce((sum, it) => sum + lineGrossPaise(it), 0);
  const subtotalPaise = Math.max(0, grossPaise - toPaise(inv.discount));
  const taxPaise = percentOfPaise(subtotalPaise, inv.gst_rate);
  return {
    subtotal: fromPaise(subtotalPaise),
    taxTotal: fromPaise(taxPaise),
    // CGST and SGST are half each; the odd paisa goes to CGST so the two add up.
    half: fromPaise(Math.round(taxPaise / 2)),
    total: fromPaise(subtotalPaise + taxPaise),
  };
}

/**
 * Per-line taxable value and tax for the document's CGST/SGST/IGST columns.
 * GST is held at invoice level, so the invoice-level discount is spread across the
 * lines in proportion to their value; the columns then reconcile with the summary.
 */
function computeLines(inv) {
  const items = inv.items || [];
  const amounts = items.map((it) => lineGrossPaise(it));
  // The invoice-level discount is spread across the lines in proportion to their
  // value, to the paisa, so the printed columns add up to the summary exactly.
  const shares = allocatePaise(toPaise(inv.discount), amounts);
  return items.map((it, i) => {
    const taxablePaise = Math.max(0, amounts[i] - (shares[i] || 0));
    const taxPaise = percentOfPaise(taxablePaise, inv.gst_rate);
    return {
      ...it,
      amount: fromPaise(amounts[i]),
      taxable: fromPaise(taxablePaise),
      tax: fromPaise(taxPaise),
      half: fromPaise(Math.round(taxPaise / 2)),
    };
  });
}

export default function Invoices() {
  const [mode, setMode] = useState('list'); // list | edit | print
  const [invoices, setInvoices] = useState([]);
  const [loading, setLoading] = useState(true);
  const [company, setCompany] = useState({});
  const [draft, setDraft] = useState(null); // invoice being edited
  const [printInv, setPrintInv] = useState(null);
  const [saving, setSaving] = useState(false);

  const loadInvoices = useCallback(() => {
    setLoading(true);
    adminApi.getInvoices()
      .then((r) => setInvoices(Array.isArray(r.data) ? r.data : []))
      .catch(() => toastError('Failed to load invoices'))
      .finally(() => setLoading(false));
  }, []);

  const loadCompany = useCallback(() => {
    adminApi.getCompanyProfile().then((r) => setCompany(r.data?.data || {})).catch(() => {});
  }, []);

  useEffect(() => {
    loadInvoices();
    loadCompany();
  }, [loadInvoices, loadCompany]);

  // The invoice carries the full profile — address, GST, bank, seal, signature — so
  // it must refetch when branding is republished, not print a stale letterhead.
  useEffect(() => {
    window.addEventListener(BRANDING_EVENT, loadCompany);
    return () => window.removeEventListener(BRANDING_EVENT, loadCompany);
  }, [loadCompany]);

  // Invoice defaults published under Billing & Legal in the master console.
  const settings = useMemo(() => invoiceSettingsFrom(company), [company]);
  const defaultSac = useMemo(() => defaultSacFrom(company), [company]);

  const startNew = async () => {
    const inv = emptyInvoice(settings, defaultSac);
    try {
      const { data } = await adminApi.getNextInvoiceNumber();
      inv.invoice_number = data?.invoice_number || '';
    } catch { /* leave blank; server will assign */ }
    setDraft(inv);
    setMode('edit');
  };

  const startEdit = (inv) => { setDraft({ ...emptyInvoice(settings, defaultSac), ...inv, items: inv.items?.length ? inv.items : [blankItem(defaultSac)] }); setMode('edit'); };

  const remove = async (inv) => {
    const ok = await confirmDialog({ title: 'Delete invoice', message: `Delete ${inv.invoice_number}? This cannot be undone.`, confirmLabel: 'Delete', danger: true });
    if (!ok) return;
    try {
      await adminApi.deleteInvoice(inv.invoice_id);
      setInvoices((prev) => prev.filter((x) => x.invoice_id !== inv.invoice_id));
      toastSuccess('Invoice deleted');
    } catch {
      toastError('Failed to delete invoice');
    }
  };

  // Blank until the profile call returns, so it cannot block on a not-yet-loaded profile.
  const missingAssets = useMemo(() => (company.assets ? missingSignoff(company) : []), [company]);

  const openPrint = (inv) => {
    if (missingAssets.length) return toastError(signoffMessage(missingAssets));
    setPrintInv(inv);
    setMode('print');
  };

  const save = async () => {
    if (!draft.client_name?.trim()) return toastError('Client name is required.');
    if (!(draft.items || []).some((it) => it.description?.trim())) return toastError('Add at least one line item.');
    if (draft.status !== 'draft' && missingAssets.length) return toastError(signoffMessage(missingAssets));
    setSaving(true);
    try {
      const saved = draft.invoice_id
        ? (await adminApi.updateInvoice(draft.invoice_id, draft)).data
        : (await adminApi.createInvoice(draft)).data;
      toastSuccess(draft.invoice_id ? 'Invoice updated' : 'Invoice created');
      loadInvoices();
      setDraft(null);
      setMode('list');
      return saved;
    } catch (e) {
      toastError(e?.response?.data?.message || 'Failed to save invoice');
    } finally {
      setSaving(false);
    }
  };

  const saveAndPrint = async () => {
    // Checked before saving so the user is not left mid-flow with nothing printed.
    if (missingAssets.length) return toastError(signoffMessage(missingAssets));
    const saved = await save();
    if (saved) openPrint(saved);
  };

  if (mode === 'print' && printInv) {
    return <InvoicePrint invoice={printInv} company={company} onBack={() => { setPrintInv(null); setMode('list'); }} />;
  }

  if (mode === 'edit' && draft) {
    return (
      <InvoiceEditor
        draft={draft}
        setDraft={setDraft}
        saving={saving}
        settings={settings}
        defaultSac={defaultSac}
        missingAssets={missingAssets}
        onCancel={() => { setDraft(null); setMode('list'); }}
        onSave={save}
        onSaveAndPrint={saveAndPrint}
      />
    );
  }

  return (
    <section className="admin-panel admin-panel-inline">
      <div className="inv-toolbar">
        <button type="button" className="admin-btn admin-btn-primary" onClick={startNew}>
          <MdAdd size={18} /> New invoice
        </button>
      </div>
      {loading ? (
        <div className="admin-loading">Loading invoices…</div>
      ) : invoices.length === 0 ? (
        <div className="admin-empty">No invoices yet. Click “New invoice”.</div>
      ) : (
        <div className="inv-table-wrap">
          <table className="inv-table">
            <thead>
              <tr>
                <th>Invoice #</th><th>Client</th><th>Date</th><th>Status</th><th className="inv-num">Total</th><th></th>
              </tr>
            </thead>
            <tbody>
              {invoices.map((inv) => (
                <tr key={inv.invoice_id}>
                  <td>{inv.invoice_number}</td>
                  <td>{inv.client_name || '—'}</td>
                  <td>{inv.invoice_date || '—'}</td>
                  <td><span className={`inv-status inv-status-${inv.status}`}>{inv.status}</span></td>
                  <td className="inv-num">{money(inv.total, inv.currency)}</td>
                  <td className="inv-row-actions">
                    <button type="button" title="Print / PDF" onClick={() => openPrint(inv)}><MdPrint size={17} /></button>
                    <button type="button" title="Edit" onClick={() => startEdit(inv)}><MdEdit size={17} /></button>
                    <button type="button" title="Delete" onClick={() => remove(inv)}><MdDelete size={17} /></button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function InvoiceEditor({
  draft, setDraft, saving, settings = INVOICE_DEFAULTS, defaultSac = FALLBACK_SAC,
  missingAssets = [], onCancel, onSave, onSaveAndPrint,
}) {
  const blocked = missingAssets.length > 0;
  const set = (k, v) => setDraft((d) => ({ ...d, [k]: v }));
  const setItem = (i, k, v) => setDraft((d) => ({ ...d, items: d.items.map((it, idx) => (idx === i ? { ...it, [k]: v } : it)) }));
  const addItem = () => setDraft((d) => ({ ...d, items: [...d.items, blankItem(defaultSac)] }));
  const removeItem = (i) => setDraft((d) => ({ ...d, items: d.items.length > 1 ? d.items.filter((_, idx) => idx !== i) : d.items }));
  const t = useMemo(() => computeTotals(draft), [draft]);

  return (
    <section className="admin-panel admin-panel-inline inv-editor">
      <div className="inv-toolbar">
        <button type="button" className="admin-btn admin-btn-secondary" onClick={onCancel}>
          <MdArrowBack size={18} /> Back
        </button>
        <div className="inv-toolbar-right">
          <button type="button" className="admin-btn admin-btn-secondary" onClick={onSave} disabled={saving}>
            {saving ? 'Saving…' : 'Save'}
          </button>
          <button type="button" className="admin-btn admin-btn-primary" onClick={onSaveAndPrint} disabled={saving || blocked} title={blocked ? signoffMessage(missingAssets) : undefined}>
            <MdPrint size={16} /> Save & Print
          </button>
        </div>
      </div>

      {blocked && (
        <div className="inv-signoff-warn" role="alert">
          <MdWarning size={18} />
          <span>{signoffMessage(missingAssets)} The invoice can be saved as a draft, but it cannot be issued or printed without them.</span>
        </div>
      )}

      <div className="inv-form-grid">
        <label>Invoice #<input value={draft.invoice_number} onChange={(e) => set('invoice_number', e.target.value)} /></label>
        <label>Status
          <select value={draft.status} onChange={(e) => set('status', e.target.value)}>
            <option value="draft">Draft</option><option value="sent">Sent</option><option value="paid">Paid</option>
          </select>
        </label>
        <label>Invoice date<input type="date" value={draft.invoice_date || ''} onChange={(e) => set('invoice_date', e.target.value)} /></label>
        <label>Due date<input type="date" value={draft.due_date || ''} onChange={(e) => set('due_date', e.target.value)} /></label>
      </div>

      <h4 className="inv-subhead">Bill To</h4>
      <div className="inv-form-grid">
        <label>Client name *<input value={draft.client_name} onChange={(e) => set('client_name', e.target.value)} /></label>
        <label>Client email<input type="email" value={draft.client_email} onChange={(e) => set('client_email', e.target.value)} /></label>
        <label>Client GSTIN<input value={draft.client_gst} onChange={(e) => set('client_gst', e.target.value.toUpperCase())} /></label>
        <label>Place of supply<input value={draft.place_of_supply} onChange={(e) => set('place_of_supply', e.target.value)} placeholder="State" /></label>
        <label className="inv-col-full">Client address<textarea rows={2} value={draft.client_address} onChange={(e) => set('client_address', e.target.value)} /></label>
      </div>

      <h4 className="inv-subhead">Line Items</h4>
      <div className="inv-items">
        <div className="inv-items-head">
          <span>Description</span><span>HSN/SAC</span><span className="inv-num">Qty</span><span className="inv-num">Rate</span><span className="inv-num">Amount</span><span />
        </div>
        {draft.items.map((it, i) => (
          <div className="inv-item-row" key={i}>
            <input list="inv-service-list" value={it.description} onChange={(e) => setItem(i, 'description', e.target.value)} placeholder="e.g. Website design & development" />
            <input list="inv-sac-list" value={it.hsn_sac} onChange={(e) => setItem(i, 'hsn_sac', e.target.value)} placeholder={defaultSac} />
            {/* Text, not type="number": a pasted "10,169.49" or "₹10,169.49" would be
                rejected by a number field and the line would silently bill 0.00.
                sanitizeDecimalInput keeps the paise and drops the formatting. */}
            <input
              className="inv-num"
              type="text"
              inputMode="decimal"
              value={it.qty}
              onChange={(e) => setItem(i, 'qty', sanitizeDecimalInput(e.target.value))}
            />
            <input
              className="inv-num"
              type="text"
              inputMode="decimal"
              value={it.rate}
              onChange={(e) => setItem(i, 'rate', sanitizeDecimalInput(e.target.value))}
            />
            <span className="inv-num inv-amount">{money(lineGross(it), draft.currency)}</span>
            <button type="button" className="inv-item-del" onClick={() => removeItem(i)} title="Remove"><MdDelete size={16} /></button>
          </div>
        ))}
        <button type="button" className="admin-btn admin-btn-secondary inv-add-item" onClick={addItem}><MdAdd size={16} /> Add item</button>
      </div>
      {/* Kept outside .inv-items so the option lists never become grid/flex children. */}
      <datalist id="inv-service-list">
        {SERVICE_SUGGESTIONS.map((s) => <option key={s} value={s} />)}
      </datalist>
      <datalist id="inv-sac-list">
        {settings.sac_catalogue.map((s) => <option key={s.code} value={s.code}>{s.label}</option>)}
      </datalist>

      <div className="inv-bottom">
        <div className="inv-bottom-left">
          <label>Notes<textarea rows={2} value={draft.notes} onChange={(e) => set('notes', e.target.value)} /></label>
          <label>Terms<textarea rows={2} value={draft.terms} onChange={(e) => set('terms', e.target.value)} /></label>
        </div>
        <div className="inv-totals">
          <div className="inv-total-controls">
            <label>Currency
              <select value={draft.currency} onChange={(e) => set('currency', e.target.value)}>
                {Object.keys(CURRENCY_SYMBOL).map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
            </label>
            <label>Discount<input type="text" inputMode="decimal" value={draft.discount} onChange={(e) => set('discount', sanitizeDecimalInput(e.target.value))} /></label>
            <label>GST %<input type="text" inputMode="decimal" value={draft.gst_rate} onChange={(e) => set('gst_rate', sanitizeDecimalInput(e.target.value))} /></label>
            <label className="inv-check"><input type="checkbox" checked={draft.is_inter_state} onChange={(e) => set('is_inter_state', e.target.checked)} /> Inter-state (IGST)</label>
          </div>
          <div className="inv-total-line"><span>Subtotal</span><span>{money(t.subtotal, draft.currency)}</span></div>
          {draft.is_inter_state ? (
            <div className="inv-total-line"><span>IGST ({draft.gst_rate}%)</span><span>{money(t.taxTotal, draft.currency)}</span></div>
          ) : (
            <>
              <div className="inv-total-line"><span>CGST ({(Number(draft.gst_rate) || 0) / 2}%)</span><span>{money(t.half, draft.currency)}</span></div>
              <div className="inv-total-line"><span>SGST ({(Number(draft.gst_rate) || 0) / 2}%)</span><span>{money(t.half, draft.currency)}</span></div>
            </>
          )}
          <div className="inv-total-line inv-grand"><span>Total</span><span>{money(t.total, draft.currency)}</span></div>
        </div>
      </div>
    </section>
  );
}

function InvoicePrint({ invoice, company, onBack }) {
  const t = computeTotals(invoice);
  const lines = computeLines(invoice);
  const c = company || {};
  const addr = c.address || {};
  const contact = c.contact || {};
  const comp = c.compliance || {};
  const bank = c.bank || {};
  const assets = c.assets || {};
  const signoff = signoffAssets(c);
  // Same source as the editor: published under Billing & Legal.
  const settings = invoiceSettingsFrom(c);
  const sellerName = c.legal_name || c.company_name || 'Your Company';
  const cur = invoice.currency || 'INR';
  const companyAddress = [addr.line1, addr.line2, [addr.city, addr.state].filter(Boolean).join(', '), [addr.country, addr.postal_code].filter(Boolean).join(' ')]
    .filter((x) => x && String(x).trim());

  const gstRate = Number(invoice.gst_rate) || 0;
  const halfRate = gstRate / 2;
  const interState = !!invoice.is_inter_state;
  // Under GST the document is a "tax invoice" only when tax is actually charged.
  const title = gstRate > 0 ? 'TAX INVOICE' : 'INVOICE';
  const balanceDue = invoice.status === 'paid' ? 0 : t.total;
  const taxCols = interState ? 1 : 2;
  const hasBank = bank.account_name || bank.bank_name || bank.account_number;

  return (
    <div className="inv-print-root">
      <div className="inv-no-print inv-print-bar">
        <button type="button" className="admin-btn admin-btn-secondary" onClick={onBack}><MdArrowBack size={18} /> Back</button>
        <button type="button" className="admin-btn admin-btn-primary" onClick={() => window.print()}><MdPrint size={16} /> Print / Save as PDF</button>
      </div>

      <div className="inv-print">
        <header className="inv-doc-head">
          <div className="inv-doc-brand">
            {assets.logo ? <img src={assets.logo} alt="" className="inv-doc-logo" /> : null}
            {c.tagline && <div className="inv-doc-tagline">{c.tagline}</div>}
          </div>
          <div className="inv-doc-title">
            <h1>{title}</h1>
            <div className="inv-doc-number"># {invoice.invoice_number}</div>
          </div>
        </header>

        <div className="inv-doc-top">
          <address className="inv-doc-seller">
            <span className="inv-doc-seller-name">{sellerName}</span>
            {companyAddress.map((l, i) => <span key={i}>{l}</span>)}
            {comp.gst && <span>GSTIN {comp.gst}</span>}
            {comp.pan && <span>PAN {comp.pan}</span>}
            {contact.official_email && <span>{contact.official_email}</span>}
            {contact.contact_number && <span>{contact.contact_number}</span>}
          </address>
          <div className="inv-doc-balance">
            <div className="inv-doc-balance-label">Balance Due</div>
            <div className="inv-doc-balance-value">{money(balanceDue, cur)}</div>
          </div>
        </div>

        <div className="inv-doc-parties">
          <address className="inv-doc-client">
            <span className="inv-doc-client-name">{invoice.client_name}</span>
            {invoice.client_address && <span className="inv-doc-preline">{invoice.client_address}</span>}
            {invoice.client_email && <span>{invoice.client_email}</span>}
            {invoice.client_gst && <span>GSTIN {invoice.client_gst}</span>}
          </address>
          <dl className="inv-doc-meta">
            <div className="inv-doc-meta-row"><dt>Invoice Date :</dt><dd>{fmtDate(invoice.invoice_date)}</dd></div>
            {invoice.terms && <div className="inv-doc-meta-row"><dt>Terms :</dt><dd>{invoice.terms}</dd></div>}
            {invoice.due_date && <div className="inv-doc-meta-row"><dt>Due Date :</dt><dd>{fmtDate(invoice.due_date)}</dd></div>}
          </dl>
        </div>

        {invoice.place_of_supply && (
          <div className="inv-doc-pos">Place Of Supply : {formatPlaceOfSupply(invoice.place_of_supply)}</div>
        )}

        <table className="inv-doc-table">
          <thead>
            <tr>
              <th className="inv-doc-c-idx">#</th>
              <th>Description</th>
              <th className="inv-doc-c-hsn">HSN/SAC</th>
              <th className="inv-num">Qty</th>
              <th className="inv-num">Rate</th>
              {interState ? (
                <th className="inv-num">IGST</th>
              ) : (
                <>
                  <th className="inv-num">CGST</th>
                  <th className="inv-num">SGST</th>
                </>
              )}
              <th className="inv-num">Amount</th>
            </tr>
          </thead>
          <tbody>
            {lines.map((l, i) => (
              <tr key={i}>
                <td className="inv-doc-c-idx">{i + 1}</td>
                <td className="inv-doc-desc">{l.description}</td>
                <td className="inv-doc-c-hsn">{l.hsn_sac || ''}</td>
                <td className="inv-num">{qty2(l.qty)}</td>
                <td className="inv-num">{plain(l.rate)}</td>
                {interState ? (
                  <td className="inv-num">{plain(l.tax)}<span className="inv-doc-taxpct">{gstRate}%</span></td>
                ) : (
                  <>
                    <td className="inv-num">{plain(l.half)}<span className="inv-doc-taxpct">{halfRate}%</span></td>
                    <td className="inv-num">{plain(l.half)}<span className="inv-doc-taxpct">{halfRate}%</span></td>
                  </>
                )}
                <td className="inv-num">{plain(l.taxable)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <td className="inv-doc-sum-gap" colSpan={4 + taxCols} />
              <th className="inv-doc-sum-label">Sub Total</th>
              <td className="inv-num">{plain(t.subtotal)}</td>
            </tr>
            {Number(invoice.discount) > 0 && (
              <tr>
                <td className="inv-doc-sum-gap" colSpan={4 + taxCols} />
                <th className="inv-doc-sum-label">Discount</th>
                <td className="inv-num">-{plain(invoice.discount)}</td>
              </tr>
            )}
            {interState ? (
              <tr>
                <td className="inv-doc-sum-gap" colSpan={4 + taxCols} />
                <th className="inv-doc-sum-label">IGST ({gstRate}%)</th>
                <td className="inv-num">{plain(t.taxTotal)}</td>
              </tr>
            ) : (
              <>
                <tr>
                  <td className="inv-doc-sum-gap" colSpan={4 + taxCols} />
                  <th className="inv-doc-sum-label">CGST ({halfRate}%)</th>
                  <td className="inv-num">{plain(t.half)}</td>
                </tr>
                <tr>
                  <td className="inv-doc-sum-gap" colSpan={4 + taxCols} />
                  <th className="inv-doc-sum-label">SGST ({halfRate}%)</th>
                  <td className="inv-num">{plain(t.half)}</td>
                </tr>
              </>
            )}
            <tr className="inv-doc-sum-total">
              <td className="inv-doc-sum-gap" colSpan={4 + taxCols} />
              <th className="inv-doc-sum-label">Total</th>
              <td className="inv-num">{money(t.total, cur)}</td>
            </tr>
            <tr className="inv-doc-sum-due">
              <td className="inv-doc-sum-gap" colSpan={4 + taxCols} />
              <th className="inv-doc-sum-label">Balance Due</th>
              <td className="inv-num">{money(balanceDue, cur)}</td>
            </tr>
          </tfoot>
        </table>

        <div className="inv-doc-words">
          <span className="inv-doc-words-label">Total In Words :</span>
          <em className="inv-doc-words-value">{amountInWords(t.total, cur)}</em>
        </div>

        {(invoice.notes || hasBank) && (
          <div className="inv-doc-extra">
            {invoice.notes && (
              <div className="inv-doc-block">
                <div className="inv-doc-block-label">Notes</div>
                <p className="inv-doc-preline">{invoice.notes}</p>
              </div>
            )}
            {hasBank && (
              <div className="inv-doc-block">
                <div className="inv-doc-block-label">Bank Details</div>
                {bank.account_name && <div>Account Name: {bank.account_name}</div>}
                {bank.bank_name && <div>Bank: {bank.bank_name}</div>}
                {bank.account_number && <div>A/C: {bank.account_number}</div>}
                {bank.branch && <div>Branch: {bank.branch}</div>}
                {bank.ifsc && <div>IFSC: {bank.ifsc}</div>}
                {bank.swift && <div>SWIFT: {bank.swift}</div>}
              </div>
            )}
          </div>
        )}

        {settings.thanks_note && (
          <div className="inv-doc-thanks">{settings.thanks_note}</div>
        )}

        {settings.declaration && (
          <div className="inv-doc-declaration">
            <div className="inv-doc-block-label">Declaration</div>
            <p className="inv-doc-preline">{settings.declaration}</p>
          </div>
        )}

        <div className="inv-doc-signoff">
          {signoff.seal && <img src={signoff.seal} alt="Company seal" className="inv-doc-seal" />}
          <div className="inv-doc-sign">
            {signoff.sign && <img src={signoff.sign} alt="Authorised signature" className="inv-doc-sig" />}
            <div className="inv-doc-sign-label">
              <span className="inv-doc-sign-for">For {sellerName}</span>
              <span className="inv-doc-sign-role">{settings.signatory_role}</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
