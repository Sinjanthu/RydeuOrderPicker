import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const STATE_FILE = path.join(__dirname, '..', 'auto-accept-state.json');

// Runtime-toggleable, unlike a plain .env value - the Discord
// "auto accept rydeu" command (see src/discordBot.js) flips this file, and
// auction.js reads it fresh on every check instead of a static process.env
// value that would need a restart to change. Falls back to the .env
// AUTO_ACCEPT value only the very first time (no state file yet) so
// existing setups keep working without extra steps.
export function isAutoAcceptEnabled() {
  try {
    if (fs.existsSync(STATE_FILE)) {
      return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8')).enabled === true;
    }
  } catch (err) {
    console.error('Failed to read auto-accept-state.json:', err.message);
  }
  return process.env.AUTO_ACCEPT === 'true';
}

export function setAutoAccept(enabled) {
  fs.writeFileSync(STATE_FILE, JSON.stringify({ enabled, updatedAt: new Date().toISOString() }, null, 2));
  return enabled;
}
