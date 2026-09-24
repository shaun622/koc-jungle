import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.106.2';
import {
  nextOwnerCommand,
  normalizedPublicSignupIntent,
  publicProjection,
  reduceTournamentWithEffects,
  upgradeTournamentV1,
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

type Environment = (name: string) => string | undefined;
type ClientFactory = typeof createClient;

async function deterministicId(commandId: string, label: string): Promise<string> {
  const hash = await sha256Hex(`${commandId}:${label}`);
  return `${label}-${hash.slice(0,8)}-${hash.slice(8,12)}-4${hash.slice(13,16)}-a${hash.slice(17,20)}-${hash.slice(20,32)}`;
}

function constantEqual(left: string, right: string): boolean {
  if (left.length !== right.length) return false;
  let difference = 0; for (let index = 0; index < left.length; index += 1) difference |= left.charCodeAt(index) ^ right.charCodeAt(index);
  return difference === 0;
}

async function trustedIp(request: Request, env: Environment): Promise<string> {
  const secret = env('TOURNAMENT_TRUSTED_IP_PROXY_SECRET') ?? '';
  if (!secret) throw new TournamentHttpError(503, 'TRUSTED_IP_UNAVAILABLE', 'Public signup is temporarily unavailable.');
  const ip = request.headers.get('x-tournament-client-ip') ?? '';
  const timestamp = request.headers.get('x-tournament-client-ip-timestamp') ?? '';
  const signature = request.headers.get('x-tournament-client-ip-signature') ?? '';
  if (!ip || !/^[0-9]+$/.test(timestamp) || !signature || Math.abs(Date.now() - Number(timestamp)) > 30_000) throw new TournamentHttpError(503, 'TRUSTED_IP_REQUIRED', 'Public signup must use the trusted gateway.');
  const expected = await hmacHex(secret, `${timestamp}:${ip}`);
  if (!constantEqual(signature, expected)) throw new TournamentHttpError(503, 'TRUSTED_IP_REQUIRED', 'Public signup must use the trusted gateway.');
  return ip;
}

const sqlStatus = (data: Record<string, unknown>) => data.status === 'conflict' ? 409 : data.status === 'rejected' ? (data.code === 'NOT_FOUND' ? 404 : String(data.code).includes('REUSED') || data.code === 'SIGNUP_CLOSED' ? 409 : 400) : 200;

export function createTournamentPublicHandler(options: { env?: Environment; createClient?: ClientFactory } = {}) {
  const env = options.env ?? ((name) => Deno.env.get(name));
  const clientFactory = options.createClient ?? createClient;
  return async (request: Request): Promise<Response> => {
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeaders(request, env) });
    if (!['GET','POST'].includes(request.method)) return jsonReply(request, env, { status: 'rejected', code: 'METHOD', message: 'Use GET or POST.' }, 405);
    try {
      const url = env('SUPABASE_URL'); const serviceKey = env('SUPABASE_SERVICE_ROLE_KEY'); const anonKey = env('SUPABASE_ANON_KEY');
      if (!url || !serviceKey || !anonKey) throw new TournamentHttpError(503, 'SERVER_CONFIG', 'Public signup is temporarily unavailable.');
      const service = clientFactory(url, serviceKey, { auth: { persistSession: false } });
      const requestUrl = new URL(request.url); const slug = requestUrl.searchParams.get('slug')?.trim() ?? '';
      if (!slug || slug.length > 120) throw new TournamentHttpError(400, 'SLUG_REQUIRED', 'A valid signup slug is required.', 'slug');
      if (request.method === 'GET') {
        const { data: publicRow, error: publicError } = await service.from('tournament_public_v1').select('tournament_id,projection,public_revision,updated_at').eq('public_slug', slug).maybeSingle();
        if (publicError) throw new TournamentHttpError(503, 'DEPENDENCY', 'Signup list is temporarily unavailable.');
        if (!publicRow) throw new TournamentHttpError(404, 'NOT_FOUND', 'This signup page is unavailable.');
        if (Number(publicRow.projection?.projectionVersion) !== 2) throw new TournamentHttpError(503, 'UPDATE_REQUIRED', 'This signup page needs organiser recovery before it can be shown.');
        return jsonReply(request, env, { projection: publicRow.projection, revision: String(publicRow.public_revision), updatedAt: publicRow.updated_at });
      }

      const body = objectBody(await readJsonBytes(request, 4 * 1024));
      exactKeys(body, ['contractVersion','commandId','tournamentId','divisionId','playerOne','playerTwo','teamName','contact']);
      if (body.contractVersion !== 2) throw new TournamentHttpError(409, 'UPDATE_REQUIRED', 'Refresh this signup page before submitting.', 'contractVersion');
      const commandId = requireUuid(body.commandId, 'commandId'); const tournamentId = requireUuid(body.tournamentId, 'tournamentId');
      const values = {
        tournamentId,
        divisionId: String(body.divisionId ?? ''),
        playerOne: String(body.playerOne ?? '').trim(), playerTwo: String(body.playerTwo ?? '').trim(),
        teamName: String(body.teamName ?? '').trim(), contact: String(body.contact ?? '').trim(),
      };
      if (!/^[A-Za-z0-9_-]{1,160}$/.test(values.divisionId)) throw new TournamentHttpError(400, 'DIVISION_ID', 'Division is invalid.', 'divisionId');
      for (const field of ['playerOne','playerTwo','teamName'] as const) if (values[field].length > 80 || (field !== 'teamName' && !values[field])) throw new TournamentHttpError(400, 'NAME', `${field} is invalid.`, field);
      if (values.contact.length > 100) throw new TournamentHttpError(400, 'CONTACT_LENGTH', 'Contact must be 100 characters or fewer.', 'contact');
      const normalized = normalizedPublicSignupIntent(values);
      const hashVersion = Number(env('TOURNAMENT_IDEMPOTENCY_KEY_VERSION') ?? '1');
      if (!Number.isSafeInteger(hashVersion) || hashVersion < 1) throw new TournamentHttpError(503, 'IDEMPOTENCY_UNAVAILABLE', 'Public signup is temporarily unavailable.');
      const idempotencySecret = env('TOURNAMENT_IDEMPOTENCY_SECRET') ?? '';
      if (!idempotencySecret) throw new TournamentHttpError(503, 'IDEMPOTENCY_UNAVAILABLE', 'Public signup is temporarily unavailable.');
      const intentHash = await hmacHex(idempotencySecret, { hashVersion, contractVersion: 2, publicSlug: slug, commandId, ...values, normalized });
      const { data: replay, error: replayError } = await service.rpc('internal_lookup_tournament_receipt_v1', { p_owner_id: null, p_tournament_id: tournamentId, p_command_id: commandId, p_intent_hash: intentHash, p_hash_key_version: hashVersion, p_public_only: true });
      if (replayError) throw new TournamentHttpError(503, 'DEPENDENCY', 'Signup receipt could not be checked. Retry the exact submission.');
      if (replay?.status !== 'absent') return jsonReply(request, env, replay, sqlStatus(replay));

      const ip = await trustedIp(request, env);
      const rateSecret = env('TOURNAMENT_RATE_LIMIT_SECRET') ?? '';
      if (!rateSecret) throw new TournamentHttpError(503, 'RATE_UNAVAILABLE', 'Public signup is temporarily unavailable.');
      const ipDigest = await hmacHex(rateSecret, ip);
      const { data: rate, error: rateError } = await service.rpc('internal_attempt_tournament_signup_v1', { p_ip_digest: ipDigest, p_tournament_id: tournamentId });
      if (rateError) throw new TournamentHttpError(503, 'RATE_UNAVAILABLE', 'Public signup is temporarily unavailable.');
      if (rate?.allowed !== true) throw new TournamentHttpError(429, 'RATE_LIMITED', 'Too many signup attempts. Please wait and retry.', undefined, { retryAfter: Number(rate?.retryAfter ?? 60) });
      const { data: publicRow, error: publicError } = await service.from('tournament_public_v1').select('tournament_id,projection,public_revision,updated_at').eq('public_slug', slug).maybeSingle();
      if (publicError) throw new TournamentHttpError(503, 'DEPENDENCY', 'Signup list is temporarily unavailable.');
      if (!publicRow || tournamentId !== publicRow.tournament_id) throw new TournamentHttpError(404, 'NOT_FOUND', 'This signup page is unavailable.');

      const ids = {
        entryId: await deterministicId(commandId, 'entry'),
        playerIds: [await deterministicId(commandId, 'player-a'), await deterministicId(commandId, 'player-b')] as [string,string],
        lineupRevisionId: await deterministicId(commandId, 'lineup'),
      };
      const issuedAt = Date.now();
      for (let attempt = 0; attempt < 3; attempt += 1) {
        const { data: currentRow, error: currentError } = await service.from('tournaments_v1').select('state,revision').eq('id', tournamentId).maybeSingle();
        if (currentError) throw new TournamentHttpError(503, 'DEPENDENCY', 'Signup list is temporarily unavailable.');
        if (!currentRow) throw new TournamentHttpError(404, 'NOT_FOUND', 'This signup page is unavailable.');
        const state = upgradeTournamentV1(currentRow.state);
        const command = nextOwnerCommand(state, { commandId, deviceId: 'public', kind: 'add-entry', payload: { divisionId: values.divisionId, teamName: values.teamName, playerNames: [values.playerOne, values.playerTwo], ids }, issuedAt });
        const reduced = reduceTournamentWithEffects(state, command, { actorId: 'public-signup', now: issuedAt });
        const admission = reduced.state.entries.find((entry) => entry.id === ids.entryId)?.admission;
        const receiptResult = { entryId: ids.entryId, admission };
        const { data, error } = await service.rpc('internal_public_signup_tournament_v2', {
          p_tournament_id: tournamentId, p_public_slug: slug, p_command_id: commandId,
          p_intent_hash: intentHash, p_hash_key_version: hashVersion, p_expected_revision: state.revision,
          p_entry_id: ids.entryId, p_contact: values.contact, p_next_state: reduced.state,
          p_public_projection: publicProjection(reduced.state),
          p_redacted_audit: { commandId, kind: 'public-signup', at: issuedAt, touchedIds: [ids.entryId], resultingRevision: reduced.state.revision },
          p_receipt_result: receiptResult,
        });
        if (error) throw new TournamentHttpError(503, 'DEPENDENCY', 'Signup outcome is unknown. Retry the exact submission.');
        if (data?.status === 'conflict' && attempt < 2) continue;
        return jsonReply(request, env, data, sqlStatus(data));
      }
      throw new TournamentHttpError(409, 'REVISION_CONFLICT', 'The signup list changed repeatedly. Retry the same submission.');
    } catch (error) { return errorReply(request, env, error); }
  };
}
