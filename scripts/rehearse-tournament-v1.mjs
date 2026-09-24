import { chromium } from 'playwright';

const base = process.env.KOC_TOURNAMENT_REHEARSAL_URL ?? 'http://127.0.0.1:5173';
const target = new URL(base);
if (!new Set(['localhost','127.0.0.1','[::1]','::1']).has(target.hostname)) throw new Error('Refusing tournament rehearsal against a non-loopback host.');

const browser = await chromium.launch({ channel: 'msedge', headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await page.addInitScript(() => {
    localStorage.setItem('koc-entitlements-v1', JSON.stringify({ state: { pro: true, loading: false, trialUsed: true }, version: 0 }));
  });
  await page.goto(`${base}/#/home`, { waitUntil: 'networkidle' });
  await page.getByRole('button', { name: 'Create event' }).click();
  await page.getByRole('button', { name: 'Choose format: Flexible Tournament' }).click();
  await page.getByRole('heading', { name: 'Build the plan. Keep every match editable.' }).waitFor();
  await page.getByLabel('Venue').fill('Local Test Courts');
  await page.getByLabel('Starts').fill('2099-01-01T18:00');
  await page.getByRole('button', { name: 'Save details' }).click();
  await page.getByRole('button', { name: 'Publish local sign-up' }).click();
  await page.getByText('Local sign-up preview published. Server publication remains disabled in this local build.').waitFor();
  await page.getByRole('link', { name: 'entries' }).click();
  for (const [team, one, two] of [['Alpha','Alex','Sam'],['Bravo','Bea','Rae'],['Charlie','Chen','Jo'],['Delta','Dee','Kai']]) {
    await page.getByLabel('Team name').fill(team);
    await page.getByLabel('Player one').fill(one);
    await page.getByLabel('Player two').fill(two);
    await page.getByRole('button', { name: 'Add pair' }).click();
  }
  await page.getByRole('link', { name: 'setup' }).click();
  await page.getByRole('button', { name: 'Round-robin groups' }).click();
  await page.getByText('Generated 6 group matches. Review them in Draw.').waitFor();
  await page.getByRole('link', { name: 'desk' }).click();
  await page.getByRole('button', { name: 'Start local rehearsal' }).click();
  await page.getByText('Local rehearsal started. These commands are not sent to production.').waitFor();
  await page.getByRole('button', { name: 'Start' }).first().click();
  await page.getByRole('button', { name: 'Result' }).first().click();
  await page.getByLabel('Final score').fill('5-3');
  await page.getByRole('button', { name: 'Review & confirm' }).click();
  await page.getByText('Result confirmed. Dependencies were recalculated.').waitFor();
  const tournamentBase = page.url().replace(/\/desk$/, '');
  for (const viewport of [{ width: 1024, height: 768 }, { width: 768, height: 1024 }, { width: 390, height: 844 }]) {
    await page.setViewportSize(viewport);
    for (const route of ['setup','entries','draw','desk']) {
      await page.goto(`${tournamentBase}/${route}`);
      await page.locator('.tv1-main').waitFor();
      const check = await page.evaluate(() => {
        const visible = [...document.querySelectorAll('.tv1 button,.tv1 input,.tv1 select,.tv1 textarea,.tv1 a')].filter((element) => {
          const box = element.getBoundingClientRect(); return box.width > 0 && box.height > 0;
        });
        return {
          wholePageFits: document.documentElement.scrollWidth <= window.innerWidth + 1,
          minimumFont: Math.min(...visible.map((element) => Number.parseFloat(getComputedStyle(element).fontSize))),
          shortControls: visible.filter((element) => (element.matches('button,select') || element.classList.contains('btn')) && element.getBoundingClientRect().height < 43.5).length,
        };
      });
      if (!check.wholePageFits || check.minimumFont < 16 || check.shortControls > 0) throw new Error(`${viewport.width}x${viewport.height} ${route} failed responsive controls: ${JSON.stringify(check)}`);
    }
  }
  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.goto(`${tournamentBase}/desk`);
  const tvHref = await page.getByRole('link', { name: 'TV display' }).getAttribute('href');
  if (!tvHref) throw new Error('TV display link was not published.');
  await page.goto(new URL(tvHref, `${base}/`).toString());
  await page.locator('.tv1-tv').waitFor();
  const tvCheck = await page.evaluate(() => ({ fits: document.documentElement.scrollWidth <= innerWidth + 1, courts: document.querySelectorAll('.tv1-tv-courts>section').length }));
  if (!tvCheck.fits || tvCheck.courts !== 4) throw new Error(`TV rehearsal failed: ${JSON.stringify(tvCheck)}`);
  process.stdout.write('Tournament V1 browser rehearsal passed\n');
} finally {
  await browser.close();
}
