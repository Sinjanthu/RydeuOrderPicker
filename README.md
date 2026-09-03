# 🚗 RydeuOrderPicker

Automated order scraper for Rydeu supplier dashboard with Discord notifications.

**Features:**
- ✅ Web scraping of Rydeu supplier dashboard
- ✅ Automatic detection of new orders/requests
- ✅ Discord webhook notifications
- ✅ Persistent cookie storage (no re-login needed)
- ✅ GitHub Actions automation (5-min cron job)
- ✅ Local development mode with `npm start`

---

## 📋 Prerequisites

- **Node.js** 18+ ([download](https://nodejs.org/))
- **npm** 9+
- **Discord server** with webhook access
- **Rydeu supplier account** (driver/vendor)

---

## 🚀 Quick Start

### 1. Clone & Install

```bash
git clone https://github.com/YOUR_USERNAME/RydeuOrderPicker.git
cd RydeuOrderPicker
npm install
```

### 2. Login to Rydeu (Save Cookies)

```bash
npm run login
```

This will:
- Open browser to Rydeu login
- Prompt for email/password in terminal
- Save authentication cookies to `cookies.json`
- Keep browser open for verification

**Note:** Cookies are saved to `cookies.json` (in .gitignore for security)

### 3. Set Up Discord Webhook

1. Go to your Discord server
2. Channel Settings → Integrations → Webhooks → New Webhook
3. Copy the webhook URL
4. Create `.env` file:

```bash
cp .env.example .env
```

Edit `.env`:
```ini
DISCORD_WEBHOOK_URL=https://discordapp.com/api/webhooks/YOUR_ID/YOUR_TOKEN
SCRAPE_INTERVAL=300000
HEADLESS=true
```

### 4. Run Scraper

**Local (continuous):**
```bash
npm start
```

**Single run:**
```bash
npm run scrape
```

**Development (with watch mode):**
```bash
npm run dev
```

---

## 🔧 Configuration

Edit `.env`:

| Variable | Default | Description |
|----------|---------|-------------|
| `DISCORD_WEBHOOK_URL` | - | Discord webhook for notifications |
| `SCRAPE_INTERVAL` | `300000` | Scrape interval in ms (300s = 5 min) |
| `HEADLESS` | `true` | Run browser headless (no UI) |
| `DEBUG` | `false` | Enable debug logging |

---

## 📁 Project Structure

```
RydeuOrderPicker/
├── src/
│   ├── index.js          # Main bot with scheduling
│   ├── scraper.js        # Playwright web scraper
│   ├── discord.js        # Discord webhook helper
│   └── auth.js           # Rydeu login handler
├── .github/workflows/
│   └── scraper.yml       # GitHub Actions (5-min cron)
├── .env.example          # Environment template
├── .gitignore            # Git ignore rules
├── package.json          # Dependencies
├── cookies.json          # Persisted auth (git ignored)
├── state.json            # Seen orders cache (git ignored)
└── README.md             # This file
```

---

## 🔄 How It Works

### Local Mode (`npm start`)
1. Loads saved cookies from `cookies.json`
2. Navigates to `supplier.rydeu.com/dashboard/requests`
3. Extracts pending order/request elements
4. Compares with seen orders in `state.json`
5. Sends Discord embed for new orders
6. Saves updated state & cookies
7. Repeats every `SCRAPE_INTERVAL` ms

### GitHub Actions (CI/CD)
1. Scheduled cron job every 5 minutes
2. Uses cached cookies from previous runs
3. Runs scraper in headless mode
4. Caches updated `cookies.json` & `state.json`
5. Sends Discord notifications on new orders
6. Notifies on failure (also via Discord)

---

## 🐛 Troubleshooting

### "Not logged in" error
```bash
npm run login
# Re-authenticate and save fresh cookies
```

### Discord notifications not working
1. Check `DISCORD_WEBHOOK_URL` in `.env`
2. Test webhook:
```bash
curl -X POST "YOUR_WEBHOOK_URL" \
  -H "Content-Type: application/json" \
  -d '{"content":"Test message"}'
```

### Scraper finds no orders
1. Check Rydeu dashboard manually: `https://supplier.rydeu.com/dashboard/requests`
2. Enable `DEBUG=true` in `.env` to see page structure
3. Open issue with debug logs

### Cookies expired
```bash
npm run login
# Refresh cookies
```

---

## 🔐 Security

- ✅ Credentials in `.env` (not in git)
- ✅ Cookies in `cookies.json` (not in git, auto-generated)
- ✅ GitHub Actions uses encrypted secrets
- ✅ No passwords stored in code

**For GitHub Actions:**
1. Go to repo Settings → Secrets and variables → Actions
2. Add `DISCORD_WEBHOOK_URL` secret
3. Workflow will use cached cookies

---

## 📊 Discord Notifications

Sample embed:
```
Title: 🚗 New Rydeu Order Request
Description: Incoming request
Fields:
  - Order ID: req_12345
  - Details: [Order details...]
Timestamp: 2024-01-15T10:30:00Z
Footer: Rydeu Order Picker
```

---

## 🚀 Deployment

### GitHub Actions (Free, Recommended)
1. Push to GitHub (repo must be **public** for unlimited free Actions
   minutes — every 5 minutes adds up fast on the private-repo 2,000 min/month
   quota. Secrets stay encrypted in GitHub's Secrets store either way, never
   in code, so this is safe.)
2. Actions tab → Enable workflows
3. Add `DISCORD_WEBHOOK_URL` secret
4. The workflow only listens for `workflow_dispatch` (manual trigger) —
   GitHub's own `schedule:` trigger used to be here, but is documented as
   best-effort and was observed skipping runs for 1.7-5 hours at a stretch
   under load, which defeats a scraper competing for time-sensitive orders.
   An external, actually-reliable timer drives it instead:
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
      - Schedule: every 5 minutes
   3. Confirm: `gh run list --repo Sinjanthu/RydeuOrderPicker` should show
      runs genuinely ~5 minutes apart, not hours.

### VPS/Local Server
```bash
# Keep running in background
npm start &

# Or use PM2
npm i -g pm2
pm2 start src/index.js --name "rydeu-scraper"
pm2 startup
pm2 save
```

---

## 📝 License

MIT

---

## 💬 Support

- Check `/src` files for detailed comments
- Enable `DEBUG=true` for verbose logging
- Open GitHub issues for bugs

---

## 🛠️ Contributing

1. Fork the repo
2. Create feature branch (`git checkout -b feature/amazing-feature`)
3. Commit changes (`git commit -m 'Add amazing feature'`)
4. Push to branch (`git push origin feature/amazing-feature`)
5. Open Pull Request

---

**Built with ❤️ for Rydeu drivers**
