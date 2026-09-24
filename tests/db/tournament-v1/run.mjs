import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

function fail(message) { process.stderr.write(`${message}\n`); process.exit(1); }
const raw = process.env.KOC_TOURNAMENT_TEST_DATABASE_URL;
if (!raw) fail('KOC_TOURNAMENT_TEST_DATABASE_URL is required. No hosted or production fallback is permitted.');
let target;
try { target = new URL(raw); } catch { fail('KOC_TOURNAMENT_TEST_DATABASE_URL must be a valid PostgreSQL URL.'); }
if (!['postgres:','postgresql:'].includes(target.protocol) || !new Set(['localhost','127.0.0.1','[::1]','::1']).has(target.hostname)) fail('Refusing database test: target must be loopback PostgreSQL.');
if (!decodeURIComponent(target.pathname.slice(1)).startsWith('koc_tournament_test_')) fail('Refusing database test: database name must start with koc_tournament_test_.');
const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '../../..');
const bundled = join(root,'.local-postgres','runtime','pgsql','bin','psql.exe');
const psql = process.env.KOC_TEST_PSQL_PATH || (existsSync(bundled) ? bundled : 'psql');
for (const sql of [
  join(here,'bootstrap.sql'),
  join(root,'supabase','migrations','20260912100000_tournament_v1.sql'),
  join(root,'supabase','migrations','20260919100000_tournament_v1_completion.sql'),
  join(here,'contract.sql'),
]) {
  const result = spawnSync(psql,[raw,'-X','-v','ON_ERROR_STOP=1','-f',sql],{encoding:'utf8',stdio:['ignore','pipe','pipe']});
  if (result.error?.code === 'ENOENT') fail('psql is required for the isolated Tournament V1 database harness.');
  if (result.status !== 0) { process.stderr.write(`Failed while applying ${sql}\n${result.stderr || ''}`); process.exit(result.status ?? 1); }
  process.stdout.write(result.stdout);
}
