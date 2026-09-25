import type { AmericanoConfigV3, AmericanoEventStateV3 } from '@/logic/americanoV3/types';
import type { SignupSnapshotV3 } from '@/lib/americanoV2';
import {
  clearPendingAmericanoRequest,
  newRequestId,
  readPendingAmericanoRequests,
  sealPendingAmericanoRequest,
  type RevisionToken,
} from '@/lib/americanoV2';
import { supabase } from '@/lib/supabase';
import { isAmericanoEventV3 } from '@/logic/eventVersions';
import { parseEventState } from '@/utils/eventSchema';

export interface OwnerSnapshotV3 {
  event: { id: string; protocolVersion: 2; revision: RevisionToken; updatedAt: string; state: AmericanoEventStateV3 };
  signup: SignupSnapshotV3 | null;
}

export type OwnerReplyV3 =
  | { status: 'applied' | 'replayed'; requestId: string; committedEventRevision: RevisionToken; snapshot: OwnerSnapshotV3 }
  | { status: 'conflict'; requestId: string; code: string; snapshot: OwnerSnapshotV3 }
  | { status: 'rejected'; requestId: string; code: string; message: string; field?: string };

function decodeReply(value: unknown): OwnerReplyV3 {
  if (!value || typeof value !== 'object') throw new Error('The server returned an invalid Americano v3 response.');
  const reply = value as OwnerReplyV3;
  if (!['applied', 'replayed', 'conflict', 'rejected'].includes(reply.status)) throw new Error('The server returned an unsupported Americano v3 response.');
  if (reply.status !== 'rejected') {
    const parsed = parseEventState(reply.snapshot.event.state);
    if (!isAmericanoEventV3(parsed)) throw new Error('The server returned a non-v3 Americano event.');
    reply.snapshot.event.state = parsed;
  }
  return reply;
}

function canonicalValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalValue);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>).sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => [key, canonicalValue(entry)]));
  }
  return value;
}

async function ownerRpc(name: string, parameters: Record<string, unknown>, ownerId?: string): Promise<OwnerReplyV3> {
  if (!supabase) throw new Error('Cloud sync is not configured.');
  const eventId = String(parameters.p_event_id ?? '');
  const baseRevision = String(parameters.p_base_event_revision ?? '');
  const payload = Object.fromEntries(Object.entries(parameters).filter(([key]) => key !== 'p_request_id'));
  let requestId = typeof parameters.p_request_id === 'string' ? parameters.p_request_id : newRequestId();
  let sealedRequest: ReturnType<typeof sealPendingAmericanoRequest> | null = null;
  if (ownerId && eventId && baseRevision) {
    const pending = readPendingAmericanoRequests().filter((request) => request.ownerId === ownerId && request.eventId === eventId);
    if (pending.length > 1) throw new Error('Multiple Americano saves are awaiting confirmation. Keep this event local and reconcile its cloud version before making another change.');
    const previous = pending[0];
    if (previous) {
      if (previous.operation !== name || previous.baseRevision !== baseRevision
        || JSON.stringify(canonicalValue(previous.payload)) !== JSON.stringify(canonicalValue(payload))) {
        throw new Error('A previous Americano save is still awaiting confirmation. Retry that exact action before changing this event.');
      }
      requestId = previous.requestId;
      sealedRequest = previous;
    } else {
      sealedRequest = sealPendingAmericanoRequest({ ownerId, eventId, baseRevision, requestId, operation: name, payload });
    }
  }
  const wireParameters = { ...parameters, p_request_id: requestId };
  let data: unknown;
  try {
    const reply = await supabase.rpc(name, wireParameters);
    if (reply.error) throw new Error('transport');
    data = reply.data;
  } catch {
    // A transport failure is ambiguous: the database may already have committed.
    // Keep the sealed payload and reuse its request ID on the next identical attempt.
    throw new Error('Could not confirm the Americano save. The exact request is kept for a safe retry.');
  }
  const decoded = decodeReply(data);
  if (sealedRequest) clearPendingAmericanoRequest(ownerId!, eventId, requestId);
  return decoded;
}

export function saveAmericanoEventV3(event: AmericanoEventStateV3, baseRevision: RevisionToken, requestId = newRequestId(), ownerId?: string): Promise<OwnerReplyV3> {
  return ownerRpc('organizer_save_event_v3', { p_event_id: event.id, p_base_event_revision: baseRevision, p_request_id: requestId, p_state: event }, ownerId);
}

export function saveAmericanoConfigV3(input: {
  eventId: string; baseEventRevision: RevisionToken; signupEventId?: string | null;
  baseCapacityRevision?: RevisionToken; baseRosterRevision?: RevisionToken;
  courts: AmericanoEventStateV3['courts']; config: AmericanoConfigV3; requestId?: string; ownerId?: string;
}): Promise<OwnerReplyV3> {
  return ownerRpc('organizer_save_americano_config_v3', {
    p_event_id: input.eventId,
    p_base_event_revision: input.baseEventRevision,
    p_signup_event_id: input.signupEventId ?? null,
    p_base_capacity_revision: input.baseCapacityRevision ?? '0',
    p_base_roster_revision: input.baseRosterRevision ?? '0',
    p_request_id: input.requestId ?? newRequestId(),
    p_courts: input.courts,
    p_format_config: input.config,
  }, input.ownerId);
}

export function startAmericanoV3(input: {
  eventId: string; baseEventRevision: RevisionToken; signupEventId?: string | null;
  baseCapacityRevision?: RevisionToken; baseRosterRevision?: RevisionToken;
  startState: AmericanoEventStateV3; requestId?: string; ownerId?: string;
}): Promise<OwnerReplyV3> {
  return ownerRpc('organizer_start_americano_v3', {
    p_event_id: input.eventId,
    p_base_event_revision: input.baseEventRevision,
    p_signup_event_id: input.signupEventId ?? null,
    p_base_capacity_revision: input.baseCapacityRevision ?? '0',
    p_base_roster_revision: input.baseRosterRevision ?? '0',
    p_request_id: input.requestId ?? newRequestId(),
    p_start_state: input.startState,
  }, input.ownerId);
}

export function saveAmericanoSignupV3(input: {
  eventId: string;
  baseEventRevision: RevisionToken;
  signupEventId?: string | null;
  baseCapacityRevision?: RevisionToken;
  baseRosterRevision?: RevisionToken;
  metadata: Record<string, unknown>;
  initialEntries: Array<Record<string, unknown>>;
  requestId?: string;
  ownerId?: string;
}): Promise<OwnerReplyV3> {
  return ownerRpc('organizer_save_signup_event_v3', {
    p_event_id: input.eventId,
    p_base_event_revision: input.baseEventRevision,
    p_signup_event_id: input.signupEventId ?? null,
    p_base_capacity_revision: input.baseCapacityRevision ?? '0',
    p_base_roster_revision: input.baseRosterRevision ?? '0',
    p_request_id: input.requestId ?? newRequestId(),
    p_metadata: input.metadata,
    p_initial_entries: input.initialEntries,
  }, input.ownerId);
}
