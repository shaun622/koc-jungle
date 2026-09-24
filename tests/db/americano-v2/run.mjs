import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

function fail(message) {
  process.stderr.write(`${message}\n`);
  process.exit(1);
}

const raw = process.env.KOC_TEST_DATABASE_URL;
if (!raw) fail('KOC_TEST_DATABASE_URL is required. No production environment fallback is permitted.');

let target;
try {
  target = new URL(raw);
} catch {
  fail('KOC_TEST_DATABASE_URL must be a valid PostgreSQL URL.');
}

if (target.protocol !== 'postgres:' && target.protocol !== 'postgresql:') {
  fail('KOC_TEST_DATABASE_URL must use the postgres or postgresql protocol.');
}
const loopbackHosts = new Set(['localhost', '127.0.0.1', '[::1]', '::1']);
if (!loopbackHosts.has(target.hostname)) {
  fail('Refusing database test: host must be loopback.');
}
const databaseName = decodeURIComponent(target.pathname.replace(/^\//, ''));
if (!databaseName.startsWith('koc_americano_test_')) {
  fail('Refusing database test: database name must start with koc_americano_test_.');
}

const here = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = resolve(here, '../../..');
const localPsql = join(repositoryRoot, '.local-postgres', 'runtime', 'pgsql', 'bin', 'psql.exe');
const psql = process.env.KOC_TEST_PSQL_PATH || (existsSync(localPsql) ? localPsql : 'psql');
const migrationDirectory = join(repositoryRoot, 'supabase', 'migrations');
const migrations = readdirSync(migrationDirectory)
  .filter((name) => name.endsWith('.sql'))
  .sort();
const firstAmericanoMigration = migrations.findIndex((name) => name.startsWith('20260911'));
if (firstAmericanoMigration < 0) fail('Americano v2 migrations are missing from the test target.');
const sqlFiles = [
  join(here, 'bootstrap.sql'),
  join(repositoryRoot, 'supabase', 'schema.sql'),
  ...migrations.slice(0, firstAmericanoMigration).map((name) => join(migrationDirectory, name)),
  join(here, 'legacy-seed.sql'),
  ...migrations.slice(firstAmericanoMigration).map((name) => join(migrationDirectory, name)),
  join(here, 'contract.sql'),
  join(here, 'concurrency-setup.sql'),
];

for (const sqlFile of sqlFiles) {
  const result = spawnSync(psql, [raw, '-X', '-v', 'ON_ERROR_STOP=1', '-f', sqlFile], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  if (result.error?.code === 'ENOENT') fail('psql is required for the isolated PostgreSQL test harness.');
  if (result.status !== 0) {
    process.stderr.write(`Failed while applying ${sqlFile}\n`);
    process.stderr.write(result.stderr || 'Isolated PostgreSQL test failed.\n');
    process.exit(result.status ?? 1);
  }
  process.stdout.write(result.stdout);
}

function canonicalValue(value) {
  if (Array.isArray(value)) return value.map(canonicalValue);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => [key, canonicalValue(entry)]));
  }
  return value;
}

const crossLanguageStateResult = spawnSync(psql, [raw, '-X', '-A', '-t', '-v', 'ON_ERROR_STOP=1', '-c',
  "select (payload->'startState')::text from public.americano_test_concurrency_payloads where name='start-race'"], {
  encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
});
if (crossLanguageStateResult.status !== 0) fail(crossLanguageStateResult.stderr || 'Could not read the fingerprint fixture.');
const crossLanguageState = JSON.parse(crossLanguageStateResult.stdout.trim());
const crossLanguageSchedule = crossLanguageState.americanoSchedule;
const crossLanguagePayload = {
  algorithmVersion: crossLanguageSchedule.algorithmVersion,
  pairingMode: crossLanguageState.formatConfig.pairingMode,
  pointsPerMatch: crossLanguageState.formatConfig.pointsPerMatch,
  scheduleKind: crossLanguageState.formatConfig.scheduleKind,
  customRounds: crossLanguageState.formatConfig.customRounds ?? null,
  paceMinutes: crossLanguageState.formatConfig.paceMinutes,
  paceClockEnabled: crossLanguageState.formatConfig.paceClockEnabled,
  seed: crossLanguageSchedule.seed,
  orderedEntrantIds: crossLanguageSchedule.orderedEntrantIds,
  membership: crossLanguageState.formatConfig.pairingMode === 'fixed'
    ? crossLanguageState.teams.filter((team) => team.active).map((team) => ({ teamId: team.id, playerIds: team.players.map((player) => player.id) }))
    : null,
  courtIds: crossLanguageSchedule.courtIds,
  rosterRevision: crossLanguageSchedule.rosterRevision,
  fixtures: crossLanguageSchedule.rounds.map((round) => ({
    matches: round.matches.map((match) => ({ courtId: match.courtId, sideA: match.sideA, sideB: match.sideB })),
    rests: round.restingEntrantIds,
  })),
  metrics: crossLanguageSchedule.metrics,
};
const crossLanguageFingerprint = createHash('sha256').update(JSON.stringify(canonicalValue(crossLanguagePayload))).digest('hex');
if (crossLanguageFingerprint !== crossLanguageSchedule.inputFingerprint) {
  fail('PostgreSQL and browser canonical schedule fingerprints do not match.');
}
process.stdout.write('Americano v2 cross-language fingerprint contract passed\n');

function runPsqlCommand(sql) {
  return new Promise((resolveCommand, rejectCommand) => {
    const child = spawn(psql, [raw, '-X', '-A', '-t', '-v', 'ON_ERROR_STOP=1', '-c', sql], {
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.on('error', rejectCommand);
    child.on('close', (code) => {
      if (code === 0) resolveCommand(stdout);
      else rejectCommand(new Error(stderr || `psql exited with ${code}`));
    });
  });
}

const payloadSql = (name, key) => `(select payload->>'${key}' from public.americano_test_concurrency_payloads where name='${name}')`;
const [lastSlotA, lastSlotB] = await Promise.all([
  runPsqlCommand(`begin; select public.register_public_player_v2(${payloadSql('last-slot','accountSlug')},${payloadSql('last-slot','eventSlug')},'Delta','delta@example.invalid','63333333-3333-4333-8333-333333333331'); select pg_sleep(0.35); commit;`),
  runPsqlCommand(`begin; select public.register_public_player_v2(${payloadSql('last-slot','accountSlug')},${payloadSql('last-slot','eventSlug')},'Echo','echo@example.invalid','63333333-3333-4333-8333-333333333332'); commit;`),
]);
process.stdout.write(lastSlotA);
process.stdout.write(lastSlotB);

// The exact same request IDs must replay without creating another row.
await Promise.all([
  runPsqlCommand(`select public.register_public_player_v2(${payloadSql('last-slot','accountSlug')},${payloadSql('last-slot','eventSlug')},'Delta','delta@example.invalid','63333333-3333-4333-8333-333333333331');`),
  runPsqlCommand(`select public.register_public_player_v2(${payloadSql('last-slot','accountSlug')},${payloadSql('last-slot','eventSlug')},'Echo','echo@example.invalid','63333333-3333-4333-8333-333333333332');`),
]);

const startPayload = `(select payload from public.americano_test_concurrency_payloads where name='start-race')`;
const ownerPrefix = `select set_config('request.jwt.claim.sub','dddddddd-dddd-4ddd-8ddd-dddddddddddd',false); select set_config('request.jwt.claim.role','authenticated',false);`;
const [startReply, signupReply] = await Promise.all([
  runPsqlCommand(`${ownerPrefix} select public.organizer_start_americano_v2((${startPayload}->>'eventId')::uuid,(${startPayload}->>'eventRevision')::bigint,(${startPayload}->>'signupId')::uuid,(${startPayload}->>'capacityRevision')::bigint,(${startPayload}->>'rosterRevision')::bigint,'64444444-4444-4444-8444-444444444441',${startPayload}->'startState');`),
  runPsqlCommand(`select public.register_public_player_v2(${payloadSql('start-race','accountSlug')},${payloadSql('start-race','eventSlug')},'Foxtrot','foxtrot@example.invalid','64444444-4444-4444-8444-444444444442');`),
]);
process.stdout.write(startReply);
process.stdout.write(signupReply);

const verify = spawnSync(psql, [raw, '-X', '-v', 'ON_ERROR_STOP=1', '-f', join(here, 'concurrency-verify.sql')], {
  encoding: 'utf8',
  stdio: ['ignore', 'pipe', 'pipe'],
});
if (verify.status !== 0) {
  process.stderr.write(verify.stderr || 'Americano concurrency verification failed.\n');
  process.exit(verify.status ?? 1);
}
process.stdout.write(verify.stdout);
