import { chromium } from 'playwright';
import { pathToFileURL } from 'url';
import { persistSession } from './session.js';

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

    await persistSession(context, page);
    console.log('✓ Session saved (cookies.json + storage.json)');

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
