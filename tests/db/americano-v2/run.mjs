import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
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
  // Rehearse the exact Americano-only production release without Tournament.
  .filter((name) => !process.argv.includes('--americano-only') || !name.includes('tournament'))
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
  join(here, '../americano-v3/scoring.sql'),
  join(here, '../americano-v3/public-signup.sql'),
  join(here, 'concurrency-setup.sql'),
  join(here, '../americano-v3/workflows.sql'),
  join(here, '../americano-v3/deletion.sql'),
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

const v3ScheduleVector = JSON.parse(readFileSync(join(repositoryRoot, 'src', 'tests', 'fixtures', 'americano-v3', 'schedule-fingerprint.json'), 'utf8'));
const v3FingerprintState = {
  formatConfig: v3ScheduleVector.config,
  teams: [],
  americanoSchedule: {
    fingerprintVersion: 3,
    algorithmVersion: 'americano-v2.1',
    seed: v3ScheduleVector.seed,
    orderedEntrantIds: v3ScheduleVector.orderedEntrantIds,
    courtIds: v3ScheduleVector.courtIds,
    rounds: v3ScheduleVector.fixtures.map((round, index) => ({
      id: `44444444-4444-4444-8444-${String(index + 1).padStart(12, '0')}`,
      index: index + 1,
      matches: round.matches.map((match, matchIndex) => ({ ...match, id: `55555555-5555-4555-8555-${String(index * 10 + matchIndex + 1).padStart(12, '0')}` })),
      restingEntrantIds: round.rests,
      unusedCourtIds: [],
    })),
    metrics: v3ScheduleVector.metrics,
    rosterRevision: v3ScheduleVector.rosterRevision,
    inputFingerprint: v3ScheduleVector.expectedFingerprint,
  },
};
const v3StateLiteral = JSON.stringify(v3FingerprintState).replaceAll("'", "''");
const v3FingerprintResult = spawnSync(psql, [raw, '-X', '-A', '-t', '-v', 'ON_ERROR_STOP=1', '-c',
  `select public.americano_v3_schedule_fingerprint('${v3StateLiteral}'::jsonb)`], {
  encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
});
if (v3FingerprintResult.status !== 0) fail(v3FingerprintResult.stderr || 'Could not compute the PostgreSQL v3 schedule fingerprint.');
if (v3FingerprintResult.stdout.trim() !== v3ScheduleVector.expectedFingerprint) {
  fail(`PostgreSQL v3 schedule fingerprint did not match the TypeScript fixture: ${v3FingerprintResult.stdout.trim()}`);
}
process.stdout.write('Americano v3 TypeScript/PostgreSQL schedule fingerprint contract passed\n');

// Schema-3 owner writes use event-revision CAS and request receipts. Race two
// independent connections, then replay the winning request exactly.
const v3SavePayload = `(select payload from public.americano_test_concurrency_payloads where name='v3-save-race')`;
const v3SaveOwner = `with auth as materialized (select set_config('request.jwt.claim.sub','cccccccc-cccc-4ccc-8ccc-cccccccccccc',false),set_config('request.jwt.claim.role','authenticated',false))`;
const v3SaveCall = (requestId) => `${v3SaveOwner} select public.organizer_save_event_v3((${v3SavePayload}->>'eventId')::uuid,(${v3SavePayload}->>'eventRevision')::bigint,'${requestId}',${v3SavePayload}->'state') from auth`;
const v3RequestA = '99999999-9999-4999-8999-999999999941';
const v3RequestB = '99999999-9999-4999-8999-999999999942';
const [v3SaveA, v3SaveB] = await Promise.all([
  runPsqlCommand(v3SaveCall(v3RequestA)),
  runPsqlCommand(v3SaveCall(v3RequestB)),
]);
const v3Statuses = [v3SaveA, v3SaveB];
if (v3Statuses.filter((reply) => /"status": "applied"/.test(reply)).length !== 1
  || v3Statuses.filter((reply) => /"status": "conflict"/.test(reply)).length !== 1) {
  fail(`Americano v3 concurrent compare-and-swap did not produce one applied and one conflict response.\n${v3SaveA}\n${v3SaveB}`);
}
const winningRequest = v3SaveA.includes(v3RequestA) && /"status": "applied"/.test(v3SaveA) ? v3RequestA : v3RequestB;
const v3Replay = await runPsqlCommand(v3SaveCall(winningRequest));
if (!/"status": "replayed"/.test(v3Replay)) fail(`Americano v3 exact request replay was not idempotent.\n${v3Replay}`);
process.stdout.write('Americano v3 owner save CAS and idempotent replay contract passed\n');

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
const readyStartPayload = `(select payload from public.americano_test_concurrency_payloads where name='start-race-ready')`;
const ownerId = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const staleStartCall = `select public.organizer_start_americano_v2((${startPayload}->>'eventId')::uuid,(${startPayload}->>'eventRevision')::bigint,(${startPayload}->>'signupId')::uuid,(${startPayload}->>'capacityRevision')::bigint,(${startPayload}->>'rosterRevision')::bigint,'64444444-4444-4444-8444-444444444441',${startPayload}->'startState')`;
const signupWinsSql = `begin; select 1 from public.events where id=(${startPayload}->>'eventId')::uuid for update; select 'SIGNUP_LOCK_HELD'; select public.register_public_player_v2(${payloadSql('start-race','accountSlug')},${payloadSql('start-race','eventSlug')},'Foxtrot','foxtrot@example.invalid','64444444-4444-4444-8444-444444444442'); select pg_sleep(0.35); commit;`;
const signupWins = runPsqlCommandWithSignal(signupWinsSql, 'SIGNUP_LOCK_HELD');
await signupWins.signal;
const staleStart = await runPsqlCommand(`begin; select set_config('request.jwt.claim.sub','${ownerId}',true); select set_config('request.jwt.claim.role','authenticated',true); ${staleStartCall}; commit;`);
const signupWinnerReply = await signupWins.result;
if (!/"status": "applied"/.test(signupWinnerReply) || !/"registrationStatus": "waitlisted"/.test(signupWinnerReply)) {
  fail(`Expected the public signup to win and become the final wait-list entry.\n${signupWinnerReply}`);
}
if (!/"status": "conflict"/.test(staleStart)) fail(`Start did not reject the stale roster after signup won.\n${staleStart}`);
process.stdout.write('Signup-first race: registration waitlisted; stale Start conflicted.\n');

const refreshStart = spawnSync(psql, [raw, '-X', '-v', 'ON_ERROR_STOP=1', '-f', join(here, 'prepare-start-retry.sql')], {
  encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
});
if (refreshStart.status !== 0) {
  process.stderr.write(refreshStart.stderr || 'Could not prepare a refreshed Start preview after signup.\n');
  process.exit(refreshStart.status ?? 1);
}
process.stdout.write(refreshStart.stdout);

const startWinsSql = `begin; select set_config('request.jwt.claim.sub','${ownerId}',true); select set_config('request.jwt.claim.role','authenticated',true); select 1 from public.events where id=(${readyStartPayload}->>'eventId')::uuid for update; select 'START_LOCK_HELD'; select public.organizer_start_americano_v2((${readyStartPayload}->>'eventId')::uuid,(${readyStartPayload}->>'eventRevision')::bigint,(${readyStartPayload}->>'signupId')::uuid,(${readyStartPayload}->>'capacityRevision')::bigint,(${readyStartPayload}->>'rosterRevision')::bigint,'64444444-4444-4444-8444-444444444443',${readyStartPayload}->'startState'); select pg_sleep(0.35); commit;`;
const startWins = runPsqlCommandWithSignal(startWinsSql, 'START_LOCK_HELD');
await startWins.signal;
const signupAfterStart = await runPsqlCommand(`select public.register_public_player_v2(${payloadSql('start-race','accountSlug')},${payloadSql('start-race','eventSlug')},'Golf','golf@example.invalid','64444444-4444-4444-8444-444444444444');`);
const startWinnerReply = await startWins.result;
if (!/"status": "applied"/.test(startWinnerReply)) fail(`Expected Start to win the second separate-connection race.\n${startWinnerReply}`);
if (!/"status": "rejected"/.test(signupAfterStart) || !/"code": "REGISTRATIONS_CLOSED"/.test(signupAfterStart)) {
  fail(`Registration was not rejected after Start won.\n${signupAfterStart}`);
}
process.stdout.write('Start-first race: event started and locked; later signup rejected.\n');

// Repeat both lock order outcomes through the schema-3 Start RPC itself, not
// only through the shared schema-2 compatibility path.
const v3StartPayload = `(select payload from public.americano_test_concurrency_payloads where name='v3-start-race')`;
const v3ReadyStartPayload = `(select payload from public.americano_test_concurrency_payloads where name='v3-start-race-ready')`;
const v3StaleStartCall = `select public.organizer_start_americano_v3((${v3StartPayload}->>'eventId')::uuid,(${v3StartPayload}->>'eventRevision')::bigint,(${v3StartPayload}->>'signupId')::uuid,(${v3StartPayload}->>'capacityRevision')::bigint,(${v3StartPayload}->>'rosterRevision')::bigint,'99999999-9999-4999-8999-999999999951',${v3StartPayload}->'startState')`;
const v3SignupWinsSql = `begin; select 1 from public.events where id=(${v3StartPayload}->>'eventId')::uuid for update; select 'V3_SIGNUP_LOCK_HELD'; select public.register_public_player_v2(${v3StartPayload}->>'accountSlug',${v3StartPayload}->>'eventSlug','V3 Waitlist','v3-waitlist@example.invalid','99999999-9999-4999-8999-999999999952'); select pg_sleep(0.35); commit;`;
const v3SignupWins = runPsqlCommandWithSignal(v3SignupWinsSql, 'V3_SIGNUP_LOCK_HELD');
await v3SignupWins.signal;
const v3StaleStart = await runPsqlCommand(`begin; select set_config('request.jwt.claim.sub','cccccccc-cccc-4ccc-8ccc-cccccccccccc',true); select set_config('request.jwt.claim.role','authenticated',true); ${v3StaleStartCall}; commit;`);
const v3SignupWinnerReply = await v3SignupWins.result;
if (!/"status": "applied"/.test(v3SignupWinnerReply) || !/"registrationStatus": "waitlisted"/.test(v3SignupWinnerReply)) {
  fail(`Expected the schema-3 public signup to win and become wait-listed.\n${v3SignupWinnerReply}`);
}
if (!/"status": "conflict"/.test(v3StaleStart)) fail(`Schema-3 Start did not reject the stale signup revision.\n${v3StaleStart}`);
process.stdout.write('V3 signup-first race: registration wait-listed; stale Start conflicted.\n');

const refreshV3Start = spawnSync(psql, [raw, '-X', '-v', 'ON_ERROR_STOP=1', '-f', join(here, '../americano-v3/prepare-start-retry.sql')], {
  encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
});
if (refreshV3Start.status !== 0) {
  process.stderr.write(refreshV3Start.stderr || 'Could not prepare a refreshed v3 Start preview.\n');
  process.exit(refreshV3Start.status ?? 1);
}
process.stdout.write(refreshV3Start.stdout);

const v3StartWinsSql = `begin; select set_config('request.jwt.claim.sub','cccccccc-cccc-4ccc-8ccc-cccccccccccc',true); select set_config('request.jwt.claim.role','authenticated',true); select 1 from public.events where id=(${v3ReadyStartPayload}->>'eventId')::uuid for update; select 'V3_START_LOCK_HELD'; select public.organizer_start_americano_v3((${v3ReadyStartPayload}->>'eventId')::uuid,(${v3ReadyStartPayload}->>'eventRevision')::bigint,(${v3ReadyStartPayload}->>'signupId')::uuid,(${v3ReadyStartPayload}->>'capacityRevision')::bigint,(${v3ReadyStartPayload}->>'rosterRevision')::bigint,'99999999-9999-4999-8999-999999999953',${v3ReadyStartPayload}->'startState'); select pg_sleep(0.35); commit;`;
const v3StartWins = runPsqlCommandWithSignal(v3StartWinsSql, 'V3_START_LOCK_HELD');
await v3StartWins.signal;
const v3SignupAfterStart = await runPsqlCommand(`select public.register_public_player_v2(${v3StartPayload}->>'accountSlug',${v3StartPayload}->>'eventSlug','V3 Golf','v3-golf@example.invalid','99999999-9999-4999-8999-999999999954');`);
const v3StartWinnerReply = await v3StartWins.result;
if (!/"status": "applied"/.test(v3StartWinnerReply)) fail(`Expected schema-3 Start to win the second race.\n${v3StartWinnerReply}`);
if (!/"status": "rejected"/.test(v3SignupAfterStart) || !/"code": "REGISTRATIONS_CLOSED"/.test(v3SignupAfterStart)) {
  fail(`Schema-3 Start did not close later public signup.\n${v3SignupAfterStart}`);
}
process.stdout.write('V3 Start-first race: event started and locked; later signup rejected.\n');

const verify = spawnSync(psql, [raw, '-X', '-v', 'ON_ERROR_STOP=1', '-f', join(here, 'concurrency-verify.sql')], {
  encoding: 'utf8',
  stdio: ['ignore', 'pipe', 'pipe'],
});
if (verify.status !== 0) {
  process.stderr.write(verify.stderr || 'Americano concurrency verification failed.\n');
  process.exit(verify.status ?? 1);
}
process.stdout.write(verify.stdout);

const v3Verify = spawnSync(psql, [raw, '-X', '-v', 'ON_ERROR_STOP=1', '-f', join(here, '../americano-v3/concurrency-verify.sql')], {
  encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
});
if (v3Verify.status !== 0) {
  process.stderr.write(v3Verify.stderr || 'Americano v3 concurrency verification failed.\n');
  process.exit(v3Verify.status ?? 1);
}
process.stdout.write(v3Verify.stdout);

function runPsqlCommandWithSignal(sql, signal) {
  let signalResolve;
  let signalReject;
  let seenSignal = false;
  const signalPromise = new Promise((resolveSignal, rejectSignal) => {
    signalResolve = resolveSignal;
    signalReject = rejectSignal;
  });
  const result = new Promise((resolveCommand, rejectCommand) => {
    const child = spawn(psql, [raw, '-X', '-A', '-t', '-v', 'ON_ERROR_STOP=1', '-c', sql], { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk) => {
      stdout += chunk;
      if (!seenSignal && stdout.includes(signal)) {
        seenSignal = true;
        signalResolve();
      }
    });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.on('error', (error) => {
      if (!seenSignal) signalReject(error);
      rejectCommand(error);
    });
    child.on('close', (code) => {
      if (!seenSignal) signalReject(new Error(`psql exited before lock signal ${signal}: ${stderr}`));
      if (code === 0) resolveCommand(stdout);
      else rejectCommand(new Error(stderr || `psql exited with ${code}`));
    });
  });
  return { signal: signalPromise, result };
}
