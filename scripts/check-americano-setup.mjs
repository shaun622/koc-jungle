// Run with: node scripts/check-americano-setup.mjs
// Fresh, nonpersistent browser profile and localhost-only requests. No real events.
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { chromium } from 'playwright';
import { createServer } from 'vite';

process.env.VITE_SUPABASE_URL = '';
process.env.VITE_SUPABASE_ANON_KEY = '';
const server = await createServer({ server: { host: '127.0.0.1', port: 4197, strictPort: true, open: false } });
await server.listen();
const base = 'http://127.0.0.1:4197';
let browser;
try {
  browser = await chromium.launch({ channel: 'msedge', headless: true });
  const context = await browser.newContext({ serviceWorkers: 'block' });
  await context.route('**/*', (route) => new URL(route.request().url()).origin === base ? route.continue() : route.abort());
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await mkdir('screenshots/americano-setup', { recursive: true });
  let checks = 0;
  for (const [device, width, height] of [['desktop',1440,1000],['ipad',1180,820],['ipad-small',1024,768],['ipad-portrait',820,1180],['phone',390,844],['small-phone',320,740],['phone-landscape',844,390]]) {
    await page.setViewportSize({ width, height });
    for (const theme of ['dark','light']) for (const mode of ['rotating','fixed']) {
      await page.goto(`${base}/scripts/americano-setup-check.html?theme=${theme}&mode=${mode}`);
      await page.locator('.amv3-setup').waitFor();
      if (mode === 'fixed') {
        await page.getByPlaceholder('Team name (optional)', { exact: true }).fill('The Smashers');
        await page.getByPlaceholder('Player one', { exact: true }).fill('Alex');
        await page.getByPlaceholder('Player two', { exact: true }).fill('Sam');
        await page.getByRole('button', { name: 'Add team', exact: true }).click();
      } else {
        await page.getByPlaceholder('Player name', { exact: true }).fill('Alex');
        await page.getByRole('button', { name: 'Add player', exact: true }).click();
      }
      await page.locator('.amv3-roster-row').waitFor();
      for (const variant of ['rally','custom','planned']) {
        if (variant === 'custom') {
          await page.locator('label:has(> span:text-is("Match format")) > select').selectOption('traditional');
          await page.locator('label:has(> span:text-is("Traditional format")) > select').selectOption('custom');
          await page.locator('label:has(> span:text-is("Schedule")) > select').selectOption('custom');
          await page.getByRole('heading', { name: 'Custom match rule' }).waitFor();
        }
        if (variant === 'planned') {
          await page.getByLabel('Plan around session time', { exact: false }).check();
          await page.getByText('More options', { exact: true }).click();
        }
        const result = await page.evaluate(() => {
          const setup = document.querySelector('.amv3-setup');
          const grid = document.querySelector('.amv3-grid');
          const panels = [...grid.children].map((node) => node.getBoundingClientRect());
          const controls = [...setup.querySelectorAll('input:not([type=checkbox]),select,textarea,button')];
          return {
            horizontalOverflow: document.documentElement.scrollWidth > innerWidth + 1 || setup.scrollWidth > setup.clientWidth + 1,
            grid: getComputedStyle(grid).display,
            fields: getComputedStyle(document.querySelector('.amv3-fields')).display,
            sideBySide: Math.abs(panels[0].top - panels[1].top) < 1 && panels[1].left > panels[0].left,
            smallControls: controls.filter((node) => node.getBoundingClientRect().height < 43.9 || parseFloat(getComputedStyle(node).fontSize) < 16).length,
            escapedControls: controls.filter((node) => { const r = node.getBoundingClientRect(); return r.left < 0 || r.right > innerWidth + 1; }).length,
          };
        });
        const label = `${device}/${theme}/${mode}/${variant}`;
        assert.equal(result.grid, 'grid', `${label}: missing setup grid`);
        assert.equal(result.fields, 'grid', `${label}: missing form layout`);
        assert.equal(result.horizontalOverflow, false, `${label}: horizontal overflow`);
        assert.equal(result.escapedControls, 0, `${label}: controls outside viewport`);
        assert.equal(result.smallControls, 0, `${label}: controls need 16px text and 44px targets`);
        assert.equal(result.sideBySide, width > 1000, `${label}: responsive panel layout`);
        const save = page.getByRole('button', { name: 'Save rules', exact: true });
        await save.scrollIntoViewIfNeeded();
        await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
        const bounds = await save.boundingBox();
        if (!bounds || bounds.y < 0 || bounds.y + bounds.height > height + 1) {
          await page.screenshot({ path: 'screenshots/americano-setup/unreachable-actions.png' });
          console.log(label, bounds, await page.locator('.amv3-setup').evaluate(node => ({ scrollTop: node.scrollTop, scrollHeight: node.scrollHeight, clientHeight: node.clientHeight })));
        }
        assert(bounds && bounds.y >= 0 && bounds.y + bounds.height <= height + 1, `${label}: bottom actions must be reachable`);
        assert(await save.evaluate((button) => { const r = button.getBoundingClientRect(); return button.contains(document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2)); }), `${label}: bottom actions must not be covered by the mobile navigation`);
        checks++;
      }
      await page.locator('.amv3-hero').scrollIntoViewIfNeeded();
      if (theme === 'dark' && mode === 'fixed') await page.screenshot({ path: `screenshots/americano-setup/${device}.png` });
    }
  }
  // Exercise the visible setup -> preview -> start -> partial result -> finish path.
  await page.setViewportSize({ width: 1440, height: 1000 });
  for (const mode of ['rotating','fixed']) for (const format of ['rally','traditional']) {
    await page.goto(`${base}/scripts/americano-setup-check.html?mode=${mode}`);
    for (let i=0;i<(mode==='fixed'?2:4);i++) {
      if (mode==='fixed') {
        await page.getByPlaceholder('Player one',{exact:true}).fill(`Alex ${i}`);
        await page.getByPlaceholder('Player two',{exact:true}).fill(`Sam ${i}`);
        await page.getByRole('button',{name:'Add team',exact:true}).click();
      } else {
        await page.getByPlaceholder('Player name',{exact:true}).fill(`Player ${i}`);
        await page.getByRole('button',{name:'Add player',exact:true}).click();
      }
    }
    await page.getByLabel('Plan around session time',{exact:false}).check();
    await page.locator('label:has(> span:text-is("Session duration")) > select').selectOption('custom');
    await page.getByLabel('Total minutes',{exact:true}).fill('7');
    await page.getByLabel('Minutes per round',{exact:true}).fill('7');
    await page.locator('label:has(> span:text-is("Match format")) > select').selectOption(format);
    await page.getByRole('button',{name:'Preview schedule',exact:true}).click();
    await page.getByText(/Preview ready/).waitFor();
    await page.getByRole('button',{name:'Start event',exact:true}).click();
    await page.getByRole('heading',{name:'Round 1 of 1',exact:true}).waitFor();
    const editor=page.locator('.amv3-match');
    await editor.getByRole('spinbutton').nth(0).fill(format==='rally'?'10':'4');
    await editor.getByRole('spinbutton').nth(1).fill(format==='rally'?'8':'3');
    assert(await editor.getByRole('button',{name:'Confirm result'}).isDisabled(),'Short score needs explicit confirmation');
    await editor.getByLabel('Time ran out — use score played',{exact:false}).check();
    await editor.getByRole('button',{name:'Confirm result'}).click();
    await page.getByText('1/1 confirmed',{exact:true}).waitFor();
    await page.getByRole('button',{name:'End final round',exact:true}).click();
    await page.locator('.amv3-complete').waitFor();
    const totals=await page.locator('.amv3-total').allTextContents();
    assert.deepEqual(totals.map(Number).sort((a,b)=>b-a),format==='rally'?(mode==='fixed'?[10,8]:[10,10,8,8]):(mode==='fixed'?[4,3]:[4,4,3,3]),'Only actual scores reach standings');
  }
  assert.deepEqual(errors, [], 'Browser runtime errors');
  console.log(`PASS: ${checks} Americano setup layout checks and four planner-to-finished-event browser flows; both pairing modes, rally/games, actual-score standings.`);
} finally {
  await browser?.close();
  await server.close();
}
