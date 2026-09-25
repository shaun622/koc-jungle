// Isolated release regressions using real browser-generated schedules and PostgreSQL RPCs.
// Run after run.mjs. Never accepts a remote database or production fallback.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';

const raw = process.env.KOC_TEST_DATABASE_URL;
if (!raw) throw new Error('KOC_TEST_DATABASE_URL is required');
const target = new URL(raw);
if (!['postgres:', 'postgresql:'].includes(target.protocol)
  || !['localhost', '127.0.0.1', '[::1]'].includes(target.hostname)
  || !decodeURIComponent(target.pathname.slice(1)).startsWith('koc_americano_test_')) {
  throw new Error('Release regressions require an isolated loopback Americano test database');
}
const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const psql = process.env.KOC_TEST_PSQL_PATH || join(root, '.local-postgres/runtime/pgsql/bin/psql.exe');
const q = (value) => value == null ? 'null' : "'" + String(value).replaceAll("'", "''") + "'";
const json = (value) => q(JSON.stringify(value)) + '::jsonb';
const owner = randomUUID();
function sql(statement, allowFailure = false) {
  const result = spawnSync(psql, [raw, '-X', '-A', '-t', '-v', 'ON_ERROR_STOP=1'], {
    input: statement, encoding: 'utf8',
  });
  if (!allowFailure && result.status !== 0) throw new Error(result.stderr || String(result.error));
  return result;
}
function call(name, args, authenticated = true) {
  const prefix = authenticated ? "select set_config('request.jwt.claim.sub'," + q(owner) + ",false);" : '';
  const result = sql(prefix + ' select public.' + name + '(' + args.join(',') + ');');
  return JSON.parse(result.stdout.trim().split('\n').at(-1));
}
function applied(reply) {
  assert.equal(reply.status, 'applied', JSON.stringify(reply));
  return reply.snapshot;
}
function rejected(reply, code) { assert.equal(reply.code, code, JSON.stringify(reply)); }
function current(id) { return call('owner_event_snapshot_v2_internal', [q(id), q(owner)]); }
function save(state) {
  return call('organizer_save_event_v2', [q(state.id), q(state.revision), q(randomUUID()), json(state)]);
}
function start(snapshot, state, signupId = snapshot.signup.id, request = randomUUID()) {
  return call('organizer_start_americano_v2', [
    q(state.id), q(snapshot.event.revision), q(signupId), q(snapshot.signup.capacityRevision),
    q(snapshot.signup.rosterRevision), q(request), json(state),
  ]);
}
function register(snapshot, mode, label) {
  const args = [q(snapshot.signup.accountSlug), q(snapshot.signup.eventSlug)];
  return mode === 'fixed'
    ? call('register_public_pair_v3', [...args, q(label), q(label + ' One'), q(label + ' Two'), q('synthetic@example.invalid'), q(randomUUID())], false)
    : call('register_public_player_v2', [...args, q(label), q('synthetic@example.invalid'), q(randomUUID())], false);
}
function configure(snapshot, courts, signupId = snapshot.signup.id) {
  return call('organizer_save_americano_config_v2', [
    q(snapshot.event.id), q(snapshot.event.revision), q(signupId), q(snapshot.signup.capacityRevision),
    q(snapshot.signup.rosterRevision), q(randomUUID()), json(courts), json(snapshot.event.state.formatConfig),
  ]);
}
sql('insert into auth.users(id,email) values(' + q(owner) + ",'release-test@example.invalid');");
const vite = await createServer({ configFile: false, root, resolve: { alias: { '@': resolve(root, 'src') } },
  server: { middlewareMode: true }, appType: 'custom' });
try {
  const runtime = await vite.ssrLoadModule('/src/logic/americanoV2/runtime.ts');
  async function publish(mode, courts = 2, count = 0) {
    let state = runtime.createAmericanoEventV2('Release test ' + randomUUID(), mode, courts);
    for (let index = 0; index < count; index++) {
      state = mode === 'fixed'
        ? runtime.addAmericanoFixedTeam(state, { teamName: 'Seed ' + index, playerOne: 'One ' + index, playerTwo: 'Two ' + index })
        : runtime.addAmericanoParticipant(state, 'Player ' + index);
    }
    const saved = applied(save(state));
    state = saved.event.state;
    const entries = mode === 'fixed'
      ? state.teams.map((team, i) => ({ localEntrantId: team.id, teamName: team.name, playerOne: team.players[0].name, playerTwo: team.players[1].name, contact: '', rank: i + 1 }))
      : state.participants.map((p, i) => ({ localEntrantId: p.id, playerOne: p.name, contact: '', rank: i + 1 }));
    return applied(call('organizer_save_signup_event_v3', [
      q(state.id), q(state.revision), 'null', '0', '0', q(randomUUID()),
      json({ accountSlug: 'release-test', title: state.name, venue: 'Synthetic court',
        startsAt: null, endsAt: null, details: '', prizes: '', timeZone: 'Asia/Singapore',
        organizerName: 'Synthetic', publicContactMethod: null, publicContactValue: '' }), json(entries),
    ]));
  }
  async function preview(snapshot) {
    return runtime.previewAmericanoSchedule(snapshot.event.state, {
      seed: 91, rosterRevision: snapshot.signup.rosterRevision,
      acknowledgeRepeatedCycle: true, acknowledgeUnevenAppearances: true,
    });
  }
  for (const mode of ['fixed', 'rotating']) {
    const max = mode === 'fixed' ? 4 : 8;
    let snapshot = await publish(mode, 2, max);
    const courts = snapshot.event.state.courts;
    const initialIds = (mode === 'fixed' ? snapshot.event.state.teams : snapshot.event.state.participants).map((p) => p.id);
    const wait = register(snapshot, mode, 'Overflow');
    assert.equal(wait.registrationStatus, 'waitlisted');
    snapshot = current(snapshot.event.id);
    rejected(configure(snapshot, courts, null), 'SIGNUP_REQUIRED');
    snapshot = applied(configure(snapshot, courts.slice(0, 1)));
    assert.equal(snapshot.signup.registrations.filter((p) => p.status === 'confirmed').length, max / 2);
    const reduced = mode === 'fixed' ? snapshot.event.state.teams : snapshot.event.state.participants;
    assert.deepEqual(reduced.map((p) => p.id), initialIds.slice(0, max / 2));
    assert.equal(snapshot.event.state.americanoSchedule, undefined);
    snapshot = applied(configure(snapshot, courts));
    assert.deepEqual((mode === 'fixed' ? snapshot.event.state.teams : snapshot.event.state.participants).map((p) => p.id), initialIds);

    // Preview may be replaced until Start; generic saves must never bypass the start handshake.
    snapshot = applied(save(await preview(snapshot)));
    snapshot = applied(save(await runtime.previewAmericanoSchedule(snapshot.event.state, {
      seed: 92, reshuffle: true, rosterRevision: snapshot.signup.rosterRevision,
      acknowledgeRepeatedCycle: true, acknowledgeUnevenAppearances: true,
    })));
    const live = runtime.startAmericanoEvent(snapshot.event.state);
    rejected(start(snapshot, live, null), 'SIGNUP_REQUIRED');
    rejected(save(live), 'START_REQUIRED');
    assert.equal(current(snapshot.event.id).signup.isOpen, true);
    const request = randomUUID();
    const started = applied(start(snapshot, live, snapshot.signup.id, request));
    assert.equal(started.signup.isOpen, false);
    assert.ok(started.signup.rosterLockedAt);
    assert.equal(start(snapshot, live, snapshot.signup.id, request).status, 'replayed');
    rejected(register(started, mode, 'Too late'), 'REGISTRATIONS_CLOSED');

    // Even a legacy/admin-reopened signup must not mutate a started event.
    sql("begin; select set_config('app.americano_v2_rpc','on',true); update public.signup_events set is_open=true,roster_locked_at=null where id=" + q(started.signup.id) + '; commit;');
    const before = current(started.event.id).event;
    rejected(register(started, mode, 'Still too late'), 'REGISTRATIONS_CLOSED');
    if (mode === 'fixed') {
      rejected(call('register_public_single_v3', [q(started.signup.accountSlug), q(started.signup.eventSlug),
        q('Late solo'), q('test@example.invalid'), q(randomUUID())], false), 'REGISTRATIONS_CLOSED');
      rejected(call('join_public_single_v3', [q(started.signup.accountSlug), q(started.signup.eventSlug),
        q(randomUUID()), q('Late partner'), q('test@example.invalid'), q(randomUUID())], false), 'REGISTRATIONS_CLOSED');
    }
    assert.deepEqual(current(started.event.id).event, before);
    const guard = sql('select public.americano_v2_commit_roster_projection(' + q(started.event.id) + ',' + q(started.signup.id) + ');', true);
    assert.notEqual(guard.status, 0);
    assert.match(guard.stderr, /Registrations are closed/);
    const scored = runtime.setAmericanoResultSide(started.event.state, started.event.state.rounds[0].matches[0].id, 'A', 10);
    const confirmed = runtime.confirmAmericanoResult(scored, scored.rounds[0].matches[0].id);
    const corrected = applied(save(confirmed));
    assert.equal(corrected.event.state.rounds[0].matches[0].scoreB, 14);
    console.log(mode + ': court capacity, preview replacement, atomic start, replay, post-start guards and scoring passed');
  }

  // Solo created first, complete pair second, then the solo finds a partner.
  // Pair-completion order differs from creation order and must still start.
  let snapshot = await publish('fixed', 1);
  const args = [q(snapshot.signup.accountSlug), q(snapshot.signup.eventSlug)];
  const solo = call('register_public_single_v3', [...args, q('First solo'), q('test@example.invalid'), q(randomUUID())], false);
  assert.equal(solo.status, 'applied', JSON.stringify(solo));
  const pair = register(snapshot, 'fixed', 'Complete pair');
  assert.equal(pair.status, 'applied', JSON.stringify(pair));
  const joined = call('join_public_single_v3', [...args, q(solo.registrationId), q('Partner'), q('test@example.invalid'), q(randomUUID())], false);
  assert.equal(joined.status, 'applied', JSON.stringify(joined));
  snapshot = current(snapshot.event.id);
  assert.equal(snapshot.event.state.teams[0].signupRegistrationId, pair.registrationId);
  const started = applied(start(snapshot, runtime.startAmericanoEvent(await preview(snapshot))));
  assert.equal(started.event.state.status, 'round-in-progress');
  console.log('fixed pairs: late partner completion starts with canonical pair order');
  console.log('Americano release safety regressions passed');
} finally {
  await vite.close();
}
