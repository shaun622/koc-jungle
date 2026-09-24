import { spawn, spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import net from 'node:net';
import { chromium } from 'playwright';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const privatePath = resolve(root, '../../outputs/tournament-local-runtime/.private/runtime.json');
const base = new URL(process.env.KOC_TOURNAMENT_BROWSER_URL ?? 'http://127.0.0.1:4187');
const allowedPorts = new Set(['4187', '55421', '55424', '55425']);

function assert(condition, message) { if (!condition) throw new Error(message); }
const sleep = (ms) => new Promise((resolveWait) => setTimeout(resolveWait, ms));
async function portAvailable(port) {
  return await new Promise((resolveAvailable) => {
    const server = net.createServer();
    server.once('error', () => resolveAvailable(false));
    server.listen({ host: '127.0.0.1', port, exclusive: true }, () => server.close(() => resolveAvailable(true)));
  });
}
function run(program, args) {
  const result = spawnSync(program, args, { cwd: root, encoding: 'utf8', windowsHide: true, env: { ...process.env, NODE_ENV: 'test' } });
  if (result.error || result.status !== 0) throw new Error(`V7 build failed: ${(result.error?.message ?? result.stderr ?? result.stdout).trim()}`);
}
async function waitForServer(child, getError) {
  for (let attempt = 0; attempt < 120; attempt += 1) {
    try { const response = await fetch(base); if (response.ok) return; } catch { /* starting */ }
    if (child.exitCode !== null) throw new Error(`V7 frontend failed to start: ${getError()}`);
    await sleep(100);
  }
  throw new Error(`V7 frontend did not become ready: ${getError()}`);
}
async function guardContext(context) {
  await context.route('**/*', async (route) => {
    const requestUrl = route.request().url();
    if (!requestUrl.startsWith('http:') && !requestUrl.startsWith('https:')) return route.continue();
    const url = new URL(requestUrl);
    return url.hostname === '127.0.0.1' && allowedPorts.has(url.port) ? route.continue() : route.abort('blockedbyclient');
  });
}
async function signIn(page, user) {
  await page.goto(new URL('/#/home', base).toString(), { waitUntil: 'networkidle' });
  await page.getByRole('button', { name: 'Menu' }).click();
  await page.getByRole('button', { name: 'Sign in to sync' }).click();
  await page.getByLabel('Email').fill(user.email);
  await page.getByLabel('Password').fill(user.password);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await page.getByRole('heading', { name: 'ACCOUNT' }).waitFor();
  await page.getByRole('button', { name: 'Done' }).click();
}
async function waitSynced(page) {
  await page.getByText('Synced to your account', { exact: true }).waitFor({ timeout: 20_000 });
}
async function accessiblePageCheck(page, label) {
  const result = await page.evaluate(() => {
    const elements = [...document.querySelectorAll('.tv1 button,.tv1 input,.tv1 select,.tv1 textarea,.tv1 a')].filter((element) => {
      const box = element.getBoundingClientRect(); return box.width > 0 && box.height > 0;
    });
    return {
      overflow: document.documentElement.scrollWidth - window.innerWidth,
      minFont: elements.length ? Math.min(...elements.map((element) => Number.parseFloat(getComputedStyle(element).fontSize))) : 16,
      shortControls: elements.filter((element) => element.getBoundingClientRect().height < 43.5).length,
    };
  });
  assert(result.overflow <= 1 && result.minFont >= 16 && result.shortControls === 0, `${label} accessibility/layout failed: ${JSON.stringify(result)}`);
}

assert(base.protocol === 'http:' && base.hostname === '127.0.0.1' && Number(base.port) === 4187, 'V7 only runs against http://127.0.0.1:4187.');
assert(existsSync(privatePath), 'V7 requires the isolated Tournament runtime. Run npm run local:tournament -- --start first.');
assert(await portAvailable(4187), 'V7 requires free port 4187 and will not attach to or stop an existing server.');
const runtime = JSON.parse(await readFile(privatePath, 'utf8'));
const runtimeApiUrl = runtime.values?.api_url ?? runtime.values?.API_URL;
assert(typeof runtimeApiUrl === 'string' && runtimeApiUrl.length > 0, 'V7 requires a started disposable Tournament backend. Run npm run local:tournament -- --start after Docker is available.');
const apiUrl = new URL(runtimeApiUrl);
assert(apiUrl.hostname === '127.0.0.1' && Number(apiUrl.port) === 55421, 'V7 refuses a nonloopback or unexpected Tournament backend.');
assert(Array.isArray(runtime.syntheticUsers) && runtime.syntheticUsers.length >= 2, 'V7 requires two generated synthetic owners.');
const health = await fetch('http://127.0.0.1:55421/auth/v1/health');
assert(health.ok, 'V7 requires the running disposable Auth/backend stack.');

run(process.execPath, ['node_modules/vite/bin/vite.js', 'build', '--config', 'vite.tournament-test.config.ts']);
const preview = spawn(process.execPath, ['node_modules/vite/bin/vite.js', 'preview', '--config', 'vite.tournament-test.config.ts', '--host', '127.0.0.1', '--port', '4187', '--strictPort'], { cwd: root, env: { ...process.env, NODE_ENV: 'test' }, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
let startupError = '';
preview.stderr.on('data', (chunk) => { startupError += String(chunk); });
await waitForServer(preview, () => startupError);

const browser = await chromium.launch({ channel: 'msedge', headless: true });
try {
  const ownerContext = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await guardContext(ownerContext);
  await ownerContext.addInitScript(() => localStorage.setItem('koc-entitlements-v1', JSON.stringify({ state: { pro: true, loading: false, trialUsed: true }, version: 0 })));
  const owner = await ownerContext.newPage();
  await signIn(owner, runtime.syntheticUsers[0]);

  await owner.getByRole('button', { name: 'Create event' }).click();
  await owner.getByRole('button', { name: 'Choose format: Flexible Tournament' }).click();
  await owner.getByRole('heading', { name: 'Build the plan. Keep every match editable.' }).waitFor();
  await waitSynced(owner);
  const setupUrl = owner.url();
  assert(/#\/tournaments\/.+\/setup$/.test(setupUrl), `Connected creation did not open Tournament setup: ${setupUrl}`);

  await owner.getByLabel('Title').fill('V7 Gold Silver Rehearsal');
  await owner.getByLabel('Venue').fill('Disposable Local Courts');
  await owner.getByLabel('Starts').fill('2099-01-01T18:00');
  await owner.getByLabel('Ends').fill('2099-01-01T23:00');
  await owner.getByRole('button', { name: 'Save details' }).click();
  await waitSynced(owner);

  await owner.getByRole('link', { name: 'entries' }).click();
  await owner.getByText('Paste from Excel').click();
  const rows = Array.from({ length: 16 }, (_, index) => `Pair ${index + 1}\tPlayer ${index * 2 + 1}\tPlayer ${index * 2 + 2}\t+62000${String(index).padStart(3, '0')}\tOpen`).join('\n');
  await owner.locator('textarea').fill(rows);
  await owner.getByRole('button', { name: 'Validate rows' }).click();
  await owner.getByRole('button', { name: 'Apply all rows' }).click();
  await owner.getByText('16 rows imported atomically.').waitFor();
  await waitSynced(owner);

  await owner.getByRole('link', { name: 'setup' }).click();
  await owner.getByRole('button', { name: 'Preview round-robin groups' }).click();
  await owner.getByRole('button', { name: 'Apply reviewed draw' }).click();
  await owner.getByRole('button', { name: 'Publish draw' }).click();
  await owner.getByRole('button', { name: 'Review and publish sign-up' }).click();
  await owner.getByRole('button', { name: 'Apply publication' }).click();
  await waitSynced(owner);
  const signupHref = await owner.getByRole('link', { name: 'Open sign-up' }).getAttribute('href');
  assert(signupHref, 'Connected publication did not expose the public sign-up route.');

  const publicContext = await browser.newContext({ viewport: { width: 390, height: 844 } });
  await guardContext(publicContext);
  const signup = await publicContext.newPage();
  await signup.goto(new URL(signupHref, base).toString(), { waitUntil: 'networkidle' });
  await signup.getByLabel('Team name (optional)').fill('Late Pair');
  await signup.getByLabel('Player one').fill('Late One');
  await signup.getByLabel('Player two').fill('Late Two');
  await signup.getByLabel('WhatsApp or phone (private)').fill('PRIVATE-V7-CONTACT');
  await signup.getByRole('button', { name: 'Register our pair' }).click();
  await signup.getByText('Your pair is on the waiting list.').waitFor();
  assert(!(await signup.locator('body').innerText()).includes('PRIVATE-V7-CONTACT'), 'Private contact leaked into the public page.');
  await publicContext.close();

  await owner.getByRole('link', { name: 'desk' }).click();
  await owner.getByRole('button', { name: 'Begin tournament' }).click();
  await owner.getByText('Tournament is live and this device holds control.').waitFor();
  await waitSynced(owner);
  await owner.getByRole('button', { name: 'Start' }).first().click();
  await owner.getByRole('button', { name: 'Score' }).first().click();
  await owner.getByLabel('Score').fill('5-3');
  await owner.getByRole('button', { name: 'Publish progress only' }).click();
  await owner.getByText('Progress published. The match has not advanced and still needs result confirmation.').waitFor();
  await owner.getByRole('button', { name: 'Review result' }).click();
  await owner.getByRole('button', { name: 'Confirm result' }).click();
  await waitSynced(owner);

  // Twenty independent connected edits are accepted locally while transport is offline,
  // then reconstructed from IndexedDB after a real PWA reload and synced exactly once.
  await owner.goto(setupUrl);
  await ownerContext.setOffline(true);
  for (let index = 0; index < 20; index += 1) {
    await owner.getByLabel('Venue').fill(`Offline Court Plan ${index + 1}`);
    await owner.getByRole('button', { name: 'Save details' }).click();
  }
  await owner.reload({ waitUntil: 'domcontentloaded' });
  await owner.getByRole('heading', { name: 'Build the plan. Keep every match editable.' }).waitFor();
  await owner.getByText(/20 unsynced changes/).waitFor();
  await ownerContext.setOffline(false);
  await waitSynced(owner);

  const tournamentBase = setupUrl.replace(/\/setup$/, '');
  for (const theme of ['Light', 'Dark']) {
    await owner.getByRole('button', { name: theme, exact: true }).click();
    for (const viewport of [{ width: 1440, height: 900 }, { width: 1024, height: 768 }, { width: 768, height: 1024 }, { width: 390, height: 844 }]) {
      await owner.setViewportSize(viewport);
      for (const route of ['setup', 'entries', 'draw', 'desk', 'courts', 'history']) {
        await owner.goto(`${tournamentBase}/${route}`, { waitUntil: 'domcontentloaded' });
        await owner.locator('.tv1-main').waitFor();
        await accessiblePageCheck(owner, `${theme} ${viewport.width}x${viewport.height} ${route}`);
      }
    }
  }

  const secondDevice = await browser.newContext({ viewport: { width: 1024, height: 768 } });
  await guardContext(secondDevice);
  await secondDevice.addInitScript(() => localStorage.setItem('koc-entitlements-v1', JSON.stringify({ state: { pro: true, loading: false, trialUsed: true }, version: 0 })));
  const secondOwner = await secondDevice.newPage();
  await signIn(secondOwner, runtime.syntheticUsers[0]);
  await secondOwner.goto(`${tournamentBase}/desk`, { waitUntil: 'networkidle' });
  await secondOwner.getByRole('heading', { name: 'Tournament desk' }).waitFor();
  await secondDevice.close();

  await owner.setViewportSize({ width: 1920, height: 1080 });
  await owner.goto(`${tournamentBase}/setup`);
  const tvHref = await owner.getByRole('link', { name: 'TV display' }).getAttribute('href');
  assert(tvHref, 'Published Tournament did not expose its TV route.');
  await owner.goto(new URL(tvHref, base).toString(), { waitUntil: 'networkidle' });
  await owner.locator('.tv1-tv').waitFor();
  assert(!(await owner.locator('body').innerText()).includes('PRIVATE-V7-CONTACT'), 'Private contact leaked into the TV projection.');
  await ownerContext.close();
  process.stdout.write('Tournament V7 built-PWA/Auth/backend browser rehearsal passed.\n');
} finally {
  await browser.close();
  preview.kill();
}
