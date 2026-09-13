import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';
import axios from 'axios';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TOKEN_FILE = path.join(__dirname, '..', 'api-token.json');

const LOGIN_URL = 'https://api.rydeu.com/app/vendors/login';

// Reverse-engineered from the Rydeu Driver Android app via mitmproxy - see
// git history for how it was captured. The token is a plain JWT (HS256,
// {userId, iat, exp}) with a 30-day lifetime and no refresh token, so
// "refreshing" just means logging in again with the account credentials.

function decodeJwtExpiry(token) {
  try {
    const payload = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString('utf8'));
    return payload.exp ? payload.exp * 1000 : null; // exp is seconds since epoch
  } catch (err) {
    return null;
  }
}

function loadToken() {
  try {
    if (fs.existsSync(TOKEN_FILE)) {
      return JSON.parse(fs.readFileSync(TOKEN_FILE, 'utf8'));
    }
  } catch (err) {
    console.error('Failed to load api-token.json:', err.message);
  }
  return null;
}

function saveToken(token) {
  const expiresAt = decodeJwtExpiry(token);
  const record = { token, expiresAt, obtainedAt: Date.now() };
  fs.writeFileSync(TOKEN_FILE, JSON.stringify(record, null, 2));
  return record;
}

// Hits the real login endpoint with the account credentials from .env.
// Throws on non-200 so callers fail loudly rather than silently polling
// with a stale/missing token.
export async function login() {
  const email = process.env.RYDEU_EMAIL;
  const password = process.env.RYDEU_PASSWORD;
  if (!email || !password) {
    throw new Error('RYDEU_EMAIL / RYDEU_PASSWORD not set in .env');
  }

  console.log('🔐 Logging in to Rydeu API...');
  const res = await axios.post(
    LOGIN_URL,
    { email, password },
    { headers: { 'Content-Type': 'application/json;charset=utf-8', Accept: 'application/json, text/plain, */*' } },
  );

  const token = res.data?.data?.token;
  if (!token) {
    throw new Error(`Login succeeded but no token in response: ${JSON.stringify(res.data)}`);
  }

  const record = saveToken(token);
  console.log(`✓ Logged in, token valid until ${new Date(record.expiresAt).toISOString()}`);
  return record.token;
}

// Returns a usable token, reusing the cached one if it's not close to
// expiring, otherwise logging in again. `bufferMs` is how much lead time to
// leave before actual expiry (default 1 day) so a token doesn't die mid-run.
export async function getValidToken(bufferMs = 24 * 60 * 60 * 1000) {
  const cached = loadToken();
  if (cached?.token && cached.expiresAt && cached.expiresAt - Date.now() > bufferMs) {
    return cached.token;
  }
  return login();
}

// Run if called directly: npm run relogin
if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  login().catch((err) => {
    console.error('❌ Login failed:', err.response?.data ?? err.message);
    process.exit(1);
  });
}
