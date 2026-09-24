// Capture the real React screens using isolated sample data, never live events.
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';

const base = new URL(process.env.BASE_URL || 'http://127.0.0.1:4181');
if (!['127.0.0.1', 'localhost'].includes(base.hostname)) throw new Error('Screenshots require the isolated local fixture server.');
const browser = await chromium.launch({ headless: true, channel: process.env.PLAYWRIGHT_CHANNEL || undefined });
try {
  for (const device of [
    { folder: 'iphone-6.5', viewport: { width: 428, height: 926 }, deviceScaleFactor: 3, isMobile: true },
    { folder: 'ipad-13', viewport: { width: 1376, height: 1032 }, deviceScaleFactor: 2, isMobile: false },
  ]) {
    const folder = resolve('screenshots', device.folder);
    mkdirSync(folder, { recursive: true });
    const context = await browser.newContext(device);
    await context.route('**/*', route => {
      const url = new URL(route.request().url());
      return ['127.0.0.1', 'localhost'].includes(url.hostname) ? route.continue() : route.abort();
    });
    for (const [name, screen, theme] of [
      ['01-event-library', 'home', 'dark'],
      ['02-live-scoring', 'display', 'dark'],
      ['03-standings', 'leaderboard', 'light'],
      ['04-final-results', 'complete', 'dark'],
    ]) {
      const page = await context.newPage();
      await page.goto(`${base.origin}/scripts/design-check.html?page=${screen}&theme=${theme}`, { waitUntil: 'networkidle' });
      await page.evaluate(() => document.fonts.ready);
      await page.waitForTimeout(screen === 'complete' ? 5000 : 700);
      await page.screenshot({ path: resolve(folder, `${name}.png`) });
      console.log(`${device.folder}/${name}.png`);
      await page.close();
    }
    await context.close();
  }
} finally {
  await browser.close();
}
