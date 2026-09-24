import { spawn, spawnSync } from 'node:child_process';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { cp, lstat, mkdir, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import net from 'node:net';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..');
const workspace = resolve(root, '../..');
const outputParent = resolve(workspace, 'outputs');
const runtime = resolve(outputParent, 'tournament-local-runtime');
const runtimeSupabase = join(runtime, 'supabase');
const manifestPath = join(runtime, 'manifest.json');
const privatePath = join(runtime, '.private', 'runtime.json');
const markerPath = join(runtime, '.koc-tournament-local-runtime');
const cliVersion = '2.45.5';
const schemaHash = '08c9cbeccc624a8a3704059bde19a0a46a50f066f469f28c23b73867f0507f25';
const ports = [55420, 55421, 55422, 55423, 55424, 55425, 55432, 4186, 4187];
const loopback = new Set(['localhost', '127.0.0.1', '::1', '[::1]']);
const ownedObjects = {
  tables: ['event_tombstones', 'events'],
  functions: ['delete_account', 'delete_event'],
};

function fail(message) { throw new Error(message); }
function sha256(value) { return createHash('sha256').update(value).digest('hex'); }
function safeEnvironment() {
  const clean = { ...process.env };
  for (const key of Object.keys(clean)) {
    if (/^(VITE_)?SUPABASE_|DATABASE_URL|POSTGRES|PGHOST|PGPORT|PGDATABASE|PGUSER|PGPASSWORD|REVENUECAT/i.test(key)) delete clean[key];
  }
  clean.NO_COLOR = '1';
  return clean;
}
function assertNoHostedEnvironment() {
  for (const [key, value] of Object.entries(process.env)) {
    if (!value || !/(SUPABASE|DATABASE_URL|BACKEND_ORIGIN)/i.test(key)) continue;
    let url;
    try { url = new URL(value); }
    catch {
      if (/URL|ORIGIN/i.test(key)) fail(`Refusing unparseable inherited ${key}.`);
      continue;
    }
    if (!loopback.has(url.hostname)) fail(`Refusing inherited non-loopback ${key}. Unset it before running the isolated Tournament runtime.`);
  }
}
async function portAvailable(port) {
  return await new Promise((resolveResult) => {
    const server = net.createServer();
    server.once('error', () => resolveResult(false));
    server.listen({ host: '127.0.0.1', port, exclusive: true }, () => server.close(() => resolveResult(true)));
  });
}
async function assertPortsAvailable() {
  const occupied = [];
  for (const port of ports) if (!await portAvailable(port)) occupied.push(port);
  if (occupied.length) fail(`Tournament local runtime requires free ports: ${occupied.join(', ')}. It will not stop or replace another service.`);
}
function run(program, args, options = {}) {
  const result = spawnSync(program, args, { cwd: root, encoding: 'utf8', env: safeEnvironment(), windowsHide: true, ...options });
  if (result.error) fail(`${program} could not start: ${result.error.message}`);
  if (result.status !== 0) fail((result.stderr || result.stdout || `${program} exited ${result.status}`).trim());
  return result.stdout ?? '';
}
function supabase(args, options = {}) {
  return run(process.platform === 'win32' ? 'npx.cmd' : 'npx', ['--yes', `supabase@${cliVersion}`, ...args], options);
}
async function readManifest() {
  if (!existsSync(manifestPath)) fail('Tournament local runtime is not prepared. Run tournament:local:prepare first.');
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  if (manifest.kind !== 'koc-tournament-local-runtime' || manifest.runtimePath !== runtime || manifest.projectId !== `koc_tournament_${manifest.runId.replaceAll('-', '_')}`) fail('Runtime manifest is not owned by this Tournament harness.');
  return manifest;
}
async function assertOwnedRuntime() {
  const expectedParent = await realpath(outputParent);
  const actualParent = await realpath(dirname(runtime));
  if (expectedParent !== actualParent || relative(outputParent, runtime).startsWith('..')) fail('Runtime target escaped the workspace outputs directory.');
  const stats = await lstat(runtime);
  if (!stats.isDirectory() || stats.isSymbolicLink()) fail('Runtime target is not a plain owned directory.');
  if (!existsSync(markerPath)) fail('Runtime ownership marker is missing.');
  return readManifest();
}
function compatibilityBootstrap(schema) {
  if (sha256(schema) !== schemaHash) fail('supabase/schema.sql changed. Re-inspect and update the pinned compatibility bootstrap hash before continuing.');
  const start = schema.indexOf('create table if not exists public.events');
  const sentinel = 'grant execute on function public.delete_account() to authenticated;';
  const end = schema.indexOf(sentinel);
  if (start < 0 || end < 0) fail('Could not locate the allowlisted legacy compatibility objects.');
  const selected = schema.slice(start, end + sentinel.length);
  const tables = [...selected.matchAll(/create table if not exists public\.([a-z_]+)/g)].map((match) => match[1]).sort();
  const functions = [...selected.matchAll(/create or replace function public\.([a-z_]+)/g)].map((match) => match[1]).sort();
  if (JSON.stringify(tables) !== JSON.stringify(ownedObjects.tables) || JSON.stringify(functions) !== JSON.stringify(ownedObjects.functions)) fail('Compatibility bootstrap contains an object outside the exact allowlist.');
  return `-- Generated from pinned supabase/schema.sql (${schemaHash}).\n-- Exact allowlist: events, event_tombstones, delete_event, delete_account.\n${selected}\n`;
}
async function prepare() {
  assertNoHostedEnvironment();
  await mkdir(outputParent, { recursive: true });
  if (existsSync(manifestPath)) {
    const manifest = await assertOwnedRuntime();
    const completion = join(root, 'supabase', 'migrations', '20260919100000_tournament_v1_completion.sql');
    if (existsSync(completion)) await cp(completion, join(runtimeSupabase, 'migrations', '20260919100000_tournament_v1_completion.sql'));
    for (const name of ['_shared', 'tournament-owner', 'tournament-public']) await cp(join(root, 'supabase', 'functions', name), join(runtimeSupabase, 'functions', name), { recursive: true, force: true });
    manifest.completionMigrationIncluded = existsSync(completion);
    manifest.refreshedAt = new Date().toISOString();
    await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
    process.stdout.write(`Tournament runtime already prepared (${manifest.runId}).\n`);
    return manifest;
  }
  if (existsSync(runtime)) fail('Refusing to reuse an unowned tournament-local-runtime directory.');
  const runId = randomUUID();
  const projectId = `koc_tournament_${runId.replaceAll('-', '_')}`;
  await mkdir(join(runtimeSupabase, 'migrations'), { recursive: true });
  await mkdir(join(runtimeSupabase, 'functions'), { recursive: true });
  await mkdir(join(runtime, '.private'), { recursive: true });
  const schema = await readFile(join(root, 'supabase', 'schema.sql'), 'utf8');
  await writeFile(join(runtimeSupabase, 'migrations', '20260912090000_compatibility_bootstrap.sql'), compatibilityBootstrap(schema), 'utf8');
  await cp(join(root, 'supabase', 'migrations', '20260912100000_tournament_v1.sql'), join(runtimeSupabase, 'migrations', '20260912100000_tournament_v1.sql'));
  const completion = join(root, 'supabase', 'migrations', '20260919100000_tournament_v1_completion.sql');
  if (existsSync(completion)) await cp(completion, join(runtimeSupabase, 'migrations', '20260919100000_tournament_v1_completion.sql'));
  for (const name of ['_shared', 'tournament-owner', 'tournament-public']) await cp(join(root, 'supabase', 'functions', name), join(runtimeSupabase, 'functions', name), { recursive: true });
  const template = await readFile(join(root, 'supabase', 'config.toml'), 'utf8');
  await writeFile(join(runtimeSupabase, 'config.toml'), template.replace('koc-tournament-local-template', projectId), 'utf8');
  await writeFile(markerPath, `${runId}\n`, 'utf8');
  const manifest = {
    kind: 'koc-tournament-local-runtime', version: 1, runId, projectId, runtimePath: runtime,
    cliVersion, createdAt: new Date().toISOString(), schemaSourceHash: schemaHash,
    completionMigrationIncluded: existsSync(completion), ports,
    objects: ownedObjects,
    ownedPaths: ['.koc-tournament-local-runtime', '.private', 'frontend', 'supabase'],
  };
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
  await writeFile(privatePath, `${JSON.stringify({ runId, syntheticUsers: [] }, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
  process.stdout.write(`Prepared isolated Tournament runtime ${runId}. Completion migration: ${manifest.completionMigrationIncluded ? 'included' : 'not yet present (baseline smoke only)'}.\n`);
  return manifest;
}
function requireDocker() {
  const result = spawnSync('docker', ['version', '--format', '{{.Server.Version}}'], { encoding: 'utf8', windowsHide: true });
  if (result.error?.code === 'ENOENT') fail('Docker is not installed or not on PATH. T-002 backend/browser verification remains partial.');
  if (result.status !== 0) fail('Docker is installed but the daemon is unavailable. T-002 backend/browser verification remains partial.');
}
async function preflight({ requireFreePorts = true } = {}) {
  assertNoHostedEnvironment();
  await prepare();
  if (requireFreePorts) await assertPortsAvailable();
  requireDocker();
  const version = supabase(['--version']).trim();
  if (!version.includes(cliVersion)) fail(`Expected Supabase CLI ${cliVersion}, received ${version || 'unknown'}.`);
  process.stdout.write(`Tournament local preflight passed with Supabase CLI ${cliVersion}.\n`);
}
async function seedSyntheticUsers(runtimeValues) {
  const serviceKey = runtimeValues.service_role_key ?? runtimeValues.SERVICE_ROLE_KEY;
  const apiUrl = runtimeValues.api_url ?? runtimeValues.API_URL ?? 'http://127.0.0.1:55421';
  if (!serviceKey || new URL(apiUrl).hostname !== '127.0.0.1') fail('Local Supabase start output did not contain a safe service key/API URL.');
  const users = [];
  for (const label of ['owner-a', 'owner-b']) {
    const email = `${label}-${randomUUID()}@tournament.invalid`;
    const password = `T-${randomUUID()}-9a!`;
    const response = await fetch(`${apiUrl}/auth/v1/admin/users`, { method: 'POST', headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password, email_confirm: true }) });
    if (!response.ok) fail(`Could not create synthetic ${label} (${response.status}).`);
    const body = await response.json();
    users.push({ label, id: body.id, email, password });
  }
  return users;
}
async function start() {
  await preflight();
  const manifest = await readManifest();
  const secrets = {
    idempotency: randomBytes(32).toString('base64url'), authority: randomBytes(32).toString('base64url'),
    rate: randomBytes(32).toString('base64url'), trustedProxy: randomBytes(32).toString('base64url'), control: randomBytes(32).toString('base64url'),
  };
  await writeFile(join(runtimeSupabase, 'functions', '.env'), [
    `TOURNAMENT_IDEMPOTENCY_SECRET=${secrets.idempotency}`, 'TOURNAMENT_IDEMPOTENCY_KEY_VERSION=1',
    `TOURNAMENT_AUTHORITY_SECRET=${secrets.authority}`, 'TOURNAMENT_AUTHORITY_KEY_VERSION=1', 'TOURNAMENT_AUTHORITY_RETAINED_KEYS={}',
    `TOURNAMENT_RATE_LIMIT_SECRET=${secrets.rate}`, `TOURNAMENT_TRUSTED_IP_PROXY_SECRET=${secrets.trustedProxy}`,
    'TOURNAMENT_LOCAL_TEST_MODE=true', 'TOURNAMENT_ALLOWED_ORIGINS=http://127.0.0.1:4186,http://127.0.0.1:4187',
  ].join('\n') + '\n', { encoding: 'utf8', mode: 0o600 });
  const stdout = supabase(['start', '--workdir', runtime, '--output', 'json']);
  let values;
  try { values = JSON.parse(stdout); } catch { fail('Supabase started but did not return parseable JSON. Stop the owned runtime and retry.'); }
  const apiUrl = values.api_url ?? values.API_URL;
  if (!apiUrl || new URL(apiUrl).hostname !== '127.0.0.1' || Number(new URL(apiUrl).port) !== 55421) fail('Supabase returned an unexpected API target; refusing to continue.');
  const syntheticUsers = await seedSyntheticUsers(values);
  const proxy = spawn(process.execPath, [join(root, 'scripts', 'tournament-trusted-proxy.mjs')], { cwd: root, detached: true, windowsHide: true, stdio: 'ignore', env: { ...safeEnvironment(), KOC_TOURNAMENT_PROXY_PORT: '55425', KOC_TOURNAMENT_PROXY_TARGET: 'http://127.0.0.1:55421', KOC_TOURNAMENT_PROXY_SECRET: secrets.trustedProxy, KOC_TOURNAMENT_PROXY_CONTROL_TOKEN: secrets.control, KOC_TOURNAMENT_RUN_ID: manifest.runId } });
  proxy.unref();
  let proxyReady = false;
  for (let attempt = 0; attempt < 50; attempt += 1) {
    try { const check = await fetch('http://127.0.0.1:55425/_tournament_harness/health'); const body = await check.json(); if (check.ok && body.runId === manifest.runId) { proxyReady = true; break; } } catch { /* starting */ }
    await new Promise((resolveWait) => setTimeout(resolveWait, 100));
  }
  if (!proxyReady) fail('Disposable trusted-IP proxy did not start on owned port 55425.');
  await writeFile(privatePath, `${JSON.stringify({ runId: manifest.runId, values, syntheticUsers, proxyControlToken: secrets.control, proxyUrl: 'http://127.0.0.1:55425' }, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
  const anonKey = values.anon_key ?? values.ANON_KEY;
  await writeFile(join(root, 'tests', 'runtime', 'tournament-v1', 'env', '.env.local'), `VITE_SUPABASE_URL=http://127.0.0.1:55421\nVITE_SUPABASE_ANON_KEY=${anonKey}\nVITE_TOURNAMENT_PUBLIC_ORIGIN=http://127.0.0.1:55425\nVITE_TOURNAMENT_TEST_MODE=true\nVITE_ENABLE_TOURNAMENT_V1=true\n`, { encoding: 'utf8', mode: 0o600 });
  for (const endpoint of ['tournament-owner', 'tournament-public']) {
    const response = await fetch(`http://127.0.0.1:55421/functions/v1/${endpoint}`, { method: 'POST', headers: { apikey: anonKey, 'Content-Type': 'application/json' }, body: '{}' });
    if (response.status >= 500) fail(`${endpoint} import smoke failed (${response.status}).`);
  }
  process.stdout.write('Isolated Tournament Auth, database and function import smoke passed. Local credentials were written only to ignored private files.\n');
}
async function stop() {
  await assertOwnedRuntime();
  try {
    const privateRuntime = JSON.parse(await readFile(privatePath, 'utf8'));
    if (privateRuntime.runId === (await readManifest()).runId && privateRuntime.proxyControlToken) await fetch('http://127.0.0.1:55425/_tournament_harness/shutdown', { method: 'POST', headers: { 'x-tournament-harness-control': privateRuntime.proxyControlToken } });
  } catch { /* an already-stopped owned proxy is acceptable */ }
  try { supabase(['stop', '--workdir', runtime, '--no-backup']); }
  catch (error) { fail(`Could not stop the owned Tournament runtime: ${error.message}`); }
  process.stdout.write('Stopped only the manifest-owned Tournament runtime. Generated files were preserved.\n');
}
async function status() {
  const manifest = await readManifest();
  process.stdout.write(`${JSON.stringify({ runId: manifest.runId, projectId: manifest.projectId, completionMigrationIncluded: manifest.completionMigrationIncluded, ports: manifest.ports }, null, 2)}\n`);
}
async function reset() {
  await assertOwnedRuntime();
  try { await stop(); } catch { /* stopped or unavailable is acceptable before exact owned cleanup */ }
  const children = await Promise.all((await import('node:fs/promises')).then(({ readdir }) => readdir(runtime, { withFileTypes: true })));
  for (const child of children) if (child.isSymbolicLink()) fail(`Refusing reset because ${child.name} is a symbolic link/reparse point.`);
  await rm(runtime, { recursive: true, force: false });
  process.stdout.write('Removed the exact manifest-owned Tournament runtime. Synthetic data cannot be recovered.\n');
}

const command = (process.argv[2] ?? 'status').replace(/^--/, '');
try {
  if (command === 'prepare') await prepare();
  else if (command === 'preflight') await preflight();
  else if (command === 'start') await start();
  else if (command === 'stop') await stop();
  else if (command === 'status') await status();
  else if (command === 'reset') await reset();
  else fail(`Unknown command ${command}. Use prepare, preflight, start, stop, status or reset.`);
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
}
