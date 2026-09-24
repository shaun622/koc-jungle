import { spawn } from 'node:child_process';
import { cpus, hostname, platform, release } from 'node:os';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import net from 'node:net';
import { chromium } from 'playwright';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const workspace = resolve(root, '../..');
const base = new URL(process.env.KOC_TOURNAMENT_PERFORMANCE_URL ?? 'http://127.0.0.1:4187');
if (base.hostname !== '127.0.0.1' || Number(base.port) !== 4187 || base.protocol !== 'http:') throw new Error('V8 only runs against http://127.0.0.1:4187.');
const available = await new Promise((resolveAvailable) => { const server = net.createServer(); server.once('error', () => resolveAvailable(false)); server.listen({ host: '127.0.0.1', port: 4187, exclusive: true }, () => server.close(() => resolveAvailable(true))); });
if (!available) throw new Error('V8 requires free port 4187 and will not attach to or stop another server.');
const vite = spawn(process.execPath, ['node_modules/vite/bin/vite.js', '--config', 'vite.tournament-test.config.ts', '--host', '127.0.0.1', '--port', '4187', '--strictPort'], { cwd: root, env: { ...process.env, NODE_ENV: 'test' }, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
let startupError = ''; vite.stderr.on('data', (chunk) => { startupError += String(chunk); });
for (let attempt = 0; attempt < 100; attempt += 1) {
  try { const response = await fetch(base); if (response.ok) break; } catch { /* starting */ }
  if (vite.exitCode !== null) throw new Error(`V8 frontend failed to start: ${startupError}`);
  await new Promise((resolveWait) => setTimeout(resolveWait, 100));
  if (attempt === 99) throw new Error(`V8 frontend did not become ready: ${startupError}`);
}
const browser = await chromium.launch({ channel: 'msedge', headless: true });
try {
  const context = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
  await context.route('**/*', async (route) => { const url = new URL(route.request().url()); if (url.hostname !== '127.0.0.1' || url.port !== '4187') return route.abort('blockedbyclient'); return route.continue(); });
  const page = await context.newPage();
  await page.goto(new URL('/tests/runtime/tournament-v1/performance-harness.html', base).toString());
  await page.waitForFunction(() => globalThis.tournamentPerformanceHarness?.ready === true);
  const outcome = await page.evaluate(() => globalThis.tournamentPerformanceHarness.run());
  const evidence = { gate: 'V8', recordedAt: new Date().toISOString(), host: { hostname: hostname(), platform: platform(), release: release(), cpu: cpus()[0]?.model ?? 'unknown', logicalCpus: cpus().length, node: process.version, browser: await browser.version() }, outcome };
  const evidenceDir = resolve(workspace, 'outputs/tournament-completion-evidence'); await mkdir(evidenceDir, { recursive: true });
  const evidencePath = resolve(evidenceDir, 'v8-performance-2026-09-20.json'); await writeFile(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`, 'utf8');
  if (!outcome.pass) throw new Error(`Tournament V8 failed: ${JSON.stringify(outcome.errors)}`);
  process.stdout.write(`Tournament V8 maximum-size browser benchmark passed. Evidence: ${evidencePath}\n`);
} finally { await browser.close(); vite.kill(); }

