import { pathToFileURL } from 'url';
import { checkAuctions } from './auction.js';

// Orders (scraper.js) are the opposite flow from auctions - we set a price
// and the customer decides later, no rush - so they're handled manually
// and don't belong in this fast automated loop. Auctions are a race (the
// customer's price is fixed, suppliers race to accept it first), which is
// what this actually needs to run often and fast for. See git history if
// orders polling needs to come back.
export async function poll() {
  await checkAuctions();
}

// Run if called directly
if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  poll().catch(console.error);
}
