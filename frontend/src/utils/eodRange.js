/**
 * EOD report filtering: an inclusive From–To day range (yyyy-mm-dd; either side may be
 * empty), a text search over the author and report text, and optional member and
 * branch filters. The result is sorted newest report date first.
 */
export const EMPTY_EOD_RANGE = { from: '', to: '', q: '', member: '', branch: '' };

const reportDay = (r) => String(r?.report_date ?? '').slice(0, 10);

// Report text without its HTML markup, for searching.
const plain = (html) =>
  String(html || '')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>');

const searchText = (r) =>
  [r?.username, r?.branch, plain(r?.achievements), r?.blockers, r?.tomorrow_plan].join(' ').toLowerCase();

export function filterEodByRange(reports = [], range = EMPTY_EOD_RANGE) {
  const { from = '', to = '', q = '', member = '', branch = '' } = range || {};
  const words = String(q).trim().toLowerCase().split(/\s+/).filter(Boolean);
  return (reports || [])
    .filter((r) => {
      if (member && String(r?.user_id) !== String(member)) return false;
      if (branch && String(r?.branch || '') !== branch) return false;
      if (from || to) {
        const d = reportDay(r);
        if (!d || (from && d < from) || (to && d > to)) return false;
      }
      if (words.length) {
        const text = searchText(r);
        if (!words.every((w) => text.includes(w))) return false;
      }
      return true;
    })
    .sort((a, b) => reportDay(b).localeCompare(reportDay(a)));
}

export const eodRangeActive = (range) =>
  Boolean(range?.from || range?.to || String(range?.q || '').trim() || range?.member || range?.branch);

/**
 * Member and branch choices for the filters, taken from the loaded reports. Members
 * come in MemberPicker's shape ({ user_id, username, profile_image }).
 */
export function eodFilterOptions(reports = []) {
  const members = new Map();
  const branches = new Set();
  for (const r of reports || []) {
    if (r?.user_id != null && !members.has(String(r.user_id))) {
      members.set(String(r.user_id), {
        user_id: String(r.user_id),
        username: r.username || `User ${r.user_id}`,
        profile_image: r.author_profile_image || null,
      });
    }
    if (r?.branch) branches.add(r.branch);
  }
  return {
    members: [...members.values()].sort((a, b) => a.username.localeCompare(b.username)),
    branches: [...branches].sort((a, b) => a.localeCompare(b)),
  };
}
