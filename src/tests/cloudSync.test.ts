import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { createElement } from 'react';
import { cleanup, render } from '@testing-library/react';

const cloud = vi.hoisted(() => {
  type QueryResult = {
    data: Array<{ id: string; state: unknown; updated_at: string }> | null;
    error: { message: string } | null;
  };

  let resolveInitial: (result: QueryResult) => void = () => undefined;
  let initial = Promise.resolve<QueryResult>({ data: null, error: null });
  let realtimeHandler: ((payload: unknown) => void) | null = null;
  let upsertImpl: (row: Record<string, unknown>) => Promise<{ error: { message: string } | null }> =
    async () => ({ error: null });
  let clearImpl: (userId: string) => Promise<{ error: { message: string } | null }> =
    async () => ({ error: null });
  const upserts: Array<Record<string, unknown>> = [];
  const upsertOptions: Array<Record<string, unknown> | undefined> = [];
  const clears: string[] = [];
  const deleteFilters: Array<Record<string, string>> = [];

  const channel = {
    on: (_event: string, _filter: unknown, handler: (payload: unknown) => void) => {
      realtimeHandler = handler;
      return channel;
    },
    subscribe: () => channel,
    unsubscribe: async () => 'ok',
  };

  const client = {
    channel: () => channel,
    from: () => ({
      select: () => ({
        eq: () => ({
          order: () => ({
            limit: () => initial,
          }),
        }),
      }),
      upsert: async (
        row: Record<string, unknown>,
        options?: Record<string, unknown>,
      ) => {
        upserts.push(row);
        upsertOptions.push(options);
        return upsertImpl(row);
      },
      delete: () => {
        let userId = '';
        const filters: Record<string, string> = {};
        const builder = {
          eq: (column: string, value: string) => {
            filters[column] = value;
            if (column === 'user_id') userId = value;
            return builder;
          },
          then: <TResult1 = { error: { message: string } | null }, TResult2 = never>(
            onfulfilled?: ((value: { error: { message: string } | null }) => TResult1 | PromiseLike<TResult1>) | null,
            onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
          ) => {
            clears.push(userId);
            deleteFilters.push({ ...filters });
            return clearImpl(userId).then(onfulfilled, onrejected);
          },
        };
        return builder;
      },
    }),
  };

  return {
    client,
    upserts,
    upsertOptions,
    clears,
    deleteFilters,
    reset() {
      initial = new Promise<QueryResult>((resolve) => {
        resolveInitial = resolve;
      });
      realtimeHandler = null;
      upsertImpl = async () => ({ error: null });
      clearImpl = async () => ({ error: null });
      upserts.length = 0;
      upsertOptions.length = 0;
      clears.length = 0;
      deleteFilters.length = 0;
    },
    resolveInitial(result: QueryResult) {
      resolveInitial(result);
    },
    emitRemote(payload: unknown) {
      realtimeHandler?.(payload);
    },
    setUpsertImpl(impl: typeof upsertImpl) {
      upsertImpl = impl;
    },
    setClearImpl(impl: typeof clearImpl) {
      clearImpl = impl;
    },
  };
});

vi.mock('@/lib/supabase', () => ({ supabase: cloud.client }));

import {
  applyStorageBroadcast,
  flushCloudSync,
  markLocalEventMutation,
  startCloudSync,
  stopCloudSync,
} from '@/store/cloudSync';
import { useEventStore } from '@/store/eventStore';
import { useStorageBroadcast } from '@/hooks/useStorageBroadcast';
import type { EventState } from '@/types/domain';

const BROADCAST_KEY = 'koc-event-broadcast-v2';

function StorageBroadcastHarness() {
  useStorageBroadcast();
  return null;
}

function eventFixture(name: string, courtCount = 3): EventState {
  useEventStore.getState().createEvent(name, 'koc');
  const event = structuredClone(useEventStore.getState().event!);
  event.courts = event.courts.slice(0, courtCount).map((court, index) => ({
    ...court,
    position: index + 1,
  }));
  return event;
}

async function settle(): Promise<void> {
  for (let index = 0; index < 10; index += 1) await Promise.resolve();
}

describe('cloud sync conflict protection', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    stopCloudSync();
    cloud.reset();
    localStorage.clear();
    useEventStore.setState({ event: null, hydrated: true, lastError: null });
  });

  afterEach(() => {
    cleanup();
    stopCloudSync();
    vi.useRealTimers();
  });

  it('keeps a court added while the initial cloud pull is pending', async () => {
    const remote = eventFixture('Remote event');
    const local = eventFixture('Local event');
    useEventStore.getState().loadEvent(local);

    startCloudSync('user-1');
    useEventStore.getState().addCourt();
    cloud.resolveInitial({
      data: [{ id: remote.id, state: remote, updated_at: '2026-08-25T12:00:00.000Z' }],
      error: null,
    });
    await settle();

    expect(useEventStore.getState().event?.name).toBe('Local event');
    expect(useEventStore.getState().event?.courts).toHaveLength(4);
  });

  it('keeps a court edited before authentication starts cloud sync', async () => {
    const remote = eventFixture('Pre-auth event');
    useEventStore.getState().loadEvent(remote);
    useEventStore.getState().addCourt();
    const edited = useEventStore.getState().event!;
    markLocalEventMutation(edited, remote);

    startCloudSync('user-1');
    cloud.resolveInitial({
      data: [{ id: remote.id, state: remote, updated_at: '2026-08-25T12:00:00.000Z' }],
      error: null,
    });
    await settle();
    await vi.advanceTimersByTimeAsync(1_100);
    await settle();

    expect(useEventStore.getState().event?.courts).toHaveLength(4);
    expect(cloud.upserts).toHaveLength(1);
    expect((cloud.upserts[0].state as EventState).courts).toHaveLength(4);
  });

  it('keeps an unsaved court after a reload and retries it instead of pulling stale cloud state', async () => {
    const remote = eventFixture('Reload event');
    useEventStore.getState().loadEvent(remote);
    startCloudSync('user-1');
    cloud.resolveInitial({
      data: [{ id: remote.id, state: remote, updated_at: '2026-08-25T12:00:00.000Z' }],
      error: null,
    });
    await settle();

    useEventStore.getState().addCourt();
    expect(useEventStore.getState().event?.courts).toHaveLength(4);
    stopCloudSync();

    cloud.reset();
    startCloudSync('user-1');
    cloud.resolveInitial({
      data: [{ id: remote.id, state: remote, updated_at: '2026-08-25T12:01:00.000Z' }],
      error: null,
    });
    await settle();
    await vi.advanceTimersByTimeAsync(1_100);
    await settle();

    expect(useEventStore.getState().event?.courts).toHaveLength(4);
    expect(cloud.upserts).toHaveLength(1);
    expect((cloud.upserts[0].state as EventState).courts).toHaveLength(4);
  });

  it('does not resurrect an old event after cancel and replace during initial pull', async () => {
    const remote = eventFixture('Cancelled cloud event');
    const local = eventFixture('Local event');
    useEventStore.getState().loadEvent(local);

    startCloudSync('user-1');
    useEventStore.getState().resetEvent();
    useEventStore.getState().createEvent('Replacement event', 'koc');
    cloud.resolveInitial({
      data: [{ id: remote.id, state: remote, updated_at: '2026-08-25T12:00:00.000Z' }],
      error: null,
    });
    await settle();

    expect(useEventStore.getState().event?.name).toBe('Replacement event');
  });

  it('rejects realtime state while a local court change is waiting to save', async () => {
    const initial = eventFixture('Current event');
    useEventStore.getState().loadEvent(initial);
    startCloudSync('user-1');
    cloud.resolveInitial({
      data: [{ id: initial.id, state: initial, updated_at: '2026-08-25T12:00:00.000Z' }],
      error: null,
    });
    await settle();

    useEventStore.getState().addCourt();
    cloud.emitRemote({
      new: {
        state: initial,
        updated_at: '2026-08-25T12:01:00.000Z',
      },
    });

    expect(useEventStore.getState().event?.courts).toHaveLength(4);
  });

  it('lets a cross-tab cancellation override a dirty local court change', async () => {
    const initial = eventFixture('Cross-tab event');
    useEventStore.getState().loadEvent(initial);
    startCloudSync('user-1');
    cloud.resolveInitial({
      data: [{ id: initial.id, state: initial, updated_at: '2026-08-25T12:00:00.000Z' }],
      error: null,
    });
    await settle();

    useEventStore.getState().addCourt();
    expect(applyStorageBroadcast(null)).toBe(true);
    await vi.advanceTimersByTimeAsync(1_100);
    await settle();

    expect(useEventStore.getState().event).toBeNull();
    expect(cloud.upserts).toHaveLength(0);
    expect(cloud.clears.length).toBeGreaterThan(0);
  });

  it('persists explicit cross-tab cancellation scope before cloud sync restarts', async () => {
    const current = eventFixture('Pre-restart cross-tab cancellation');
    useEventStore.getState().loadEvent(current);
    startCloudSync('user-1');
    cloud.resolveInitial({
      data: [{ id: current.id, state: current, updated_at: '2026-08-25T12:00:00.000Z' }],
      error: null,
    });
    await settle();
    stopCloudSync();

    expect(applyStorageBroadcast(null)).toBe(true);
    cloud.reset();
    startCloudSync('user-1');
    await settle();

    expect(cloud.deleteFilters.at(-1)).toEqual({ user_id: 'user-1' });
    cloud.resolveInitial({
      data: [{ id: current.id, state: current, updated_at: '2026-08-25T12:01:00.000Z' }],
      error: null,
    });
    await settle();
    expect(useEventStore.getState().event).toBeNull();
  });

  it('lets a newer cross-tab edit invalidate a pending stale initial pull', async () => {
    const stale = eventFixture('Stale cloud event');
    const local = eventFixture('Local event');
    const broadcast = { ...structuredClone(local), name: 'Edited in other tab' };
    useEventStore.getState().loadEvent(local);
    startCloudSync('user-1');

    expect(applyStorageBroadcast(broadcast)).toBe(true);
    cloud.resolveInitial({
      data: [{ id: stale.id, state: stale, updated_at: '2026-08-25T12:00:00.000Z' }],
      error: null,
    });
    await settle();
    await vi.advanceTimersByTimeAsync(1_100);

    expect(useEventStore.getState().event?.name).toBe('Edited in other tab');
    expect(cloud.upserts).toHaveLength(1);
    expect((cloud.upserts[0].state as EventState).name).toBe('Edited in other tab');
  });

  it('protects a clean tab\'s newer cross-tab court state from an older cloud echo', async () => {
    const initial = eventFixture('Clean receiver');
    useEventStore.getState().loadEvent(initial);
    startCloudSync('user-1');
    cloud.resolveInitial({
      data: [{ id: initial.id, state: initial, updated_at: '2026-08-25T12:00:00.000Z' }],
      error: null,
    });
    await settle();

    const newer = structuredClone(initial);
    newer.courts.push({
      ...newer.courts[0],
      id: 'fourth-court',
      name: 'Court 4',
      position: 4,
    });
    applyStorageBroadcast(newer);
    cloud.emitRemote({
      eventType: 'UPDATE',
      new: {
        state: initial,
        updated_at: '2026-08-25T12:01:00.000Z',
      },
    });

    expect(useEventStore.getState().event?.courts).toHaveLength(4);
    await vi.advanceTimersByTimeAsync(1_100);
    await settle();
    expect(cloud.upserts).toHaveLength(1);
    expect((cloud.upserts[0].state as EventState).courts).toHaveLength(4);
  });

  it('does not adopt another account\'s pre-auth local mutation marker', async () => {
    const accountA = eventFixture('Account A');
    useEventStore.getState().loadEvent(accountA);
    startCloudSync('account-a');
    cloud.resolveInitial({
      data: [{ id: accountA.id, state: accountA, updated_at: '2026-08-25T12:00:00.000Z' }],
      error: null,
    });
    await settle();
    stopCloudSync();

    useEventStore.getState().addCourt();
    const editedAccountA = structuredClone(useEventStore.getState().event!);
    markLocalEventMutation(editedAccountA, accountA);

    const accountB = eventFixture('Account B');
    cloud.reset();
    useEventStore.getState().loadEvent(editedAccountA);
    startCloudSync('account-b');
    cloud.resolveInitial({
      data: [{ id: accountB.id, state: accountB, updated_at: '2026-08-25T12:01:00.000Z' }],
      error: null,
    });
    await settle();

    expect(useEventStore.getState().event?.name).toBe('Account B');
    expect(cloud.upserts).toHaveLength(0);
  });

  it('applies a clean remote state without writing it straight back', async () => {
    const remote = eventFixture('Remote winner');
    const local = eventFixture('Local copy');
    useEventStore.getState().loadEvent(local);
    startCloudSync('user-1');
    cloud.resolveInitial({
      data: [{ id: remote.id, state: remote, updated_at: '2026-08-25T12:00:00.000Z' }],
      error: null,
    });
    await settle();
    await vi.advanceTimersByTimeAsync(1_100);

    expect(useEventStore.getState().event?.name).toBe('Remote winner');
    expect(cloud.upserts).toHaveLength(0);
  });

  it('does not resurrect a local event when the cloud row was deleted', async () => {
    const local = eventFixture('Local only');
    useEventStore.getState().loadEvent(local);
    startCloudSync('user-1');
    cloud.resolveInitial({ data: [], error: null });
    await settle();

    expect(cloud.upserts).toHaveLength(0);
    expect(useEventStore.getState().event?.name).toBe('Local only');
  });

  it('applies a remote cancellation without echoing or resurrecting it', async () => {
    const current = eventFixture('Cancelled elsewhere');
    useEventStore.getState().loadEvent(current);
    startCloudSync('user-1');
    cloud.resolveInitial({
      data: [{ id: current.id, state: current, updated_at: '2026-08-25T12:00:00.000Z' }],
      error: null,
    });
    await settle();

    cloud.emitRemote({ eventType: 'DELETE', old: { id: current.id }, new: {} });
    expect(useEventStore.getState().event).toBeNull();
    await settle();
    expect(cloud.deleteFilters.at(-1)).toEqual({
      user_id: 'user-1',
      id: current.id,
    });
    await vi.advanceTimersByTimeAsync(1_100);
    expect(cloud.upserts).toHaveLength(0);
  });

  it('does not escalate a replacement delete received from another device', async () => {
    const original = eventFixture('Remote original');
    const replacement = eventFixture('Remote replacement');
    useEventStore.getState().loadEvent(original);
    startCloudSync('user-1');
    cloud.resolveInitial({
      data: [{ id: original.id, state: original, updated_at: '2026-08-25T12:00:00.000Z' }],
      error: null,
    });
    await settle();

    cloud.emitRemote({ eventType: 'DELETE', old: { id: original.id }, new: {} });
    await settle();
    expect(cloud.deleteFilters.at(-1)).toEqual({
      user_id: 'user-1',
      id: original.id,
    });

    cloud.emitRemote({
      eventType: 'INSERT',
      new: {
        state: replacement,
        updated_at: new Date(Date.now() + 1_000).toISOString(),
      },
    });
    expect(useEventStore.getState().event?.id).toBe(replacement.id);
  });

  it('keeps a remote scoped delete scoped after restart before replacement arrives', async () => {
    const original = eventFixture('Restarted remote original');
    const replacement = eventFixture('Restarted remote replacement');
    useEventStore.getState().loadEvent(original);
    startCloudSync('user-1');
    cloud.resolveInitial({
      data: [{ id: original.id, state: original, updated_at: '2026-08-25T12:00:00.000Z' }],
      error: null,
    });
    await settle();

    let resolveOldClear: (result: { error: null }) => void = () => undefined;
    cloud.setClearImpl(() => new Promise((resolve) => {
      resolveOldClear = resolve;
    }));
    cloud.emitRemote({ eventType: 'DELETE', old: { id: original.id }, new: {} });
    await settle();
    expect(useEventStore.getState().event).toBeNull();
    stopCloudSync();

    cloud.reset();
    startCloudSync('user-1');
    cloud.resolveInitial({
      data: [{ id: replacement.id, state: replacement, updated_at: '2026-08-25T12:00:30.000Z' }],
      error: null,
    });
    await settle();
    expect(useEventStore.getState().event?.id).toBe(replacement.id);

    resolveOldClear({ error: null });
    await settle();
    expect(cloud.deleteFilters.at(-1)).toEqual({
      user_id: 'user-1',
      id: original.id,
    });
    expect(useEventStore.getState().event?.id).toBe(replacement.id);
  });

  it('does not rebroadcast a cloud-origin scoped delete as explicit cancellation', async () => {
    const current = eventFixture('Cloud-origin delete');
    useEventStore.getState().loadEvent(current);
    startCloudSync('user-1');
    cloud.resolveInitial({
      data: [{ id: current.id, state: current, updated_at: '2026-08-25T12:00:00.000Z' }],
      error: null,
    });
    await settle();
    render(createElement(StorageBroadcastHarness));

    const sentinel = JSON.stringify({
      version: { at: Date.now(), source: 'existing-tab' },
      event: current,
    });
    localStorage.setItem(BROADCAST_KEY, sentinel);
    cloud.emitRemote({ eventType: 'DELETE', old: { id: current.id }, new: {} });

    expect(useEventStore.getState().event).toBeNull();
    expect(localStorage.getItem(BROADCAST_KEY)).toBe(sentinel);
  });

  it('finishes account-wide cleanup despite multiple realtime delete echoes', async () => {
    const current = eventFixture('Clear-all current');
    const replacement = eventFixture('After clear-all');
    useEventStore.getState().loadEvent(current);
    startCloudSync('user-1');
    cloud.resolveInitial({
      data: [{ id: current.id, state: current, updated_at: '2026-08-25T12:00:00.000Z' }],
      error: null,
    });
    await settle();

    let resolveClear: (result: { error: null }) => void = () => undefined;
    cloud.setClearImpl(() => new Promise((resolve) => {
      resolveClear = resolve;
    }));
    useEventStore.getState().resetEvent();
    await settle();
    expect(cloud.clears).toHaveLength(1);

    cloud.emitRemote({ eventType: 'DELETE', old: { id: current.id }, new: {} });
    cloud.emitRemote({ eventType: 'DELETE', old: { id: 'legacy-row' }, new: {} });
    expect(cloud.clears).toHaveLength(1);

    resolveClear({ error: null });
    await settle();
    cloud.emitRemote({
      eventType: 'INSERT',
      new: {
        state: replacement,
        updated_at: new Date(Date.now() + 1_000).toISOString(),
      },
    });

    expect(useEventStore.getState().event?.id).toBe(replacement.id);
  });

  it('clears pending cleanup after cancel, create and replace before delete resolves', async () => {
    const original = eventFixture('Deferred original');
    const firstReplacement = eventFixture('Deferred replacement one');
    const finalReplacement = eventFixture('Deferred replacement two');
    const remoteAfterward = eventFixture('Remote after cleanup');
    useEventStore.getState().loadEvent(original);
    startCloudSync('user-1');
    cloud.resolveInitial({
      data: [{ id: original.id, state: original, updated_at: '2026-08-25T12:00:00.000Z' }],
      error: null,
    });
    await settle();

    let resolveFirstClear: (result: { error: null }) => void = () => undefined;
    let clearCalls = 0;
    cloud.setClearImpl(() => {
      clearCalls += 1;
      if (clearCalls === 1) {
        return new Promise((resolve) => {
          resolveFirstClear = resolve;
        });
      }
      return Promise.resolve({ error: null });
    });

    useEventStore.getState().resetEvent();
    useEventStore.getState().loadEvent(firstReplacement);
    useEventStore.getState().loadEvent(finalReplacement);
    await settle();
    expect(cloud.clears).toHaveLength(1);

    resolveFirstClear({ error: null });
    await settle();
    await vi.advanceTimersByTimeAsync(1_100);
    await settle();
    expect((cloud.upserts.at(-1)?.state as EventState).id).toBe(finalReplacement.id);

    cloud.emitRemote({
      eventType: 'UPDATE',
      new: {
        state: remoteAfterward,
        updated_at: new Date(Date.now() + 2_000).toISOString(),
      },
    });
    expect(useEventStore.getState().event?.id).toBe(remoteAfterward.id);
  });

  it('serialises a restarted replacement behind the old session clear', async () => {
    const original = eventFixture('Old session event');
    const replacement = eventFixture('New session replacement');
    useEventStore.getState().loadEvent(original);
    startCloudSync('user-1');
    cloud.resolveInitial({
      data: [{ id: original.id, state: original, updated_at: '2026-08-25T12:00:00.000Z' }],
      error: null,
    });
    await settle();

    let resolveOldClear: (result: { error: null }) => void = () => undefined;
    cloud.setClearImpl(() => new Promise((resolve) => {
      resolveOldClear = resolve;
    }));
    useEventStore.getState().resetEvent();
    await settle();
    stopCloudSync();

    cloud.reset();
    useEventStore.getState().loadEvent(replacement);
    startCloudSync('user-1');
    cloud.resolveInitial({
      data: [{ id: original.id, state: original, updated_at: '2026-08-25T12:01:00.000Z' }],
      error: null,
    });
    await settle();
    await vi.advanceTimersByTimeAsync(1_100);
    expect(cloud.upserts).toHaveLength(0);

    resolveOldClear({ error: null });
    await settle();
    await flushCloudSync();
    await settle();
    expect(cloud.upserts.length).toBeGreaterThan(0);
    expect(cloud.upserts.every(
      (row) => (row.state as EventState).id === replacement.id,
    )).toBe(true);
    expect(localStorage.getItem('koc-cloud-sync-v2:user-1')).toContain(replacement.id);
  });

  it('does not let an initial pull resurrect a deletion received first', async () => {
    const current = eventFixture('Deleted before pull');
    useEventStore.getState().loadEvent(current);
    startCloudSync('user-1');

    cloud.emitRemote({ eventType: 'DELETE', old: { id: current.id }, new: {} });
    cloud.resolveInitial({
      data: [{ id: current.id, state: current, updated_at: '2026-08-25T12:00:00.000Z' }],
      error: null,
    });
    await settle();

    expect(useEventStore.getState().event).toBeNull();
  });

  it('persists a failed cancellation and blocks resurrection after restart', async () => {
    const current = eventFixture('Offline cancellation');
    useEventStore.getState().loadEvent(current);
    startCloudSync('user-1');
    cloud.resolveInitial({
      data: [{ id: current.id, state: current, updated_at: '2026-08-25T12:00:00.000Z' }],
      error: null,
    });
    await settle();

    cloud.setClearImpl(async () => ({ error: { message: 'offline' } }));
    useEventStore.getState().resetEvent();
    await settle();
    stopCloudSync();

    cloud.reset();
    cloud.setClearImpl(async () => ({ error: { message: 'still offline' } }));
    startCloudSync('user-1');
    cloud.resolveInitial({
      data: [{ id: current.id, state: current, updated_at: '2026-08-25T12:01:00.000Z' }],
      error: null,
    });
    await settle();

    expect(useEventStore.getState().event).toBeNull();
    expect(localStorage.getItem('koc-cloud-sync-v2:user-1')).toContain(current.id);
  });

  it('blocks a different legacy row while an account-wide cancellation retries', async () => {
    const legacy = eventFixture('Older legacy row');
    const current = eventFixture('Cancelled newest row');
    useEventStore.getState().loadEvent(current);
    startCloudSync('user-1');
    cloud.resolveInitial({
      data: [{ id: current.id, state: current, updated_at: '2026-08-25T12:01:00.000Z' }],
      error: null,
    });
    await settle();

    cloud.setClearImpl(async () => ({ error: { message: 'offline' } }));
    useEventStore.getState().resetEvent();
    await settle();
    stopCloudSync();

    cloud.reset();
    cloud.setClearImpl(async () => ({ error: { message: 'still offline' } }));
    startCloudSync('user-1');
    cloud.resolveInitial({
      data: [{ id: legacy.id, state: legacy, updated_at: '2026-08-25T12:00:00.000Z' }],
      error: null,
    });
    await settle();

    expect(useEventStore.getState().event).toBeNull();
    expect(cloud.deleteFilters.at(-1)).toEqual({ user_id: 'user-1' });
  });

  it('retries a failed cancellation when another tab repeats the null snapshot', async () => {
    const current = eventFixture('Repeated cancellation');
    useEventStore.getState().loadEvent(current);
    startCloudSync('user-1');
    cloud.resolveInitial({
      data: [{ id: current.id, state: current, updated_at: '2026-08-25T12:00:00.000Z' }],
      error: null,
    });
    await settle();

    cloud.setClearImpl(async () => ({ error: { message: 'offline' } }));
    useEventStore.getState().resetEvent();
    await settle();
    expect(cloud.clears).toHaveLength(1);

    expect(applyStorageBroadcast(null)).toBe(true);
    await settle();

    expect(cloud.clears).toHaveLength(2);
    expect(cloud.deleteFilters[1]).toEqual({
      user_id: 'user-1',
    });
  });

  it('rejects a stale cross-tab snapshot for a tombstoned event', async () => {
    const current = eventFixture('Tombstoned broadcast');
    useEventStore.getState().loadEvent(current);
    startCloudSync('user-1');
    cloud.resolveInitial({
      data: [{ id: current.id, state: current, updated_at: '2026-08-25T12:00:00.000Z' }],
      error: null,
    });
    await settle();

    cloud.setClearImpl(async () => ({ error: { message: 'offline' } }));
    useEventStore.getState().resetEvent();
    await settle();

    expect(applyStorageBroadcast(current)).toBe(false);
    expect(useEventStore.getState().event).toBeNull();
    await vi.advanceTimersByTimeAsync(1_100);
    await settle();
    expect(cloud.upserts).toHaveLength(0);
  });

  it('preserves one account cancellation while another account records edits', async () => {
    const accountA = eventFixture('Account A cancellation');
    useEventStore.getState().loadEvent(accountA);
    startCloudSync('account-a');
    cloud.resolveInitial({
      data: [{ id: accountA.id, state: accountA, updated_at: '2026-08-25T12:00:00.000Z' }],
      error: null,
    });
    await settle();
    stopCloudSync();

    useEventStore.getState().loadEvent(accountA);
    useEventStore.getState().resetEvent();
    markLocalEventMutation(null, accountA);

    const accountB = eventFixture('Account B edit');
    useEventStore.getState().loadEvent(accountB);
    cloud.reset();
    startCloudSync('account-b');
    cloud.resolveInitial({
      data: [{ id: accountB.id, state: accountB, updated_at: '2026-08-25T12:01:00.000Z' }],
      error: null,
    });
    await settle();
    useEventStore.getState().addCourt();
    markLocalEventMutation(useEventStore.getState().event, accountB);
    stopCloudSync();

    expect(localStorage.getItem('koc-local-mutation-v2:account-a')).toContain(accountA.id);
    expect(localStorage.getItem('koc-local-mutation-v2:account-b')).toContain(accountB.id);

    useEventStore.setState({ event: null, lastError: null });
    cloud.reset();
    startCloudSync('account-a');
    await settle();
    cloud.resolveInitial({
      data: [{ id: accountA.id, state: accountA, updated_at: '2026-08-25T12:02:00.000Z' }],
      error: null,
    });
    await settle();

    expect(cloud.clears).toContain('account-a');
    expect(cloud.deleteFilters.at(-1)).toEqual({ user_id: 'account-a' });
    expect(useEventStore.getState().event).toBeNull();
  });

  it('preserves and uploads a replacement while retrying an older cancellation', async () => {
    const current = eventFixture('Old cancelled event');
    useEventStore.getState().loadEvent(current);
    startCloudSync('user-1');
    cloud.resolveInitial({
      data: [{ id: current.id, state: current, updated_at: '2026-08-25T12:00:00.000Z' }],
      error: null,
    });
    await settle();

    cloud.setClearImpl(async () => ({ error: { message: 'offline' } }));
    useEventStore.getState().resetEvent();
    useEventStore.getState().createEvent('Replacement event', 'koc');
    const replacement = structuredClone(useEventStore.getState().event!);
    await settle();
    stopCloudSync();

    cloud.reset();
    useEventStore.getState().loadEvent(replacement);
    startCloudSync('user-1');
    cloud.resolveInitial({ data: [], error: null });
    await settle();
    await vi.advanceTimersByTimeAsync(1_100);
    await settle();

    expect(useEventStore.getState().event?.id).toBe(replacement.id);
    expect(cloud.upserts).toHaveLength(1);
    expect((cloud.upserts[0].state as EventState).id).toBe(replacement.id);
    expect(localStorage.getItem('koc-cloud-sync-v2:user-1')).not.toContain(current.id);
  });

  it('removes a directly replaced event before saving its replacement', async () => {
    const original = eventFixture('Original event');
    useEventStore.getState().loadEvent(original);
    startCloudSync('user-1');
    cloud.resolveInitial({
      data: [{ id: original.id, state: original, updated_at: '2026-08-25T12:00:00.000Z' }],
      error: null,
    });
    await settle();

    const replacement = eventFixture('Direct replacement');
    await settle();
    expect(cloud.deleteFilters).toContainEqual({
      user_id: 'user-1',
      id: original.id,
    });

    cloud.emitRemote({
      eventType: 'UPDATE',
      new: {
        state: original,
        updated_at: new Date(Date.now() + 1_000).toISOString(),
      },
    });
    expect(useEventStore.getState().event?.id).toBe(replacement.id);

    await vi.advanceTimersByTimeAsync(1_100);
    await settle();
    expect(cloud.upserts).toHaveLength(1);
    expect((cloud.upserts[0].state as EventState).id).toBe(replacement.id);
    expect(cloud.upsertOptions[0]).toEqual({ onConflict: 'id' });

    useEventStore.getState().resetEvent();
    await settle();
    expect(cloud.deleteFilters).toContainEqual({
      user_id: 'user-1',
    });

    stopCloudSync();
    cloud.reset();
    startCloudSync('user-1');
    cloud.resolveInitial({ data: [], error: null });
    await settle();
    expect(useEventStore.getState().event).toBeNull();
  });

  it('serialises writes so an older snapshot cannot finish last', async () => {
    const initial = eventFixture('Serial event');
    useEventStore.getState().loadEvent(initial);
    startCloudSync('user-1');
    cloud.resolveInitial({
      data: [{ id: initial.id, state: initial, updated_at: '2026-08-25T12:00:00.000Z' }],
      error: null,
    });
    await settle();

    const resolvers: Array<() => void> = [];
    cloud.setUpsertImpl(() => new Promise((resolve) => {
      resolvers.push(() => resolve({ error: null }));
    }));

    useEventStore.getState().addCourt();
    await vi.advanceTimersByTimeAsync(1_100);
    expect(cloud.upserts).toHaveLength(1);

    useEventStore.getState().addCourt();
    await vi.advanceTimersByTimeAsync(1_100);
    expect(cloud.upserts).toHaveLength(1);

    resolvers[0]();
    await settle();
    expect(cloud.upserts).toHaveLength(2);
    expect((cloud.upserts[1].state as EventState).courts).toHaveLength(5);

    resolvers[1]();
    await settle();
  });

  it('queues a newer cross-tab snapshot behind an upsert already in flight', async () => {
    const initial = eventFixture('Cross-tab write race');
    useEventStore.getState().loadEvent(initial);
    startCloudSync('user-1');
    cloud.resolveInitial({
      data: [{ id: initial.id, state: initial, updated_at: '2026-08-25T12:00:00.000Z' }],
      error: null,
    });
    await settle();

    const resolvers: Array<() => void> = [];
    cloud.setUpsertImpl(() => new Promise((resolve) => {
      resolvers.push(() => resolve({ error: null }));
    }));

    useEventStore.getState().addCourt();
    await vi.advanceTimersByTimeAsync(1_100);
    expect(cloud.upserts).toHaveLength(1);

    const newer = structuredClone(useEventStore.getState().event!);
    newer.courts.push({
      ...newer.courts[0],
      id: 'newer-court',
      name: 'Newest court',
      position: newer.courts.length + 1,
    });
    applyStorageBroadcast(newer);
    await vi.advanceTimersByTimeAsync(1_100);
    expect(cloud.upserts).toHaveLength(1);

    resolvers[0]();
    await settle();
    expect(cloud.upserts).toHaveLength(2);
    expect((cloud.upserts[1].state as EventState).courts).toHaveLength(5);

    resolvers[1]();
    await settle();
  });

  it('bounds a flush when the network write never settles', async () => {
    const initial = eventFixture('Stalled save');
    useEventStore.getState().loadEvent(initial);
    startCloudSync('user-1');
    cloud.resolveInitial({
      data: [{ id: initial.id, state: initial, updated_at: '2026-08-25T12:00:00.000Z' }],
      error: null,
    });
    await settle();
    cloud.setUpsertImpl(() => new Promise(() => undefined));

    useEventStore.getState().addCourt();
    await vi.advanceTimersByTimeAsync(1_100);

    let finished = false;
    const flush = flushCloudSync().then(() => {
      finished = true;
    });
    await vi.advanceTimersByTimeAsync(3_999);
    expect(finished).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    await flush;
    expect(finished).toBe(true);
  });
});
