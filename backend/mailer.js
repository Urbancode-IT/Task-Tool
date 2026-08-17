// Sends email through the Gmail API using an OAuth2 refresh token.
// No SMTP and no third-party service. Reads credentials from environment:
//   GMAIL_CLIENT_ID, GMAIL_CLIENT_SECRET, GMAIL_REFRESH_TOKEN, EMAIL_FROM (or GMAIL_USER)
// If not configured, sendMail() is a safe no-op so the app keeps working.

let cachedToken = { value: null, expiresAt: 0 };

export function isMailConfigured() {
  return Boolean(
    process.env.GMAIL_CLIENT_ID &&
      process.env.GMAIL_CLIENT_SECRET &&
      process.env.GMAIL_REFRESH_TOKEN
  );
}

async function getAccessToken() {
  const now = Date.now();
  if (cachedToken.value && now < cachedToken.expiresAt - 60_000) return cachedToken.value;
  const body = new URLSearchParams({
    client_id: process.env.GMAIL_CLIENT_ID,
    client_secret: process.env.GMAIL_CLIENT_SECRET,
    refresh_token: process.env.GMAIL_REFRESH_TOKEN,
    grant_type: 'refresh_token',
  });
  const resp = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });
  if (!resp.ok) {
    throw new Error(`Gmail token refresh failed: ${resp.status} ${await resp.text()}`);
  }
  const data = await resp.json();
  cachedToken = {
    value: data.access_token,
    expiresAt: now + (Number(data.expires_in) || 3600) * 1000,
  };
  return cachedToken.value;
}

const EMAIL_FONT =
  "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";

// Fallbacks used until the company profile is loaded, and for any field left blank.
const DEFAULT_BRAND = {
  name: 'Seyal',
  product: 'Task Tool',
  primary: '#4f46e5',
  accent: '#06b6d4',
  footer: 'Seyal Task Tool · Urbancode',
  // `member`/`admin` are the per-audience defaults; `byMail` holds per-mail overrides
  // keyed by MAIL_TYPE (see below). A mail with no override uses its audience default.
  signatures: { member: '', admin: '', byMail: {} },
  vars: { company_name: '', phone: '', website: '' },
};

/**
 * Every mail the system sends. Keys are the contract shared with the admin editor —
 * renaming one orphans whatever the admin configured against it.
 */
export const MAIL_TYPES = [
  { key: 'mention', audience: 'member', label: 'Comment mention' },
  { key: 'task_assigned', audience: 'member', label: 'Task assigned' },
  { key: 'task_due_soon', audience: 'member', label: 'Task due soon' },
  { key: 'task_overdue', audience: 'member', label: 'Task overdue' },
  { key: 'eod_reminder', audience: 'member', label: 'EOD reminder' },
  { key: 'eod_pending_report', audience: 'admin', label: 'EOD pending summary (8pm)' },
  { key: 'eod_defaulters_locked', audience: 'admin', label: 'EOD defaulters locked (midnight)' },
];
let brand = { ...DEFAULT_BRAND };

/**
 * Point the email shell at the published company branding. Called at boot and
 * whenever the profile is republished, so notifications follow the same identity
 * as the app. The logo is deliberately not embedded: assets are stored as base64
 * data URLs, which most mail clients (Gmail included) refuse to render.
 * @param {{company_name?:string, legal_name?:string, colors?:{primary?:string, accent?:string},
 *          signatures?:{member?:string, admin?:string},
 *          contact?:{contact_number?:string, website?:string}, website?:string}} b
 */
export function applyEmailBranding(b = {}) {
  const name = b.company_name || b.legal_name || DEFAULT_BRAND.name;
  brand = {
    ...DEFAULT_BRAND,
    name,
    primary: b.colors?.primary || DEFAULT_BRAND.primary,
    accent: b.colors?.accent || DEFAULT_BRAND.accent,
    footer: b.legal_name || name,
    signatures: {
      member: b.signatures?.member || '',
      admin: b.signatures?.admin || '',
      byMail: b.signatures?.byMail || {},
    },
    vars: {
      company_name: name,
      phone: b.contact?.contact_number || '',
      website: b.contact?.website || b.website || '',
    },
  };
}

function escapeHtml(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

/**
 * Resolve a signature template into HTML.
 *
 * Merge fields resolve from the company profile, plus an optional human sender.
 * A line whose merge fields all resolve to nothing is dropped entirely, so
 * automated mails do not leave a blank `{{sender_name}}` line behind. Templates
 * are author-controlled but still escaped — they are rendered into every mail.
 *
 * A mail-specific template wins; otherwise the audience default is used, so an admin
 * only fills in the mails they actually want worded differently.
 *
 * @param {'member'|'admin'} audience
 * @param {{name?:string, title?:string}} [sender]
 * @param {string} [mailType] one of MAIL_TYPES[].key
 * @returns {string} HTML block, or '' when nothing is configured
 */
function renderSignature(audience, sender = {}, mailType = '') {
  const template =
    (mailType && brand.signatures.byMail?.[mailType]) ||
    brand.signatures[audience === 'admin' ? 'admin' : 'member'];
  if (!template || !String(template).trim()) return '';

  const map = {
    ...brand.vars,
    sender_name: sender.name || '',
    sender_title: sender.title || '',
  };

  const lines = String(template).split(/\r?\n/).filter((line) => {
    // Keep a line only if it still says something once merge fields resolve.
    const resolved = line.replace(/\{\{(\w+)\}\}/g, (_, k) => map[k] ?? '');
    return resolved.replace(/[\s·|,\-–—]/g, '') !== '';
  });
  if (!lines.length) return '';

  const html = lines
    .map((line) => escapeHtml(line.replace(/\{\{(\w+)\}\}/g, (_, k) => map[k] ?? '')))
    .join('<br />');

  return `<div style="margin:26px 0 0;padding-top:16px;border-top:1px solid #e5e9f0;font-family:${EMAIL_FONT};font-size:13px;line-height:1.6;color:#64748b;">${html}</div>`;
}

/**
 * Wrap inner email content in the branded Seyal shell — a professional,
 * table-based layout with inline styles for broad email-client compatibility.
 * Colors mirror the app theme (indigo #4f46e5 / #6366f1, slate neutrals).
 * @param {{heading?:string, contentHtml?:string, ctaUrl?:string, ctaLabel?:string, preheader?:string}} opts
 */
export function renderEmail({
  heading = '', contentHtml = '', ctaUrl = '', ctaLabel = '', preheader = '',
  audience = 'member', sender = null, mailType = '',
} = {}) {
  const cta = ctaLabel || `Open ${brand.name}`;
  const signatureHtml = renderSignature(audience, sender || {}, mailType);
  const headingHtml = heading
    ? `<h1 style="margin:0 0 16px;font-family:${EMAIL_FONT};font-size:19px;line-height:1.35;font-weight:700;color:#0f172a;">${heading}</h1>`
    : '';

  const button = ctaUrl
    ? `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:28px auto 8px;">
        <tr>
          <td align="center" bgcolor="${brand.primary}" style="border-radius:10px;">
            <a href="${ctaUrl}" target="_blank"
              style="display:inline-block;padding:13px 34px;font-family:${EMAIL_FONT};font-size:15px;font-weight:600;line-height:1;color:#ffffff;text-decoration:none;border-radius:10px;">
              ${cta} &rarr;
            </a>
          </td>
        </tr>
      </table>
      <p style="margin:6px 0 0;font-family:${EMAIL_FONT};font-size:12px;line-height:1.5;color:#94a3b8;text-align:center;">
        Or open this link:<br />
        <a href="${ctaUrl}" target="_blank" style="color:${brand.primary};text-decoration:none;word-break:break-all;">${ctaUrl}</a>
      </p>`
    : '';

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<meta name="x-apple-disable-message-reformatting" />
<meta name="color-scheme" content="light only" />
</head>
<body style="margin:0;padding:0;background-color:#eef2f7;-webkit-text-size-adjust:100%;">
  ${preheader ? `<div style="display:none;max-height:0;overflow:hidden;mso-hide:all;opacity:0;">${preheader}</div>` : ''}
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#eef2f7;padding:32px 12px;">
    <tr>
      <td align="center">
        <table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="width:600px;max-width:100%;">
          <!-- Brand header -->
          <tr>
            <td style="padding:0 4px 16px;">
              <span style="font-family:${EMAIL_FONT};font-size:22px;font-weight:800;letter-spacing:-0.2px;color:${brand.primary};">${brand.name}</span>
              <span style="font-family:${EMAIL_FONT};font-size:13px;font-weight:500;color:#94a3b8;margin-left:8px;">${brand.product}</span>
            </td>
          </tr>
          <!-- Card -->
          <tr>
            <td bgcolor="#ffffff" style="border:1px solid #e5e9f0;border-radius:14px;overflow:hidden;">
              <!-- accent bar -->
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
                <tr><td height="4" bgcolor="${brand.primary}" style="height:4px;line-height:4px;font-size:0;background-image:linear-gradient(90deg,${brand.primary},${brand.accent});">&nbsp;</td></tr>
              </table>
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
                <tr>
                  <td style="padding:34px 36px;font-family:${EMAIL_FONT};font-size:15px;line-height:1.65;color:#334155;">
                    ${headingHtml}
                    ${contentHtml}
                    ${button}
                    ${signatureHtml}
                  </td>
                </tr>
              </table>
            </td>
          </tr>
          <!-- Footer -->
          <tr>
            <td align="center" style="padding:22px 16px 4px;font-family:${EMAIL_FONT};font-size:12px;line-height:1.6;color:#94a3b8;">
              You are receiving this email because you are a member of the ${brand.name} workspace.<br />
              <span style="color:#cbd5e1;">${brand.footer}</span>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

function encodeSubject(subject) {
  // RFC 2047 so non-ASCII subjects are safe.
  return `=?UTF-8?B?${Buffer.from(String(subject || ''), 'utf-8').toString('base64')}?=`;
}

function toBase64Url(str) {
  return Buffer.from(str, 'utf-8')
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

/**
 * Send an HTML email. Returns true on success, false otherwise (never throws).
 * @param {{to:string, subject:string, html:string}} opts
 */
export async function sendMail({ to, subject, html }) {
  if (!isMailConfigured()) {
    console.warn('[mailer] Gmail not configured (missing GMAIL_* env). Skipping email to', to);
    return false;
  }
  if (!to) return false;
  try {
    const token = await getAccessToken();
    const from = process.env.EMAIL_FROM || process.env.GMAIL_USER || 'no-reply@localhost';
    const message =
      [
        `From: ${from}`,
        `To: ${to}`,
        `Subject: ${encodeSubject(subject)}`,
        'MIME-Version: 1.0',
        'Content-Type: text/html; charset="UTF-8"',
      ].join('\r\n') +
      '\r\n\r\n' +
      (html || '');
    const raw = toBase64Url(message);
    const resp = await fetch(
      'https://gmail.googleapis.com/gmail/v1/users/me/messages/send',
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ raw }),
      }
    );
    if (!resp.ok) {
      console.error('[mailer] Gmail send failed:', resp.status, await resp.text());
      return false;
    }
    let info = {};
    try { info = await resp.json(); } catch { /* ignore */ }
    console.log(`[mailer] sent to ${to} (gmail id: ${info.id || 'n/a'})`);
    return true;
  } catch (err) {
    console.error('[mailer] error sending email:', err.message);
    return false;
  }
}
