import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const COOKIES_FILE = path.join(__dirname, '..', 'cookies.json');
const STORAGE_FILE = path.join(__dirname, '..', 'storage.json');

export function loadCookies() {
  try {
    if (fs.existsSync(COOKIES_FILE)) {
      return JSON.parse(fs.readFileSync(COOKIES_FILE, 'utf8'));
    }
  } catch (err) {
    console.error('Failed to load cookies:', err.message);
  }
  return [];
}

export function saveCookies(cookies) {
  try {
    fs.writeFileSync(COOKIES_FILE, JSON.stringify(cookies, null, 2));
  } catch (err) {
    console.error('Failed to save cookies:', err.message);
  }
}

// Load persisted localStorage/sessionStorage (this SPA keeps its real auth
// state here — cookies alone aren't enough to be considered logged in).
export function loadStorage() {
  try {
    if (fs.existsSync(STORAGE_FILE)) {
      return JSON.parse(fs.readFileSync(STORAGE_FILE, 'utf8'));
    }
  } catch (err) {
    console.error('Failed to load storage:', err.message);
  }
  return { localStorage: {}, sessionStorage: {} };
}

export function saveStorage(storage) {
  try {
    fs.writeFileSync(STORAGE_FILE, JSON.stringify(storage, null, 2));
  } catch (err) {
    console.error('Failed to save storage:', err.message);
  }
}

// Restore a saved session into a fresh browser context: cookies directly,
// and localStorage/sessionStorage via an init script (must run before the
// app's own scripts, hence addInitScript rather than page.evaluate after nav).
export async function restoreSession(context) {
  const cookies = loadCookies();
  if (cookies.length > 0) {
    await context.addCookies(cookies);
  }

  const storage = loadStorage();
  await context.addInitScript((data) => {
    for (const [key, value] of Object.entries(data.localStorage || {})) {
      try { window.localStorage.setItem(key, value); } catch (e) { /* ignore */ }
    }
    for (const [key, value] of Object.entries(data.sessionStorage || {})) {
      try { window.sessionStorage.setItem(key, value); } catch (e) { /* ignore */ }
    }
  }, storage);
}

// Capture the live session back out of a context/page so the next run can
// reuse it (the SPA may rotate its token).
export async function persistSession(context, page) {
  saveCookies(await context.cookies());
  saveStorage(await page.evaluate(() => ({
    localStorage: { ...window.localStorage },
    sessionStorage: { ...window.sessionStorage },
  })));
}
