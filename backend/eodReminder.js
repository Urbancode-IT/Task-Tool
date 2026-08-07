// Two EOD email jobs, both on the EOD timezone wall clock (default IST, +05:30) so they
// line up with the EOD lock's day boundary:
//
//   1. Member reminders (default 17:30 and 19:30) — nudge each member who is present
//      today and has not filed their own EOD report yet.
//   2. Director report (default 20:00) — summarise who is still missing.
//
// Configure with:
//   EOD_TZ_OFFSET_MINUTES  (default 330)
//   EOD_REPORT_HOUR        (default 20 = 8pm)   — director report
//   EOD_REPORT_MINUTE      (default 0)          — director report
//   EOD_REMINDER_TIMES     (default '17:30,19:30', comma-separated HH:MM) — member nudges
//   EOD_REMINDER_SCOPE     ('all' default, or 'it' to remind IT members only)
//   APP_URL                (optional link in the email)

import { sendMail, isMailConfigured, renderEmail } from './mailer.js';

const EOD_TZ_OFFSET_MIN = Number(process.env.EOD_TZ_OFFSET_MINUTES ?? 330);
const REPORT_HOUR = Number(process.env.EOD_REPORT_HOUR ?? 20);
const REPORT_MINUTE = Number(process.env.EOD_REPORT_MINUTE ?? 0);
const REMINDER_SCOPE = String(process.env.EOD_REMINDER_SCOPE ?? 'all').toLowerCase();

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

// ── Member reminders (default 5:30pm and 7:30pm) ──────────────────────────────

// Parse 'HH:MM,HH:MM' into sorted {hour, minute} slots, dropping anything malformed.
function parseTimes(raw) {
  return String(raw)
    .split(',')
    .map((t) => t.trim())
    .filter(Boolean)
    .map((t) => {
      const [h, m] = t.split(':');
      return { hour: Number(h), minute: Number(m ?? 0) };
    })
    .filter(
      (t) =>
        Number.isInteger(t.hour) && t.hour >= 0 && t.hour <= 23 &&
        Number.isInteger(t.minute) && t.minute >= 0 && t.minute <= 59
    )
    .sort((a, b) => a.hour - b.hour || a.minute - b.minute);
}

const REMINDER_TIMES = parseTimes(process.env.EOD_REMINDER_TIMES ?? '17:30,19:30');

const slotLabel = (t) => `${String(t.hour).padStart(2, '0')}:${String(t.minute).padStart(2, '0')}`;

// The soonest upcoming slot, and how long until it fires.
function nextSlot(times) {
  const now = eodNow();
  let best = null;
  for (const t of times) {
    const at = new Date(now);
    at.setUTCHours(t.hour, t.minute, 0, 0);
    if (at <= now) at.setUTCDate(at.getUTCDate() + 1);
    if (!best || at < best.at) best = { at, slot: t };
  }
  if (!best) return null;
  return { ...best, delay: Math.max(1000, best.at.getTime() - now.getTime()) };
}

function reminderHtml({ username, dateStr, label }) {
  const contentHtml = `
    <p style="margin:0 0 14px;color:#334155;">
      Hi ${escapeHtml(username || 'there')},
    </p>
    <p style="margin:0 0 14px;color:#334155;">
      Your EOD report for <strong>${dateStr}</strong> has not been submitted yet
      (checked at ${label}). Please take a minute to write it up before you finish
      for the day.
    </p>
    <p style="margin:0 0 14px;color:#334155;">
      Reports are due by midnight. If the day closes without one, your account is
      locked the next morning until an admin unlocks it.
    </p>
    <p style="margin:16px 0 0;color:#94a3b8;font-size:12px;">
      If you are on leave today, ask an admin to mark the day so these reminders stop.
      This is an automated reminder.
    </p>`;

  return renderEmail({
    heading: `Reminder: submit your EOD report for ${dateStr}`,
    contentHtml,
    ctaUrl: process.env.APP_URL || '',
    ctaLabel: 'Submit EOD report',
    preheader: `Your EOD report for ${dateStr} is still pending.`,
  });
}

async function runMemberReminders(db, slot) {
  const now = eodNow();
  // Saturday is a working day; only Sunday is off.
  if (now.getUTCDay() === 0) return;

  const dateStr = now.toISOString().slice(0, 10);
  const label = slotLabel(slot);

  if (!isMailConfigured()) {
    console.warn(`[eodReminder] Gmail not configured; skipping the ${label} member reminder.`);
    return;
  }

  let pending = [];
  try {
    pending = await db.dbGetUsersMissingEod(dateStr, { itOnly: REMINDER_SCOPE === 'it' });
  } catch (err) {
    console.error('[eodReminder] failed to gather pending members:', err.message);
    return;
  }

  if (!pending.length) {
    console.log(`[eodReminder] ${dateStr} ${label}: everyone has submitted. No reminders sent.`);
    return;
  }

  let sent = 0;
  // Sequential rather than Promise.all: one member's bounce must not abort the rest,
  // and it keeps the send rate well inside the Gmail account's daily quota.
  for (const u of pending) {
    const ok = await sendMail({
      to: u.email,
      subject: `Reminder: your EOD report for ${dateStr} is pending`,
      html: reminderHtml({ username: u.username, dateStr, label }),
    });
    if (ok) sent += 1;
  }

  console.log(
    `[eodReminder] ${dateStr} ${label}: ${pending.length} pending; ${sent} reminder(s) sent, ${pending.length - sent} failed.`
  );
}

/**
 * Start the member EOD reminders (default 5:30pm and 7:30pm in the EOD timezone).
 * Each slot re-queries, so anyone who filed after the first nudge is not emailed again.
 */
export function startEodMemberReminders(db) {
  if (!REMINDER_TIMES.length) {
    console.warn('[eodReminder] EOD_REMINDER_TIMES is empty or invalid; member reminders disabled.');
    return;
  }

  // Guards against a timer firing a hair early and re-running the same slot.
  let lastFired = '';

  const schedule = () => {
    const next = nextSlot(REMINDER_TIMES);
    if (!next) return;
    console.log(
      `[eodReminder] next member reminder at ${slotLabel(next.slot)} EOD-time (in ${Math.round(next.delay / 60000)} min).`
    );
    setTimeout(async () => {
      const key = `${eodNow().toISOString().slice(0, 10)} ${slotLabel(next.slot)}`;
      if (key !== lastFired) {
        lastFired = key;
        try {
          await runMemberReminders(db, next.slot);
        } catch (err) {
          console.error('[eodReminder] member reminder error:', err.message);
        }
      }
      schedule();
    }, next.delay).unref?.();
  };

  schedule();
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
