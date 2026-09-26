/**
 * Event-scoped cloud synchronization.
 *
 * Every competition is independent: selecting another event never deletes the
 * previous one, writes are serialized per event id, and durable tombstones
 * prevent an old tab/offline snapshot from recreating a deleted competition.
 */

import type { RealtimeChannel } from '@supabase/supabase-js';
import { create } from 'zustand';
import { supabase } from '@/lib/supabase';
import type { VersionedEventState } from '@/logic/americanoV2/types';
import { isAmericanoEventV2 } from '@/logic/americanoV2/types';
import { isAmericanoEventV3 } from '@/logic/eventVersions';
import { deleteAmericanoEventV2, saveAmericanoEventV2 } from '@/lib/americanoV2';
import { saveAmericanoEventV3 } from '@/lib/americanoV3';
import { useEventCatalogStore } from './eventCatalog';
import {
  listLocalEventRecords,
  type EventCatalogRecord,
} from './eventRepository';
import {
  applyExternalEventToActiveFacade,
  flushEventCatalogPersistence,
  isApplyingCatalogEvent,
  removeEventFromLocalCatalog,
  saveEventToLocalCatalog,
  useEventStore,
} from './eventStore';

const PUSH_DEBOUNCE_MS = 1_000;
const FLUSH_TIMEOUT_MS = 4_000;
const META_KEY_PREFIX = 'koc-cloud-sync-v3:';
const LOCAL_MUTATION_KEY_PREFIX = 'koc-local-mutation-v3:';
const LEGACY_META_KEY_PREFIX = 'koc-cloud-sync-v2:';
const LEGACY_MUTATION_KEY_PREFIX = 'koc-local-mutation-v2:';
const LAST_USER_KEY = 'koc-last-cloud-user-v1';

type Stop = () => void;

interface DirtyMarker {
  fingerprint: string;
  changedAt: number;
}

interface TombstoneMarker {
  deletedAt: number;
  pending: boolean;
  protocolVersion?: 2;
  baseRevision?: string;
}

interface MutationLedger {
  dirtyById: Record<string, DirtyMarker>;
  tombstonesById: Record<string, TombstoneMarker>;
}

interface SyncMeta extends MutationLedger {
  remoteUpdatedAtById: Record<string, number>;
}

interface Session {
  userId: string;
  channel: RealtimeChannel | null;
  unsubStore: Stop;
  pushTimers: Map<string, ReturnType<typeof setTimeout>>;
  dirtySnapshots: Map<string, VersionedEventState>;
  pendingById: Map<string, Promise<void>>;
  meta: SyncMeta;
  bootstrap: Promise<void>;
  lastError: string | null;
}

export type CloudSyncPhase = 'local' | 'syncing' | 'pending' | 'synced' | 'error';
interface CloudSyncStatusState {
  phase: CloudSyncPhase;
  syncedAt: number | null;
  pendingEventIds: string[];
  error: string | null;
}
export const useCloudSyncStatus = create<CloudSyncStatusState>(() => ({
  phase: 'local', syncedAt: null, pendingEventIds: [], error: null,
}));

function publishStatus(session: Session | null, phase?: CloudSyncPhase, error?: string | null) {
  if (!session || active !== session) {
    useCloudSyncStatus.setState({ phase: 'local', pendingEventIds: [], error: null });
    return;
  }
  const pendingEventIds = Array.from(new Set([
    ...Object.keys(session.meta.dirtyById),
    ...Object.entries(session.meta.tombstonesById).filter(([, marker]) => marker.pending).map(([id]) => id),
  ])).sort();
  const nextPhase = phase ?? (session.lastError ? 'error' : pendingEventIds.length ? 'pending' : 'synced');
  useCloudSyncStatus.setState((current) => ({
    phase: nextPhase,
    pendingEventIds,
    error: error === undefined ? session.lastError : error,
    syncedAt: nextPhase === 'synced' ? Date.now() : current.syncedAt,
  }));
}

export interface CloudSyncFlushResult {
  ok: boolean;
  pendingEventIds: string[];
  error?: string;
}

interface CloudEventRow {
  id: string;
  state: VersionedEventState | null;
  updated_at: string;
}

interface CloudTombstoneRow {
  event_id: string;
  deleted_at: string;
}

let active: Session | null = null;

// These chains intentionally survive auth/route restarts in this page. A late
// write and a later deletion for the same UUID can therefore never overtake
// one another. Unrelated competitions remain parallel.
const remoteQueues = new Map<string, Promise<void>>();

// Zustand notifies subscribers synchronously. This guard prevents trusted
// cloud/cross-tab applications from being interpreted as fresh local edits by
// either this module or the broadcast hook.
const applyingExternalIds = new Set<string>();
let applyingExternalNull = false;

export function startCloudSync(userId: string): Stop {
  if (!supabase) return () => undefined;
  if (active?.userId === userId) {
    const existing = active;
    return () => {
      if (active === existing) stopCloudSync();
    };
  }
  if (active) stopCloudSync();

  const session: Session = {
    userId,
    channel: null,
    unsubStore: () => undefined,
    pushTimers: new Map(),
    dirtySnapshots: new Map(),
    pendingById: new Map(),
    meta: readSyncMeta(userId),
    bootstrap: Promise.resolve(),
    lastError: null,
  };
  active = session;
  publishStatus(session, 'syncing', null);

  adoptLocalMutationLedger(session);
  writeLastUserId(userId);

  session.unsubStore = useEventStore.subscribe((state, previous) => {
    if (active !== session || state.event === previous.event) return;
    if (isApplyingCatalogEvent()) return;
    const next = state.event;
    const before = previous.event;
    if (next && applyingExternalIds.has(next.id)) return;
    if (!next && applyingExternalNull) return;

    if (!next) {
      // Legacy reset/cancel flows still mean "delete this event", but the
      // operation is exact-id only. Selecting another event never enters this
      // branch and never removes the previous competition.
      if (before) markLocalEventDeleted(before.id);
      return;
    }

    recordDirty(session, next);
  });

  session.channel = supabase
    .channel(`event-catalog-${userId}`)
    .on(
      'postgres_changes',
      {
        event: '*',
        schema: 'public',
        table: 'events',
        filter: `user_id=eq.${userId}`,
      },
      (payload) => {
        if (active !== session) return;
        if (payload.eventType === 'DELETE') {
          // Compatibility with projects that have not installed soft
          // tombstones yet. This is still scoped to the UUID in the payload.
          const eventId = (payload.old as { id?: unknown } | null)?.id;
          if (typeof eventId === 'string') {
            void applyRemoteDeletion(session, eventId, Date.now(), false);
          }
          return;
        }
        const row = payload.new as Partial<CloudEventRow> | null;
        if (!row || typeof row.id !== 'string' || !row.state) return;
        void applyRemoteUpsert(
          session,
          row.state,
          parseTimestamp(row.updated_at),
        );
      },
    )
    .on(
      'postgres_changes',
      {
        event: '*',
        schema: 'public',
        table: 'event_tombstones',
        filter: `user_id=eq.${userId}`,
      },
      (payload) => {
        if (active !== session || payload.eventType === 'DELETE') return;
        const row = payload.new as Partial<CloudTombstoneRow> | null;
        if (!row || typeof row.event_id !== 'string') return;
        void applyRemoteDeletion(
          session,
          row.event_id,
          parseTimestamp(row.deleted_at),
          false,
        );
      },
    )
    .subscribe();

  session.bootstrap = bootstrapSession(session)
    .catch((error) => {
      session.lastError = errorMessage(error);
      console.warn('[cloudSync] initial catalog sync failed:', errorMessage(error));
    })
    .then(() => resumePendingSessionMutations(session))
    .catch((error) => {
      session.lastError = errorMessage(error);
      console.warn('[cloudSync] pending mutation recovery failed:', errorMessage(error));
    })
    .finally(() => publishStatus(session));

  return () => {
    if (active === session) stopCloudSync();
  };
}

export function stopCloudSync(): void {
  if (!active) return;
  const session = active;
  active = null;
  publishStatus(null);
  void session.channel?.unsubscribe();
  session.unsubStore();
  cancelAllPendingPushes(session);
}

/** Mark one competition for durable deletion; no other id is touched. */
export function markLocalEventDeleted(eventId: string): boolean {
  if (!eventId) return false;
  const userId = active?.userId ?? readLastUserId();
  const ledger = readLocalMutationLedger(userId);
  delete ledger.dirtyById[eventId];
  const current = currentEventWithId(eventId);
  const versioned = current && (isAmericanoEventV2(current) || isAmericanoEventV3(current)) ? current : null;
  ledger.tombstonesById[eventId] = {
    deletedAt: Math.max(Date.now(), ledger.tombstonesById[eventId]?.deletedAt ?? 0),
    pending: true,
    ...(versioned ? { protocolVersion: 2 as const, baseRevision: versioned.revision } : {}),
  };
  writeLocalMutationLedger(userId, ledger);

  const session = active;
  if (session && session.userId === userId) {
    cancelPendingPush(session, eventId);
    session.dirtySnapshots.delete(eventId);
    delete session.meta.dirtyById[eventId];
    session.meta.tombstonesById[eventId] = ledger.tombstonesById[eventId];
    writeSyncMeta(session.userId, session.meta);
    void queueDelete(session, eventId);
  }
  return true;
}

/**
 * UI-callable exact-ID cloud deletion. The caller removes the same id from the
 * local catalog through eventStore.deleteLocalEvent; this owns the remote RPC.
 */
export async function deleteCloudEvent(eventId: string): Promise<void> {
  if (!markLocalEventDeleted(eventId)) return;
  const session = active;
  if (!session) return;
  await session.bootstrap.catch(() => undefined);
  await queueDelete(session, eventId);
}

/** Best-effort bounded save of every dirty event before sign-out/SW reload. */
export async function flushCloudSync(): Promise<CloudSyncFlushResult> {
  const session = active;
  if (session) cancelAllPendingPushes(session);
  const work = (async () => {
    await flushEventCatalogPersistence().catch(() => undefined);
    if (!supabase || !session || active !== session) return;
    await session.bootstrap.catch(() => undefined);
    if (active !== session) return;

    // Recovery after bootstrap can schedule debounced work. Convert every
    // remaining marker into an immediate bounded flush below.
    cancelAllPendingPushes(session);
    adoptLocalMutationLedger(session);
    const localRecords = await safeListLocalRecords();
    const localById = new Map(localRecords.map((record) => [record.id, record.state]));
    const current = useEventStore.getState().event;
    if (current) localById.set(current.id, current);

    const pending: Promise<void>[] = [];
    for (const [eventId, marker] of Object.entries(session.meta.tombstonesById)) {
      if (marker.pending) pending.push(queueDelete(session, eventId));
    }
    for (const eventId of Object.keys(session.meta.dirtyById)) {
      if (session.meta.tombstonesById[eventId]) continue;
      const snapshot = session.dirtySnapshots.get(eventId) ?? localById.get(eventId);
      if (snapshot) pending.push(queuePush(session, snapshot));
    }
    await Promise.all(pending);
  })();
  try {
    await waitWithTimeout(work, FLUSH_TIMEOUT_MS);
  } catch (error) {
    if (session) session.lastError = errorMessage(error);
    console.warn('[cloudSync] flush failed:', errorMessage(error));
  }
  if (!session) return { ok: true, pendingEventIds: [] };
  publishStatus(session);
  const state = useCloudSyncStatus.getState();
  return {
    ok: state.pendingEventIds.length === 0 && state.phase !== 'error',
    pendingEventIds: state.pendingEventIds,
    ...(state.error ? { error: state.error } : {}),
  };
}

/** Explicit alias used by service-worker/update integrations. */
export const flushAllCloudEvents = flushCloudSync;

/** Settle this event's autosave before an explicit owner RPC uses its revision. */
export async function flushCloudEvent(eventId: string): Promise<void> {
  const session = active;
  if (!session || !supabase) return;
  await waitWithTimeout((async () => {
    await session.bootstrap;
    await flushEventCatalogPersistence();
    if (active !== session) throw new Error('The signed-in account changed. Reload this event.');
    cancelPendingPush(session, eventId);
    await session.pendingById.get(eventId);
    cancelPendingPush(session, eventId);
    if (session.meta.tombstonesById[eventId]) throw new Error('This event was deleted.');
    if (session.meta.dirtyById[eventId]) {
      const snapshot = session.dirtySnapshots.get(eventId) ?? currentEventWithId(eventId);
      if (snapshot) await queuePush(session, snapshot);
    }
    if (active !== session) throw new Error('The signed-in account changed. Reload this event.');
    if (session.meta.dirtyById[eventId]) {
      throw new Error(session.lastError ?? 'This event is still waiting to sync. Retry when connected.');
    }
  })(), FLUSH_TIMEOUT_MS);
}

/**
 * Record a local body mutation. A -> B marks B dirty but deliberately does not
 * tombstone A: that transition is event selection, not deletion.
 */
export function markLocalEventMutation(
  event: VersionedEventState | null,
  previous: VersionedEventState | null,
): boolean {
  if (isApplyingCatalogEvent()) return false;
  if (event && applyingExternalIds.has(event.id)) return false;
  if (!event && applyingExternalNull) return false;
  if (event && previous && event.id === previous.id) {
    if (event === previous || eventFingerprint(event) === eventFingerprint(previous)) {
      return false;
    }
  }

  if (!event) return previous ? markLocalEventDeleted(previous.id) : false;

  const session = active;
  if (session) {
    recordDirty(session, event);
    return true;
  }

  const userId = readLastUserId();
  const ledger = readLocalMutationLedger(userId);
  if (ledger.tombstonesById[event.id]) return false;
  ledger.dirtyById[event.id] = dirtyMarkerFor(event);
  writeLocalMutationLedger(userId, ledger);
  return true;
}

/** Apply one cross-tab body snapshot without replacing unrelated events. */
export function applyStorageBroadcast(
  event: VersionedEventState | null,
  pinnedEventId: string | null = null,
): boolean {
  if (!event) {
    // A legacy v2 null message has no exact event id. Treating it as a delete
    // would let an old installed PWA cancel whichever competition the new tab
    // happens to be viewing, so it is intentionally ignored.
    return false;
  }
  if (hasTombstone(event.id)) return false;

  const session = active;
  if (isAmericanoEventV3(event)) {
    // The originating tab owns persistence and its durable mutation marker.
    // Other tabs only display the draft; re-saving it would race the source
    // with the same revision. Keep genuine local edits for conflict handling.
    if (session?.meta.dirtyById[event.id]) return false;
    const activeId = useEventCatalogStore.getState().activeEventId;
    const shouldDisplay = pinnedEventId
      ? pinnedEventId === event.id
      : activeId === event.id || useEventStore.getState().event?.id === event.id;
    if (shouldDisplay) setExternalActiveEvent(event);
    return true;
  }
  if (session) recordDirty(session, event);
  else markLocalEventMutation(event, null);

  void saveExternalEvent(event);
  const activeId = useEventCatalogStore.getState().activeEventId;
  const shouldDisplay = pinnedEventId
    ? pinnedEventId === event.id
    : activeId === event.id || useEventStore.getState().event?.id === event.id;
  if (shouldDisplay) setExternalActiveEvent(event);
  return true;
}

/** Apply one exact cross-tab deletion and retry its idempotent cloud RPC. */
export function applyStorageEventDeletion(eventId: string): boolean {
  if (!eventId) return false;
  markLocalEventDeleted(eventId);
  void removeExternalEvent(eventId);
  return true;
}

/** Follow another tab unless this display is pinned to a different event. */
export function applyStorageEventSelection(
  eventId: string,
  pinnedEventId: string | null = null,
): boolean {
  if (!eventId || (pinnedEventId && pinnedEventId !== eventId)) return false;
  void (async () => {
    const event = await useEventCatalogStore.getState().selectEvent(eventId);
    if (event) setExternalActiveEvent(event);
  })();
  return true;
}

export function isApplyingExternalEvent(eventId: string | null): boolean {
  return eventId ? applyingExternalIds.has(eventId) : applyingExternalNull;
}

async function bootstrapSession(session: Session): Promise<void> {
  await useEventCatalogStore.getState().initialize();
  if (active !== session || !supabase) return;

  const [eventResult, tombstoneResult, localRecords] = await Promise.all([
    supabase
      .from('events')
      .select('id, state, updated_at')
      .eq('user_id', session.userId)
      .order('updated_at', { ascending: false }),
    supabase
      .from('event_tombstones')
      .select('event_id, deleted_at')
      .eq('user_id', session.userId),
    safeListLocalRecords(),
  ]);
  if (active !== session) return;
  if (eventResult.error) throw new Error(eventResult.error.message);
  if (tombstoneResult.error) {
    console.warn('[cloudSync] tombstone pull failed:', tombstoneResult.error.message);
  }

  const tombstones = (tombstoneResult.data ?? []) as CloudTombstoneRow[];
  for (const row of tombstones) {
    if (!row?.event_id) continue;
    await applyRemoteDeletion(
      session,
      row.event_id,
      parseTimestamp(row.deleted_at),
      false,
    );
  }
  if (active !== session) return;

  const remoteRows = ((eventResult.data ?? []) as CloudEventRow[])
    .filter((row) => row?.id && row.state);
  const remoteById = new Map(remoteRows.map((row) => [row.id, row]));
  const localById = new Map(localRecords.map((record) => [record.id, record]));

  for (const row of remoteRows) {
    if (!row.state || session.meta.tombstonesById[row.id]) continue;
    const remoteAt = parseTimestamp(row.updated_at);
    session.meta.remoteUpdatedAtById[row.id] = Math.max(
      remoteAt,
      session.meta.remoteUpdatedAtById[row.id] ?? 0,
    );
    const local = localById.get(row.id);
    if (session.meta.dirtyById[row.id]) {
      // An operator can edit while the initial pull is still in flight. The
      // in-memory dirty snapshot is newer than the IndexedDB list captured at
      // bootstrap start, so never replace it with that stale local record.
      const snapshot = session.dirtySnapshots.get(row.id)
        ?? currentEventWithId(row.id)
        ?? local?.state;
      if (snapshot) recordDirty(session, snapshot);
      continue;
    }
    if (local && local.updatedAt > remoteAt) {
      recordDirty(session, local.state, local.updatedAt);
      continue;
    }
    await applyRemoteUpsert(session, row.state, remoteAt);
  }

  for (const record of localRecords) {
    if (remoteById.has(record.id) || session.meta.tombstonesById[record.id]) continue;
    // A local catalog can contain another account's events on a shared iPad.
    // Only a mutation explicitly recorded while THIS user was active may
    // create a missing remote row; never upload the whole device catalog.
    if (!session.meta.dirtyById[record.id]) continue;
    // If tombstones could not be read, do not recreate a formerly-known row.
    if (
      session.meta.remoteUpdatedAtById[record.id]
      && tombstoneResult.error
      && !session.meta.dirtyById[record.id]
    ) continue;
    recordDirty(session, record.state, record.updatedAt);
  }

  for (const eventId of Object.keys(session.meta.dirtyById)) {
    if (session.meta.tombstonesById[eventId]) continue;
    const snapshot = session.dirtySnapshots.get(eventId)
      ?? localById.get(eventId)?.state
      ?? currentEventWithId(eventId);
    if (snapshot) schedulePush(session, snapshot);
  }
  for (const [eventId, marker] of Object.entries(session.meta.tombstonesById)) {
    if (marker.pending) void queueDelete(session, eventId);
  }
  writeSyncMeta(session.userId, session.meta);
}

/** Retry durable v3 markers even when the initial cloud pull failed. */
async function resumePendingSessionMutations(session: Session): Promise<void> {
  if (active !== session) return;
  await useEventCatalogStore.getState().initialize();
  const localRecords = await safeListLocalRecords();
  if (active !== session) return;
  const localById = new Map(localRecords.map((record) => [record.id, record.state]));
  const current = useEventStore.getState().event;
  if (current) localById.set(current.id, current);

  for (const [eventId, marker] of Object.entries(session.meta.tombstonesById)) {
    if (marker.pending) void queueDelete(session, eventId);
  }
  for (const eventId of Object.keys(session.meta.dirtyById)) {
    if (session.meta.tombstonesById[eventId]) continue;
    const snapshot = session.dirtySnapshots.get(eventId) ?? localById.get(eventId);
    if (snapshot) schedulePush(session, snapshot);
  }
}

async function applyRemoteUpsert(
  session: Session,
  event: VersionedEventState,
  remoteAt: number,
): Promise<void> {
  if (active !== session || session.meta.tombstonesById[event.id]) return;
  if (session.meta.dirtyById[event.id]) return;
  const knownAt = session.meta.remoteUpdatedAtById[event.id] ?? 0;
  if (remoteAt && remoteAt < knownAt) return;

  const saved = await saveEventToLocalCatalog(event, {
    updatedAt: remoteAt || Date.now(),
    makeActive: false,
  });
  if (!saved || active !== session) return;
  session.meta.remoteUpdatedAtById[event.id] = Math.max(remoteAt, knownAt);
  writeSyncMeta(session.userId, session.meta);

  if (
    useEventCatalogStore.getState().activeEventId === event.id
    || useEventStore.getState().event?.id === event.id
  ) setExternalActiveEvent(event);
}

async function applyRemoteDeletion(
  session: Session,
  eventId: string,
  deletedAt: number,
  pending: boolean,
): Promise<void> {
  if (active !== session) return;
  cancelPendingPush(session, eventId);
  session.dirtySnapshots.delete(eventId);
  delete session.meta.dirtyById[eventId];
  delete session.meta.remoteUpdatedAtById[eventId];
  session.meta.tombstonesById[eventId] = {
    deletedAt: Math.max(deletedAt, session.meta.tombstonesById[eventId]?.deletedAt ?? 0),
    pending,
  };
  writeSyncMeta(session.userId, session.meta);
  writeLocalDeletionMarker(session.userId, eventId, session.meta.tombstonesById[eventId]);
  await removeExternalEvent(eventId);
}

async function saveExternalEvent(event: VersionedEventState): Promise<void> {
  await saveEventToLocalCatalog(event, {
    updatedAt: Date.now(),
    makeActive: false,
  });
}

async function removeExternalEvent(eventId: string): Promise<void> {
  applyingExternalIds.add(eventId);
  try {
    await removeEventFromLocalCatalog(eventId);
  } finally {
    applyingExternalIds.delete(eventId);
  }
}

function setExternalActiveEvent(event: VersionedEventState | null): void {
  if (!event) {
    applyingExternalNull = true;
    try {
      applyExternalEventToActiveFacade(null);
    } finally {
      applyingExternalNull = false;
    }
    return;
  }
  applyingExternalIds.add(event.id);
  try {
    applyExternalEventToActiveFacade(event);
  } finally {
    applyingExternalIds.delete(event.id);
  }
}

function recordDirty(session: Session, event: VersionedEventState, changedAt = Date.now()): void {
  if (session.meta.tombstonesById[event.id]) return;
  const marker = dirtyMarkerFor(event, changedAt);
  session.meta.dirtyById[event.id] = marker;
  session.dirtySnapshots.set(event.id, cloneEvent(event));
  writeSyncMeta(session.userId, session.meta);

  const ledger = readLocalMutationLedger(session.userId);
  ledger.dirtyById[event.id] = marker;
  delete ledger.tombstonesById[event.id];
  writeLocalMutationLedger(session.userId, ledger);
  session.lastError = null;
  publishStatus(session, 'pending', null);
  schedulePush(session, event);
}

function schedulePush(session: Session, event: VersionedEventState): void {
  cancelPendingPush(session, event.id);
  const snapshot = cloneEvent(event);
  session.pushTimers.set(event.id, setTimeout(() => {
    session.pushTimers.delete(event.id);
    void queuePush(session, snapshot);
  }, PUSH_DEBOUNCE_MS));
}

function queuePush(session: Session, event: VersionedEventState): Promise<void> {
  let snapshot = cloneEvent(event);
  let snapshotFingerprint = eventFingerprint(snapshot);
  publishStatus(session, 'syncing');
  return enqueueRemote(session, event.id, async () => {
    if (!supabase || session.meta.tombstonesById[event.id]) return;
    if (isAmericanoEventV3(snapshot)) {
      // A queued save may have been superseded while an earlier one was in
      // flight. Use the current pending draft and its acknowledged revision.
      if (!session.meta.dirtyById[event.id]) return;
      const pendingDraft = session.dirtySnapshots.get(event.id);
      if (pendingDraft && isAmericanoEventV3(pendingDraft)) snapshot = cloneEvent(pendingDraft) as typeof pendingDraft;
      if (!isAmericanoEventV3(snapshot)) return;
      snapshotFingerprint = eventFingerprint(snapshot);
      const reply = await saveAmericanoEventV3(snapshot, snapshot.revision, undefined, session.userId);
      if (reply.status === 'rejected') throw new Error(reply.message);
      if (reply.status === 'conflict') throw new Error('This Americano was changed on another device. Your local draft was kept; reload the server version before saving again.');
      if (active !== session || session.meta.tombstonesById[event.id]) return;
      const current = currentEventWithId(snapshot.id);
      if (current && eventFingerprint(current) === snapshotFingerprint) {
        await saveExternalEvent(reply.snapshot.event.state);
        setExternalActiveEvent(reply.snapshot.event.state);
      }
      const newerDraft = session.dirtySnapshots.get(event.id);
      if (newerDraft && isAmericanoEventV3(newerDraft)
        && newerDraft.revision === snapshot.revision
        && eventFingerprint(newerDraft) !== snapshotFingerprint) {
        // Only advance edits descended from our own successful save. A server
        // conflict never enters this path and is never overwritten or retried.
        const rebased = { ...newerDraft, revision: reply.snapshot.event.state.revision };
        recordDirty(session, rebased);
        await saveExternalEvent(rebased);
        const latest = currentEventWithId(event.id);
        if (latest && eventFingerprint(latest) === eventFingerprint(newerDraft)) setExternalActiveEvent(rebased);
      }
      const latestMarker = session.meta.dirtyById[event.id];
      if (latestMarker?.fingerprint === snapshotFingerprint) {
        delete session.meta.dirtyById[event.id];
        session.dirtySnapshots.delete(event.id);
        clearLocalDirtyMarker(session.userId, event.id, snapshotFingerprint);
        writeSyncMeta(session.userId, session.meta);
      }
      session.lastError = null;
      return;
    }
    if (isAmericanoEventV2(snapshot)) {
      const reply = await saveAmericanoEventV2(snapshot, snapshot.revision);
      if (reply.status === 'rejected') throw new Error(reply.message);
      if (reply.status === 'conflict') throw new Error('This Americano was changed on another device. Your local draft was kept; reload the server version before saving again.');
      const current = currentEventWithId(snapshot.id);
      if (current && eventFingerprint(current) === snapshotFingerprint) {
        await saveExternalEvent(reply.snapshot.event.state);
        setExternalActiveEvent(reply.snapshot.event.state);
      }
      const latestMarker = session.meta.dirtyById[event.id];
      if (latestMarker?.fingerprint === snapshotFingerprint) {
        delete session.meta.dirtyById[event.id];
        session.dirtySnapshots.delete(event.id);
        clearLocalDirtyMarker(session.userId, event.id, snapshotFingerprint);
        writeSyncMeta(session.userId, session.meta);
      }
      session.lastError = null;
      return;
    }
    const updatedAt = new Date().toISOString();
    const { error } = await supabase.from('events').upsert(
      {
        id: snapshot.id,
        user_id: session.userId,
        state: snapshot,
        updated_at: updatedAt,
        deleted_at: null,
      },
      { onConflict: 'id' },
    );
    if (error) throw new Error(error.message);

    const currentDirty = session.meta.dirtyById[event.id];
    if (currentDirty?.fingerprint === snapshotFingerprint) {
      delete session.meta.dirtyById[event.id];
      session.dirtySnapshots.delete(event.id);
      clearLocalDirtyMarker(session.userId, event.id, snapshotFingerprint);
    }
    session.meta.remoteUpdatedAtById[event.id] = parseTimestamp(updatedAt);
    writeSyncMeta(session.userId, session.meta);
    session.lastError = null;
  });
}

function queueDelete(session: Session, eventId: string): Promise<void> {
  cancelPendingPush(session, eventId);
  return enqueueRemote(session, eventId, async () => {
    if (!supabase) return;
    const marker = session.meta.tombstonesById[eventId];
    if (!marker?.pending) return;
    if (marker.protocolVersion === 2 && marker.baseRevision) {
      const reply = await deleteAmericanoEventV2({ eventId, baseEventRevision: marker.baseRevision });
      if (reply.status === 'rejected') throw new Error(reply.message);
      if (reply.status === 'conflict') throw new Error('This Americano changed before it could be deleted. Reload it and confirm deletion again.');
      if (!('deletedAt' in reply)) throw new Error('The server returned an invalid Americano deletion response.');
      markTombstoneSynced(session, eventId, parseTimestamp(reply.deletedAt) || marker.deletedAt);
      return;
    }
    const { data, error } = await supabase.rpc('delete_event', {
      p_event_id: eventId,
    });
    if (error) {
      // A never-uploaded local draft has no server row. Local removal is
      // already complete; the exact-id RPC intentionally reveals no owner data.
      if (/could not be found|not found/i.test(error.message)) {
        markTombstoneSynced(session, eventId, marker.deletedAt);
        return;
      }
      throw new Error(error.message);
    }
    markTombstoneSynced(session, eventId, parseTimestamp(data) || marker.deletedAt);
  });
}

function markTombstoneSynced(session: Session, eventId: string, deletedAt: number): void {
  const current = session.meta.tombstonesById[eventId];
  if (!current) return;
  const synced = {
    deletedAt: Math.max(deletedAt, current.deletedAt),
    pending: false,
    ...(current.protocolVersion === 2 ? { protocolVersion: 2 as const, baseRevision: current.baseRevision } : {}),
  };
  session.meta.tombstonesById[eventId] = synced;
  delete session.meta.dirtyById[eventId];
  delete session.meta.remoteUpdatedAtById[eventId];

  // A request from a stopped session may finish after the same user has made
  // new edits in a replacement session. Update only this event's marker so the
  // late completion cannot overwrite unrelated dirty events.
  const currentSession = active?.userId === session.userId ? active : null;
  if (currentSession && currentSession !== session) {
    currentSession.meta.tombstonesById[eventId] = synced;
    delete currentSession.meta.dirtyById[eventId];
    delete currentSession.meta.remoteUpdatedAtById[eventId];
    writeSyncMeta(currentSession.userId, currentSession.meta);
  } else if (currentSession === session) {
    writeSyncMeta(session.userId, session.meta);
  } else {
    const persisted = readSyncMeta(session.userId);
    persisted.tombstonesById[eventId] = synced;
    delete persisted.dirtyById[eventId];
    delete persisted.remoteUpdatedAtById[eventId];
    writeSyncMeta(session.userId, persisted);
  }
  writeLocalDeletionMarker(session.userId, eventId, synced);
}

function enqueueRemote(
  session: Session,
  eventId: string,
  operation: () => Promise<void>,
): Promise<void> {
  const key = `${session.userId}:${eventId}`;
  const previous = remoteQueues.get(key) ?? Promise.resolve();
  const raw = previous.catch(() => undefined).then(operation);
  const observed = raw.catch((error) => {
    session.lastError = errorMessage(error);
    publishStatus(session, 'error', session.lastError);
    console.warn(`[cloudSync] ${eventId} operation failed:`, errorMessage(error));
  });
  remoteQueues.set(key, observed);
  session.pendingById.set(eventId, observed);
  void observed.finally(() => {
    if (remoteQueues.get(key) === observed) remoteQueues.delete(key);
    if (session.pendingById.get(eventId) === observed) session.pendingById.delete(eventId);
    publishStatus(session);
  });
  return observed;
}

function cancelPendingPush(session: Session, eventId: string): void {
  const timer = session.pushTimers.get(eventId);
  if (!timer) return;
  clearTimeout(timer);
  session.pushTimers.delete(eventId);
}

function cancelAllPendingPushes(session: Session): void {
  for (const timer of session.pushTimers.values()) clearTimeout(timer);
  session.pushTimers.clear();
}

function adoptLocalMutationLedger(session: Session): void {
  // Never assign anonymous/device-wide edits to whichever account happens to
  // sign in next. That could leak a previous organiser's events on a shared
  // iPad. Explicit edits made during this user session create their own
  // per-user dirty markers through recordDirty().
  const ledger = readLocalMutationLedger(session.userId);
  session.meta.dirtyById = {
    ...session.meta.dirtyById,
    ...ledger.dirtyById,
  };
  session.meta.tombstonesById = mergeTombstones(
    session.meta.tombstonesById,
    ledger.tombstonesById,
  );
  for (const eventId of Object.keys(session.meta.tombstonesById)) {
    delete session.meta.dirtyById[eventId];
  }
  writeLocalMutationLedger(session.userId, ledger);
  writeSyncMeta(session.userId, session.meta);
}

function writeLocalDeletionMarker(
  userId: string,
  eventId: string,
  marker: TombstoneMarker,
): void {
  const ledger = readLocalMutationLedger(userId);
  delete ledger.dirtyById[eventId];
  ledger.tombstonesById[eventId] = marker;
  writeLocalMutationLedger(userId, ledger);
}

function clearLocalDirtyMarker(
  userId: string,
  eventId: string,
  fingerprint: string,
): void {
  const ledger = readLocalMutationLedger(userId);
  if (ledger.dirtyById[eventId]?.fingerprint !== fingerprint) return;
  delete ledger.dirtyById[eventId];
  writeLocalMutationLedger(userId, ledger);
}

function hasTombstone(eventId: string): boolean {
  if (active?.meta.tombstonesById[eventId]) return true;
  const userId = active?.userId ?? readLastUserId();
  return Boolean(readLocalMutationLedger(userId).tombstonesById[eventId]);
}

function currentEventWithId(eventId: string): VersionedEventState | null {
  const current = useEventStore.getState().event as VersionedEventState | null;
  return current?.id === eventId ? current : null;
}

async function safeListLocalRecords(): Promise<EventCatalogRecord[]> {
  try {
    return await listLocalEventRecords();
  } catch (error) {
    console.warn('[cloudSync] local catalog read failed:', errorMessage(error));
    return [];
  }
}

function emptyLedger(): MutationLedger {
  return { dirtyById: {}, tombstonesById: {} };
}

function emptySyncMeta(): SyncMeta {
  return { ...emptyLedger(), remoteUpdatedAtById: {} };
}

function readSyncMeta(userId: string): SyncMeta {
  const value = readJson<Partial<SyncMeta>>(`${META_KEY_PREFIX}${userId}`);
  if (value) {
    return {
      dirtyById: sanitizeDirtyMap(value.dirtyById),
      tombstonesById: sanitizeTombstoneMap(value.tombstonesById),
      remoteUpdatedAtById: sanitizeNumberMap(value.remoteUpdatedAtById),
    };
  }

  // Non-destructive migration from the old single-event marker. The former
  // clear-all flag is intentionally not migrated; multi-event sync never
  // performs an account-wide event delete.
  const legacy = readJson<{
    lastSyncedEventId?: string | null;
    dirtyEventId?: string | null;
    tombstoneEventId?: string | null;
  }>(`${LEGACY_META_KEY_PREFIX}${userId}`);
  if (!legacy) return emptySyncMeta();
  const migrated = emptySyncMeta();
  if (legacy.lastSyncedEventId) migrated.remoteUpdatedAtById[legacy.lastSyncedEventId] = 0;
  if (legacy.dirtyEventId) migrated.dirtyById[legacy.dirtyEventId] = {
    fingerprint: '',
    changedAt: 0,
  };
  // Do not promote a legacy cancellation marker into a durable tombstone.
  // Older builds could leave this marker behind when a cancelled event later
  // reappeared; only an explicit v3 exact-id delete is destructive.
  writeSyncMeta(userId, migrated);
  removeStorageKey(`${LEGACY_META_KEY_PREFIX}${userId}`);
  return migrated;
}

function writeSyncMeta(userId: string, meta: SyncMeta): void {
  writeJson(`${META_KEY_PREFIX}${userId}`, meta);
}

function readLocalMutationLedger(userId: string | null): MutationLedger {
  const suffix = userId ?? 'anonymous';
  const value = readJson<Partial<MutationLedger>>(`${LOCAL_MUTATION_KEY_PREFIX}${suffix}`);
  if (value) {
    return {
      dirtyById: sanitizeDirtyMap(value.dirtyById),
      tombstonesById: sanitizeTombstoneMap(value.tombstonesById),
    };
  }

  const legacy = readJson<{
    eventId?: string | null;
    fingerprint?: string | null;
    cancelledEventId?: string | null;
  }>(`${LEGACY_MUTATION_KEY_PREFIX}${suffix}`);
  if (!legacy) return emptyLedger();
  const migrated = emptyLedger();
  if (legacy.eventId) migrated.dirtyById[legacy.eventId] = {
    fingerprint: legacy.fingerprint ?? '',
    changedAt: 0,
  };
  // As above, legacy anonymous/user cancellation markers are deliberately
  // ignored. They did not have the multi-event exact-delete safety contract.
  writeLocalMutationLedger(userId, migrated);
  removeStorageKey(`${LEGACY_MUTATION_KEY_PREFIX}${suffix}`);
  return migrated;
}

function writeLocalMutationLedger(userId: string | null, ledger: MutationLedger): void {
  writeJson(`${LOCAL_MUTATION_KEY_PREFIX}${userId ?? 'anonymous'}`, ledger);
}

function removeStorageKey(key: string): void {
  try {
    globalThis.localStorage?.removeItem(key);
  } catch {
    // Storage migration is best effort; v3 keys remain the source of truth.
  }
}

function readLastUserId(): string | null {
  try {
    return globalThis.localStorage?.getItem(LAST_USER_KEY) ?? null;
  } catch {
    return null;
  }
}

function writeLastUserId(userId: string): void {
  try {
    globalThis.localStorage?.setItem(LAST_USER_KEY, userId);
  } catch {
    // Cloud sync continues for this page session.
  }
}

function readJson<T>(key: string): T | null {
  try {
    const raw = globalThis.localStorage?.getItem(key);
    return raw ? JSON.parse(raw) as T : null;
  } catch {
    return null;
  }
}

function writeJson(key: string, value: unknown): void {
  try {
    globalThis.localStorage?.setItem(key, JSON.stringify(value));
  } catch {
    // Marker storage can be unavailable/full. IndexedDB still owns event data.
  }
}

function sanitizeDirtyMap(value: unknown): Record<string, DirtyMarker> {
  if (!value || typeof value !== 'object') return {};
  const result: Record<string, DirtyMarker> = {};
  for (const [eventId, marker] of Object.entries(value)) {
    if (!marker || typeof marker !== 'object') continue;
    const candidate = marker as Partial<DirtyMarker>;
    result[eventId] = {
      fingerprint: typeof candidate.fingerprint === 'string' ? candidate.fingerprint : '',
      changedAt: typeof candidate.changedAt === 'number' ? candidate.changedAt : 0,
    };
  }
  return result;
}

function sanitizeTombstoneMap(value: unknown): Record<string, TombstoneMarker> {
  if (!value || typeof value !== 'object') return {};
  const result: Record<string, TombstoneMarker> = {};
  for (const [eventId, marker] of Object.entries(value)) {
    if (!marker || typeof marker !== 'object') continue;
    const candidate = marker as Partial<TombstoneMarker>;
    result[eventId] = {
      deletedAt: typeof candidate.deletedAt === 'number' ? candidate.deletedAt : 0,
      pending: candidate.pending !== false,
      ...(candidate.protocolVersion === 2 && typeof candidate.baseRevision === 'string'
        ? { protocolVersion: 2 as const, baseRevision: candidate.baseRevision }
        : {}),
    };
  }
  return result;
}

function sanitizeNumberMap(value: unknown): Record<string, number> {
  if (!value || typeof value !== 'object') return {};
  const result: Record<string, number> = {};
  for (const [eventId, timestamp] of Object.entries(value)) {
    if (typeof timestamp === 'number' && Number.isFinite(timestamp)) result[eventId] = timestamp;
  }
  return result;
}

function mergeTombstones(
  first: Record<string, TombstoneMarker>,
  second: Record<string, TombstoneMarker>,
): Record<string, TombstoneMarker> {
  const result = { ...first };
  for (const [eventId, marker] of Object.entries(second)) {
    const current = result[eventId];
    result[eventId] = {
      deletedAt: Math.max(current?.deletedAt ?? 0, marker.deletedAt),
      pending: Boolean(current?.pending || marker.pending),
      ...(marker.protocolVersion === 2 && marker.baseRevision
        ? { protocolVersion: 2 as const, baseRevision: marker.baseRevision }
        : current?.protocolVersion === 2 && current.baseRevision
          ? { protocolVersion: 2 as const, baseRevision: current.baseRevision }
          : {}),
    };
  }
  return result;
}

function dirtyMarkerFor(event: VersionedEventState, changedAt = Date.now()): DirtyMarker {
  return { fingerprint: eventFingerprint(event), changedAt };
}

function eventFingerprint(event: VersionedEventState): string {
  try {
    return JSON.stringify(event);
  } catch {
    return `${event.id}:${event.createdAt}`;
  }
}

function cloneEvent(event: VersionedEventState): VersionedEventState {
  if (typeof globalThis.structuredClone === 'function') return globalThis.structuredClone(event);
  return JSON.parse(JSON.stringify(event)) as VersionedEventState;
}

function parseTimestamp(value: unknown): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value !== 'string') return 0;
  const parsed = new Date(value).getTime();
  return Number.isFinite(parsed) ? parsed : 0;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function waitWithTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('Timed out waiting for cloud sync.')), timeoutMs);
    promise.then(
      (value) => {
        clearTimeout(timeout);
        resolve(value);
      },
      (error) => {
        clearTimeout(timeout);
        reject(error);
      },
    );
  });
}
