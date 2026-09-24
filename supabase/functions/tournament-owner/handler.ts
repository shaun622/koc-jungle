import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.106.2';
import {
  createTournamentV1,
  applyAuthorityGrantState,
  applyAuthorityReleaseState,
  parseTournamentCommandEnvelope,
  publicProjection,
  reduceTournamentWithEffects,
  upgradeTournamentV1,
  validateGrantRequest,
  validateReleaseRequest,
  validateContactMap,
  type TournamentPrivateContacts,
} from '../_shared/tournament/index.ts';
import {
  TournamentHttpError,
  corsHeaders,
  errorReply,
  exactKeys,
  hmacHex,
  jsonReply,
  objectBody,
  readJsonBytes,
  requireUuid,
  sha256Hex,
} from '../_shared/tournamentHttp.ts';
import { deriveAuthorityMaterial } from '../_shared/tournamentAuthority.ts';

type Environment = (name: string) => string | undefined;
type ClientFactory = typeof createClient;

const safeAudit = (state: ReturnType<typeof upgradeTournamentV1>) => {
  const latest = state.audit.at(-1);
  return latest ? { commandId: latest.commandId, kind: latest.kind, at: latest.at, touchedIds: latest.touchedIds, resultingRevision: latest.resultingRevision } : {};
};

const keyVersion = (env: Environment) => {
  const parsed = Number(env('TOURNAMENT_IDEMPOTENCY_KEY_VERSION') ?? '1');
  if (!Number.isSafeInteger(parsed) || parsed < 1) throw new TournamentHttpError(503, 'IDEMPOTENCY_UNAVAILABLE', 'Tournament idempotency service is unavailable.');
  return parsed;
};

async function derivedUuid(seed: string): Promise<string> {
  const hash = await sha256Hex(seed);
  return `${hash.slice(0,8)}-${hash.slice(8,12)}-4${hash.slice(13,16)}-a${hash.slice(17,20)}-${hash.slice(20,32)}`;
}

function responseStatus(body: Record<string, unknown>): number {
  if (body.status === 'conflict') return 409;
  if (body.status !== 'rejected') return body.status === 'applied' ? 200 : 200;
  if (body.code === 'NOT_FOUND' || body.code === 'TOURNAMENT_DELETED') return 404;
  if (body.code === 'AUTHORITY_CHANGED' || body.code === 'REVISION_CONFLICT' || String(body.code).includes('REUSED') || body.code === 'UPDATE_REQUIRED') return 409;
  return 400;
}

function privateChanges(value: unknown): Array<{ entryId: string; contact: string | null }> {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > 128) throw new TournamentHttpError(400, 'CONTACT_SHAPE', 'privateContactChanges must contain at most 128 rows.', 'privateContactChanges');
  const seen = new Set<string>();
  return value.map((item, index) => {
    const row = objectBody(item, `privateContactChanges.${index}`);
    exactKeys(row, ['entryId', 'contact'], `privateContactChanges.${index}`);
    const entryId = String(row.entryId ?? '');
    if (!/^[A-Za-z0-9_-]{1,160}$/.test(entryId)) throw new TournamentHttpError(400, 'CONTACT_ENTRY', 'Contact entry ID is invalid.', `privateContactChanges.${index}.entryId`);
    if (seen.has(entryId)) throw new TournamentHttpError(400, 'CONTACT_DUPLICATE', 'A contact entry may appear only once.', `privateContactChanges.${index}.entryId`);
    seen.add(entryId);
    if (row.contact !== null && typeof row.contact !== 'string') throw new TournamentHttpError(400, 'CONTACT_SHAPE', 'Contact must be text or null.', `privateContactChanges.${index}.contact`);
    const contact = typeof row.contact === 'string' ? row.contact.trim() : null;
    if (contact && contact.length > 100) throw new TournamentHttpError(400, 'CONTACT_LENGTH', 'Contact must be 100 characters or fewer.', `privateContactChanges.${index}.contact`);
    return { entryId, contact: contact || null };
  });
}

export function createTournamentOwnerHandler(options: { env?: Environment; createClient?: ClientFactory } = {}) {
  const env = options.env ?? ((name) => Deno.env.get(name));
  const clientFactory = options.createClient ?? createClient;
  return async (request: Request): Promise<Response> => {
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeaders(request, env) });
    if (request.method !== 'POST') return jsonReply(request, env, { status: 'rejected', code: 'METHOD', message: 'Use POST.' }, 405);
    try {
      const url = env('SUPABASE_URL'); const anonKey = env('SUPABASE_ANON_KEY'); const serviceKey = env('SUPABASE_SERVICE_ROLE_KEY');
      if (!url || !anonKey || !serviceKey) throw new TournamentHttpError(503, 'SERVER_CONFIG', 'Tournament service is unavailable.');
      const token = request.headers.get('authorization')?.replace(/^Bearer\s+/i, '');
      if (!token) throw new TournamentHttpError(401, 'AUTH_REQUIRED', 'Sign in to manage this tournament.');
      const auth = clientFactory(url, anonKey, { global: { headers: { Authorization: `Bearer ${token}` } }, auth: { persistSession: false } });
      const { data: authData, error: authError } = await auth.auth.getUser(token);
      if (authError || !authData.user) throw new TournamentHttpError(401, 'AUTH_INVALID', 'Your session expired. Sign in again.');
      const ownerId = authData.user.id;
      const service = clientFactory(url, serviceKey, { auth: { persistSession: false } });
      const body = objectBody(await readJsonBytes(request, 2 * 1024 * 1024));
      const action = String(body.action ?? '');
      if (!action) throw new TournamentHttpError(400, 'ACTION_REQUIRED', 'action is required.', 'action');
      const secret = env('TOURNAMENT_IDEMPOTENCY_SECRET') ?? '';
      const hashVersion = keyVersion(env);

      if (action === 'create') {
        exactKeys(body, ['action','operationId','tournamentId','title','courtCount','timeZone']);
        const operationId = requireUuid(body.operationId, 'operationId'); const tournamentId = requireUuid(body.tournamentId, 'tournamentId');
        const title = typeof body.title === 'string' ? body.title.trim() : '';
        const courtCount = Number(body.courtCount); const timeZone = typeof body.timeZone === 'string' ? body.timeZone : '';
        if (!title || title.length > 80) throw new TournamentHttpError(400, 'TITLE', 'Title is required and must be at most 80 characters.', 'title');
        if (!Number.isInteger(courtCount) || courtCount < 1 || courtCount > 16) throw new TournamentHttpError(400, 'COURT_COUNT', 'Court count must be between 1 and 16.', 'courtCount');
        try { new Intl.DateTimeFormat('en', { timeZone }).format(); } catch { throw new TournamentHttpError(400, 'TIME_ZONE', 'Choose a valid IANA time zone.', 'timeZone'); }
        const divisionId = `division-${await derivedUuid(`${tournamentId}:division:0`)}`;
        const courtIds = await Promise.all(Array.from({ length: courtCount }, (_, index) => derivedUuid(`${tournamentId}:court:${index}`).then((id) => `court-${id}`)));
        const now = Date.now(); const state = createTournamentV1({ id: tournamentId, title, now, divisionId, courtIds }); state.meta.timeZone = timeZone;
        const intent = { action, operationId, tournamentId, title, courtCount, timeZone, hashVersion };
        const requestHash = await hmacHex(secret, intent);
        const { data, error } = await service.rpc('internal_create_tournament_v1', { p_owner_id: ownerId, p_operation_id: operationId, p_tournament_id: tournamentId, p_request_hash: requestHash, p_hash_key_version: hashVersion, p_initial_state: state });
        if (error) throw new TournamentHttpError(503, 'DEPENDENCY', 'Tournament creation could not be confirmed. Retry with the same request.');
        return jsonReply(request, env, data?.status === 'applied' || data?.status === 'replayed' ? { ...data, snapshot: state } : data, responseStatus(data as Record<string, unknown>));
      }

      if (action === 'import-copy') {
        exactKeys(body, ['action','operationId','tournamentId','snapshot','contacts']);
        const operationId = requireUuid(body.operationId, 'operationId'); const tournamentId = requireUuid(body.tournamentId, 'tournamentId');
        const snapshot = upgradeTournamentV1(body.snapshot);
        if (snapshot.id !== tournamentId || snapshot.revision !== '0' || snapshot.lifecycle !== 'setup' || snapshot.controller.deviceId !== null || snapshot.meta.publicSlug !== null || snapshot.meta.signupOpen) throw new TournamentHttpError(400, 'IMPORT_STATE', 'Imported copy must be a private setup snapshot at revision 0.', 'snapshot');
        const contactsBody = objectBody(body.contacts, 'contacts');
        const contacts: TournamentPrivateContacts = {};
        for (const [entryId, value] of Object.entries(contactsBody)) {
          if (typeof value !== 'string') throw new TournamentHttpError(400, 'CONTACT_SHAPE', 'Imported contacts must be text.', `contacts.${entryId}`);
          contacts[entryId] = value.trim();
        }
        validateContactMap(snapshot, contacts);
        const requestHash = await hmacHex(secret, { action, operationId, tournamentId, snapshot, contacts, hashVersion });
        const { data, error } = await service.rpc('internal_import_tournament_v1', { p_owner_id: ownerId, p_operation_id: operationId, p_tournament_id: tournamentId, p_request_hash: requestHash, p_hash_key_version: hashVersion, p_initial_state: snapshot, p_initial_contacts: contacts });
        if (error) throw new TournamentHttpError(503, 'DEPENDENCY', 'Tournament import could not be confirmed. Retry with the same request.');
        return jsonReply(request, env, data?.status === 'applied' || data?.status === 'replayed' ? { ...data, snapshot, contacts } : data, responseStatus(data as Record<string, unknown>));
      }

      if (action === 'list') {
        exactKeys(body, ['action','limit','cursor','archived']);
        const limit = body.limit === undefined ? 50 : Number(body.limit);
        if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw new TournamentHttpError(400, 'LIMIT', 'limit must be between 1 and 100.', 'limit');
        let query = service.from('tournaments_v1').select('id,revision,lifecycle,state,archived_at,updated_at').eq('owner_id', ownerId).order('updated_at', { ascending: false }).order('id', { ascending: false }).limit(limit + 1);
        if (body.archived === true) query = query.not('archived_at', 'is', null); else if (body.archived === false) query = query.is('archived_at', null);
        if (body.cursor) {
          let cursor: { updatedAt?: string; id?: string };
          try { cursor = JSON.parse(atob(String(body.cursor))); } catch { throw new TournamentHttpError(400, 'CURSOR', 'List cursor is invalid.', 'cursor'); }
          requireUuid(cursor.id, 'cursor.id');
          if (!cursor.updatedAt || Number.isNaN(Date.parse(cursor.updatedAt))) throw new TournamentHttpError(400, 'CURSOR', 'List cursor is invalid.', 'cursor');
          query = query.or(`updated_at.lt.${cursor.updatedAt},and(updated_at.eq.${cursor.updatedAt},id.lt.${cursor.id})`);
        }
        const { data, error } = await query;
        if (error) throw new TournamentHttpError(503, 'DEPENDENCY', 'Tournament list is temporarily unavailable.');
        const rows = data ?? []; const page = rows.slice(0, limit);
        const cards = page.map((row: Record<string, unknown>) => { const state = upgradeTournamentV1(row.state); return { tournamentId: row.id, revision: String(row.revision), lifecycle: row.lifecycle, title: state.meta.title, venue: state.meta.venue, startsAt: state.meta.startsAt, archivedAt: row.archived_at, updatedAt: row.updated_at }; });
        const last = page.at(-1) as Record<string, unknown> | undefined;
        const nextCursor = rows.length > limit && last ? btoa(JSON.stringify({ updatedAt: last.updated_at, id: last.id })) : null;
        return jsonReply(request, env, { status: 'applied', tournaments: cards, nextCursor });
      }

      if (action === 'get') {
        exactKeys(body, ['action','tournamentId']); const tournamentId = requireUuid(body.tournamentId, 'tournamentId');
        const { data, error } = await service.rpc('internal_get_tournament_v1', { p_owner_id: ownerId, p_tournament_id: tournamentId });
        if (error) throw new TournamentHttpError(503, 'DEPENDENCY', 'Tournament could not be loaded.');
        if (data?.status === 'not_found') throw new TournamentHttpError(404, 'NOT_FOUND', 'Tournament was not found.');
        if (data?.status === 'deleted') throw new TournamentHttpError(404, 'TOURNAMENT_DELETED', 'Tournament was deleted.');
        return jsonReply(request, env, { ...data, status: 'applied' });
      }

      if (action === 'receipts') {
        exactKeys(body, ['action','tournamentId','commandIds']); const tournamentId = requireUuid(body.tournamentId, 'tournamentId');
        if (!Array.isArray(body.commandIds) || body.commandIds.length > 100) throw new TournamentHttpError(400, 'RECEIPT_IDS', 'commandIds must contain at most 100 UUIDs.', 'commandIds');
        const commandIds = body.commandIds.map((value, index) => requireUuid(value, `commandIds.${index}`));
        const { data, error } = await service.from('tournament_commands_v1').select('command_id,resulting_revision,kind,accepted_at').eq('owner_id', ownerId).eq('tournament_id', tournamentId).in('command_id', commandIds);
        if (error) throw new TournamentHttpError(503, 'DEPENDENCY', 'Receipts are temporarily unavailable.');
        return jsonReply(request, env, { status: 'applied', receipts: (data ?? []).map((row: Record<string, unknown>) => ({ commandId: row.command_id, resultingRevision: String(row.resulting_revision), kind: row.kind, acceptedAt: row.accepted_at })) });
      }

      if (action === 'delete') {
        exactKeys(body, ['action','operationId','tournamentId']); const operationId = requireUuid(body.operationId, 'operationId'); const tournamentId = requireUuid(body.tournamentId, 'tournamentId');
        const requestHash = await hmacHex(secret, { action, operationId, tournamentId, hashVersion });
        const { data, error } = await service.rpc('internal_delete_tournament_v1', { p_owner_id: ownerId, p_operation_id: operationId, p_tournament_id: tournamentId, p_request_hash: requestHash, p_hash_key_version: hashVersion });
        if (error) throw new TournamentHttpError(503, 'DEPENDENCY', 'Tournament deletion could not be confirmed. Retry with the same request.');
        return jsonReply(request, env, data, responseStatus(data as Record<string, unknown>));
      }

      if (['begin','claim','takeover','reopen'].includes(action)) {
        exactKeys(body, ['action','request']); const grantBody = objectBody(body.request, 'request');
        exactKeys(grantBody, ['contractVersion','action','operationId','tournamentId','baseRevision','expectedEpoch','deviceId','nonce','reason','acknowledgeInaccessibleWork'], 'request');
        const grant = validateGrantRequest(grantBody as never);
        if (grant.action !== action) throw new TournamentHttpError(400, 'GRANT_ACTION', 'Action does not match the controller request.', 'action');
        const requestHash = await hmacHex(secret, { hashVersion, ...grant });
        const { data: priorOperation, error: priorError } = await service.from('tournament_operations_v1').select('tournament_id,kind,request_hash,hash_key_version,result_json').eq('owner_id', ownerId).eq('operation_id', grant.operationId).maybeSingle();
        if (priorError) throw new TournamentHttpError(503, 'DEPENDENCY', 'Controller receipt could not be checked.');
        if (priorOperation) {
          if (priorOperation.tournament_id !== grant.tournamentId || priorOperation.kind !== `grant-${grant.action}` || priorOperation.request_hash !== requestHash || priorOperation.hash_key_version !== hashVersion) throw new TournamentHttpError(409, 'OPERATION_ID_REUSED', 'Controller request ID was already used.');
          const { data: receipt } = await service.from('tournament_claim_receipts_v1').select('granted_epoch,derivation_key_version,nonce_hash,capability_hash').eq('tournament_id', grant.tournamentId).eq('claim_id', grant.operationId).maybeSingle();
          const { data: authority } = await service.from('tournament_authority_v1').select('current_claim_id,capability_hash').eq('tournament_id', grant.tournamentId).maybeSingle();
          if (!receipt || !authority || authority.current_claim_id !== grant.operationId || authority.capability_hash !== receipt.capability_hash || receipt.nonce_hash !== await sha256Hex(grant.nonce)) throw new TournamentHttpError(409, 'AUTHORITY_CHANGED', 'Controller authority changed after this request.');
          const material = await deriveAuthorityMaterial(env, { ownerId, request: grant, claimId: grant.operationId, grantedEpoch: String(receipt.granted_epoch), keyVersion: Number(receipt.derivation_key_version) });
          return jsonReply(request, env, { status: 'replayed', result: priorOperation.result_json, capability: material.capability });
        }
        const { data: loaded, error: loadError } = await service.rpc('internal_get_tournament_v1', { p_owner_id: ownerId, p_tournament_id: grant.tournamentId });
        if (loadError) throw new TournamentHttpError(503, 'DEPENDENCY', 'Tournament could not be loaded.');
        if (loaded?.status !== 'found') throw new TournamentHttpError(404, 'NOT_FOUND', 'Tournament was not found.');
        const next = applyAuthorityGrantState(upgradeTournamentV1(loaded.snapshot), grant, ownerId, Date.now());
        const material = await deriveAuthorityMaterial(env, { ownerId, request: grant, claimId: grant.operationId, grantedEpoch: next.controller.epoch });
        const { data, error } = await service.rpc('internal_grant_tournament_v1', {
          p_owner_id: ownerId, p_operation_id: grant.operationId, p_tournament_id: grant.tournamentId,
          p_action: grant.action, p_request_hash: requestHash, p_hash_key_version: hashVersion,
          p_expected_revision: grant.baseRevision, p_expected_epoch: grant.expectedEpoch,
          p_device_id: grant.deviceId, p_nonce_hash: material.nonceHash,
          p_capability_hash: material.capabilityHash, p_capability_key_version: material.keyVersion,
          p_next_state: next,
        });
        if (error) throw new TournamentHttpError(503, 'DEPENDENCY', 'Controller grant outcome is unknown. Retry the exact request.');
        const status = responseStatus(data as Record<string, unknown>);
        return jsonReply(request, env, data?.status === 'applied' || data?.status === 'replayed' ? { ...data, snapshot: next, capability: material.capability } : data, status);
      }

      if (action === 'release') {
        exactKeys(body, ['action','request']); const releaseBody = objectBody(body.request, 'request');
        exactKeys(releaseBody, ['contractVersion','action','operationId','tournamentId','baseRevision','expectedEpoch','expectedSequence','deviceId','reason'], 'request');
        const release = validateReleaseRequest(releaseBody as never);
        const requestHash = await hmacHex(secret, { hashVersion, ...release });
        const { data: priorOperation, error: priorError } = await service.from('tournament_operations_v1').select('tournament_id,kind,request_hash,hash_key_version,result_json').eq('owner_id', ownerId).eq('operation_id', release.operationId).maybeSingle();
        if (priorError) throw new TournamentHttpError(503, 'DEPENDENCY', 'Release receipt could not be checked.');
        if (priorOperation) {
          if (priorOperation.tournament_id !== release.tournamentId || priorOperation.kind !== 'release' || priorOperation.request_hash !== requestHash || priorOperation.hash_key_version !== hashVersion) throw new TournamentHttpError(409, 'OPERATION_ID_REUSED', 'Release request ID was already used.');
          return jsonReply(request, env, { status: 'replayed', result: priorOperation.result_json });
        }
        const capability = request.headers.get('x-tournament-capability') ?? '';
        if (!capability) throw new TournamentHttpError(409, 'AUTHORITY_REQUIRED', 'This device does not hold tournament control.');
        const { data: loaded, error: loadError } = await service.rpc('internal_get_tournament_v1', { p_owner_id: ownerId, p_tournament_id: release.tournamentId });
        if (loadError) throw new TournamentHttpError(503, 'DEPENDENCY', 'Tournament could not be loaded.');
        if (loaded?.status !== 'found') throw new TournamentHttpError(404, 'NOT_FOUND', 'Tournament was not found.');
        const next = applyAuthorityReleaseState(upgradeTournamentV1(loaded.snapshot), release, ownerId, Date.now());
        const { data, error } = await service.rpc('internal_release_tournament_v1', {
          p_owner_id: ownerId, p_operation_id: release.operationId, p_tournament_id: release.tournamentId,
          p_request_hash: requestHash, p_hash_key_version: hashVersion, p_expected_revision: release.baseRevision,
          p_expected_epoch: release.expectedEpoch, p_expected_sequence: release.expectedSequence,
          p_device_id: release.deviceId, p_capability_hash: await sha256Hex(capability), p_next_state: next,
        });
        if (error) throw new TournamentHttpError(503, 'DEPENDENCY', 'Release outcome is unknown. Retry the exact request.');
        return jsonReply(request, env, data?.status === 'applied' ? { ...data, snapshot: next } : data, responseStatus(data as Record<string, unknown>));
      }

      if (action === 'command') {
        exactKeys(body, ['action','command','privateContactChanges']);
        const command = parseTournamentCommandEnvelope(body.command);
        if (command.kind === 'begin-event' || command.kind === 'reopen-event') throw new TournamentHttpError(400, 'GRANT_REQUIRED', 'Use the controller grant action for this lifecycle change.', 'command.kind');
        const changes = privateChanges(body.privateContactChanges);
        if (command.kind === 'set-entry-contact' && (changes.length !== 1 || changes[0].entryId !== String(command.payload.entryId) || (changes[0].contact === null ? 'clear' : 'set') !== command.payload.action)) throw new TournamentHttpError(400, 'CONTACT_COMMAND', 'Contact delta does not match the redacted command.', 'privateContactChanges');
        const intent = { action, command, privateContactChanges: changes };
        const intentHash = await hmacHex(secret, { hashVersion, ...intent });
        const { data: replay, error: replayError } = await service.rpc('internal_lookup_tournament_receipt_v1', { p_owner_id: ownerId, p_tournament_id: command.tournamentId, p_command_id: command.commandId, p_intent_hash: intentHash, p_hash_key_version: hashVersion, p_public_only: false });
        if (replayError) throw new TournamentHttpError(503, 'DEPENDENCY', 'Command receipt could not be checked.');
        if (replay?.status !== 'absent') return jsonReply(request, env, replay, responseStatus(replay));
        const { data: loaded, error: loadError } = await service.rpc('internal_get_tournament_v1', { p_owner_id: ownerId, p_tournament_id: command.tournamentId });
        if (loadError) throw new TournamentHttpError(503, 'DEPENDENCY', 'Tournament could not be loaded.');
        if (loaded?.status !== 'found') throw new TournamentHttpError(404, 'NOT_FOUND', 'Tournament was not found.');
        const current = upgradeTournamentV1(loaded.snapshot);
        const reduced = reduceTournamentWithEffects(current, command, { actorId: ownerId, now: command.issuedAt });
        const nextContacts: TournamentPrivateContacts = { ...(loaded.contacts ?? {}) };
        for (const change of changes) { if (change.contact === null) delete nextContacts[change.entryId]; else nextContacts[change.entryId] = change.contact; }
        validateContactMap(reduced.state, nextContacts);
        const capability = request.headers.get('x-tournament-capability') ?? '';
        const capabilityHash = capability ? await sha256Hex(capability) : '';
        const projection = reduced.state.meta.publicSlug ? publicProjection(reduced.state) : null;
        const { data, error } = await service.rpc('internal_commit_tournament_v2', {
          p_owner_id: ownerId, p_tournament_id: command.tournamentId, p_command_id: command.commandId,
          p_intent_hash: intentHash, p_hash_key_version: hashVersion, p_expected_revision: command.baseRevision,
          p_device_id: command.deviceId, p_capability_hash: capabilityHash, p_controller_epoch: command.controllerEpoch,
          p_sequence: command.sequence, p_kind: command.kind, p_next_state: reduced.state,
          p_private_contact_changes: changes, p_public_slug: reduced.state.meta.publicSlug,
          p_public_projection: projection, p_redacted_audit: safeAudit(reduced.state), p_receipt_result: {},
        });
        if (error) throw new TournamentHttpError(503, 'DEPENDENCY', 'Command outcome is unknown. Retry the exact request.');
        const status = responseStatus(data as Record<string, unknown>);
        return jsonReply(request, env, data?.status === 'applied' ? { ...data, snapshot: reduced.state, contacts: nextContacts } : data, status);
      }

      throw new TournamentHttpError(400, 'ACTION_UNKNOWN', 'Unsupported Tournament owner action.', 'action');
    } catch (error) { return errorReply(request, env, error); }
  };
}
