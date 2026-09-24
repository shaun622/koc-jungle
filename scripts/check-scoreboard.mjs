// Isolated synthetic fixture only; no event backend or user browser profile.
import { chromium } from 'playwright';
import assert from 'node:assert/strict';
const base = process.env.SCOREBOARD_CHECK_URL || 'http://127.0.0.1:4183';
const browser = await chromium.launch({ channel: 'msedge', headless: true });
const context = await browser.newContext({ serviceWorkers: 'block' });
await context.route('**/*', route => {
  const url = new URL(route.request().url());
  return url.origin === base || ['fonts.googleapis.com', 'fonts.gstatic.com'].includes(url.hostname)
    ? route.continue() : route.abort();
});
const page = await context.newPage();
const errors = [];
page.on('pageerror', error => errors.push(error.message));
const settle = async () => {
  await page.evaluate(() => document.fonts.ready);
  await page.evaluate(() => document.getAnimations().forEach(animation => {
    if (Number.isFinite(animation.effect?.getComputedTiming().endTime)) animation.finish();
  }));
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
};
const inspect = () => page.evaluate(() => {
  const problems = [];
  if (document.documentElement.scrollWidth > innerWidth + 1 || document.documentElement.scrollHeight > innerHeight + 1) problems.push('document scroll');
  for (const panel of document.querySelectorAll('.tv-courts-col,.tv-lb-list')) {
    if (panel.scrollHeight > panel.clientHeight + 1) problems.push(`panel scroll: ${panel.className}`);
  }
  for (const element of document.querySelectorAll('.tv-court-team-name,.tv-lb-players,.tv-centre-team-name,.tv-timer-value,.tv-score-btn,.tv-court-score,.tv-centre-score,.tv-tie-btn')) {
    const host = element.closest('.tv-court-row,.tv-lb-row,.tv-centre,.night-timer,.tv-court,.tv-centre-tie');
    const bounds = host.getBoundingClientRect();
    let text = element.getBoundingClientRect();
    if (element.tagName !== 'BUTTON') {
      const range = document.createRange(); range.selectNodeContents(element);
      text = range.getBoundingClientRect();
    }
    if (text.left < bounds.left - 1 || text.right > bounds.right + 1 || text.top < bounds.top - 1 || text.bottom > bounds.bottom + 1) problems.push(`${element.className}: ${element.textContent}`);
  }
  return problems;
});
let checked = 0;
try {
  for (const [width, height] of [[1920,1080],[1366,768],[1180,820],[1024,768],[1024,650]]) {
    await page.setViewportSize({ width, height });
    for (const teams of [6,14,16]) for (const theme of ['dark','light']) {
      await page.goto(`${base}/scripts/design-check.html?page=display&teams=${teams}&theme=${theme}`);
      await page.locator('.tv-display--quiet').waitFor(); await settle();
      assert.equal(await page.locator('.tv-lb-row').count(), teams);
      assert.equal(await page.locator('.tv-score-btn:visible').count(), teams * 2);
      assert.equal(await page.locator('.tv-court-team-label:visible').count(), teams - 2, 'Keep team names above the player names, including dense columns');
      assert.deepEqual(await inspect(), [], `${width}x${height}, ${teams} teams, ${theme}`); checked++;
      // Worst-case dense board: every court tied and showing its winner picker.
      await page.evaluate(async () => {
        const store = (await import('/src/store/eventStore.ts')).useEventStore;
        const event = structuredClone(store.getState().event);
        event.rounds.at(-1).matches.forEach(match => { match.scoreA = 10; match.scoreB = 10; });
        store.setState({ event });
      });
      await settle();
      assert.deepEqual(await inspect(), [], `Ties: ${width}x${height}, ${teams} teams, ${theme}`); checked++;
    }
  }
  await page.setViewportSize({ width:1024, height:768 });
  await page.goto(`${base}/scripts/design-check.html?page=display&teams=16&theme=dark`);
  await page.locator('.tv-display--quiet').waitFor(); await settle();
  const group = page.locator('.tv-centre-score-group').first();
  const before = Number(await group.locator('.tv-centre-score').textContent());
  await group.locator('button').last().focus(); await page.keyboard.press('Enter');
  assert.equal(Number(await group.locator('.tv-centre-score').textContent()), before + 1);
  await group.locator('button').first().click();
  assert.equal(Number(await group.locator('.tv-centre-score').textContent()), before);
  await page.getByRole('button', { name:/Resume/i }).click();
  await page.getByRole('button', { name:/Pause/i }).waitFor();
  await page.getByRole('button', { name:/Pause/i }).click();
  // Landscape/portrait transition uses the existing readable phone/tablet view.
  await page.setViewportSize({ width:390, height:844 });
  await page.locator('.mobile-display').waitFor();
  assert.equal(await page.locator('.mobile-court').count(), 8);
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth), 390);
  await page.setViewportSize({ width:1024, height:768 });
  await page.locator('.tv-display--quiet').waitFor(); await settle();
  assert.deepEqual(await inspect(), [], 'Return to landscape');
  assert.deepEqual(errors, []);
  console.log(`${checked} production-font layout checks passed; real mouse/keyboard scoring, timer controls and portrait/landscape transition passed.`);
} finally { await browser.close(); }
