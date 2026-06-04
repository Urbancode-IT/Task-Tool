// Standalone Gmail send test — isolates email config from the app.
// Usage:  node scripts/test-mail.js recipient@example.com
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '..', '.env') });

const { sendMail, isMailConfigured } = await import('../mailer.js');

const to = process.argv[2];
if (!to) {
  console.error('Usage: node scripts/test-mail.js recipient@example.com');
  process.exit(1);
}

console.log('--- Gmail config check ---');
console.log('isMailConfigured     :', isMailConfigured());
console.log('GMAIL_CLIENT_ID set  :', Boolean(process.env.GMAIL_CLIENT_ID));
console.log('GMAIL_CLIENT_SECRET  :', Boolean(process.env.GMAIL_CLIENT_SECRET));
console.log('GMAIL_REFRESH_TOKEN  :', Boolean(process.env.GMAIL_REFRESH_TOKEN));
console.log('EMAIL_FROM / GMAIL_USER:', process.env.EMAIL_FROM || process.env.GMAIL_USER || '(none)');
console.log('Node fetch available :', typeof fetch === 'function');
console.log('--------------------------');

const ok = await sendMail({
  to,
  subject: 'Task Tool — test email',
  html: '<p>This is a test email from Task Tool. If you received it, Gmail sending works.</p>',
});

console.log('sendMail result      :', ok);
process.exit(ok ? 0 : 2);
