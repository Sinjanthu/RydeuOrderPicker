import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';
import axios from 'axios';
import { getValidToken } from './apiAuth.js';
import { notifyAuctionFound, notifyAutoAcceptAttempt } from './discord.js';
import { isAutoAcceptEnabled } from './autoAcceptState.js';

// Recording is opt-in and local-only (see recordAuctionBoard below) -
// Playwright is a lazy/dynamic import so a plain `npm run poll` (CI, no
// browser installed) never touches it unless RECORD_ON_AUCTION is set.

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const STATE_FILE = path.join(__dirname, '..', 'auction-state.json');

// NOT the same thing as /app/vendors/bookingRequest - that one is the
// manual-request flow (we set a price, customer decides later, no rush).
// This is the actual fixed-price, race-to-accept auction board, confirmed
// as a genuinely separate endpoint (its own path + limit/offset paging).
const AUCTION_URL = 'https://api.rydeu.com/app/vendors/auction';

function loadState() {
  try {
    if (fs.existsSync(STATE_FILE)) {
      return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
    }
  } catch (err) {
    console.log('Auction state file init');
  }
  return { seenAuctions: [] };
}

function saveState(state) {
  try {
    fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
  } catch (err) {
    console.error('Failed to save auction state:', err.message);
  }
}

// Night pickup window is 23:00-05:00 in the auction's own local timezone
// (the API gives both an ISO UTC instant and an IANA zone per row).
function isNightPickup(startDateTimeIso, timezone) {
  if (!startDateTimeIso) return false;
  try {
    const hour = parseInt(
      new Intl.DateTimeFormat('en-GB', {
        timeZone: timezone || 'UTC',
        hour: '2-digit',
        hourCycle: 'h23',
      }).format(new Date(startDateTimeIso)),
      10,
    );
    return hour >= 23 || hour < 5;
  } catch (err) {
    return false;
  }
}

// "06 Dec | 09:00" in the auction's own local timezone, matching the format
// Discord notifications have always shown.
function formatTransferDate(startDateTimeIso, timezone) {
  if (!startDateTimeIso) return 'N/A';
  const d = new Date(startDateTimeIso);
  const zone = timezone || 'UTC';
  const datePart = new Intl.DateTimeFormat('en-GB', { timeZone: zone, day: '2-digit', month: 'short' }).format(d);
  const timePart = new Intl.DateTimeFormat('en-GB', { timeZone: zone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(d);
  return `${datePart} | ${timePart}`;
}

function formatPassengers(row) {
  const parts = [`${row.totalAdultSeats ?? 0} adult${row.totalAdultSeats === 1 ? '' : 's'}`];
  if (row.totalChildSeats) parts.push(`${row.totalChildSeats} child${row.totalChildSeats === 1 ? '' : 'ren'}`);
  const bags = (row.smallCabinBaggageCount || 0) + (row.largeCheckInBaggageCount || 0);
  if (bags) parts.push(`${bags} bag${bags === 1 ? '' : 's'}`);
  return parts.join(', ');
}

// The auction endpoint has never actually returned a row yet (board's been
// empty every time it's been checked), so this shape is inferred from the
// sibling bookingRequest endpoint's schema rather than confirmed - it's
// deliberately defensive (lots of ?./??) so a real row's actual shape
// doesn't just crash this. Log the raw row the first time one shows up and
// tighten this once we see it.
function mapRow(row) {
  return {
    id: row.booking?.bookingNumber || row.id,
    transferDate: formatTransferDate(row.startDateTime, row.timezone),
    pickupLocation: row.pickupLocation?.formattedAddress || '?',
    dropLocation: row.dropLocation?.formattedAddress || '?',
    distanceKm: row.numberOfKms ?? row.totalNumberOfKms ?? null,
    passengers: formatPassengers(row),
    transferType: row.transferType || 'N/A',
    price: row.price ?? row.offerAmount ?? row.amount ?? null,
  };
}

// Local-only debug aid: opens a real headed/headless browser on the
// auction board and records ~30s of video, so a genuinely new auction can
// be *seen* (what it looks like on the actual dashboard) alongside the API
// notification. Deliberately does NOT click anything - same reasoning as
// always: an accept flow is a real, hard-to-reverse booking commitment, not
// something to guess-click through. Never wired into the CI workflow (see
// scraper.yml) - only runs when RECORD_ON_AUCTION=true is set locally,
// since it needs Playwright's browser installed, which is exactly the
// dependency the API migration removed from the automated path.
async function recordAuctionBoard() {
  try {
    const { chromium } = await import('playwright');
    const { restoreSession } = await import('./session.js');

    console.log('🎥 Recording auction board for 30s...');
    const dir = path.join(__dirname, '..', 'recordings');
    const browser = await chromium.launch({ headless: process.env.HEADLESS === 'true' });
    const context = await browser.newContext({ recordVideo: { dir } });
    const page = await context.newPage();
    await restoreSession(context);

    // 'networkidle' hangs to its full timeout here - this SPA apparently
    // keeps some background polling/websocket alive, so network activity
    // never actually goes quiet. 'domcontentloaded' + a short settle wait
    // is what actually works (confirmed live: full dashboard content in
    // ~2s vs. a 30s timeout stuck on the loading screen).
    await page.goto('https://supplier.rydeu.com/dashboard/auction', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(30_000);

    await context.close(); // finalizes the video file
    const videoPath = await page.video()?.path();
    await browser.close();

    console.log(`🎥 Recording saved: ${videoPath}`);
    return videoPath;
  } catch (err) {
    console.error('Recording failed (non-fatal):', err.message);
    return null;
  }
}

// Local-only, best-effort auto-accept. Genuinely unverified past the "View
// Details" click (the only step this project has ever confirmed works) -
// there is no known selector for accept/vehicle-select, so this guesses at
// common button text. Deliberately defensive about it:
//   - screenshots BEFORE every blind click, not just after, so there's a
//     record of what was actually on screen when a guess was made
//   - explicitly excludes anything that looks like it declines/cancels,
//     to bias mistakes toward "did nothing" over "did the opposite thing"
//   - records full video of the attempt and reports outcome + video to
//     Discord either way, success or failure, so nothing happens silently
// This is a real, hard-to-reverse action on a live account (accepting a
// booking is a real commitment) - treat the first real attempt as
// supervised, not fire-and-forget, and check the recording immediately.
async function attemptAutoAccept(auction) {
  const ACCEPT_WORDS = ['Accept', 'Confirm', 'Book Now', 'Submit'];
  const AVOID_WORDS = ['Decline', 'Reject', 'Cancel', 'Remove'];
  const acceptSelector = ACCEPT_WORDS.map((w) => `button:has-text("${w}")`).join(', ');

  const { chromium } = await import('playwright');
  const { restoreSession } = await import('./session.js');

  console.log(`🤖 Attempting to accept auction ${auction.id} (best-effort, unverified past View Details)...`);
  const dir = path.join(__dirname, '..', 'recordings');
  const browser = await chromium.launch({ headless: process.env.HEADLESS === 'true' });
  const context = await browser.newContext({ recordVideo: { dir } });
  const page = await context.newPage();
  const screenshots = [];

  try {
    await restoreSession(context);
    // See recordAuctionBoard above - 'networkidle' hangs to its full
    // timeout on this SPA, 'domcontentloaded' + a settle wait is what
    // actually works.
    await page.goto('https://supplier.rydeu.com/dashboard/auction', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(3_000);
    await page.locator('button:has-text("Got it")').click({ timeout: 2000 }).catch(() => {});

    const row = page.locator('table#table tbody tr').filter({ hasText: auction.id });
    if ((await row.count().catch(() => 0)) === 0) {
      throw new Error('Auction row not found on web dashboard (may already be taken)');
    }

    // Verified step - same click checkAuctions' predecessor always used.
    await row.locator(':text-is("View Details")').click({ timeout: 3000 });
    await page.waitForTimeout(2000);
    screenshots.push(await page.screenshot({ fullPage: true }));

    // Unverified from here - best-effort only.
    for (let step = 0; step < 3; step++) {
      const candidate = page.locator(acceptSelector).first();
      if ((await candidate.count().catch(() => 0)) === 0) break;

      const text = (await candidate.textContent().catch(() => '')) || '';
      if (AVOID_WORDS.some((w) => text.includes(w))) break; // paranoia - shouldn't match acceptSelector anyway

      screenshots.push(await page.screenshot({ fullPage: true })); // before the blind click
      console.log(`  → clicking "${text.trim()}"`);
      await candidate.click({ timeout: 3000 }).catch(() => {});
      await page.waitForTimeout(2000);
    }

    screenshots.push(await page.screenshot({ fullPage: true }));
    await context.close();
    const videoPath = await page.video()?.path();
    await browser.close();

    console.log(`🤖 Auto-accept attempt for ${auction.id} finished (unverified - check the recording).`);
    return { attempted: true, videoPath, screenshots };
  } catch (err) {
    console.error(`Auto-accept attempt for ${auction.id} failed:`, err.message);
    const failureScreenshot = await page.screenshot({ fullPage: true }).catch(() => null);
    await context.close().catch(() => {});
    const videoPath = await page.video()?.path().catch(() => null);
    await browser.close();
    return { attempted: false, reason: err.message, videoPath, screenshots: failureScreenshot ? [failureScreenshot] : [] };
  }
}

// Reads the live auction board straight from the Rydeu API (reverse-
// engineered - see src/apiAuth.js) instead of scraping the web dashboard
// with a browser. No browser dependency left for this check at all, which
// also sidesteps every Playwright/apt CI flake this project has hit.
//
// Accept + vehicle-select still isn't automatable: the bookingRequest
// listing itself has no vehicle type (it's chosen when an offer is
// submitted), and the endpoint that submits an offer/accepts a request
// hasn't been identified yet. So this still just notifies a human for each
// new auction rather than guessing at that flow.
export async function checkAuctions() {
  const state = loadState();

  try {
    console.log('🎯 Checking Rydeu Auction Board (API)...');
    const token = await getValidToken();

    const res = await axios.get(AUCTION_URL, {
      params: {
        bookingState: 2,
        q: '',
        fromTravelDate: '',
        toTravelDate: '',
        transferType: '',
        vehicleType: '',
        maxDistance: '',
        minDistance: '',
        sort: '["createdAt","DESC"]',
        limit: 10,
        offset: 0,
      },
      headers: { Authorization: `Bearer ${token}` },
    });

    const rows = res.data?.data?.rows || [];
    console.log(`📋 Found ${rows.length} auction(s)`);

    let foundNew = false;

    for (const row of rows) {
      // First confirmed row ever - shape is still unverified, so log it
      // raw for a sanity check until mapRow's field guesses are confirmed.
      console.log('Raw auction row:', JSON.stringify(row));
      const auction = mapRow(row);
      // Tracked by the human-facing booking number (e.g. "SE219252748"),
      // same identifier the old web-scraped version used and the same one
      // shown in Discord - keeps continuity with existing state/history.
      if (state.seenAuctions.includes(auction.id)) continue;

      console.log(`🆕 New auction: ${auction.id} — ${auction.pickupLocation} → ${auction.dropLocation}`);

      await notifyAuctionFound(auction, isNightPickup(row.startDateTime, row.timezone));
      foundNew = true;

      // Best-effort auto-accept (see attemptAutoAccept above for what "best
      // effort" means here - unverified past View Details). No rules
      // engine yet ("we will implement rules later"), so every new auction
      // is attempted when this is on - it isn't filtering by price/
      // distance/etc yet. Toggleable at runtime via the Discord
      // "auto accept rydeu" command (see src/autoAcceptState.js) rather
      // than only the static .env value, and local-only for the same
      // reason as RECORD_ON_AUCTION - never wired into the CI workflow.
      if (isAutoAcceptEnabled()) {
        const result = await attemptAutoAccept(auction);
        await notifyAutoAcceptAttempt(auction, result);
      }

      // Mark as seen either way so this doesn't re-notify every run - the
      // item naturally drops off the board once anyone (you or a competing
      // supplier) accepts it, so a single nudge is enough.
      state.seenAuctions.push(auction.id);
    }

    if (state.seenAuctions.length > 1000) {
      state.seenAuctions = state.seenAuctions.slice(-1000);
    }
    saveState(state);

    // Once per run, not once per auction - 30s is about the board, not any
    // one row.
    if (foundNew && process.env.RECORD_ON_AUCTION === 'true') {
      await recordAuctionBoard();
    }

    console.log('✓ Auction check complete');
  } catch (err) {
    console.error('Auction checker error:', err.response?.data ?? err.message);
    throw err;
  }
}

// Run if called directly
if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  checkAuctions().catch(console.error);
}
