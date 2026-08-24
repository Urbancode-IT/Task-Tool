/**
 * Email signature templates, stored on the company profile.
 *
 * Two audience defaults plus an optional per-mail override:
 *
 *   email_signature            default for every mail sent to a member
 *   email_signature_admin      default for every mail sent to admins
 *   email_signatures_by_mail   { [MAIL_TYPES key]: template } — blank falls through
 *
 * Owned by the master console (Company & Branding → Email signatures). Moved here from
 * the retired Admin → Company & Branding screen so the shape and the mail catalogue have
 * one definition.
 *
 * `renderSignature` in backend/mailer.js resolves mail-specific → audience default and
 * drops any line whose merge fields all come out empty.
 */

export const MERGE_FIELDS = [
  '{{sender_name}}', '{{sender_title}}', '{{company_name}}', '{{phone}}', '{{website}}',
];

// `email_signature` keeps its original key so profiles published before the admin
// template existed still carry over as the member default.
export const DEFAULT_SIGNATURE =
  '{{sender_name}}\n{{sender_title}}\n{{company_name}}\n{{phone}} · {{website}}';
export const DEFAULT_ADMIN_SIGNATURE =
  '{{company_name}} · Automated report\n{{phone}} · {{website}}';

/** The two audience defaults. A mail with no override of its own uses these. */
export const SIGNATURE_SECTIONS = [
  { key: 'email_signature', label: 'Team member mails', covers: 'Default for every mail sent to a member' },
  { key: 'email_signature_admin', label: 'Admin mails', covers: 'Default for every mail sent to admins' },
];

/**
 * Every mail the system sends, with the format it already uses.
 *
 * `subject`, `heading`, `body` and `cta` mirror the sending code in
 * backend/server.js and backend/eodReminder.js; values filled in at send time are
 * shown in braces. Keys must match MAIL_TYPES in backend/mailer.js.
 */
export const MAIL_TYPES = [
  {
    key: 'mention', audience: 'member', label: 'Comment mention',
    when: 'Someone @mentions a member in a comment',
    subject: '{who} mentioned you on "{task}"',
    heading: 'You were mentioned in a comment',
    body: ['Hi {name},', '{who} mentioned you in a comment on {task}:', '“the comment text”'],
    cta: 'Open task',
  },
  {
    key: 'task_assigned', audience: 'member', label: 'Task assigned',
    when: 'A task is assigned to a member',
    subject: '{who} assigned you a task: "{task}"',
    heading: 'A task was assigned to you',
    body: ['Hi {name},', '{who} assigned you a new task: {task}.', '“the task description”'],
    cta: 'Open task',
  },
  {
    key: 'task_due_soon', audience: 'member', label: 'Task due soon',
    when: 'A task is approaching its deadline',
    subject: 'Due soon: "{task}"',
    heading: 'Task due soon',
    body: ['Hi {name},', 'The task {task} is due on {date}.'],
    cta: 'Open task',
  },
  {
    key: 'task_overdue', audience: 'member', label: 'Task overdue',
    when: 'A task has passed its deadline',
    subject: 'Overdue: "{task}"',
    heading: 'Task overdue',
    body: ['Hi {name},', 'The task {task} is overdue (was due {date}).'],
    cta: 'Open task',
  },
  {
    key: 'eod_reminder', audience: 'member', label: 'EOD reminder',
    when: 'Evening nudge to file a pending EOD report',
    subject: 'Reminder: your EOD report for {date} is pending',
    heading: 'Reminder: submit your EOD report for {date}',
    body: [
      'Hi {name},',
      'Your EOD report for {date} has not been submitted yet (checked at {time}).',
      'Reports are due by midnight. If the day closes without one, your account is locked until an admin unlocks it.',
    ],
    cta: 'Submit EOD report',
  },
  {
    key: 'eod_pending_report', audience: 'admin', label: 'EOD pending summary',
    when: '8pm list of members still missing an EOD',
    subject: 'EOD not submitted ({count}) — {date}',
    heading: 'EOD not submitted — {date}',
    body: [
      'The following IT team members have not submitted an EOD report for {date} as of 20:00:',
      'table of #, Name, Email',
      'Total pending: {count}.',
    ],
    cta: 'Open {company}',
  },
  {
    key: 'eod_defaulters_locked', audience: 'admin', label: 'EOD defaulters locked',
    when: 'Midnight list of accounts locked for a missed EOD',
    subject: 'EOD defaulters locked ({count}) — {date}',
    heading: 'EOD defaulters locked — {date}',
    body: [
      'These members did not file an EOD report for {date}. Their accounts have been locked and they cannot sign in until an admin revokes the lock.',
      'list of name — email',
      'Total locked: {count}.',
    ],
    cta: 'Open {company}',
  },
];

export const EMPTY_SIGNATURES = {
  email_signature: DEFAULT_SIGNATURE,
  email_signature_admin: DEFAULT_ADMIN_SIGNATURE,
  email_signatures_by_mail: {},
};

/** Read the signature templates off a loaded profile. */
export function signaturesFrom(profile) {
  const p = profile || {};
  const byMail = p.email_signatures_by_mail || {};
  return {
    email_signature: p.email_signature || DEFAULT_SIGNATURE,
    email_signature_admin: p.email_signature_admin || DEFAULT_ADMIN_SIGNATURE,
    // Only string entries; a blank one means "use the audience default".
    email_signatures_by_mail: Object.fromEntries(
      Object.entries(byMail).filter(([, v]) => typeof v === 'string'),
    ),
  };
}

export function sameSignatures(a, b) {
  if ((a?.email_signature || '') !== (b?.email_signature || '')) return false;
  if ((a?.email_signature_admin || '') !== (b?.email_signature_admin || '')) return false;
  const x = a?.email_signatures_by_mail || {};
  const y = b?.email_signatures_by_mail || {};
  const keys = new Set([...Object.keys(x), ...Object.keys(y)]);
  return [...keys].every((k) => (x[k] || '') === (y[k] || ''));
}

/** The audience default a mail falls back to when it carries no override. */
export function audienceDefault(signatures, mailKey) {
  const mail = MAIL_TYPES.find((m) => m.key === mailKey);
  return mail?.audience === 'admin'
    ? signatures?.email_signature_admin || ''
    : signatures?.email_signature || '';
}

/**
 * What a given mail will actually sign off with: its own override if it has one, else
 * its audience default. Mirrors the server's resolution order.
 *
 * This is also what the editor shows in the per-mail box, so the field always displays
 * the text that will really go out rather than an empty box behind a placeholder.
 */
export function effectiveSignature(signatures, mailKey) {
  const own = signatures?.email_signatures_by_mail?.[mailKey];
  if (typeof own === 'string' && own.trim()) return own;
  return audienceDefault(signatures, mailKey);
}

/** True when this mail carries its own override rather than inheriting. */
export function isOverridden(signatures, mailKey) {
  const own = signatures?.email_signatures_by_mail?.[mailKey];
  return typeof own === 'string' && own.trim().length > 0;
}

/**
 * Drop every override that is byte-identical to the audience default it would inherit
 * anyway.
 *
 * The editor pre-fills each per-mail box with the resolved default, so simply opening
 * the section and pressing Publish would otherwise freeze today's default into all
 * seven mails as explicit overrides — and a later edit to the audience default would
 * then stop reaching them. Pruning keeps inheritance alive: only genuinely different
 * text is stored.
 */
export function pruneSignatures(signatures) {
  const byMail = signatures?.email_signatures_by_mail || {};
  const kept = Object.fromEntries(
    Object.entries(byMail).filter(([key, text]) => {
      if (typeof text !== 'string' || !text.trim()) return false;
      return text.trim() !== audienceDefault(signatures, key).trim();
    }),
  );
  return { ...signatures, email_signatures_by_mail: kept };
}

/**
 * Preview a template with the merge fields filled in. `{{sender_name}}` and
 * `{{sender_title}}` resolve only where a mail has a human sender, so on an automated
 * (admin-audience) mail those lines are dropped exactly as the server drops them.
 */
export function previewSignature(template, { audience, company }) {
  const human = audience !== 'admin';
  const values = {
    '{{sender_name}}': human ? 'Priya Raman' : '',
    '{{sender_title}}': human ? 'Project Manager' : '',
    '{{company_name}}': company?.company_name || 'Your Company',
    '{{phone}}': company?.contact?.contact_number || '',
    '{{website}}': company?.contact?.website || company?.website || '',
  };
  return String(template || '')
    .split('\n')
    .map((line) => {
      let filled = line;
      let sawField = false;
      let allEmpty = true;
      for (const [token, value] of Object.entries(values)) {
        if (!filled.includes(token)) continue;
        sawField = true;
        if (value) allEmpty = false;
        filled = filled.split(token).join(value);
      }
      // A line built only from fields that resolved empty is dropped, not left as
      // stray punctuation.
      if (sawField && allEmpty) return null;
      return filled.replace(/\s*·\s*$/, '').replace(/^\s*·\s*/, '').trim();
    })
    .filter((line) => line !== null && line !== '')
    .join('\n');
}
