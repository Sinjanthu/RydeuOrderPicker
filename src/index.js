import dotenv from 'dotenv';
import { poll } from './poll.js';

// Load environment variables
dotenv.config();

const SCRAPE_INTERVAL = parseInt(process.env.SCRAPE_INTERVAL || '300000', 10); // 5 minutes default

console.log('🤖 Rydeu Order Picker Bot');
console.log('========================\n');

async function runScraper() {
  try {
    console.log(`[${new Date().toISOString()}] Running scraper...`);
    await poll();
    console.log(`[${new Date().toISOString()}] Scraper complete\n`);
  } catch (err) {
    console.error(`[${new Date().toISOString()}] Error:`, err.message);
  }
}

async function main() {
  console.log(`📅 Scraper interval: ${SCRAPE_INTERVAL / 1000}s`);
  console.log(`🔗 Discord webhook: ${process.env.DISCORD_WEBHOOK_URL ? '✓ Set' : '✗ Not set'}\n`);

  // Run immediately
  await runScraper();

  // Then run on interval
  setInterval(runScraper, SCRAPE_INTERVAL);

  console.log('🟢 Bot running. Press Ctrl+C to stop.\n');
}

// Handle graceful shutdown
process.on('SIGINT', () => {
  console.log('\n👋 Shutting down gracefully...');
  process.exit(0);
});

main().catch(console.error);
