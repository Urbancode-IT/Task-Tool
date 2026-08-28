/**
 * Editable mail templates — subject, heading, body and button label per mail.
 *
 * Stored on the company profile under `email_templates_by_mail`. Owned by the master
 * console (Company & Branding → Email templates).
 *
 * **These defaults mirror `backend/mailTemplates.js` and must stay in step with it.**
 * The backend is the authority at send time; this copy exists so the editor can pre-fill
 * each box with the text that will really go out, and preview it.
 *
 * ## Body format
 *
 * Plain text. Blank lines separate paragraphs, `**bold**` renders bold, and `{token}`s
 * are replaced at send time. A paragraph that is just a BLOCK token — `{quote}`,
 * `{table}`, `{list}` — is replaced by a block the server generates (the quoted comment,
 * the pending table, the defaulters list). Remove the token to drop that block.
 */

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

/**
 * The tokens each mail can use, with a sample value for the preview. Only these resolve
 * — anything else is left as literal text, which is how a stray `{foo}` shows up.
 */
export const MAIL_TOKENS = {
  mention: { name: 'Suchithra', who: 'Priya Raman', task: 'Landing page redesign', quote: '(block)' },
  task_assigned: { name: 'Suchithra', who: 'Priya Raman', task: 'Landing page redesign', quote: '(block)' },
  task_due_soon: { name: 'Suchithra', task: 'Landing page redesign', date: '24/08/2026' },
  task_overdue: { name: 'Suchithra', task: 'Landing page redesign', date: '24/08/2026' },
  eod_reminder: { name: 'Suchithra', date: '2026-08-24', time: '17:30' },
  eod_pending_report: { date: '2026-08-24', count: '3', time: '00:00', table: '(block)' },
  eod_defaulters_locked: { date: '2026-08-24', count: '2', list: '(block)' },
};

/** Tokens that stand for a generated block rather than a value. */
export const BLOCK_TOKENS = ['quote', 'table', 'list'];

export const EMPTY_TEMPLATES = {};

/** Read the stored overrides, keeping only known fields with actual content. */
export function templatesFrom(profile) {
  const raw = profile?.email_templates_by_mail || {};
  const out = {};
  for (const [key, val] of Object.entries(raw)) {
    if (!MAIL_TEMPLATE_DEFAULTS[key] || !val || typeof val !== 'object') continue;
    const fields = {};
    for (const f of TEMPLATE_FIELDS) {
      if (typeof val[f] === 'string' && val[f].trim()) fields[f] = val[f];
    }
    if (Object.keys(fields).length) out[key] = fields;
  }
  return out;
}

/** One field's effective value: the override if set, else the shipped default. */
export function templateField(templates, mailKey, field) {
  const over = templates?.[mailKey]?.[field];
  if (typeof over === 'string' && over.trim()) return over;
  return MAIL_TEMPLATE_DEFAULTS[mailKey]?.[field] ?? '';
}

/** True when this field differs from what the code ships. */
export function isFieldOverridden(templates, mailKey, field) {
  const over = templates?.[mailKey]?.[field];
  if (typeof over !== 'string' || !over.trim()) return false;
  return over.trim() !== (MAIL_TEMPLATE_DEFAULTS[mailKey]?.[field] ?? '').trim();
}

/** How many fields this mail overrides, for the row badge. */
export function overriddenCount(templates, mailKey) {
  return TEMPLATE_FIELDS.filter((f) => isFieldOverridden(templates, mailKey, f)).length;
}

export function sameTemplates(a, b) {
  const keys = new Set([...Object.keys(a || {}), ...Object.keys(b || {})]);
  for (const k of keys) {
    for (const f of TEMPLATE_FIELDS) {
      if ((a?.[k]?.[f] || '') !== (b?.[k]?.[f] || '')) return false;
    }
  }
  return true;
}

/**
 * Drop every field identical to the shipped default.
 *
 * The editor pre-fills each box with the resolved default, so without this a single
 * Publish would freeze today's wording into all seven mails — and a future change to a
 * default would never reach them.
 */
export function pruneTemplates(templates) {
  const out = {};
  for (const key of Object.keys(templates || {})) {
    const fields = {};
    for (const f of TEMPLATE_FIELDS) {
      if (isFieldOverridden(templates, key, f)) fields[f] = templates[key][f];
    }
    if (Object.keys(fields).length) out[key] = fields;
  }
  return out;
}

/** Set one field, or clear it (back to the default) when the text matches the default. */
export function setTemplateField(templates, mailKey, field, text) {
  const next = { ...(templates || {}) };
  const mail = { ...(next[mailKey] || {}) };
  mail[field] = text;
  next[mailKey] = mail;
  return next;
}

/** Clear every override on one mail, returning it to the shipped wording. */
export function resetTemplate(templates, mailKey) {
  const next = { ...(templates || {}) };
  delete next[mailKey];
  return next;
}

const esc = (v) => String(v ?? '');

/** Fill {token}s from the sample values, leaving unknown tokens visible. */
export function fillTokens(text, mailKey) {
  const values = MAIL_TOKENS[mailKey] || {};
  return esc(text).replace(/\{(\w+)\}/g, (m, k) => (k in values ? values[k] : m));
}

/**
 * Split a body into preview paragraphs. Block tokens come back flagged so the preview
 * can show a placeholder for the generated table/list rather than the literal token.
 */
export function previewParagraphs(body, mailKey) {
  return String(body ?? '')
    .replace(/\r\n/g, '\n')
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter(Boolean)
    .map((para) => {
      const solo = /^\{(\w+)\}$/.exec(para);
      if (solo && BLOCK_TOKENS.includes(solo[1])) {
        return { block: solo[1], text: '' };
      }
      return { block: null, text: fillTokens(para, mailKey) };
    });
}
