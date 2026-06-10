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

/**
 * Wrap inner email content in the branded Seyal shell.
 * Table-based with inline styles for broad email-client compatibility.
 * Colors mirror the app theme (indigo primary #4f46e5 / #6366f1, slate neutrals).
 * @param {{contentHtml?:string, ctaUrl?:string, ctaLabel?:string, preheader?:string}} opts
 */
export function renderEmail({ contentHtml = '', ctaUrl = '', ctaLabel = 'Open Seyal', preheader = '' } = {}) {
  const button = ctaUrl
    ? `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:28px 0 4px;">
        <tr>
          <td align="center" bgcolor="#4f46e5" style="border-radius:8px;">
            <a href="${ctaUrl}" target="_blank"
              style="display:inline-block;padding:12px 30px;font-family:'Segoe UI',Arial,sans-serif;font-size:14px;font-weight:600;line-height:1;color:#ffffff;text-decoration:none;border-radius:8px;">
              ${ctaLabel}
            </a>
          </td>
        </tr>
      </table>`
    : '';

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<meta name="color-scheme" content="light only" />
</head>
<body style="margin:0;padding:0;background-color:#f1f5f9;">
  ${preheader ? `<div style="display:none;max-height:0;overflow:hidden;opacity:0;">${preheader}</div>` : ''}
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#f1f5f9;padding:28px 12px;">
    <tr>
      <td align="center">
        <table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="width:600px;max-width:100%;">
          <!-- Header -->
          <tr>
            <td bgcolor="#4f46e5" style="background-image:linear-gradient(135deg,#4f46e5,#6366f1);border-radius:12px 12px 0 0;padding:22px 28px;">
              <span style="font-family:'Segoe UI',Arial,sans-serif;font-size:22px;font-weight:700;letter-spacing:0.5px;color:#ffffff;">Seyal</span>
              <span style="font-family:'Segoe UI',Arial,sans-serif;font-size:13px;color:#e0e7ff;margin-left:8px;">Task Tool</span>
            </td>
          </tr>
          <!-- Content card -->
          <tr>
            <td bgcolor="#ffffff" style="border-radius:0 0 12px 12px;padding:30px 28px;font-family:'Segoe UI',Arial,sans-serif;font-size:15px;line-height:1.6;color:#334155;">
              ${contentHtml}
              ${button}
            </td>
          </tr>
          <!-- Footer -->
          <tr>
            <td align="center" style="padding:18px 28px;font-family:'Segoe UI',Arial,sans-serif;font-size:12px;color:#94a3b8;">
              You received this email because you are a member of the Seyal workspace.<br />
              Seyal &middot; Task Tool
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
