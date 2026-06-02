/**
 * Cloud sync glue (Stage 2.4).
 *
 *  Local Zustand store  ←──debounced upsert──►  Supabase `events` table
 *                       ←──Realtime channel ──┘
 *
 *  - Push: when `event` in the store changes, debounce 1s then upsert the
 *    full EventState as JSON. The row's updated_at uses Date.now() so it
 *    monotonically advances across devices on the same wall clock.
 *  - Pull (initial): the most-recently-updated event for the signed-in
 *    user is pulled into the store so the device boots into the latest
 *    state.
 *  - Pull (incremental): Postgres CDC over WebSocket. When another
 *    device updates the same event we apply the remote state IFF its
 *    updated_at is newer than what we last pushed (avoids feedback
 *    loops from our own writes echoing back).
 *
 *  No cloud config? Then `supabase` is null and this module is a no-op
 *  — the app stays in local-only mode.
 */

import type { RealtimeChannel } from '@supabase/supabase-js';
import { supabase } from '@/lib/supabase';
import { useEventStore } from './eventStore';
import type { EventState } from '@/types/domain';

const PUSH_DEBOUNCE_MS = 1000;

type Stop = () => void;

interface Session {
  userId: string;
  channel: RealtimeChannel;
  unsubStore: Stop;
  pushTimer: ReturnType<typeof setTimeout> | null;
  /** Highest updated_at (ms) we have either pushed or received. Used to
   *  reject stale Realtime echoes of our own writes. */
  lastKnownAt: number;
}

let active: Session | null = null;

/**
 * Start cloud sync for the given user. Returns a stop function (idempotent).
 * Calling startCloudSync twice without stop is a no-op for the same userId
 * and tears down + restarts for a different userId.
 */
export function startCloudSync(userId: string): Stop {
  if (!supabase) return () => undefined;
  if (active && active.userId === userId) return () => stopCloudSync();
  if (active) stopCloudSync();

  // 1. Initial pull — load the most recently-updated event from cloud.
  void (async () => {
    if (!supabase) return;
    const { data } = await supabase
      .from('events')
      .select('id, state, updated_at')
      .eq('user_id', userId)
      .order('updated_at', { ascending: false })
      .limit(1);
    if (active?.userId !== userId) return; // user changed mid-fetch
    const row = data?.[0];
    if (row?.state) {
      active.lastKnownAt = new Date(row.updated_at as string).getTime();
      // loadEvent() replaces the store's event entirely.
      useEventStore.getState().loadEvent(row.state as EventState);
    }
  })();

  // 2. Realtime channel — apply remote updates that are newer than what
  //    we last pushed.
  const channel = supabase
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
        const next = payload.new as
          | { state: EventState; updated_at: string }
          | null;
        if (!active || !next?.state) return;
        const remoteAt = new Date(next.updated_at).getTime();
        if (remoteAt <= active.lastKnownAt) return; // our own echo
        active.lastKnownAt = remoteAt;
        useEventStore.getState().loadEvent(next.state);
      },
    )
    .subscribe();

  // 3. Subscribe to local store changes; debounce 1s; upsert.
  const unsubStore = useEventStore.subscribe((state) => {
    if (!supabase || !active || active.userId !== userId) return;
    if (!state.event) return;
    if (active.pushTimer) clearTimeout(active.pushTimer);
    active.pushTimer = setTimeout(() => void pushOnce(userId, state.event!), PUSH_DEBOUNCE_MS);
  });

  active = { userId, channel, unsubStore, pushTimer: null, lastKnownAt: 0 };
  return () => stopCloudSync();
}

export function stopCloudSync(): void {
  if (!active) return;
  active.channel.unsubscribe();
  active.unsubStore();
  if (active.pushTimer) clearTimeout(active.pushTimer);
  active = null;
}

/** Force an immediate push (e.g. on sign-out, before tearing down). */
export async function flushCloudSync(): Promise<void> {
  if (!supabase || !active) return;
  if (active.pushTimer) {
    clearTimeout(active.pushTimer);
    active.pushTimer = null;
  }
  const event = useEventStore.getState().event;
  if (event) await pushOnce(active.userId, event);
}

async function pushOnce(userId: string, event: EventState): Promise<void> {
  if (!supabase || !active || active.userId !== userId) return;
  const now = Date.now();
  active.lastKnownAt = Math.max(active.lastKnownAt, now);
  const { error } = await supabase.from('events').upsert(
    {
      id: event.id,
      user_id: userId,
      state: event,
      updated_at: new Date(now).toISOString(),
    },
    { onConflict: 'id' },
  );
  if (error) {
    // Non-fatal — surface to console; offline writes will retry on the
    // next store change once connectivity returns.
    console.warn('[cloudSync] push failed:', error.message);
  }
}
