// Spell an invoice total out in words, e.g. 41300 INR ->
// "Indian Rupee Forty-One Thousand Three Hundred Only".
//
// INR uses Indian grouping (crore / lakh / thousand); other currencies use the
// western scale (billion / million / thousand).

const ONES = [
  '', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten',
  'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen',
  'Eighteen', 'Nineteen',
];
const TENS = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];

const CURRENCY_WORDS = {
  INR: { major: 'Indian Rupee', minor: 'Paise' },
  USD: { major: 'US Dollar', minor: 'Cents' },
  EUR: { major: 'Euro', minor: 'Cents' },
  GBP: { major: 'Pound Sterling', minor: 'Pence' },
  AED: { major: 'UAE Dirham', minor: 'Fils' },
};

function under100(n) {
  if (n < 20) return ONES[n];
  const t = Math.floor(n / 10);
  const o = n % 10;
  return o ? `${TENS[t]}-${ONES[o]}` : TENS[t];
}

function under1000(n) {
  const h = Math.floor(n / 100);
  const r = n % 100;
  const parts = [];
  if (h) parts.push(`${ONES[h]} Hundred`);
  if (r) parts.push(under100(r));
  return parts.join(' ');
}

function indianWords(n) {
  if (n === 0) return 'Zero';
  const crore = Math.floor(n / 10000000);
  const lakh = Math.floor((n % 10000000) / 100000);
  const thousand = Math.floor((n % 100000) / 1000);
  const rest = n % 1000;
  const parts = [];
  // Recurse on crore so values above 99 crore still read correctly.
  if (crore) parts.push(`${indianWords(crore)} Crore`);
  if (lakh) parts.push(`${under100(lakh)} Lakh`);
  if (thousand) parts.push(`${under100(thousand)} Thousand`);
  if (rest) parts.push(under1000(rest));
  return parts.join(' ');
}

const SCALES = [
  [1e9, 'Billion'],
  [1e6, 'Million'],
  [1e3, 'Thousand'],
];

function westernWords(n) {
  if (n === 0) return 'Zero';
  const parts = [];
  let rest = n;
  for (const [value, name] of SCALES) {
    if (rest >= value) {
      parts.push(`${westernWords(Math.floor(rest / value))} ${name}`);
      rest %= value;
    }
  }
  if (rest) parts.push(under1000(rest));
  return parts.join(' ');
}

/**
 * @param {number|string} amount
 * @param {string} currency  INR | USD | EUR | GBP | AED (falls back to the code itself)
 * @returns {string} e.g. "Indian Rupee Forty-One Thousand Three Hundred Only"
 */
export function amountInWords(amount, currency = 'INR') {
  const n = Number(amount);
  if (!Number.isFinite(n)) return '';

  const names = CURRENCY_WORDS[currency] || { major: currency, minor: 'Cents' };
  // Work in minor units so 0.1 + 0.2 style float error cannot shift a digit.
  const minorUnits = Math.round(Math.abs(n) * 100);
  const major = Math.floor(minorUnits / 100);
  const minor = minorUnits % 100;

  const spell = currency === 'INR' ? indianWords : westernWords;
  const parts = [names.major, spell(major)];
  if (minor) parts.push(`and ${under100(minor)} ${names.minor}`);

  return `${n < 0 ? 'Minus ' : ''}${parts.join(' ')} Only`;
}

export default amountInWords;
