import 'dotenv/config';
import { chromium } from 'playwright';
import fs from 'fs';
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';
import { notifyAuctionFailed, notifyAuctionNeedsManualStep } from './discord.js';
import { restoreSession, persistSession } from './session.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const STATE_FILE = path.join(__dirname, '..', 'auction-state.json');

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

// Transfer date cells look like "11 Sep | 00:30" — pull the hour out to
// decide whether this is a night pickup (23:00–05:00).
function isNightPickup(transferDate) {
  const match = /(\d{1,2}):(\d{2})/.exec(transferDate || '');
  if (!match) return false;
  const hour = parseInt(match[1], 10);
  return hour >= 23 || hour < 5;
}

// The `table#table tbody tr` row layout is confirmed correct against real
// auctions (id/dates/locations all extracted correctly on 2026-09-06 and
// 2026-09-09). Two live rows have now shown the row action button reads
// "View Details" — not "Accept" — so accepting is at least a two-step flow.
// The user accepted both manually via the phone app, describing a vehicle
// selection step ("selected the first available car"), meaning there's a
// second screen we've never seen the markup of. Rather than guess-click
// through an unverified screen that ends in a real, hard-to-reverse booking
// commitment, this opens that screen and hands it to a human with a
// screenshot instead of attempting to finish the flow blindly.
export async function checkAuctions() {
  const browser = await chromium.launch({
    headless: process.env.HEADLESS !== 'false',
  });

  const context = await browser.newContext();
  const page = await context.newPage();

  const state = loadState();

  try {
    console.log('🎯 Checking Rydeu Auction Board...');
    await restoreSession(context);

    await page.goto('https://supplier.rydeu.com/dashboard/auction', {
      waitUntil: 'networkidle',
    });

    if (page.url().includes('/login')) {
      console.log('⚠️  Not logged in (redirected to /login). Please run: npm run login');
      await browser.close();
      return;
    }

    // Dismiss the onboarding tooltip overlay if it's covering the board.
    await page.locator('button:has-text("Got it")').click({ timeout: 2000 }).catch(() => {});

    const hasRows = await page.locator('table#table tbody tr').count().catch(() => 0);
    if (hasRows === 0) {
      console.log('📭 No new auctions');
      saveState(state);
      await persistSession(context, page);
      return;
    }

    const extractAuctions = () => page.evaluate(() => {
      const rows = Array.from(document.querySelectorAll('table#table tbody tr'));
      return rows.map((row) => {
        const cells = row.querySelectorAll('td');
        const get = (i) => cells[i]?.innerText.trim() ?? '';
        const id = cells[0]?.querySelector('p')?.innerText.trim() ?? get(0).split('\n')[0];
        return {
          id,
          transferDate: get(1),
          pickupLocation: get(2),
          dropLocation: get(3),
          distanceKm: get(4),
          passengers: get(5),
          transferType: get(6),
          vehicleType: get(7),
        };
      }).filter((a) => a.id);
    });

    let auctions = await extractAuctions();
    console.log(`📋 Found ${auctions.length} auction(s)`);

    // Loop by re-fetching + matching on id (not a fixed row index) each time:
    // opening "View Details" likely navigates away from this table, which
    // would invalidate positional locators for whatever's left to process.
    let auction;
    while ((auction = auctions.find((a) => !state.seenAuctions.includes(a.id)))) {
      console.log(`🆕 New auction: ${auction.id} — ${auction.pickupLocation} → ${auction.dropLocation}`);

      const row = page.locator('table#table tbody tr').filter({ hasText: auction.id });
      const viewDetailsButton = row.locator(':text-is("View Details")');

      try {
        // Short timeout: this is a race against other suppliers for the same
        // booking, so fail fast and hand it to a human rather than burn the
        // window retrying a selector that isn't going to start matching.
        await viewDetailsButton.click({ timeout: 3000 });
        await page.waitForTimeout(2500); // let the details screen render

        // Unverified past this point — send a screenshot rather than guess
        // at a vehicle-select + accept flow that would create a real booking.
        const screenshot = await page.screenshot({ fullPage: true });
        await notifyAuctionNeedsManualStep(auction, screenshot, isNightPickup(auction.transferDate));
        console.log(`📸 Opened details for ${auction.id}, sent screenshot for manual accept`);
      } catch (err) {
        console.error(`❌ Failed to open details for ${auction.id}:`, err.message);
        const rowHtml = await row.evaluate((el) => el.outerHTML).catch(() => '(could not read row HTML)');
        await notifyAuctionFailed(auction, `${err.message}\n\nRow HTML:\n${rowHtml}`);
        // Mark as seen anyway: the row selector itself is fine (row data
        // extracted correctly), so retrying wouldn't behave differently —
        // avoid spamming the same failure notification every run.
        state.seenAuctions.push(auction.id);
        // Back to the board before the next iteration re-extracts rows.
        await page.goto('https://supplier.rydeu.com/dashboard/auction', { waitUntil: 'networkidle' });
        await page.locator('button:has-text("Got it")').click({ timeout: 2000 }).catch(() => {});
        auctions = await extractAuctions();
        continue;
      }

      // Mark as seen either way so this doesn't re-notify every run — the
      // item naturally drops off the board once anyone (you or a competing
      // supplier) accepts it, so a single nudge is enough.
      state.seenAuctions.push(auction.id);

      // Back to the board before the next iteration re-extracts rows.
      await page.goto('https://supplier.rydeu.com/dashboard/auction', { waitUntil: 'networkidle' });
      await page.locator('button:has-text("Got it")').click({ timeout: 2000 }).catch(() => {});
      auctions = await extractAuctions();
    }

    if (state.seenAuctions.length > 1000) {
      state.seenAuctions = state.seenAuctions.slice(-1000);
    }
    saveState(state);

    await persistSession(context, page);
    console.log('✓ Auction check complete');
  } catch (err) {
    console.error('Auction checker error:', err.message);
    throw err;
  } finally {
    await browser.close();
  }
}

// Run if called directly
if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  checkAuctions().catch(console.error);
}
