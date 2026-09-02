import { pathToFileURL } from 'url';
import { scrapeRydeuOrders } from './scraper.js';
import { checkAuctions } from './auction.js';

// One-shot combined run: check pending requests, then the auction board.
// Used by CI (npm run poll) and by the local persistent bot (index.js).
export async function poll() {
  await scrapeRydeuOrders();
  await checkAuctions();
}

// Run if called directly
if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  poll().catch(console.error);
}
