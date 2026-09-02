import { chromium } from 'playwright';
import fs from 'fs';
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const COOKIES_FILE = path.join(__dirname, '..', 'cookies.json');
const STORAGE_FILE = path.join(__dirname, '..', 'storage.json');

export async function loginRydeu() {
  console.log('\n🔐 Rydeu Login Helper');
  console.log('====================\n');

  const browser = await chromium.launch({
    headless: false, // you log in by hand in this window
  });

  const context = await browser.newContext();
  const page = await context.newPage();

  try {
    console.log('🌐 Opening Rydeu login page...');
    await page.goto('https://supplier.rydeu.com/login', {
      waitUntil: 'domcontentloaded',
    });

    console.log('\n👉 Log in manually in the browser window that just opened.');
    console.log('   This script never sees your email/password — it just waits');
    console.log('   for the page to reach your dashboard, then saves the session.\n');

    // No timeout: wait as long as it takes you to log in.
    await page.waitForURL('**/dashboard/**', { timeout: 0 });

    console.log('✓ Login detected!');

    // Give the app a moment to finish writing cookies/localStorage.
    await page.waitForTimeout(2000);

    // Extract and save cookies
    const cookies = await context.cookies();
    fs.writeFileSync(COOKIES_FILE, JSON.stringify(cookies, null, 2));
    console.log(`✓ Cookies saved to ${COOKIES_FILE} (${cookies.length} cookies)`);

    // Extract and save localStorage/sessionStorage — many SPAs keep the real
    // auth token here rather than relying solely on cookies for client-side routing.
    const storage = await page.evaluate(() => ({
      localStorage: { ...window.localStorage },
      sessionStorage: { ...window.sessionStorage },
    }));
    fs.writeFileSync(STORAGE_FILE, JSON.stringify(storage, null, 2));
    console.log(`✓ Storage saved to ${STORAGE_FILE}`);
    console.log(`  localStorage keys: ${Object.keys(storage.localStorage).join(', ') || '(none)'}`);
    console.log(`  sessionStorage keys: ${Object.keys(storage.sessionStorage).join(', ') || '(none)'}`);

    console.log('\n✅ Authentication complete!');
    console.log('You can now run: npm run scrape\n');
  } catch (err) {
    console.error('❌ Login failed:', err.message);
  } finally {
    await browser.close();
  }
}

// Run if called directly
if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  loginRydeu().catch(console.error);
}
