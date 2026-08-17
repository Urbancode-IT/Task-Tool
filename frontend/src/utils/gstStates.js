// GST state / UT codes, used to render "Place Of Supply" as "Tamil Nadu (33)".
const STATE_CODES = {
  'jammu and kashmir': '01',
  'himachal pradesh': '02',
  punjab: '03',
  chandigarh: '04',
  uttarakhand: '05',
  haryana: '06',
  delhi: '07',
  rajasthan: '08',
  'uttar pradesh': '09',
  bihar: '10',
  sikkim: '11',
  'arunachal pradesh': '12',
  nagaland: '13',
  manipur: '14',
  mizoram: '15',
  tripura: '16',
  meghalaya: '17',
  assam: '18',
  'west bengal': '19',
  jharkhand: '20',
  odisha: '21',
  chhattisgarh: '22',
  'madhya pradesh': '23',
  gujarat: '24',
  'dadra and nagar haveli and daman and diu': '26',
  maharashtra: '27',
  karnataka: '29',
  goa: '30',
  lakshadweep: '31',
  kerala: '32',
  'tamil nadu': '33',
  puducherry: '34',
  'andaman and nicobar islands': '35',
  telangana: '36',
  'andhra pradesh': '37',
  ladakh: '38',
  'other territory': '97',
};

/**
 * Render a place of supply for the invoice. A recognised state name gains its GST
 * code; anything already carrying a code, or not recognised, is returned unchanged.
 */
export function formatPlaceOfSupply(place) {
  const raw = String(place ?? '').trim();
  if (!raw) return '';
  if (/\(\s*\d{2}\s*\)/.test(raw)) return raw; // already has a code
  const code = STATE_CODES[raw.toLowerCase()];
  return code ? `${raw} (${code})` : raw;
}

export default formatPlaceOfSupply;
