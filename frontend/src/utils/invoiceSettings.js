/**
 * Invoice generation settings, stored on the company profile under `invoice`.
 *
 * These used to be hardcoded in `features/Admin/Invoices.jsx`. They now live on the
 * profile so the master console owns them and every invoice an admin generates picks
 * them up. This module is the single definition of the shape and of the fallbacks, so
 * the editor and the printed document can never disagree about a default.
 *
 * The values are deliberately *not* part of `publicBranding()` on the server: GSTIN,
 * bank and tax data must never reach the unauthenticated `/api/branding` endpoint.
 *
 * The default SAC is the one exception to "everything lives under `invoice`" — it is
 * already stored and server-validated as `compliance.sac`, so it is read from there
 * rather than duplicated. See `defaultSacFrom`.
 */

/** SAC 998314 — "IT design and development services" — covers the web build work. */
export const FALLBACK_SAC = '998314';

export const CURRENCIES = ['INR', 'USD', 'EUR', 'GBP', 'AED'];

/** Shipped suggestions, used when the profile carries no catalogue of its own. */
export const FALLBACK_SAC_CATALOGUE = [
  { code: '998314', label: 'IT design & development services' },
  { code: '998313', label: 'IT consulting & support services' },
  { code: '998315', label: 'Hosting & IT infrastructure provisioning' },
  { code: '998316', label: 'IT infrastructure & network management' },
  { code: '998319', label: 'Other IT services' },
  { code: '998361', label: 'Advertising services' },
];

export const FALLBACK_DECLARATION =
  'We declare that this invoice shows the actual price of the services described '
  + 'and that all particulars are true and correct.';

/**
 * Everything persisted under `profile.invoice`, with the value used when the profile
 * leaves a field blank.
 */
export const INVOICE_DEFAULTS = {
  sac_catalogue: FALLBACK_SAC_CATALOGUE,
  gst_rate: 18,
  currency: 'INR',
  payment_terms: 'Payment due within 15 days.',
  signatory_role: 'Director',
  number_prefix: 'INV',
  declaration: FALLBACK_DECLARATION,
  thanks_note: 'Thanks for your business.',
};

const text = (v, fallback) => {
  const s = typeof v === 'string' ? v.trim() : '';
  return s || fallback;
};

/**
 * The service code new line items start with. Stored as `compliance.sac`, which the
 * server already validates against its `sac` pattern.
 */
export function defaultSacFrom(profile) {
  return text(profile?.compliance?.sac, FALLBACK_SAC);
}

/**
 * Read the invoice settings off a loaded company profile, filling every blank with the
 * shipped default. Always returns a complete object, so callers never need `||`.
 */
export function invoiceSettingsFrom(profile) {
  const raw = profile?.invoice || {};
  const rate = Number(raw.gst_rate);
  const catalogue = Array.isArray(raw.sac_catalogue)
    ? raw.sac_catalogue
      .map((r) => ({ code: text(r?.code, ''), label: text(r?.label, '') }))
      .filter((r) => r.code)
    : [];

  return {
    sac_catalogue: catalogue.length ? catalogue : INVOICE_DEFAULTS.sac_catalogue,
    // Zero is a legitimate rate (exports, exempt supply), so only a non-finite or
    // out-of-range value falls back to the default.
    gst_rate: Number.isFinite(rate) && rate >= 0 && rate <= 100 ? rate : INVOICE_DEFAULTS.gst_rate,
    currency: CURRENCIES.includes(raw.currency) ? raw.currency : INVOICE_DEFAULTS.currency,
    payment_terms: text(raw.payment_terms, INVOICE_DEFAULTS.payment_terms),
    signatory_role: text(raw.signatory_role, INVOICE_DEFAULTS.signatory_role),
    number_prefix: text(raw.number_prefix, INVOICE_DEFAULTS.number_prefix),
    // A blank declaration or closing note is a deliberate choice — the block is simply
    // omitted — so these two keep an explicit empty string rather than reinstating the
    // default. Only an absent key falls back.
    declaration: typeof raw.declaration === 'string'
      ? raw.declaration.trim()
      : INVOICE_DEFAULTS.declaration,
    thanks_note: typeof raw.thanks_note === 'string'
      ? raw.thanks_note.trim()
      : INVOICE_DEFAULTS.thanks_note,
  };
}

const KEYS = Object.keys(INVOICE_DEFAULTS);

/** True when two settings objects would publish identically. */
export function sameInvoiceSettings(a, b) {
  return KEYS.every((k) => {
    if (k === 'sac_catalogue') {
      const x = a?.[k] || [];
      const y = b?.[k] || [];
      return x.length === y.length
        && x.every((r, i) => r.code === y[i]?.code && r.label === y[i]?.label);
    }
    return String(a?.[k] ?? '') === String(b?.[k] ?? '');
  });
}
