/**
 * EOD report filtering by an inclusive From–To day range (yyyy-mm-dd; either side may
 * be empty). The result is sorted newest report date first.
 */
export const EMPTY_EOD_RANGE = { from: '', to: '' };

const reportDay = (r) => String(r?.report_date ?? '').slice(0, 10);

export function filterEodByRange(reports = [], range = EMPTY_EOD_RANGE) {
  const { from = '', to = '' } = range || {};
  return (reports || [])
    .filter((r) => {
      const d = reportDay(r);
      if (!from && !to) return true;
      if (!d) return false;
      return (!from || d >= from) && (!to || d <= to);
    })
    .sort((a, b) => reportDay(b).localeCompare(reportDay(a)));
}

export const eodRangeActive = (range) => Boolean(range?.from || range?.to);
