/**
 * Editable mail templates.
 *
 * Subject, heading, body and button label for every mail Seyal sends. The defaults below
 * reproduce the wording the code shipped before templates existed; the master console
 * (Company & Branding → Email templates) can override any field per mail, stored on the
 * company profile under `email_templates_by_mail`.
 *
 * Keys must match MAIL_TYPES in mailer.js and the catalogue in
 * frontend/src/utils/mailTemplates.js. **Keep the three in step.**
 *
 * ## Body format
 *
 * Plain text. Blank lines separate paragraphs. `**bold**` becomes <strong>. Every
 * `{token}` is replaced with a value supplied by the sending code and HTML-escaped, so
 * a task title containing markup cannot inject anything.
 *
 * A paragraph consisting of a single BLOCK token — `{quote}`, `{table}`, `{list}` — is
 * replaced by a block of HTML the sending code renders (a quoted comment, the pending
 * table, the defaulters list). Those cannot be expressed as text, so the template only
 * decides *where* they appear. Dropping the token drops the block.
 */

const BLOCK_TOKENS = ['quote', 'table', 'list'];

/**
 * Shipped sign-offs per audience, used when the company profile stores none.
 *
 * These are no longer editable as an audience-wide value — the master console edits the
 * sign-off per mail — so without a code-level fallback an install that never published a
 * profile would send every mail with no sign-off at all. Mirrors DEFAULT_SIGNATURE and
 * DEFAULT_ADMIN_SIGNATURE in frontend/src/utils/emailSignatures.js.
 */
export const DEFAULT_SIGNATURES = {
  member: '{{sender_name}}\n{{sender_title}}\n{{company_name}}\n{{phone}} · {{website}}',
  admin: '{{company_name}} · Automated report\n{{phone}} · {{website}}',
};

/** Field set an override may carry. Anything else on the stored object is ignored. */
export const TEMPLATE_FIELDS = ['subject', 'heading', 'body', 'cta'];

export const MAIL_TEMPLATE_DEFAULTS = {
  mention: {
    subject: '{who} mentioned you on "{task}"',
    heading: 'You were mentioned in a comment',
    body: 'Hi {name},\n\n**{who}** mentioned you in a comment on **{task}**:\n\n{quote}',
    cta: 'Open task',
  },
  task_assigned: {
    subject: '{who} assigned you a task: "{task}"',
    heading: 'A task was assigned to you',
    body: 'Hi {name},\n\n**{who}** assigned you a new task: **{task}**.\n\n{quote}',
    cta: 'Open task',
  },
  task_due_soon: {
    subject: 'Due soon: "{task}"',
    heading: '{task} is due soon',
    body: 'Hi {name},\n\nThe task **{task}** is due on {date}.',
    cta: 'Open task',
  },
  task_overdue: {
    subject: 'Overdue: "{task}"',
    heading: '{task} is overdue',
    body: 'Hi {name},\n\nThe task **{task}** is overdue (was due {date}).',
    cta: 'Open task',
  },
  eod_reminder: {
    subject: 'Reminder: your EOD report for {date} is pending',
    heading: 'Reminder: submit your EOD report for {date}',
    body: [
      'Hi {name},',
      'Your EOD report for **{date}** has not been submitted yet (checked at {time}). '
        + 'Please take a minute to write it up before you finish for the day.',
      'Reports are due by midnight. If the day closes without one, your account is locked '
        + 'the next morning until an admin unlocks it.',
      'If you are on leave today, ask an admin to mark the day so these reminders stop. '
        + 'This is an automated reminder.',
    ].join('\n\n'),
    cta: 'Submit EOD report',
  },
  eod_pending_report: {
    subject: 'EOD not submitted ({count}) — {date}',
    heading: 'EOD not submitted — {date}',
    body: [
      'The following team members have not submitted an EOD report for **{date}** as of {time}.',
      '{table}',
      'Total pending: {count}. This is an automated daily summary.',
    ].join('\n\n'),
    cta: '',
  },
  eod_defaulters_locked: {
    subject: 'EOD defaulters locked ({count}) — {date}',
    heading: 'EOD defaulters locked — {date}',
    body: [
      'These members did not file an EOD report for **{date}**. Their accounts have been '
        + 'locked and they cannot sign in until an admin revokes the lock.',
      '{list}',
      'Total locked: {count}. This is an automated action taken at the day boundary.',
    ].join('\n\n'),
    cta: '',
  },
};

function escapeHtml(v) {
  return String(v ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** Substitute {token}s. `escape` is off only for the subject, which is not HTML. */
function fill(text, values, escape) {
  return String(text ?? '').replace(/\{(\w+)\}/g, (match, key) => {
    if (!(key in values)) return match;
    const v = values[key];
    return escape ? escapeHtml(v) : String(v ?? '');
  });
}

/** `**bold**` → <strong>. Applied after escaping, so it cannot introduce markup. */
function bold(html) {
  return html.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
}

/**
 * Render a body template to the HTML `renderEmail` expects.
 *
 * `blocks` maps a block token to ready-made HTML. A block token with no matching entry
 * yields nothing rather than a literal "{table}" in the mail.
 */
export function renderBody(body, values = {}, blocks = {}) {
  const paragraphs = String(body ?? '')
    .replace(/\r\n/g, '\n')
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter(Boolean);

  const out = [];
  for (const para of paragraphs) {
    const solo = /^\{(\w+)\}$/.exec(para);
    if (solo && BLOCK_TOKENS.includes(solo[1])) {
      const html = blocks[solo[1]];
      if (html) out.push(html);
      continue;
    }
    // Single newlines inside a paragraph become <br>, which is what someone typing a
    // short address block or list would expect.
    const inner = bold(escapeHtml(para)).replace(/\n/g, '<br>');
    out.push(`<p style="margin:0 0 16px;color:#334155;">${fill(inner, values, true)}</p>`);
  }
  return out.join('');
}

/** The stored override for one mail, with only the known fields and no blank strings. */
function overrideFor(templates, key) {
  const raw = templates?.[key];
  if (!raw || typeof raw !== 'object') return {};
  const out = {};
  for (const f of TEMPLATE_FIELDS) {
    // `cta` is legitimately empty on the two report mails, so an empty string is only
    // ignored when the default is non-empty — otherwise a deliberate blank is honoured.
    if (typeof raw[f] === 'string' && raw[f].trim()) out[f] = raw[f];
  }
  return out;
}

/**
 * Resolve one mail to its final parts.
 *
 * Falls back field by field, so an override that only changes the subject keeps the
 * shipped heading and body. An unknown key returns null and the caller keeps its own
 * hardcoded wording.
 */
export function resolveMail(key, templates, { values = {}, blocks = {} } = {}) {
  const base = MAIL_TEMPLATE_DEFAULTS[key];
  if (!base) return null;
  const over = overrideFor(templates, key);
  const merged = { ...base, ...over };
  return {
    // A newline in a subject would split the header, so collapse any whitespace.
    subject: fill(merged.subject, values, false).replace(/\s+/g, ' ').trim(),
    heading: fill(merged.heading, values, true),
    contentHtml: renderBody(merged.body, values, blocks),
    ctaLabel: fill(merged.cta, values, false).trim(),
  };
}
