// Daily 8pm reminder: report IT-team members (Internal + External Projects) who have
// not submitted their EOD report to the directors by email.
//
// The "day boundary" and the run hour are in the EOD timezone (default IST, +05:30),
// matching the EOD lock logic. Configure with:
//   EOD_TZ_OFFSET_MINUTES  (default 330)
//   EOD_REPORT_HOUR        (default 20 = 8pm)
//   EOD_REPORT_MINUTE      (default 0)
//   APP_URL                (optional link in the email)

import { sendMail, isMailConfigured, renderEmail } from './mailer.js';

const EOD_TZ_OFFSET_MIN = Number(process.env.EOD_TZ_OFFSET_MINUTES ?? 330);
const REPORT_HOUR = Number(process.env.EOD_REPORT_HOUR ?? 20);
const REPORT_MINUTE = Number(process.env.EOD_REPORT_MINUTE ?? 0);

// "Now" expressed as a Date whose UTC fields read as the EOD-timezone wall clock.
function eodNow() {
  return new Date(Date.now() + EOD_TZ_OFFSET_MIN * 60_000);
}

function msUntilNextRun() {
  const now = eodNow();
  const next = new Date(now);
  next.setUTCHours(REPORT_HOUR, REPORT_MINUTE, 0, 0);
  if (next <= now) next.setUTCDate(next.getUTCDate() + 1);
  return Math.max(1000, next.getTime() - now.getTime());
}

function escapeHtml(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

async function runReport(db) {
  const now = eodNow();
  const dow = now.getUTCDay(); // 0 Sun … 6 Sat
  // Saturday is a working day; only Sunday is off, so skip the report only on Sunday.
  if (dow === 0) return;

  const dateStr = now.toISOString().slice(0, 10);

  if (!isMailConfigured()) {
    console.warn('[eodReminder] Gmail not configured; skipping the 8pm director report.');
    return;
  }

  let missing = [];
  let directors = [];
  try {
    [missing, directors] = await Promise.all([
      db.dbGetItMembersMissingEod(dateStr),
      db.dbGetUsersByRoleCode('director'),
    ]);
  } catch (err) {
    console.error('[eodReminder] failed to gather data:', err.message);
    return;
  }

  if (!missing.length) {
    console.log(`[eodReminder] ${dateStr}: all IT members submitted their EOD. No email sent.`);
    return;
  }

  const recipients = directors.map((d) => d.email).filter(Boolean);
  if (!recipients.length) {
    console.warn('[eodReminder] No directors with an email address; cannot send the report.');
    return;
  }

  const rows = missing
    .map(
      (m, i) =>
        `<tr>
           <td style="padding:6px 10px;border-bottom:1px solid #eef2f7;color:#64748b;">${i + 1}</td>
           <td style="padding:6px 10px;border-bottom:1px solid #eef2f7;color:#0f172a;font-weight:600;">${escapeHtml(m.username || 'Unknown')}</td>
           <td style="padding:6px 10px;border-bottom:1px solid #eef2f7;color:#64748b;">${escapeHtml(m.email || '—')}</td>
         </tr>`
    )
    .join('');

  const contentHtml = `
    <p style="margin:0 0 14px;color:#334155;">
      The following IT team member${missing.length === 1 ? ' has' : 's have'} not submitted an
      EOD report for <strong>${dateStr}</strong> as of ${REPORT_HOUR}:00 (Internal &amp; External Projects):
    </p>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"
           style="border-collapse:collapse;font-size:14px;">
      <tr>
        <th align="left" style="padding:6px 10px;border-bottom:2px solid #e5e9f0;color:#94a3b8;font-size:12px;text-transform:uppercase;">#</th>
        <th align="left" style="padding:6px 10px;border-bottom:2px solid #e5e9f0;color:#94a3b8;font-size:12px;text-transform:uppercase;">Name</th>
        <th align="left" style="padding:6px 10px;border-bottom:2px solid #e5e9f0;color:#94a3b8;font-size:12px;text-transform:uppercase;">Email</th>
      </tr>
      ${rows}
    </table>
    <p style="margin:16px 0 0;color:#94a3b8;font-size:12px;">
      Total pending: ${missing.length}. This is an automated daily summary.
    </p>`;

  const html = renderEmail({
    heading: `EOD not submitted — ${dateStr}`,
    contentHtml,
    ctaUrl: process.env.APP_URL || '',
    ctaLabel: 'Open Seyal',
    preheader: `${missing.length} IT member(s) missing their EOD report for ${dateStr}.`,
  });

  const ok = await sendMail({
    to: recipients.join(', '),
    subject: `EOD not submitted (${missing.length}) — ${dateStr}`,
    html,
  });

  console.log(
    `[eodReminder] ${dateStr}: ${missing.length} missing; report ${ok ? 'sent' : 'FAILED'} to ${recipients.length} director(s).`
  );
}

/**
 * Start the daily 8pm director report. Self-reschedules each run so it keeps firing
 * once per day at the configured hour in the EOD timezone.
 */
export function startEodDirectorReport(db) {
  const schedule = () => {
    const delay = msUntilNextRun();
    const fireAt = new Date(Date.now() + delay);
    console.log(`[eodReminder] next run at ${fireAt.toISOString()} (in ${Math.round(delay / 60000)} min).`);
    setTimeout(async () => {
      try {
        await runReport(db);
      } catch (err) {
        console.error('[eodReminder] run error:', err.message);
      }
      schedule(); // schedule the following day
    }, delay).unref?.();
  };
  schedule();
}
