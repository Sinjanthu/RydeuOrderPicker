# 🚗 RydeuOrderPicker

Automated **auction watcher** for the Rydeu vendor/supplier account, with Discord notifications. Talks to Rydeu's vendor REST API directly (reverse-engineered — see below) rather than scraping the web dashboard, so a check is a couple of HTTP calls, not a browser launch.

**Features:**
- ✅ Polls Rydeu's real auction API directly (~1s per check, no browser)
- ✅ Discord notification the moment a new auction appears
- ✅ GitHub Actions automation, triggered ~every minute by an external timer
- ✅ Local dev mode with `npm start`
- ✅ Optional local video capture of the auction board when a new one appears
- 🚧 Auto-accept: scaffolded (`AUTO_ACCEPT` flag), not functional yet — see [Auto-Accept](#-auto-accept-status) below

---

## 🎯 Auctions vs. Orders — read this first

Rydeu's vendor app has two genuinely different flows, easy to mix up (this project did, once):

| | **Auctions** (what this project watches) | **Orders** (`bookingRequest`, manual-only) |
|---|---|---|
| Who sets the price | Rydeu / the system, fixed upfront | The vendor (you) submits a quote |
| Urgency | High — first vendor to accept wins, competing against other suppliers | Low — customer decides later, no race |
| Endpoint | `GET /app/vendors/auction` | `GET /app/vendors/bookingRequest` |
| Automated here? | Yes (detection) | No — `scraper.js` exists for manual use but isn't in the automated loop |

Only auctions are in the automated poll (`poll.js` → `auction.js`). Orders are a separate, non-urgent concern and are handled manually.

---

## 📋 Prerequisites

- **Node.js** 18+ ([download](https://nodejs.org/))
- **npm** 9+
- **Discord server** with webhook access
- **Rydeu supplier/vendor account**

---

## 🚀 Quick Start

### 1. Clone & Install

```bash
git clone https://github.com/Sinjanthu/RydeuOrderPicker.git
cd RydeuOrderPicker
npm install
```

### 2. Configure

```bash
cp .env.example .env
```

Edit `.env` — at minimum you need `RYDEU_EMAIL`, `RYDEU_PASSWORD`, and `DISCORD_WEBHOOK_URL` (Discord: Channel Settings → Integrations → Webhooks → New Webhook).

### 3. Log in

```bash
npm run relogin
```

Hits the real Rydeu login API with your `.env` credentials and saves the resulting JWT to `api-token.json` (gitignored). This is all `auction.js` needs — no browser involved. The token lasts 30 days with no refresh token, so `getValidToken()` (in `apiAuth.js`) re-logs-in automatically once it's within a day of expiring; you don't need to run this manually again in normal use.

(`npm run login` also exists — that's the *old*, Playwright-based browser login, which saves `cookies.json`/`storage.json` for `scraper.js` (orders) instead. Only needed if you're using orders scraping.)

### 4. Run

**Check auctions once:**
```bash
npm run auction
```

**Local continuous bot:**
```bash
npm start
```

---

## 🔧 Configuration

Edit `.env`:

| Variable | Default | Description |
|----------|---------|-------------|
| `RYDEU_EMAIL` / `RYDEU_PASSWORD` | - | Vendor account credentials, used by `apiAuth.js` to log in to the API |
| `DISCORD_WEBHOOK_URL` | - | Discord webhook for notifications |
| `SCRAPE_INTERVAL` | `300000` | Local bot (`npm start`) poll interval in ms — irrelevant to GitHub Actions, which is driven externally (see Deployment) |
| `HEADLESS` | `true` | Only affects `scraper.js` (orders) and `RECORD_ON_AUCTION`'s browser — auction *checking* itself has no browser |
| `DEBUG` | `false` | Enable debug logging |
| `RECORD_ON_AUCTION` | `false` | Local-only debug aid: records ~30s of video of the auction board whenever a genuinely new auction is found. Needs Playwright's browser installed (`npx playwright install chromium`). **Never set this in CI** — see [Auto-Accept](#-auto-accept-status) note on why. |
| `AUTO_ACCEPT` | `false` | Scaffolded, currently **inert** — see below. |

---

## 📁 Project Structure

```
RydeuOrderPicker/
├── src/
│   ├── index.js          # Local persistent bot (poll on an interval)
│   ├── poll.js            # One-shot: runs checkAuctions()
│   ├── auction.js         # Auction detection - hits the Rydeu API directly
│   ├── apiAuth.js         # Rydeu API login (JWT), reverse-engineered
│   ├── discord.js         # Discord webhook helper
│   ├── scraper.js         # Orders scraper (Playwright, manual use only)
│   ├── auth.js            # Playwright browser login, for scraper.js
│   └── session.js         # Cookie/localStorage persistence, for scraper.js
├── .github/workflows/
│   └── scraper.yml        # GitHub Actions - runs poll.js on trigger
├── .env.example           # Environment template
├── api-token.json         # Cached API JWT (git ignored)
├── auction-state.json     # Seen auction IDs (git ignored)
├── cookies.json / storage.json  # Playwright session, for scraper.js only (git ignored)
└── README.md               # This file
```

---

## 🔄 How It Works

### What's actually monitoring right now

The GitHub Actions workflow (`scraper.yml`), triggered externally roughly **once a minute** (see Deployment). Nothing runs continuously unless you also start the local bot (`npm start`) yourself.

### What happens when a new auction lands

1. `checkAuctions()` (in `auction.js`) calls `GET /app/vendors/auction` with a fresh/cached bearer token.
2. Each row returned is compared against `auction-state.json`'s `seenAuctions` list, tracked by the human-facing booking number (e.g. `SE219252748` — same ID format shown in the app and in Discord).
3. Anything not already in that list is genuinely new → a Discord notification goes out (`notifyAuctionFound`) with pickup/drop, transfer date, distance, passengers, transfer type.
4. It's immediately marked as seen (pushed into `auction-state.json`) so the next check — a minute later — doesn't re-notify for the same item. An item naturally drops off the board once anyone (you or a competing vendor) accepts it.
5. If running locally with `RECORD_ON_AUCTION=true`, a ~30s video of the auction board is also captured at this point (see `.env` table above).
6. **Nothing is accepted automatically.** The accept + vehicle-select request hasn't been captured yet (see Auto-Accept below), so this is still watch-and-notify only.

### How it "knows" — state tracking

`auction-state.json` is the entire memory: a flat list of booking numbers already notified about. GitHub Actions caches this file between runs (keyed by run ID, falling back to the last successful cache) so state survives across the ephemeral CI runners. Locally, it's just a file next to the project.

### GitHub Actions run, step by step
1. External timer (cron-job.org) fires `workflow_dispatch`
2. `npm ci` (no browser install needed — API only)
3. Restore `auction-state.json` from cache
4. `npm run poll` → logs in to the API fresh (cheap, ~1s), checks the auction endpoint, notifies on anything new
5. Save `auction-state.json` back to cache
6. On failure: separate job pings Discord

---

## 🤖 Auto-Accept status

The goal is full automation — accepting matching auctions automatically, not just detecting them. Two things are blocking that:

1. **The accept + vehicle-select API request has never been captured.** The auction board has been empty every time it's been checked, and you can't capture a request that never fires. Needs a live/populated auction to click through in the app while a traffic capture (mitmproxy + Frida, to bypass TLS pinning) is running.
2. **No rules engine yet.** Once accepting is possible, it still needs rules for *which* auctions to accept automatically (price threshold, distance, time-of-day, transfer type, etc.) — deliberately built after seeing real auction data, not guessed in advance.

`AUTO_ACCEPT` (env var) and a scaffolded check in `auction.js` exist already so wiring this in later is a small, contained change — not a redesign. Right now it does nothing regardless of its value.

**Next step:** capture a real, populated auction (row shape + the accept POST). `auction.js` already logs the raw row JSON the first time one appears, to help nail down the exact fields once that happens.

---

## 🐛 Troubleshooting

### "Login failed" / 401
```bash
npm run relogin
```
Re-checks `RYDEU_EMAIL`/`RYDEU_PASSWORD` against the real login endpoint and prints the API's actual error response.

### Discord notifications not working
1. Check `DISCORD_WEBHOOK_URL` in `.env`
2. Test webhook:
```bash
curl -X POST "YOUR_WEBHOOK_URL" \
  -H "Content-Type: application/json" \
  -d '{"content":"Test message"}'
```

### Orders scraper ("Not logged in" / cookies expired)
```bash
npm run login
# Re-authenticate via browser, save fresh cookies.json/storage.json
```
(Only relevant to `scraper.js`/orders — auctions don't use cookies at all.)

---

## 🔐 Security

- ✅ Credentials in `.env` (gitignored, never committed)
- ✅ `api-token.json`, `cookies.json`, `storage.json` all gitignored, auto-generated
- ✅ GitHub Actions uses encrypted repo secrets
- ✅ No passwords or tokens stored in code

**GitHub Actions secrets required:**
- `RYDEU_EMAIL`, `RYDEU_PASSWORD` — used to log in to the API fresh each run
- `DISCORD_WEBHOOK_URL`

---

## 🚀 Deployment

### GitHub Actions (Recommended)
1. Push to GitHub (repo must be **public** for unlimited free Actions minutes)
2. Actions tab → Enable workflows
3. Add repo secrets: `RYDEU_EMAIL`, `RYDEU_PASSWORD`, `DISCORD_WEBHOOK_URL`
4. The workflow only listens for `workflow_dispatch` (manual trigger) —
   GitHub's own `schedule:` trigger is documented as best-effort and was
   observed skipping runs for 1.7-5 hours at a stretch under load, useless
   for something racing other suppliers to accept an auction first. An
   external, actually-reliable timer drives it instead:
   1. Create a fine-grained PAT scoped to just this repo's Actions:
      [github.com/settings/personal-access-tokens/new](https://github.com/settings/personal-access-tokens/new)
      → repository access "Only select repositories" → `RydeuOrderPicker` →
      Permissions → Repository permissions → **Actions: Read and write**.
   2. Sign up free at [cron-job.org](https://cron-job.org) and create a cronjob:
      - URL: `https://api.github.com/repos/Sinjanthu/RydeuOrderPicker/actions/workflows/scraper.yml/dispatches`
      - Method: `POST`
      - Headers: `Authorization: Bearer <token from step 1>`,
        `Accept: application/vnd.github+json`,
        `X-GitHub-Api-Version: 2022-11-28`
      - Body: `{"ref":"main"}`
      - Schedule: as tight as you're comfortable with — currently running
        ~once a minute in practice (a run finishes in ~15-20s now that it's
        API-only, so there's plenty of headroom before overlapping runs
        become a real concern; `concurrency:` in the workflow queues
        overlaps rather than running them in parallel either way).
   3. Confirm: `gh run list --repo Sinjanthu/RydeuOrderPicker` should show
      runs genuinely close together, not hours apart.

### VPS/Local Server
```bash
# Keep running in background
npm start &

# Or use PM2
npm i -g pm2
pm2 start src/index.js --name "rydeu-auction-watcher"
pm2 startup
pm2 save
```

---

## 📝 License

MIT

---

**Built with ❤️ for Rydeu drivers**
