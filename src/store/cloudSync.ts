/**
 * Cloud sync for the single active tournament.
 *
 * Local edits are debounced, remote writes are serialised, and every pull is
 * invalidated as soon as a newer local/cross-tab/Realtime change is seen. A
 * small per-user sync marker distinguishes an unsynced local draft from an
 * event that was deleted on another device.
 */

import type { RealtimeChannel } from '@supabase/supabase-js';
import { supabase } from '@/lib/supabase';
import { useEventStore } from './eventStore';
import type { EventState } from '@/types/domain';

const PUSH_DEBOUNCE_MS = 1000;
const FLUSH_TIMEOUT_MS = 4_000;
const META_KEY_PREFIX = 'koc-cloud-sync-v2:';
const LOCAL_MUTATION_KEY_PREFIX = 'koc-local-mutation-v2:';
const LAST_USER_KEY = 'koc-last-cloud-user-v1';

type Stop = () => void;

interface SyncMeta {
  /** Event known to have reached cloud on this device. */
  lastSyncedEventId: string | null;
  /** Local event changed but its latest snapshot has not reached cloud yet. */
  dirtyEventId: string | null;
  /** Cancellation remains here until a server delete succeeds. */
  tombstoneEventId: string | null;
  /** Explicit cancellation is still removing every legacy row for this user. */
  clearAllPending: boolean;
}

interface LocalMutationMarker {
  eventId: string | null;
  fingerprint: string | null;
  cancelledEventId: string | null;
}

interface Session {
  userId: string;
  channel: RealtimeChannel | null;
  unsubStore: Stop;
  pushTimer: ReturnType<typeof setTimeout> | null;
  lastKnownAt: number;
  applyingRemote: boolean;
  /** Increments synchronously for every accepted local/cross-tab edit. */
  localRevision: number;
  /** Highest local revision confirmed by a completed write/delete. */
  syncedRevision: number;
  /** Invalidates initial pulls without turning clean remote applies dirty. */
  pullGeneration: number;
  /** Older snapshots can never finish after newer snapshots in this tab. */
  remoteQueue: Promise<void>;
  /** Identifies the newest clear-all request independently of its tombstone. */
  clearAllGeneration: number;
  meta: SyncMeta;
}

let active: Session | null = null;

export function startCloudSync(userId: string): Stop {
  if (!supabase) return () => undefined;
  if (active && active.userId === userId) {
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
    pushTimer: null,
    lastKnownAt: 0,
    applyingRemote: false,
    localRevision: 0,
    syncedRevision: 0,
    pullGeneration: 0,
    remoteQueue: Promise.resolve(),
    clearAllGeneration: 0,
    meta: readSyncMeta(userId),
  };
  active = session;

  // The operator UI is available while authentication restores. The per-owner
  // marker is written by the always-on tab-sync hook, so a court/score changed
  // before this session existed is still recognised as local and authoritative.
  const localAtStart = useEventStore.getState().event;
  let localMarker = readLocalMutationMarker(userId);
  const anonymousMarker = readLocalMutationMarker(null);
  if (!hasLocalMutation(localMarker) && hasLocalMutation(anonymousMarker)) {
    localMarker = anonymousMarker;
    writeLocalMutationMarker(userId, localMarker);
    removeLocalMutationMarker(null);
  }
  writeLastUserId(userId);
  if (
    localMarker.cancelledEventId &&
    !session.meta.tombstoneEventId
  ) {
    session.meta.tombstoneEventId = localMarker.cancelledEventId;
  }
  if (
    localAtStart &&
    localMarker.eventId === localAtStart.id &&
    localMarker.fingerprint === eventFingerprint(localAtStart)
  ) {
    session.meta.dirtyEventId = localAtStart.id;
  }
  writeSyncMeta(session.userId, session.meta);

  // Subscribe before pulling. A court/score edit made during the request then
  // increments the generation synchronously, so the late response is stale.
  session.unsubStore = useEventStore.subscribe((state, previous) => {
    if (!supabase || active !== session || state.event === previous.event) return;
    if (session.applyingRemote) return;

    session.localRevision += 1;
    session.pullGeneration += 1;
    cancelPendingPush(session);

    if (!state.event) {
      session.meta.dirtyEventId = null;
      beginCancellation(
        session,
        previous.event?.id ?? session.meta.lastSyncedEventId,
        session.localRevision,
        true,
      );
      return;
    }

    const snapshot = state.event;
    const revision = session.localRevision;
    if (previous.event && previous.event.id !== snapshot.id) {
      // Home/import flows replace the active event directly. Remove the old
      // row first so cancelling this replacement can never reveal it again.
      beginCancellation(session, previous.event.id, revision, false);
    }
    session.meta.dirtyEventId = snapshot.id;
    writeSyncMeta(session.userId, session.meta);
    session.pushTimer = setTimeout(() => {
      session.pushTimer = null;
      enqueueRemote(session, () => pushOnce(session, snapshot, revision));
    }, PUSH_DEBOUNCE_MS);
  });

  session.channel = supabase
    .channel(`events-${userId}`)
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
          const deletedId = (payload.old as { id?: string } | null)?.id;
          const currentId = useEventStore.getState().event?.id;
          // A clear-all can emit several row deletions. They are echoes of the
          // request already in flight, not new cancellation commands.
          if (session.meta.clearAllPending && !currentId) return;
          if (deletedId && currentId && deletedId !== currentId) return;

          // Cancellation wins even over an unsaved edit in this tab. Cancel a
          // pending push and queue an idempotent delete after any write already
          // in flight, so that write cannot recreate the cancelled event.
          session.localRevision += 1;
          session.pullGeneration += 1;
          cancelPendingPush(session);
          const cancelledId = deletedId ?? currentId ?? session.meta.lastSyncedEventId;
          // This tab cannot tell whether the originating DELETE was a full
          // cancellation or the scoped cleanup preceding a replacement. Never
          // escalate it to delete-all: the origin owns that decision.
          beginCancellation(session, cancelledId, session.localRevision, false);
          applyRemoteEvent(session, null, 0);
          return;
        }

        const next = payload.new as
          | { state: EventState; updated_at: string }
          | null;
        if (!next?.state) return;
        if (session.meta.clearAllPending) return;
        if (session.meta.tombstoneEventId === next.state.id) return;
        if (session.meta.dirtyEventId) return;
        if (session.localRevision > session.syncedRevision) return;

        const remoteAt = new Date(next.updated_at).getTime();
        if (remoteAt <= session.lastKnownAt) return;
        applyRemoteEvent(session, next.state, remoteAt);
      },
    )
    .subscribe();

  // A cancellation that previously lost connectivity is retried before its
  // old row is allowed to influence this session.
  if (session.meta.tombstoneEventId || session.meta.clearAllPending) {
    const current = useEventStore.getState().event;
    if (session.meta.tombstoneEventId && current?.id === session.meta.tombstoneEventId) {
      applyRemoteEvent(session, null, 0);
    }
    beginCancellation(
      session,
      session.meta.tombstoneEventId,
      session.localRevision,
      session.meta.clearAllPending || !useEventStore.getState().event,
    );
  }
  const local = useEventStore.getState().event;
  if (
    local &&
    (session.meta.dirtyEventId === local.id || session.meta.clearAllPending)
  ) {
    session.meta.dirtyEventId = local.id;
    writeSyncMeta(session.userId, session.meta);
    session.localRevision += 1;
    session.pullGeneration += 1;
    const revision = session.localRevision;
    session.pushTimer = setTimeout(() => {
      session.pushTimer = null;
      enqueueRemote(session, () => pushOnce(session, local, revision));
    }, PUSH_DEBOUNCE_MS);
  }

  void pullInitialEvent(session);

  return () => {
    if (active === session) stopCloudSync();
  };
}

export function stopCloudSync(): void {
  if (!active) return;
  const session = active;
  active = null;
  void session.channel?.unsubscribe();
  session.unsubStore();
  cancelPendingPush(session);
}

/** Best-effort bounded save used before sign-out and PWA activation. */
export async function flushCloudSync(): Promise<void> {
  if (!supabase || !active) return;
  const session = active;
  cancelPendingPush(session);

  const event = useEventStore.getState().event;
  if (session.meta.clearAllPending) {
    session.clearAllGeneration += 1;
    queueClear(
      session,
      session.localRevision,
      session.meta.tombstoneEventId,
      true,
      session.clearAllGeneration,
    );
  } else if (session.meta.tombstoneEventId) {
    queueClear(
      session,
      session.localRevision,
      session.meta.tombstoneEventId,
      false,
      null,
    );
  }
  if (event && session.meta.tombstoneEventId !== event.id) {
    enqueueRemote(session, () => pushOnce(session, event, session.localRevision));
  }

  try {
    await waitWithTimeout(session.remoteQueue, FLUSH_TIMEOUT_MS);
  } catch (error) {
    console.warn('[cloudSync] flush failed:', error instanceof Error ? error.message : error);
  }
}

async function pullInitialEvent(session: Session): Promise<void> {
  if (!supabase) return;
  const generationAtStart = session.pullGeneration;
  const { data, error } = await supabase
    .from('events')
    .select('id, state, updated_at')
    .eq('user_id', session.userId)
    .order('updated_at', { ascending: false })
    .limit(1);

  if (active !== session) return;
  if (error) {
    console.warn('[cloudSync] initial pull failed:', error.message);
    return;
  }
  if (session.pullGeneration !== generationAtStart) return;
  if (session.localRevision > session.syncedRevision) return;

  const row = data?.[0];
  if (row?.state) {
    const remote = row.state as EventState;
    if (session.meta.clearAllPending) return;
    if (session.meta.tombstoneEventId === remote.id) return;
    const remoteAt = new Date(row.updated_at as string).getTime();
    if (remoteAt > session.lastKnownAt) applyRemoteEvent(session, remote, remoteAt);
    return;
  }

  // An empty cloud is authoritative only for a local event that this device
  // knows was synced. A never-synced offline draft remains available locally.
  const current = useEventStore.getState().event;
  const wasSynced = Boolean(
    current && session.meta.lastSyncedEventId === current.id,
  );
  if (wasSynced || session.meta.tombstoneEventId || session.meta.clearAllPending) {
    const tombstoneId = session.meta.tombstoneEventId;
    if (wasSynced) applyRemoteEvent(session, null, 0);
    if (!tombstoneId || session.meta.lastSyncedEventId === tombstoneId) {
      session.meta.lastSyncedEventId = null;
    }
    if (!tombstoneId || session.meta.dirtyEventId === tombstoneId) {
      session.meta.dirtyEventId = null;
    }
    session.meta.tombstoneEventId = null;
    session.meta.clearAllPending = false;
    writeSyncMeta(session.userId, session.meta);
    clearLocalCancellationMarker(tombstoneId, session.userId);
  }
}

/** Apply a trusted cloud change without creating a write-back echo. */
function applyRemoteEvent(
  session: Session,
  event: EventState | null,
  remoteAt: number,
): void {
  if (active !== session) return;
  cancelPendingPush(session);
  session.pullGeneration += 1;
  session.applyingRemote = true;
  try {
    useEventStore.setState({ event, lastError: null });
  } finally {
    session.applyingRemote = false;
  }
  session.lastKnownAt = Math.max(session.lastKnownAt, remoteAt);
  session.syncedRevision = session.localRevision;
  if (event) {
    session.meta.lastSyncedEventId = event.id;
    session.meta.dirtyEventId = null;
    writeSyncMeta(session.userId, session.meta);
    clearLocalMutationMarker(event, session.userId);
  }
}

/**
 * Apply a version-checked same-origin tab message. The hook owns ordering;
 * this function intentionally accepts the latest message even when this tab
 * has a pending edit. That makes rapid score/court updates converge instead
 * of freezing the display on the first broadcast.
 */
export function applyStorageBroadcast(event: EventState | null): boolean {
  const current = useEventStore.getState().event;

  // A repeated null still retries a durable cancellation if the first tab
  // closed before its network delete completed.
  if (!event && !current && active) {
    active.localRevision += 1;
    active.pullGeneration += 1;
    beginCancellation(
      active,
      active.meta.tombstoneEventId ?? active.meta.lastSyncedEventId,
      active.localRevision,
      true,
    );
    return true;
  }

  if (event && active?.meta.tombstoneEventId === event.id) {
    if (current?.id === event.id) applyRemoteEvent(active, null, 0);
    return false;
  }

  if (event && active?.meta.clearAllPending && !current) return false;

  if (
    current === event ||
    (current && event && eventFingerprint(current) === eventFingerprint(event))
  ) return true;

  if (event && active) {
    // The originating tab owns the cloud write. Mark this as external so a
    // receiving TV/operator tab does not upsert it again, receive that echo
    // over Realtime, and start an endless tab-to-cloud loop.
    const session = active;
    cancelPendingPush(session);
    session.pullGeneration += 1;
    session.localRevision += 1;
    if (current && current.id !== event.id) {
      beginCancellation(session, current.id, session.localRevision, false);
    }
    session.applyingRemote = true;
    try {
      useEventStore.setState({ event, lastError: null });
    } finally {
      session.applyingRemote = false;
    }

    // Keep the accepted snapshot protected from an older Realtime echo until
    // it is confirmed in cloud. If an upsert is already on the wire, the queue
    // guarantees this newer snapshot finishes afterward.
    const revision = session.localRevision;
    session.meta.dirtyEventId = event.id;
    writeSyncMeta(session.userId, session.meta);
    session.pushTimer = setTimeout(() => {
      session.pushTimer = null;
      enqueueRemote(session, () => pushOnce(session, event, revision));
    }, PUSH_DEBOUNCE_MS);
    return true;
  }

  useEventStore.setState({ event, lastError: null });
  return true;
}

function cancelPendingPush(session: Session): void {
  if (!session.pushTimer) return;
  clearTimeout(session.pushTimer);
  session.pushTimer = null;
}

function beginCancellation(
  session: Session,
  eventId: string | null | undefined,
  revision: number,
  clearAll: boolean,
): void {
  cancelPendingPush(session);
  session.pullGeneration += 1;
  session.lastKnownAt = Math.max(Date.now(), session.lastKnownAt + 1);
  let clearAllGeneration: number | null = null;
  if (clearAll) {
    session.meta.clearAllPending = true;
    session.clearAllGeneration += 1;
    clearAllGeneration = session.clearAllGeneration;
  }
  if (eventId) session.meta.tombstoneEventId = eventId;
  writeSyncMeta(session.userId, session.meta);
  queueClear(
    session,
    revision,
    session.meta.tombstoneEventId,
    clearAll,
    clearAllGeneration,
  );
}

function queueClear(
  session: Session,
  revision: number,
  tombstoneAtQueue: string | null,
  clearAll: boolean,
  clearAllGeneration: number | null,
): void {
  enqueueRemote(session, async () => {
    if (!supabase) return;
    let request = supabase
      .from('events')
      .delete()
      .eq('user_id', session.userId);
    // Replacing an event removes just the previous row. Deliberately clearing
    // the active event removes every legacy row for this account, matching the
    // app's one-active-event model and preventing an older event resurfacing.
    if (!clearAll && tombstoneAtQueue) request = request.eq('id', tombstoneAtQueue);
    const { error } = await request;
    if (error) {
      // Keep the tombstone. It will be retried on the next start/flush and the
      // old row is ignored meanwhile, so cancellation cannot spring back.
      throw new Error(error.message);
    }

    // A scoped delete during E1 -> E2 replacement has not saved E2. Advancing
    // the synced revision here would let a stale E1 Realtime echo overwrite E2
    // during its debounce window. A true clear-all does complete the revision.
    if (clearAll) {
      session.syncedRevision = Math.max(session.syncedRevision, revision);
    }
    session.pullGeneration += 1;
    let metaChanged = false;
    if (
      clearAll &&
      clearAllGeneration !== null &&
      clearAllGeneration === session.clearAllGeneration
    ) {
      session.meta.clearAllPending = false;
      metaChanged = true;
    }
    if (session.meta.tombstoneEventId === tombstoneAtQueue) {
      session.meta.tombstoneEventId = null;
      if (
        !tombstoneAtQueue ||
        session.meta.lastSyncedEventId === tombstoneAtQueue
      ) session.meta.lastSyncedEventId = null;
      if (
        !tombstoneAtQueue ||
        session.meta.dirtyEventId === tombstoneAtQueue
      ) session.meta.dirtyEventId = null;
      metaChanged = true;
      clearLocalCancellationMarker(tombstoneAtQueue, session.userId);
    }
    if (metaChanged) writeSyncMeta(session.userId, session.meta);
  });
}

function enqueueRemote(session: Session, operation: () => Promise<void>): void {
  session.remoteQueue = session.remoteQueue
    .catch(() => undefined)
    .then(operation)
    .catch((error) => {
      console.warn('[cloudSync] queued operation failed:', error instanceof Error ? error.message : error);
    });
}

async function waitWithTimeout(operation: Promise<void>, timeoutMs: number): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | null = null;
  try {
    await Promise.race([
      operation,
      new Promise<void>((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error('Timed out saving event.')), timeoutMs);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function pushOnce(
  session: Session,
  event: EventState,
  revision: number,
): Promise<void> {
  if (!supabase || active !== session) return;
  if (revision < session.localRevision) return;
  if (session.meta.tombstoneEventId === event.id) return;
  const current = useEventStore.getState().event;
  if (!current || current.id !== event.id) return;

  const now = Math.max(Date.now(), session.lastKnownAt + 1);
  const { error } = await supabase.from('events').upsert(
    {
      id: event.id,
      user_id: session.userId,
      state: event,
      updated_at: new Date(now).toISOString(),
    },
    { onConflict: 'id' },
  );
  if (error) {
    console.warn('[cloudSync] push failed:', error.message);
    return;
  }
  if (active !== session) return;
  if (session.meta.tombstoneEventId === event.id) return;
  session.lastKnownAt = Math.max(session.lastKnownAt, now);
  session.syncedRevision = Math.max(session.syncedRevision, revision);
  session.meta.lastSyncedEventId = event.id;
  if (revision === session.localRevision) {
    session.meta.dirtyEventId = null;
    clearLocalMutationMarker(event, session.userId);
  }
  writeSyncMeta(session.userId, session.meta);
}

/** Record operator changes even before async auth has started cloud sync. */
export function markLocalEventMutation(
  event: EventState | null,
  previous: EventState | null,
): void {
  if (active?.applyingRemote) return;
  const ownerUserId = active?.userId ?? readLastUserId();
  const existing = readLocalMutationMarker(ownerUserId);
  const marker: LocalMutationMarker = event
    ? {
        eventId: event.id,
        fingerprint: eventFingerprint(event),
        cancelledEventId:
          previous && previous.id !== event.id
            ? previous.id
            : existing.cancelledEventId,
      }
    : {
        eventId: null,
        fingerprint: null,
        cancelledEventId:
          previous?.id ?? existing.eventId ?? existing.cancelledEventId,
      };
  writeLocalMutationMarker(ownerUserId, marker);
}

function eventFingerprint(event: EventState): string {
  return JSON.stringify(event);
}

function readLocalMutationMarker(ownerUserId: string | null): LocalMutationMarker {
  const empty: LocalMutationMarker = {
    eventId: null,
    fingerprint: null,
    cancelledEventId: null,
  };
  try {
    const raw = globalThis.localStorage?.getItem(localMutationKey(ownerUserId));
    if (!raw) return empty;
    const parsed = JSON.parse(raw) as Partial<LocalMutationMarker>;
    return {
      eventId: parsed.eventId ?? null,
      fingerprint: parsed.fingerprint ?? null,
      cancelledEventId: parsed.cancelledEventId ?? null,
    };
  } catch {
    return empty;
  }
}

function writeLocalMutationMarker(
  ownerUserId: string | null,
  marker: LocalMutationMarker,
): void {
  try {
    globalThis.localStorage?.setItem(
      localMutationKey(ownerUserId),
      JSON.stringify(marker),
    );
  } catch {
    // Storage restrictions must not stop score entry.
  }
}

function clearLocalMutationMarker(event: EventState, userId: string): void {
  const marker = readLocalMutationMarker(userId);
  if (
    marker.eventId !== event.id ||
    marker.fingerprint !== eventFingerprint(event)
  ) return;
  marker.eventId = null;
  marker.fingerprint = null;
  writeLocalMutationMarker(userId, marker);
}

function clearLocalCancellationMarker(
  eventId: string | null,
  userId: string,
): void {
  if (!eventId) return;
  const marker = readLocalMutationMarker(userId);
  if (marker.cancelledEventId !== eventId) return;
  marker.cancelledEventId = null;
  writeLocalMutationMarker(userId, marker);
}

function hasLocalMutation(marker: LocalMutationMarker): boolean {
  return Boolean(marker.eventId || marker.cancelledEventId);
}

function localMutationKey(ownerUserId: string | null): string {
  return `${LOCAL_MUTATION_KEY_PREFIX}${ownerUserId ?? 'anonymous'}`;
}

function removeLocalMutationMarker(ownerUserId: string | null): void {
  try {
    globalThis.localStorage?.removeItem(localMutationKey(ownerUserId));
  } catch {
    // Storage restrictions must not stop cloud sync.
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
    // Storage restrictions must not stop cloud sync.
  }
}

function readSyncMeta(userId: string): SyncMeta {
  const empty: SyncMeta = {
    lastSyncedEventId: null,
    dirtyEventId: null,
    tombstoneEventId: null,
    clearAllPending: false,
  };
  try {
    const raw = globalThis.localStorage?.getItem(`${META_KEY_PREFIX}${userId}`);
    if (!raw) return empty;
    const parsed = JSON.parse(raw) as Partial<SyncMeta>;
    return {
      lastSyncedEventId: parsed.lastSyncedEventId ?? null,
      dirtyEventId: parsed.dirtyEventId ?? null,
      tombstoneEventId: parsed.tombstoneEventId ?? null,
      clearAllPending: parsed.clearAllPending ?? false,
    };
  } catch {
    return empty;
  }
}

function writeSyncMeta(userId: string, meta: SyncMeta): void {
  try {
    globalThis.localStorage?.setItem(`${META_KEY_PREFIX}${userId}`, JSON.stringify(meta));
  } catch {
    // Private browsing/storage restrictions must not break the tournament.
  }
}
