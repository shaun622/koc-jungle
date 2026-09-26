// Browser rehearsal of the iPad's directly editable, TV-mirrored scoreboard.
// Only synthetic fixtures and localhost requests are allowed.
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { chromium } from 'playwright';
import { createServer } from 'vite';

process.env.VITE_SUPABASE_URL = '';
process.env.VITE_SUPABASE_ANON_KEY = '';
const server = await createServer({ server: { host: '127.0.0.1', port: 4199, strictPort: true, open: false } });
await server.listen();
const base = 'http://127.0.0.1:4199';
let browser;
let checks = 0;
try {
  browser = await chromium.launch({ channel: 'msedge', headless: true });
  const context = await browser.newContext({ serviceWorkers: 'block' });
  await context.route('**/*', (route) => new URL(route.request().url()).origin === base ? route.continue() : route.abort());
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await mkdir('screenshots/americano-setup', { recursive: true });
  for (const [width, height] of [[1024, 768], [1180, 820], [1366, 1024]]) {
    await page.setViewportSize({ width, height });
    for (const mode of ['rotating', 'fixed']) for (const courts of [4, 8]) for (const format of ['rally', 'traditional']) {
      const label = `${width}×${height} ${mode} ${courts} courts ${format}`;
      console.log(`Checking ${label}`);
      await page.goto(`${base}/scripts/americano-setup-check.html?demo=live&mode=${mode}&courts=${courts}&format=${format}`);
      await page.locator('.amv3-match-slot:not([hidden])').first().waitFor();
      const result = await page.evaluate(() => {
        const panel = document.querySelector('.amv3-leaderboard').getBoundingClientRect();
        const rows = [...document.querySelectorAll('.amv3-leaderboard li')];
        const cards = [...document.querySelectorAll('.amv3-match-slot:not([hidden])')];
        return {
          scrollWidth: document.documentElement.scrollWidth,
          scrollHeight: document.documentElement.scrollHeight,
          viewportWidth: innerWidth,
          viewportHeight: innerHeight,
          standingsFit: rows.every((row) => row.getBoundingClientRect().bottom <= panel.bottom + 1),
          courtLabels: cards.map((card) => card.querySelector('.amv3-match>header>span')?.textContent),
          controlsFit: cards.every((card) => {
            const bounds = card.getBoundingClientRect();
            return [...card.querySelectorAll('button,input')].every((control) => {
              const rect = control.getBoundingClientRect();
              return rect.left >= bounds.left - 1 && rect.right <= bounds.right + 1 && rect.top >= bounds.top - 1 && rect.bottom <= bounds.bottom + 1;
            });
          }),
        };
      });
      assert(result.scrollWidth <= result.viewportWidth + 1, `${label}: horizontal scroll`);
      assert(result.scrollHeight <= result.viewportHeight + 1, `${label}: vertical scroll`);
      assert(result.standingsFit, `${label}: standings clipped`);
      assert(result.controlsFit, `${label}: score control clipped`);
      assert.equal(result.courtLabels.length, format === 'traditional' ? 2 : 4, `${label}: wrong court page size`);
      if (courts === 8) {
        await page.getByRole('button', { name: 'Next courts' }).click();
        const nextLabels = await page.locator('.amv3-match-slot:not([hidden]) .amv3-match>header>span:first-child').allTextContents();
        assert(nextLabels.every((name) => !result.courtLabels.includes(name)), `${label}: next page repeated courts`);
      }
      if (width === 1024 && courts === 8 && format === 'rally') await page.screenshot({ path: `screenshots/americano-setup/ipad-landscape-${mode}.png` });
      checks++;
    }
  }
  // Changing court pages must not discard a score that has not been saved yet.
  await page.setViewportSize({ width: 1024, height: 768 });
  await page.goto(`${base}/scripts/americano-setup-check.html?demo=live&mode=rotating&courts=8`);
  await page.locator('.amv3-match-slot:not([hidden])').first().waitFor();
  const first = page.locator('.amv3-match-slot:not([hidden])').first();
  await first.getByRole('spinbutton').nth(0).fill('10');
  await first.getByRole('spinbutton').nth(1).fill('8');
  await page.getByRole('button', { name: 'Next courts' }).click();
  await page.getByRole('button', { name: 'Previous courts' }).click();
  assert.deepEqual(await Promise.all([0, 1].map((index) => first.getByRole('spinbutton').nth(index).inputValue())), ['10', '8'], 'Court paging discarded unsaved scores');
  await first.getByLabel('Time ran out — use score played').check();
  await first.getByRole('button', { name: 'Confirm result' }).click();
  await page.getByText('1/8 confirmed', { exact: true }).waitFor();
  await page.getByRole('button', { name: 'Next courts' }).click();
  const fifth = page.locator('.amv3-match-slot:not([hidden])').first();
  await fifth.getByRole('spinbutton').nth(0).fill('24');
  await fifth.getByRole('spinbutton').nth(1).fill('0');
  await fifth.getByRole('button', { name: 'Confirm result' }).click();
  await page.getByText('2/8 confirmed', { exact: true }).waitFor();
  await page.getByRole('button', { name: 'Previous courts' }).click();
  assert.deepEqual(await Promise.all([0, 1].map((index) => first.getByRole('spinbutton').nth(index).inputValue())), ['10', '8'], 'First-page result changed while scoring another court page');
  assert.deepEqual(errors, [], 'Browser runtime errors');
  console.log(`PASS ${checks} no-scroll iPad landscape layouts; court paging retains drafts and results across pages.`);
} finally {
  await browser?.close();
  await server.close();
}
