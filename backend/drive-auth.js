import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import dotenv from 'dotenv';
import { google } from 'googleapis';

dotenv.config({ path: path.resolve('.env') });

const PORT = 42813;
const redirect = `http://127.0.0.1:${PORT}/oauth2callback`;
const clientId = String(process.env.GOOGLE_DRIVE_CLIENT_ID || '').trim();
const clientSecret = String(process.env.GOOGLE_DRIVE_CLIENT_SECRET || '').trim();

if (!clientId || !clientSecret) {
  console.error('Set GOOGLE_DRIVE_CLIENT_ID and GOOGLE_DRIVE_CLIENT_SECRET in backend/.env. Do not reuse the other project’s Gmail client.');
  process.exit(1);
}

const oauth = new google.auth.OAuth2(clientId, clientSecret, redirect);
const url = oauth.generateAuthUrl({
  access_type: 'offline',
  prompt: 'consent',
  scope: ['https://www.googleapis.com/auth/drive'],
});

const server = http.createServer(async (req, res) => {
  const reqUrl = new URL(req.url || '/', redirect);
  if (reqUrl.pathname !== '/oauth2callback') {
    res.writeHead(404);
    res.end();
    return;
  }
  const code = reqUrl.searchParams.get('code');
  const oauthError = reqUrl.searchParams.get('error');
  if (oauthError || !code) {
    res.end('Drive authorization was not completed. Close this tab and run the command again.');
    server.close();
    process.exit(1);
  }
  try {
    const { tokens } = await oauth.getToken(code);
    if (!tokens.refresh_token) {
      res.end('Google did not return a refresh token. Remove this app under Google Account permissions and try again.');
      server.close();
      process.exit(1);
    }
    const envPath = path.resolve('.env');
    let env = fs.readFileSync(envPath, 'utf8');
    const line = `GOOGLE_DRIVE_REFRESH_TOKEN=${tokens.refresh_token}`;
    if (/^GOOGLE_DRIVE_REFRESH_TOKEN=/m.test(env)) {
      env = env.replace(/^GOOGLE_DRIVE_REFRESH_TOKEN=.*$/m, line);
    } else {
      if (!env.endsWith('\n')) env += '\n';
      env += `${line}\n`;
    }
    fs.writeFileSync(envPath, env);
    res.end('Drive is connected. You can close this tab and restart the backend.');
    console.log('Saved Drive access for the signed-in Google account. Restart the backend, then upload again.');
    server.close();
    process.exit(0);
  } catch (err) {
    console.error('Drive authorization failed:', err?.message || err);
    res.end('Drive authorization failed. Check the terminal.');
    server.close();
    process.exit(1);
  }
});

server.listen(PORT, '127.0.0.1', () => {
  console.log('Sign in as the Google account that owns the DM Root folder:');
  console.log(url);
});
