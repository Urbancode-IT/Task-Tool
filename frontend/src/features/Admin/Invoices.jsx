import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { MdAdd, MdArrowBack, MdPrint, MdDelete, MdEdit, MdContentCopy } from 'react-icons/md';
import adminApi from '../../api/adminApi';
import { toastSuccess, toastError } from '../../utils/toast';
import { confirmDialog } from '../../utils/confirm';
import './Invoices.css';

const CURRENCY_SYMBOL = { INR: '₹', USD: '$', EUR: '€', GBP: '£', AED: 'AED ' };
const money = (amount, currency = 'INR') => {
  const n = Number(amount) || 0;
  const sym = CURRENCY_SYMBOL[currency] ?? `${currency} `;
  return `${sym}${n.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
};

const blankItem = () => ({ description: '', hsn_sac: '', qty: 1, rate: 0 });
const emptyInvoice = () => ({
  invoice_number: '',
  invoice_date: new Date().toISOString().slice(0, 10),
  due_date: '',
  client_name: '', client_address: '', client_email: '', client_gst: '', place_of_supply: '',
  is_inter_state: false,
  gst_rate: 18,
  currency: 'INR',
  items: [blankItem()],
  discount: 0,
  notes: '',
  terms: 'Payment due within 15 days.',
  status: 'draft',
});

// Money math — mirrors the server's computeInvoiceTotals.
function computeTotals(inv) {
  const raw = (inv.items || []).reduce((s, it) => s + (Number(it.qty) || 0) * (Number(it.rate) || 0), 0);
  const subtotal = Math.max(0, raw - (Number(inv.discount) || 0));
  const taxTotal = +(subtotal * ((Number(inv.gst_rate) || 0) / 100)).toFixed(2);
  const half = +(taxTotal / 2).toFixed(2);
  return { subtotal: +subtotal.toFixed(2), taxTotal, half, total: +(subtotal + taxTotal).toFixed(2) };
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

  useEffect(() => {
    loadInvoices();
    adminApi.getCompanyProfile().then((r) => setCompany(r.data?.data || {})).catch(() => {});
  }, [loadInvoices]);

  const startNew = async () => {
    const inv = emptyInvoice();
    try {
      const { data } = await adminApi.getNextInvoiceNumber();
      inv.invoice_number = data?.invoice_number || '';
    } catch { /* leave blank; server will assign */ }
    setDraft(inv);
    setMode('edit');
  };

  const startEdit = (inv) => { setDraft({ ...emptyInvoice(), ...inv, items: inv.items?.length ? inv.items : [blankItem()] }); setMode('edit'); };

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

  const openPrint = (inv) => { setPrintInv(inv); setMode('print'); };

  const save = async () => {
    if (!draft.client_name?.trim()) return toastError('Client name is required.');
    if (!(draft.items || []).some((it) => it.description?.trim())) return toastError('Add at least one line item.');
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

function InvoiceEditor({ draft, setDraft, saving, onCancel, onSave, onSaveAndPrint }) {
  const set = (k, v) => setDraft((d) => ({ ...d, [k]: v }));
  const setItem = (i, k, v) => setDraft((d) => ({ ...d, items: d.items.map((it, idx) => (idx === i ? { ...it, [k]: v } : it)) }));
  const addItem = () => setDraft((d) => ({ ...d, items: [...d.items, blankItem()] }));
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
          <button type="button" className="admin-btn admin-btn-primary" onClick={onSaveAndPrint} disabled={saving}>
            <MdPrint size={16} /> Save & Print
          </button>
        </div>
      </div>

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
            <input value={it.description} onChange={(e) => setItem(i, 'description', e.target.value)} placeholder="Item / service" />
            <input value={it.hsn_sac} onChange={(e) => setItem(i, 'hsn_sac', e.target.value)} />
            <input className="inv-num" type="number" min="0" value={it.qty} onChange={(e) => setItem(i, 'qty', e.target.value)} />
            <input className="inv-num" type="number" min="0" step="0.01" value={it.rate} onChange={(e) => setItem(i, 'rate', e.target.value)} />
            <span className="inv-num inv-amount">{money((Number(it.qty) || 0) * (Number(it.rate) || 0), draft.currency)}</span>
            <button type="button" className="inv-item-del" onClick={() => removeItem(i)} title="Remove"><MdDelete size={16} /></button>
          </div>
        ))}
        <button type="button" className="admin-btn admin-btn-secondary inv-add-item" onClick={addItem}><MdAdd size={16} /> Add item</button>
      </div>

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
            <label>Discount<input type="number" min="0" step="0.01" value={draft.discount} onChange={(e) => set('discount', e.target.value)} /></label>
            <label>GST %<input type="number" min="0" step="0.01" value={draft.gst_rate} onChange={(e) => set('gst_rate', e.target.value)} /></label>
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
  const c = company || {};
  const addr = c.address || {};
  const contact = c.contact || {};
  const comp = c.compliance || {};
  const bank = c.bank || {};
  const assets = c.assets || {};
  const companyAddress = [addr.line1, addr.line2, [addr.city, addr.state].filter(Boolean).join(', '), [addr.country, addr.postal_code].filter(Boolean).join(' ')]
    .filter((x) => x && String(x).trim());

  return (
    <div className="inv-print-root">
      <div className="inv-no-print inv-print-bar">
        <button type="button" className="admin-btn admin-btn-secondary" onClick={onBack}><MdArrowBack size={18} /> Back</button>
        <button type="button" className="admin-btn admin-btn-primary" onClick={() => window.print()}><MdPrint size={16} /> Print / Save as PDF</button>
      </div>

      <div className="inv-print">
        <header className="inv-print-head">
          <div className="inv-print-company">
            {assets.logo ? <img src={assets.logo} alt="Logo" className="inv-print-logo" /> : null}
            <div>
              <div className="inv-print-cname">{c.company_name || 'Your Company'}</div>
              {c.legal_name && <div className="inv-print-legal">{c.legal_name}</div>}
              {companyAddress.map((l, i) => <div key={i} className="inv-print-cline">{l}</div>)}
              {contact.official_email && <div className="inv-print-cline">{contact.official_email}</div>}
              {contact.contact_number && <div className="inv-print-cline">{contact.contact_number}</div>}
              {comp.gst && <div className="inv-print-cline">GSTIN: {comp.gst}</div>}
              {comp.pan && <div className="inv-print-cline">PAN: {comp.pan}</div>}
            </div>
          </div>
          <div className="inv-print-title">
            <h1>INVOICE</h1>
            <div className="inv-print-meta"><span>Invoice #</span><strong>{invoice.invoice_number}</strong></div>
            <div className="inv-print-meta"><span>Date</span><strong>{invoice.invoice_date || '—'}</strong></div>
            {invoice.due_date && <div className="inv-print-meta"><span>Due</span><strong>{invoice.due_date}</strong></div>}
          </div>
        </header>

        <section className="inv-print-billto">
          <div className="inv-print-billto-label">Bill To</div>
          <div className="inv-print-billto-name">{invoice.client_name}</div>
          {invoice.client_address && <div className="inv-print-cline" style={{ whiteSpace: 'pre-wrap' }}>{invoice.client_address}</div>}
          {invoice.client_email && <div className="inv-print-cline">{invoice.client_email}</div>}
          {invoice.client_gst && <div className="inv-print-cline">GSTIN: {invoice.client_gst}</div>}
          {invoice.place_of_supply && <div className="inv-print-cline">Place of supply: {invoice.place_of_supply}</div>}
        </section>

        <table className="inv-print-table">
          <thead>
            <tr><th>#</th><th>Description</th><th>HSN/SAC</th><th className="inv-num">Qty</th><th className="inv-num">Rate</th><th className="inv-num">Amount</th></tr>
          </thead>
          <tbody>
            {(invoice.items || []).map((it, i) => (
              <tr key={i}>
                <td>{i + 1}</td>
                <td>{it.description}</td>
                <td>{it.hsn_sac}</td>
                <td className="inv-num">{it.qty}</td>
                <td className="inv-num">{money(it.rate, invoice.currency)}</td>
                <td className="inv-num">{money((Number(it.qty) || 0) * (Number(it.rate) || 0), invoice.currency)}</td>
              </tr>
            ))}
          </tbody>
        </table>

        <div className="inv-print-summary">
          <div className="inv-print-notes">
            {invoice.notes && <><div className="inv-print-billto-label">Notes</div><p>{invoice.notes}</p></>}
            {invoice.terms && <><div className="inv-print-billto-label">Terms</div><p>{invoice.terms}</p></>}
            {(bank.account_name || bank.bank_name || bank.account_number) && (
              <div className="inv-print-bank">
                <div className="inv-print-billto-label">Bank Details</div>
                {bank.account_name && <div className="inv-print-cline">Account Name: {bank.account_name}</div>}
                {bank.bank_name && <div className="inv-print-cline">Bank: {bank.bank_name}</div>}
                {bank.account_number && <div className="inv-print-cline">A/C: {bank.account_number}</div>}
                {bank.branch && <div className="inv-print-cline">Branch: {bank.branch}</div>}
                {bank.ifsc && <div className="inv-print-cline">IFSC: {bank.ifsc}</div>}
                {bank.swift && <div className="inv-print-cline">SWIFT: {bank.swift}</div>}
              </div>
            )}
          </div>
          <div className="inv-print-totals">
            <div className="inv-total-line"><span>Subtotal</span><span>{money(t.subtotal, invoice.currency)}</span></div>
            {Number(invoice.discount) > 0 && <div className="inv-total-line"><span>Discount</span><span>-{money(invoice.discount, invoice.currency)}</span></div>}
            {invoice.is_inter_state ? (
              <div className="inv-total-line"><span>IGST ({invoice.gst_rate}%)</span><span>{money(t.taxTotal, invoice.currency)}</span></div>
            ) : (
              <>
                <div className="inv-total-line"><span>CGST ({(Number(invoice.gst_rate) || 0) / 2}%)</span><span>{money(t.half, invoice.currency)}</span></div>
                <div className="inv-total-line"><span>SGST ({(Number(invoice.gst_rate) || 0) / 2}%)</span><span>{money(t.half, invoice.currency)}</span></div>
              </>
            )}
            <div className="inv-total-line inv-grand"><span>Total</span><span>{money(t.total, invoice.currency)}</span></div>
          </div>
        </div>

        {(assets.signature || assets.digital_signature || assets.seal) && (
          <div className="inv-print-signoff">
            {assets.seal && <img src={assets.seal} alt="Seal" className="inv-print-seal" />}
            <div className="inv-print-sign">
              {(assets.digital_signature || assets.signature) && (
                <img src={assets.digital_signature || assets.signature} alt="Signature" className="inv-print-sig" />
              )}
              <div className="inv-print-sign-label">Authorized Signatory</div>
              <div className="inv-print-cline">{c.company_name || ''}</div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
