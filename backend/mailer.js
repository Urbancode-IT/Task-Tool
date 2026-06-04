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
    return true;
  } catch (err) {
    console.error('[mailer] error sending email:', err.message);
    return false;
  }
}
