import { randomBytes, randomUUID } from 'node:crypto';

function assert(condition, message) { if (!condition) throw new Error(message); }

export async function runSmoke(runtime) {
  const apiUrl = runtime.values.api_url ?? runtime.values.API_URL;
  const proxyUrl = runtime.proxyUrl;
  const anonKey = runtime.values.anon_key ?? runtime.values.ANON_KEY;
  const ownerA = runtime.syntheticUsers.find((user) => user.label === 'owner-a');
  const ownerB = runtime.syntheticUsers.find((user) => user.label === 'owner-b');
  if (!ownerA || !ownerB || !apiUrl || !anonKey || !proxyUrl) throw new Error('Local runtime credentials or trusted proxy are incomplete.');
  for (const url of [apiUrl, proxyUrl]) assert(new URL(url).hostname === '127.0.0.1', 'V6 refuses nonloopback runtime URLs.');

  const signIn = async (user) => {
    const response = await fetch(`${apiUrl}/auth/v1/token?grant_type=password`, { method: 'POST', headers: { apikey: anonKey, 'Content-Type': 'application/json' }, body: JSON.stringify({ email: user.email, password: user.password }) });
    assert(response.ok, `Synthetic ${user.label} sign-in failed (${response.status}).`); return (await response.json()).access_token;
  };
  const [tokenA, tokenB] = await Promise.all([signIn(ownerA), signIn(ownerB)]);
  const ownerCall = async (token, body, extra = {}) => {
    const response = await fetch(`${apiUrl}/functions/v1/tournament-owner`, { method: 'POST', headers: { apikey: anonKey, Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', Origin: 'http://127.0.0.1:4187', ...extra }, body: JSON.stringify(body) });
    const parsed = await response.json(); return { response, body: parsed };
  };
  const publicCall = async (slug, body, direct = false, headers = {}) => {
    const response = await fetch(`${direct ? apiUrl : proxyUrl}/functions/v1/tournament-public?slug=${encodeURIComponent(slug)}`, { method: body === undefined ? 'GET' : 'POST', headers: { apikey: anonKey, Authorization: `Bearer ${anonKey}`, 'Content-Type': 'application/json', Origin: 'http://127.0.0.1:4187', ...headers }, ...(body === undefined ? {} : { body: typeof body === 'string' ? body : JSON.stringify(body) }) });
    const parsed = await response.json(); return { response, body: parsed };
  };
  const command = (state, kind, payload, deviceId = 'edge-setup') => ({ protocol: 'tournament-v1', contractVersion: 2, tournamentId: state.id, commandId: randomUUID(), baseRevision: state.revision, controllerEpoch: state.controller.epoch, deviceId: state.controller.deviceId ?? deviceId, sequence: state.lifecycle === 'live' ? state.controller.nextSequence : 0, kind, payload, issuedAt: Date.now() });

  const unauthenticated = await fetch(`${apiUrl}/functions/v1/tournament-owner`, { method: 'POST', headers: { apikey: anonKey, 'Content-Type': 'application/json', Origin: 'http://127.0.0.1:4187' }, body: JSON.stringify({ action: 'list' }) });
  assert(unauthenticated.status === 401, `Owner endpoint accepted anonymous access (${unauthenticated.status}).`);
  const options = await fetch(`${apiUrl}/functions/v1/tournament-owner`, { method: 'OPTIONS', headers: { apikey: anonKey, Origin: 'http://127.0.0.1:4187' } });
  assert(options.status === 204 && options.headers.get('access-control-allow-origin') === 'http://127.0.0.1:4187', 'Owner CORS preflight did not return the allowlisted origin.');

  const tournamentId = randomUUID(); const createOperationId = randomUUID(); const slug = `edge-${randomUUID()}`;
  const createIntent = { action: 'create', operationId: createOperationId, tournamentId, title: 'V6 edge acceptance', courtCount: 2, timeZone: 'UTC' };
  const created = await ownerCall(tokenA, createIntent);
  assert(created.response.ok && created.body.status === 'applied', `Owner create failed: ${JSON.stringify(created.body)}`);
  const replayedCreate = await ownerCall(tokenA, createIntent);
  assert(replayedCreate.body.status === 'replayed', 'Exact create retry did not replay.');
  const changedCreate = await ownerCall(tokenA, { ...createIntent, title: 'Changed intent' });
  assert(changedCreate.response.status === 409 && changedCreate.body.code === 'OPERATION_ID_REUSED', 'Changed create intent reused an operation ID.');
  const otherOwnerGet = await ownerCall(tokenB, { action: 'get', tournamentId });
  assert(otherOwnerGet.response.status === 404, 'Owner B could read owner A Tournament.');

  let state = created.body.snapshot;
  let reply = await ownerCall(tokenA, { action: 'command', command: command(state, 'update-capacity', { divisionId: state.divisions[0].id, capacity: 1 }), privateContactChanges: [] });
  assert(reply.response.ok && reply.body.status === 'applied', `Capacity command failed: ${JSON.stringify(reply.body)}`); state = reply.body.snapshot;
  reply = await ownerCall(tokenA, { action: 'command', command: command(state, 'update-metadata', { patch: { publicSlug: slug, startsAt: '2099-01-01T18:00:00.000Z', signupOpen: true } }), privateContactChanges: [] });
  assert(reply.response.ok && reply.body.status === 'applied', `Publication command failed: ${JSON.stringify(reply.body)}`); state = reply.body.snapshot;

  const projection = await publicCall(slug);
  assert(projection.response.ok && projection.body.projection?.projectionVersion === 2, 'Anonymous public projection was unavailable or unversioned.');
  const oversized = await publicCall(slug, JSON.stringify({ padding: 'x'.repeat(5_000) }));
  assert(oversized.response.status === 413 && oversized.body.code === 'BODY_TOO_LARGE', 'Actual public request byte limit was not enforced.');

  const sentinel = 'PRIVATE-CONTACT-SENTINEL@invalid';
  const signupA = { contractVersion: 2, commandId: randomUUID(), tournamentId, divisionId: state.divisions[0].id, playerOne: 'Alpha One', playerTwo: 'Alpha Two', teamName: 'Alpha', contact: sentinel };
  const signupB = { contractVersion: 2, commandId: randomUUID(), tournamentId, divisionId: state.divisions[0].id, playerOne: 'Bravo One', playerTwo: 'Bravo Two', teamName: 'Bravo', contact: '+620000000' };
  const directSpoof = await publicCall(slug, { ...signupB, commandId: randomUUID() }, true, { 'x-tournament-client-ip': '203.0.113.10', 'x-tournament-client-ip-timestamp': String(Date.now()), 'x-tournament-client-ip-signature': 'forged' });
  assert(directSpoof.response.status === 503 && directSpoof.body.code === 'TRUSTED_IP_REQUIRED', 'Direct/spoofed public POST bypassed the trusted proxy proof.');
  const race = await Promise.all([publicCall(slug, signupA), publicCall(slug, signupB)]);
  assert(race.every((item) => item.response.ok), `Concurrent signup failed: ${JSON.stringify(race.map((item) => item.body))}`);
  assert(race.map((item) => item.body.result?.admission).sort().join(',') === 'confirmed,waiting', 'Last-place signup race did not yield exactly one confirmed and one waiting entry.');
  const exactSignupReplay = await publicCall(slug, signupA);
  assert(exactSignupReplay.body.status === 'replayed', 'Exact public signup retry did not replay.');
  const changedContact = await publicCall(slug, { ...signupA, contact: 'changed@invalid' });
  assert(changedContact.response.status === 409 && changedContact.body.code === 'COMMAND_ID_REUSED', 'Same signup command ID accepted changed private contact.');
  const publicAfter = await publicCall(slug);
  assert(!JSON.stringify(publicAfter.body).includes(sentinel), 'Private contact leaked into public projection.');
  const ownerAfter = await ownerCall(tokenA, { action: 'get', tournamentId });
  assert(ownerAfter.response.ok && Object.values(ownerAfter.body.contacts).includes(sentinel), 'Owner state did not retain the private contact atomically.'); state = ownerAfter.body.snapshot;

  const directRpc = await fetch(`${apiUrl}/rest/v1/rpc/internal_get_tournament_v1`, { method: 'POST', headers: { apikey: anonKey, Authorization: `Bearer ${anonKey}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ p_owner_id: ownerA.id, p_tournament_id: tournamentId }) });
  assert(!directRpc.ok, 'Anonymous caller could execute a service-only Tournament RPC.');

  reply = await ownerCall(tokenA, { action: 'command', command: command(state, 'update-metadata', { patch: { signupOpen: false } }), privateContactChanges: [] });
  assert(reply.response.ok, `Signup close failed: ${JSON.stringify(reply.body)}`); state = reply.body.snapshot;
  const grantRequest = { contractVersion: 2, action: 'begin', operationId: randomUUID(), tournamentId, baseRevision: state.revision, expectedEpoch: state.controller.epoch, deviceId: 'edge-device-a', nonce: randomBytes(32).toString('base64url'), reason: null, acknowledgeInaccessibleWork: false };
  const granted = await ownerCall(tokenA, { action: 'begin', request: grantRequest });
  assert(granted.response.ok && granted.body.capability && granted.body.snapshot.lifecycle === 'live', `Controller grant failed: ${JSON.stringify(granted.body)}`); state = granted.body.snapshot;
  const replayedGrant = await ownerCall(tokenA, { action: 'begin', request: grantRequest });
  assert(replayedGrant.body.status === 'replayed' && replayedGrant.body.capability === granted.body.capability, 'Exact lost grant response did not recover the current capability.');
  const wrongNonce = await ownerCall(tokenA, { action: 'begin', request: { ...grantRequest, nonce: randomBytes(32).toString('base64url') } });
  assert(wrongNonce.response.status === 409, 'Changed claim nonce recovered controller authority.');
  const releaseRequest = { contractVersion: 2, action: 'release', operationId: randomUUID(), tournamentId, baseRevision: state.revision, expectedEpoch: state.controller.epoch, expectedSequence: state.controller.nextSequence, deviceId: 'edge-device-a', reason: null };
  const released = await ownerCall(tokenA, { action: 'release', request: releaseRequest }, { 'x-tournament-capability': granted.body.capability });
  assert(released.response.ok && released.body.snapshot.controller.deviceId === null, `Controller release failed: ${JSON.stringify(released.body)}`);
  const replayedRelease = await ownerCall(tokenA, { action: 'release', request: releaseRequest });
  assert(replayedRelease.body.status === 'replayed', 'Exact lost release response did not replay.');

  const deleteIntent = { action: 'delete', operationId: randomUUID(), tournamentId };
  const deleted = await ownerCall(tokenA, deleteIntent); assert(deleted.response.ok && deleted.body.status === 'applied', 'Tournament delete failed.');
  const replayedDelete = await ownerCall(tokenA, deleteIntent); assert(replayedDelete.body.status === 'replayed', 'Exact delete retry did not replay.');
  const resurrect = await ownerCall(tokenA, { ...createIntent, operationId: randomUUID() });
  assert(!resurrect.response.ok && resurrect.body.code === 'TOURNAMENT_DELETED', 'A tombstoned Tournament was recreated.');
}
