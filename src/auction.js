import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';
import axios from 'axios';
import { getValidToken } from './apiAuth.js';
import { notifyAuctionFound } from './discord.js';

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

      // Mark as seen either way so this doesn't re-notify every run - the
      // item naturally drops off the board once anyone (you or a competing
      // supplier) accepts it, so a single nudge is enough.
      state.seenAuctions.push(auction.id);
    }

    if (state.seenAuctions.length > 1000) {
      state.seenAuctions = state.seenAuctions.slice(-1000);
    }
    saveState(state);

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
