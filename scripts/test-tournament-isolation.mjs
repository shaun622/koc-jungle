import { spawnSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import net from 'node:net';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const workspace = resolve(root, '../..');
const runtimeScript = resolve(root, 'scripts/tournament-local-runtime.mjs');
const manifestPath = resolve(workspace, 'outputs/tournament-local-runtime/manifest.json');
const node = process.execPath;
const clean = { ...process.env };
for (const key of Object.keys(clean)) if (/(SUPABASE|DATABASE_URL|BACKEND_ORIGIN)/i.test(key)) delete clean[key];

function run(args, env = clean) { return spawnSync(node, [runtimeScript, ...args], { cwd: root, env, encoding: 'utf8', windowsHide: true }); }
function assert(condition, message) { if (!condition) throw new Error(message); }

let result = run(['prepare'], { ...clean, SUPABASE_URL: 'https://project.supabase.co' });
assert(result.status !== 0 && /Refusing inherited non-loopback/.test(result.stderr), 'Hosted inherited Supabase URL was not refused before work.');

result = run(['prepare']);
assert(result.status === 0, result.stderr || 'Could not prepare isolated runtime.');
const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
assert(manifest.kind === 'koc-tournament-local-runtime', 'Runtime manifest kind is wrong.');
assert(/^koc_tournament_[0-9a-f_]+$/.test(manifest.projectId), 'Runtime project ID is not unique and scoped.');
assert(manifest.runtimePath === resolve(workspace, 'outputs/tournament-local-runtime'), 'Runtime path escaped the workspace outputs directory.');
assert(JSON.stringify(manifest.ports) === JSON.stringify([55420,55421,55422,55423,55424,55425,55432,4186,4187]), 'Runtime port manifest changed.');

const blocker = net.createServer();
await new Promise((resolveListen, reject) => blocker.once('error', reject).listen({ host: '127.0.0.1', port: 55420, exclusive: true }, resolveListen));
try {
  result = run(['preflight']);
  assert(result.status !== 0 && /requires free ports: 55420/.test(result.stderr), 'Occupied port was not rejected before Docker/CLI startup.');
} finally {
  await new Promise((resolveClose) => blocker.close(resolveClose));
}

result = spawnSync(node, [resolve(root, 'tests/db/tournament-v1/run.mjs')], { cwd: root, env: { ...clean, KOC_TOURNAMENT_TEST_DATABASE_URL: 'postgresql://user:pass@db.example.com/koc_tournament_test_bad' }, encoding: 'utf8', windowsHide: true });
assert(result.status !== 0 && /loopback PostgreSQL/.test(result.stderr), 'SQL harness accepted a non-loopback database.');

process.stdout.write('Tournament isolation refusal checks passed. Docker-dependent startup remains a separate prerequisite.\n');
