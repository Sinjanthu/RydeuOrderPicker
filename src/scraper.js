import 'dotenv/config';
import { chromium } from 'playwright';
import fs from 'fs';
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';
import { notifyDiscord } from './discord.js';
import { restoreSession, persistSession } from './session.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const STATE_FILE = path.join(__dirname, '..', 'state.json');

// Load seen orders state
function loadState() {
  try {
    if (fs.existsSync(STATE_FILE)) {
      return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
    }
  } catch (err) {
    console.log('State file init');
  }
  return { seenOrders: [], lastScrape: null };
}

// Save state
function saveState(state) {
  try {
    fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
  } catch (err) {
    console.error('Failed to save state:', err.message);
  }
}

// Main scraper function
export async function scrapeRydeuOrders() {
  const browser = await chromium.launch({
    headless: process.env.HEADLESS !== 'false',
  });

  const context = await browser.newContext();
  const page = await context.newPage();

  const state = loadState();

  try {
    console.log('🚀 Starting Rydeu order scraper...');
    await restoreSession(context);
    console.log('📦 Loaded persisted session');

    // Navigate to Rydeu supplier dashboard
    console.log('🌐 Navigating to Rydeu dashboard...');
    await page.goto('https://supplier.rydeu.com/dashboard/account', {
      waitUntil: 'networkidle',
    });

    // This is a client-rendered SPA: an unauthenticated session gets
    // redirected client-side back to /login rather than server-rejected.
    const isLoggedIn = !page.url().includes('/login');

    if (!isLoggedIn) {
      console.log('⚠️  Not logged in (redirected to /login). Please run: npm run login');
      await browser.close();
      return;
    }

    console.log('✓ Logged in successfully');

    // Navigate to orders/requests page
    await page.goto('https://supplier.rydeu.com/dashboard/requests', {
      waitUntil: 'networkidle',
    });

    // Wait for the requests table to load
    await page.waitForSelector('table#table tbody tr', {
      timeout: 10000,
    }).catch(() => console.log('⚠️  No request rows found'));

    // Extract pending request information from the requests table.
    // Each row's cells are, in order: request id + created date, transfer
    // date, pickup location, drop location, distance (km), passengers/
    // baggage, transfer type, vehicle type, quote button.
    const orders = await page.evaluate(() => {
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
          fullText: row.innerText,
          timestamp: new Date().toISOString(),
        };
      }).filter((order) => order.id);
    });

    console.log(`📋 Found ${orders.length} orders/requests`);

    // Check for new orders
    for (const order of orders) {
      if (!state.seenOrders.includes(order.id)) {
        console.log(`🆕 New order detected: ${order.id}`);
        console.log(`   ${order.pickupLocation} → ${order.dropLocation}`);

        // Send Discord notification
        await notifyDiscord(order);

        state.seenOrders.push(order.id);
      }
    }

    // Clean up old entries (keep last 1000)
    if (state.seenOrders.length > 1000) {
      state.seenOrders = state.seenOrders.slice(-1000);
    }

    state.lastScrape = new Date().toISOString();
    saveState(state);

    // Save session for next run (the SPA may rotate its token)
    await persistSession(context, page);

    console.log('✓ Scrape complete');
  } catch (err) {
    console.error('Scraper error:', err.message);
    throw err;
  } finally {
    await browser.close();
  }
}

// Run if called directly
if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  scrapeRydeuOrders().catch(console.error);
}
