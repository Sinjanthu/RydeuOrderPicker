import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const RULES_FILE = path.join(__dirname, '..', 'auto-accept-rules.json');

// Rules, in the order they're checked (see auctionMatchesRules):
//   1. Blackout window (23:00-07:00 Stockholm, everyday) - checked first,
//      blocks everything else regardless of pickup/price.
//   2. Arlanda pickup -> only accept if price > arlandaMinPrice (EUR -
//      confirmed via a real row: price is a plain top-level number, always
//      seen paired with currency.code "EUR" so far).
//   3. Non-Arlanda pickup -> accept immediately (no price condition).
// Anything that fails one of these is left for manual handling.
// See git history for the conversation this came from.
const DEFAULT_RULES = {
  blackoutStart: '23:00', // Europe/Stockholm, current wall-clock time - pauses attempts, not filtered by trip time
  blackoutEnd: '07:00',
  arlandaMinPrice: 74,
  // One-time bypass: the very first auction this code ever sees is
  // attempted regardless of every rule above, purely so there's one real,
  // complete recording of the accept flow to study - flips to true and
  // stays that way once used (see auction.js).
  firstAuctionStudied: false,
};

export function loadRules() {
  try {
    if (fs.existsSync(RULES_FILE)) {
      return { ...DEFAULT_RULES, ...JSON.parse(fs.readFileSync(RULES_FILE, 'utf8')) };
    }
  } catch (err) {
    console.error('Failed to load auto-accept-rules.json:', err.message);
  }
  return { ...DEFAULT_RULES };
}

export function saveRules(rules) {
  fs.writeFileSync(RULES_FILE, JSON.stringify(rules, null, 2));
  return rules;
}

export function updateRules(partial) {
  return saveRules({ ...loadRules(), ...partial });
}

function parseHHMM(str) {
  const m = /^(\d{1,2}):(\d{2})$/.exec(str || '');
  if (!m) return null;
  const h = parseInt(m[1], 10);
  const min = parseInt(m[2], 10);
  if (h > 23 || min > 59) return null;
  return h * 60 + min;
}

// Handles the window wrapping past midnight (e.g. 23:00-07:00).
function isWithinWindow(nowMinutes, startStr, endStr) {
  const start = parseHHMM(startStr);
  const end = parseHHMM(endStr);
  if (start === null || end === null || start === end) return false;
  return start < end
    ? nowMinutes >= start && nowMinutes < end
    : nowMinutes >= start || nowMinutes < end; // wraps midnight
}

function currentStockholmMinutes() {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/Stockholm',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(new Date());
  const h = parseInt(parts.find((p) => p.type === 'hour').value, 10);
  const m = parseInt(parts.find((p) => p.type === 'minute').value, 10);
  return h * 60 + m;
}

// Decides whether auto-accept should actually run for this auction right
// now, under the currently configured rules. Returns { eligible, reasons,
// rules, isFirstAuctionBypass } - reasons explains every rule that blocked
// it (empty array + eligible:true if none did), for logging/Discord.
export function auctionMatchesRules(auction) {
  const rules = loadRules();

  if (!rules.firstAuctionStudied) {
    return { eligible: true, reasons: [], rules, isFirstAuctionBypass: true };
  }

  const reasons = [];

  if (isWithinWindow(currentStockholmMinutes(), rules.blackoutStart, rules.blackoutEnd)) {
    reasons.push(`within blackout window (${rules.blackoutStart}-${rules.blackoutEnd} Stockholm time)`);
  } else if (/arlanda/i.test(auction.pickupLocation || '')) {
    if (!(typeof auction.price === 'number' && auction.price > rules.arlandaMinPrice)) {
      reasons.push(`Arlanda pickup priced at ${auction.price ?? 'unknown'} (needs > ${rules.arlandaMinPrice} to auto-accept)`);
    }
  }
  // else: non-Arlanda pickup, no blackout - eligible, no further checks.

  return { eligible: reasons.length === 0, reasons, rules, isFirstAuctionBypass: false };
}
