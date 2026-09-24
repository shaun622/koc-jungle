import type {
  AmericanoConfigV2,
  AmericanoEventStateV2,
} from '@/logic/americanoV2/types';
import { publicSupabase, supabase } from '@/lib/supabase';
import { isAmericanoEventV2 } from '@/logic/americanoV2/types';
import { parseEventState } from '@/utils/eventSchema';

export const AMERICANO_V2_PENDING_KEY = 'koc-americano-v2-pending-v1';

export type RevisionToken = string;
export type AmericanoEntryMode = 'fixed-pairs' | 'individual';

export interface SignupCapacityV2 {
  unit: 'teams' | 'players';
  value: number;
}

export interface SignupRegistrationV2 {
  id: string;
  teamName: string;
  playerOne: string;
  playerTwo: string | null;
  contact?: string;
  playerTwoContact?: string | null;
  status: 'confirmed' | 'waitlisted' | 'looking' | 'cancelled';
  position?: number | null;
  entryMode: AmericanoEntryMode;
  organizerRank: number | null;
  pairCompletedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface SignupSnapshotV3 {
  id: string;
  sourceEventId?: string;
  publicSlug: string;
  accountSlug: string;
  eventSlug: string;
  title: string;
  venue: string;
  startsAt: string | null;
  endsAt: string | null;
  details: string;
  prizes: string;
  isOpen: boolean;
  cancelledAt: string | null;
  cancellationMessage: string;
  timeZone: string | null;
  organizerName: string;
  publicContactMethod: 'whatsapp' | 'email' | null;
  publicContactValue: string;
  protocolVersion: 1 | 2;
  entryMode: AmericanoEntryMode;
  capacity: SignupCapacityV2;
  capacityRevision?: RevisionToken;
  rosterRevision?: RevisionToken;
  rosterSeededAt?: string | null;
  rosterLockedAt?: string | null;
  registrations: SignupRegistrationV2[];
}

export interface OwnerSnapshotV2 {
  event: {
    id: string;
    protocolVersion: 2;
    revision: RevisionToken;
    updatedAt: string;
    state: AmericanoEventStateV2;
  };
  signup: SignupSnapshotV3 | null;
}

export type OwnerReplyV2 =
  | { status: 'applied' | 'replayed'; requestId: string; committedEventRevision: RevisionToken; snapshot: OwnerSnapshotV2 }
  | { status: 'conflict'; requestId: string; code: 'EVENT_REVISION_CONFLICT' | 'SIGNUP_REVISION_CONFLICT' | 'ROSTER_REVISION_CONFLICT'; snapshot: OwnerSnapshotV2 }
  | { status: 'rejected'; requestId: string; code: string; message: string; field?: string };

export type PublicMutationReplyV2 =
  | { status: 'applied' | 'replayed'; requestId: string; registrationId: string; entryMode: AmericanoEntryMode; registrationStatus: SignupRegistrationV2['status']; position: number | null }
  | { status: 'rejected'; requestId: string; code: string; message: string; field?: string };

export interface PendingAmericanoRequest {
  ownerId: string;
  eventId: string;
  baseRevision: RevisionToken;
  requestId: string;
  operation: string;
  payload: Record<string, unknown>;
  sealedAt: number;
}

export function compareRevisionTokens(left: RevisionToken, right: RevisionToken): number {
  const a = BigInt(left);
  const b = BigInt(right);
  return a < b ? -1 : a > b ? 1 : 0;
}

export function newRequestId(): string {
  return globalThis.crypto.randomUUID();
}

function pendingStorage(): Storage | null {
  try { return globalThis.localStorage ?? null; } catch { return null; }
}

export function readPendingAmericanoRequests(storage: Storage | null = pendingStorage()): PendingAmericanoRequest[] {
  if (!storage) return [];
  try {
    const value = JSON.parse(storage.getItem(AMERICANO_V2_PENDING_KEY) ?? '[]');
    return Array.isArray(value) ? value.filter(isPendingRequest) : [];
  } catch { return []; }
}

function isPendingRequest(value: unknown): value is PendingAmericanoRequest {
  if (!value || typeof value !== 'object') return false;
  const row = value as Partial<PendingAmericanoRequest>;
  return typeof row.ownerId === 'string' && typeof row.eventId === 'string'
    && typeof row.baseRevision === 'string' && typeof row.requestId === 'string'
    && typeof row.operation === 'string' && !!row.payload && typeof row.payload === 'object'
    && typeof row.sealedAt === 'number';
}

export function sealPendingAmericanoRequest(
  request: Omit<PendingAmericanoRequest, 'sealedAt'>,
  storage: Storage | null = pendingStorage(),
): PendingAmericanoRequest {
  // Freeze the wire payload by value. Event/store objects continue changing
  // while a request is in flight, but an idempotency key must always replay
  // byte-for-byte equivalent data.
  const sealed = {
    ...request,
    payload: JSON.parse(JSON.stringify(request.payload)) as Record<string, unknown>,
    sealedAt: Date.now(),
  };
  if (!storage) return sealed;
  const others = readPendingAmericanoRequests(storage)
    .filter((item) => !(item.ownerId === sealed.ownerId && item.eventId === sealed.eventId && item.requestId === sealed.requestId));
  storage.setItem(AMERICANO_V2_PENDING_KEY, JSON.stringify([...others, sealed]));
  return sealed;
}

export function clearPendingAmericanoRequest(ownerId: string, eventId: string, requestId: string, storage: Storage | null = pendingStorage()): void {
  if (!storage) return;
  const next = readPendingAmericanoRequests(storage)
    .filter((item) => !(item.ownerId === ownerId && item.eventId === eventId && item.requestId === requestId));
  if (next.length) storage.setItem(AMERICANO_V2_PENDING_KEY, JSON.stringify(next));
  else storage.removeItem(AMERICANO_V2_PENDING_KEY);
}

function requireOwnerClient() {
  if (!supabase) throw new Error('Cloud sync is not configured.');
  return supabase;
}

function requirePublicClient() {
  if (!publicSupabase) throw new Error('Public signup is not configured.');
  return publicSupabase;
}

function decodeOwnerReply(value: unknown): OwnerReplyV2 {
  if (!value || typeof value !== 'object') throw new Error('The server returned an invalid Americano response.');
  const reply = value as OwnerReplyV2;
  if (!['applied', 'replayed', 'conflict', 'rejected'].includes(reply.status)) throw new Error('The server returned an unsupported Americano response.');
  if (reply.status !== 'rejected') {
    const parsed = parseEventState(reply.snapshot.event.state);
    if (!isAmericanoEventV2(parsed)) throw new Error('The server returned a non-Americano protocol-2 event.');
    reply.snapshot.event.state = parsed;
  }
  return reply;
}

async function ownerRpc(name: string, parameters: Record<string, unknown>): Promise<OwnerReplyV2> {
  const { data, error } = await requireOwnerClient().rpc(name, parameters);
  if (error) throw new Error(error.message);
  return decodeOwnerReply(data);
}

export async function saveAmericanoEventV2(event: AmericanoEventStateV2, baseRevision: RevisionToken, requestId = newRequestId()): Promise<OwnerReplyV2> {
  return ownerRpc('organizer_save_event_v2', { p_event_id: event.id, p_base_event_revision: baseRevision, p_request_id: requestId, p_state: event });
}

export async function saveAmericanoConfigV2(input: {
  eventId: string; baseEventRevision: RevisionToken; signupEventId?: string | null;
  baseCapacityRevision?: RevisionToken; baseRosterRevision?: RevisionToken; courts: AmericanoEventStateV2['courts'];
  config: AmericanoConfigV2; requestId?: string;
}): Promise<OwnerReplyV2> {
  return ownerRpc('organizer_save_americano_config_v2', {
    p_event_id: input.eventId, p_base_event_revision: input.baseEventRevision,
    p_signup_event_id: input.signupEventId ?? null, p_base_capacity_revision: input.baseCapacityRevision ?? '0',
    p_base_roster_revision: input.baseRosterRevision ?? '0', p_request_id: input.requestId ?? newRequestId(),
    p_courts: input.courts, p_format_config: input.config,
  });
}

export async function publishAmericanoSignupV3(input: {
  eventId: string; baseEventRevision: RevisionToken; signupEventId?: string | null;
  baseCapacityRevision?: RevisionToken; baseRosterRevision?: RevisionToken; metadata: Record<string, unknown>;
  initialEntries: Array<Record<string, unknown>>; requestId?: string;
}): Promise<OwnerReplyV2> {
  return ownerRpc('organizer_save_signup_event_v3', {
    p_event_id: input.eventId, p_base_event_revision: input.baseEventRevision,
    p_signup_event_id: input.signupEventId ?? null, p_base_capacity_revision: input.baseCapacityRevision ?? '0',
    p_base_roster_revision: input.baseRosterRevision ?? '0', p_request_id: input.requestId ?? newRequestId(),
    p_metadata: input.metadata, p_initial_entries: input.initialEntries,
  });
}

export async function mutateAmericanoSignupEntry(input: {
  eventId: string; baseEventRevision: RevisionToken; signupEventId: string; baseCapacityRevision: RevisionToken;
  baseRosterRevision: RevisionToken; command: Record<string, unknown>; requestId?: string;
}): Promise<OwnerReplyV2> {
  return ownerRpc('organizer_mutate_signup_entry_v2', {
    p_event_id: input.eventId, p_base_event_revision: input.baseEventRevision, p_signup_event_id: input.signupEventId,
    p_base_capacity_revision: input.baseCapacityRevision, p_base_roster_revision: input.baseRosterRevision,
    p_request_id: input.requestId ?? newRequestId(), p_command: input.command,
  });
}

export async function startAmericanoV2(input: {
  eventId: string; baseEventRevision: RevisionToken; signupEventId?: string | null; baseCapacityRevision?: RevisionToken;
  baseRosterRevision?: RevisionToken; startState: AmericanoEventStateV2; requestId?: string;
}): Promise<OwnerReplyV2> {
  return ownerRpc('organizer_start_americano_v2', {
    p_event_id: input.eventId, p_base_event_revision: input.baseEventRevision, p_signup_event_id: input.signupEventId ?? null,
    p_base_capacity_revision: input.baseCapacityRevision ?? '0', p_base_roster_revision: input.baseRosterRevision ?? '0',
    p_request_id: input.requestId ?? newRequestId(), p_start_state: input.startState,
  });
}

export async function correctAmericanoSignupLabels(input: {
  eventId: string; baseEventRevision: RevisionToken; signupEventId: string; baseCapacityRevision: RevisionToken;
  baseRosterRevision: RevisionToken; registrationId: string; expectedUpdatedAt: string;
  labels: Record<string, string | null | undefined>; requestId?: string;
}): Promise<OwnerReplyV2> {
  return ownerRpc('organizer_correct_signup_labels_v2', {
    p_event_id: input.eventId, p_base_event_revision: input.baseEventRevision, p_signup_event_id: input.signupEventId,
    p_base_capacity_revision: input.baseCapacityRevision, p_base_roster_revision: input.baseRosterRevision,
    p_request_id: input.requestId ?? newRequestId(), p_registration_id: input.registrationId,
    p_expected_updated_at: input.expectedUpdatedAt, p_labels: input.labels,
  });
}

export async function setAmericanoSignupOpen(input: {
  eventId: string; baseEventRevision: RevisionToken; signupEventId: string; baseCapacityRevision: RevisionToken;
  isOpen: boolean; requestId?: string;
}): Promise<OwnerReplyV2> {
  return ownerRpc('organizer_set_signup_open_v2', {
    p_event_id: input.eventId, p_base_event_revision: input.baseEventRevision, p_signup_event_id: input.signupEventId,
    p_base_capacity_revision: input.baseCapacityRevision, p_request_id: input.requestId ?? newRequestId(), p_is_open: input.isOpen,
  });
}

export async function cancelAmericanoSignup(input: {
  eventId: string; baseEventRevision: RevisionToken; signupEventId: string; baseCapacityRevision: RevisionToken;
  message?: string; requestId?: string;
}): Promise<OwnerReplyV2> {
  return ownerRpc('organizer_cancel_signup_event_v2', {
    p_event_id: input.eventId, p_base_event_revision: input.baseEventRevision, p_signup_event_id: input.signupEventId,
    p_base_capacity_revision: input.baseCapacityRevision, p_request_id: input.requestId ?? newRequestId(), p_message: input.message ?? null,
  });
}

export async function deleteAmericanoEventV2(input: { eventId: string; baseEventRevision: RevisionToken; requestId?: string }): Promise<OwnerReplyV2 | { status: 'applied' | 'replayed'; requestId: string; eventId: string; deletedAt: string }> {
  const { data, error } = await requireOwnerClient().rpc('organizer_delete_event_v2', {
    p_event_id: input.eventId, p_base_event_revision: input.baseEventRevision, p_request_id: input.requestId ?? newRequestId(),
  });
  if (error) throw new Error(error.message);
  return data as OwnerReplyV2 | { status: 'applied' | 'replayed'; requestId: string; eventId: string; deletedAt: string };
}

export async function getOrganizerSignupV3(signupEventId: string): Promise<SignupSnapshotV3> {
  const { data, error } = await requireOwnerClient().rpc('get_organizer_signup_v3', { p_signup_event_id: signupEventId });
  if (error) throw new Error(error.message);
  const value = data as SignupSnapshotV3 | { status: 'rejected'; message: string };
  if ('status' in value && value.status === 'rejected') throw new Error(value.message);
  return value as SignupSnapshotV3;
}

export async function getPublicSignupV3(accountSlug: string, eventSlug: string): Promise<{ event: SignupSnapshotV3; registrations: SignupRegistrationV2[] } | null> {
  const { data, error } = await requirePublicClient().rpc('get_public_signup_v3', { p_account_slug: accountSlug, p_event_slug: eventSlug });
  if (error) throw new Error(error.message);
  return data as { event: SignupSnapshotV3; registrations: SignupRegistrationV2[] } | null;
}

async function publicRpc(name: string, parameters: Record<string, unknown>): Promise<PublicMutationReplyV2> {
  const { data, error } = await requirePublicClient().rpc(name, parameters);
  if (error) throw new Error(error.message);
  return data as PublicMutationReplyV2;
}

export function registerPublicAmericanoPlayer(input: { accountSlug: string; eventSlug: string; playerName: string; contact: string; requestId?: string }): Promise<PublicMutationReplyV2> {
  return publicRpc('register_public_player_v2', { p_account_slug: input.accountSlug, p_event_slug: input.eventSlug, p_player_name: input.playerName, p_contact: input.contact, p_request_id: input.requestId ?? newRequestId() });
}

export function registerPublicAmericanoSingle(input: { accountSlug: string; eventSlug: string; playerOne: string; contact: string; requestId?: string }): Promise<PublicMutationReplyV2> {
  return publicRpc('register_public_single_v3', { p_account_slug: input.accountSlug, p_event_slug: input.eventSlug, p_player_one: input.playerOne, p_contact: input.contact, p_request_id: input.requestId ?? newRequestId() });
}

export function registerPublicAmericanoPair(input: { accountSlug: string; eventSlug: string; teamName: string; playerOne: string; playerTwo: string; contact: string; requestId?: string }): Promise<PublicMutationReplyV2> {
  return publicRpc('register_public_pair_v3', { p_account_slug: input.accountSlug, p_event_slug: input.eventSlug, p_team_name: input.teamName, p_player_one: input.playerOne, p_player_two: input.playerTwo, p_contact: input.contact, p_request_id: input.requestId ?? newRequestId() });
}

export function joinPublicAmericanoPair(input: { accountSlug: string; eventSlug: string; registrationId: string; playerTwo: string; contact: string; requestId?: string }): Promise<PublicMutationReplyV2> {
  return publicRpc('join_public_single_v3', { p_account_slug: input.accountSlug, p_event_slug: input.eventSlug, p_registration_id: input.registrationId, p_player_two: input.playerTwo, p_contact: input.contact, p_request_id: input.requestId ?? newRequestId() });
}
