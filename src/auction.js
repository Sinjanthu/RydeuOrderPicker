import 'dotenv/config';
import { chromium } from 'playwright';
import fs from 'fs';
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';
import { notifyAuctionAccepted, notifyAuctionFailed } from './discord.js';
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

// NOTE: the Auction Board is empty at the time this was written, so this
// reuses the same `table#table tbody tr` layout confirmed on the Requests
// page (both pages share the same "booking-requests" container classes,
// strongly suggesting the same table component). Watch the first real
// auction closely to confirm the "Accept" button matches before trusting
// this fully unattended.
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
      await persistSession(context, page);
      return;
    }

    const auctions = await page.evaluate(() => {
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

    console.log(`📋 Found ${auctions.length} auction(s)`);

    for (let i = 0; i < auctions.length; i++) {
      const auction = auctions[i];
      if (state.seenAuctions.includes(auction.id)) continue;

      console.log(`🆕 New auction: ${auction.id} — ${auction.pickupLocation} → ${auction.dropLocation}`);

      const row = page.locator('table#table tbody tr').nth(i);
      const acceptButton = row.locator('button:has-text("Accept")');

      try {
        await acceptButton.click({ timeout: 10000 });
        await page.waitForTimeout(1500); // let the accept action settle
        console.log(`✓ Accepted ${auction.id}`);

        await notifyAuctionAccepted(auction, isNightPickup(auction.transferDate));
      } catch (err) {
        console.error(`❌ Failed to accept ${auction.id}:`, err.message);
        await notifyAuctionFailed(auction, err.message);
        // Don't mark as seen — retry next run.
        continue;
      }

      state.seenAuctions.push(auction.id);
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
