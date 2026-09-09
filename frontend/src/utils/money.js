/**
 * Money handling for invoices.
 *
 * Two problems this file exists to solve:
 *
 * 1. Amounts are typed and pasted from quotations, e-mails and spreadsheets, so they
 *    arrive formatted: "10,169.49", "₹10,169.49", "Rs. 10,169.49". A native
 *    <input type="number"> refuses those outright — the browser hands back an empty
 *    string and the line silently bills 0.00, or the paise are dropped and the
 *    invoice is short. So the fields take text and are sanitised here.
 *
 * 2. Binary floating point cannot hold rupees exactly: 7.5 * 1333.33 evaluates to
 *    9999.974999999999, which rounds to 9,999.97 when the true decimal value is
 *    9,999.975 and must round to 9,999.98. All arithmetic therefore happens in
 *    integer paise, and every rounding step is half-up on the exact value.
 *
 * Mirrored server-side by computeInvoiceTotals in backend/db/index.js.
 */

/**
 * Turn anything typed or pasted into a clean decimal string, keeping the paise.
 *
 * - currency symbols, spaces and trailing junk are dropped
 * - "," is a grouping separator, except when it is clearly the decimal mark
 *   ("10169,49"), which is what a European keyboard or locale produces
 * - at most one decimal point, at most `decimals` digits after it
 * - an empty field stays empty, so a half-typed value is never forced to 0
 */
export function sanitizeDecimalInput(raw, { decimals = 2 } = {}) {
  let s = String(raw ?? '').trim();
  if (!s) return '';

  // A currency word carries its own dot ("Rs. 10,169.49"), which would otherwise be
  // read as the decimal mark. A leading symbol or bare point is left alone so ".5"
  // still works.
  const firstDigit = s.search(/[0-9]/);
  if (firstDigit > 0 && /[A-Za-z]/.test(s.slice(0, firstDigit))) s = s.slice(firstDigit);

  // Drop everything that cannot be part of a number.
  s = s.replace(/[^\d.,]/g, '');
  if (!s) return '';

  const dots = (s.match(/\./g) || []).length;
  const commas = (s.match(/,/g) || []).length;

  if (dots === 0 && commas > 0) {
    // A single comma with one or two trailing digits is a decimal mark, not grouping.
    const decimalComma = commas === 1 && /,\d{1,2}$/.test(s);
    s = decimalComma ? s.replace(',', '.') : s.replace(/,/g, '');
  } else {
    s = s.replace(/,/g, '');
  }

  // Keep only the first decimal point.
  const firstDot = s.indexOf('.');
  if (firstDot !== -1) {
    s = s.slice(0, firstDot + 1) + s.slice(firstDot + 1).replace(/\./g, '');
  }

  const [whole = '', fraction] = s.split('.');
  const wholePart = whole.replace(/^0+(?=\d)/, '');
  if (fraction === undefined) return wholePart;
  // A trailing "." is kept so the field can be typed through.
  return `${wholePart}.${fraction.slice(0, decimals)}`;
}

/** The numeric value of a field. Blank or unparseable reads as 0. */
export function parseAmount(raw) {
  const n = Number(sanitizeDecimalInput(raw));
  return Number.isFinite(n) ? n : 0;
}

/**
 * A value as whole paise, half-up.
 *
 * Field text goes through the sanitiser first (it may carry symbols or separators).
 * A number is scaled directly: the sanitiser truncates to two decimals, which is
 * right for what someone typed but would quietly shave a computed value such as
 * 2951.9082 down to 2951.90 instead of rounding it to 2951.91.
 */
export const toPaise = (raw) => {
  const value = typeof raw === 'number' && Number.isFinite(raw) ? raw : parseAmount(raw);
  return Math.round(value * 100);
};

/** Paise back to rupees, for display and for storage. */
export const fromPaise = (paise) => (Math.round(Number(paise) || 0)) / 100;

/** Round a rupee value to paise, half-up on the exact decimal value. */
export const roundPaise = (value) => fromPaise(toPaise(value));

/**
 * qty x rate, in paise, exactly. Both operands are scaled to integers first, so the
 * product is an exact integer and only the final half-up step rounds.
 */
export function multiplyPaise(qtyRaw, rateRaw) {
  const qtyHundredths = toPaise(qtyRaw); // qty may itself carry decimals (e.g. 7.5 h)
  const ratePaise = toPaise(rateRaw);
  // qtyHundredths * ratePaise is in units of 1/10000 rupee.
  return Math.round((qtyHundredths * ratePaise) / 100);
}

/** A percentage of a paise amount, in paise, exactly. */
export function percentOfPaise(paise, percentRaw) {
  const hundredths = toPaise(percentRaw); // e.g. 18% -> 1800, 2.5% -> 250
  return Math.round(((Number(paise) || 0) * hundredths) / 10000);
}

/**
 * Split a discount across lines in proportion to their value, in whole paise.
 *
 * Proportional shares rarely divide evenly, so the rounding remainder is handed to
 * the largest lines one paisa at a time. The allocations then add up to the discount
 * exactly, which is what makes the printed line values reconcile with the summary.
 */
export function allocatePaise(amountPaise, weights) {
  const list = (weights || []).map((w) => Math.max(0, Math.round(Number(w) || 0)));
  const totalWeight = list.reduce((s, w) => s + w, 0);
  const target = Math.max(0, Math.min(Math.round(Number(amountPaise) || 0), totalWeight));
  if (!totalWeight || !target) return list.map(() => 0);

  const exact = list.map((w) => (w * target) / totalWeight);
  const shares = exact.map((v) => Math.floor(v));
  let remainder = target - shares.reduce((s, v) => s + v, 0);

  // Largest fractional part first, so the leftover paise land where they matter most.
  const order = exact
    .map((v, i) => ({ i, frac: v - Math.floor(v) }))
    .sort((a, b) => b.frac - a.frac || a.i - b.i);
  for (let k = 0; remainder > 0 && k < order.length; k += 1, remainder -= 1) {
    shares[order[k].i] += 1;
  }
  return shares;
}
