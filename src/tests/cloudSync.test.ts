import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const cloud = vi.hoisted(() => {
  type Result = { data: unknown[]; error: { message: string } | null };
  let eventResult: Result = { data: [], error: null };
  let tombstoneResult: Result = { data: [], error: null };
  let eventQueryImpl: () => Promise<Result> = async () => eventResult;
  let rpcImpl: (id: string) => Promise<{ data: unknown; error: { message: string } | null }> =
    async () => ({ data: new Date().toISOString(), error: null });
  let upsertImpl: (row: Record<string, unknown>) => Promise<{ error: { message: string } | null }> =
    async () => ({ error: null });
  const upserts: Record<string, unknown>[] = [];
  const rpcs: string[] = [];
  const handlers = new Map<string, (payload: unknown) => void>();

  const channel = {
    on: (
      _kind: string,
      filter: { table?: string },
      handler: (payload: unknown) => void,
    ) => {
      if (filter.table) handlers.set(filter.table, handler);
      return channel;
    },
    subscribe: () => channel,
    unsubscribe: async () => 'ok',
  };

  const client = {
    channel: () => channel,
    from: (table: string) => ({
      select: () => ({
        eq: () => table === 'events'
          ? { order: () => eventQueryImpl() }
          : Promise.resolve(tombstoneResult),
      }),
      upsert: async (row: Record<string, unknown>) => {
        upserts.push(row);
        return upsertImpl(row);
      },
    }),
    rpc: async (_name: string, args: { p_event_id: string }) => {
      rpcs.push(args.p_event_id);
      return rpcImpl(args.p_event_id);
    },
  };

  return {
    client,
    upserts,
    rpcs,
    reset() {
      eventResult = { data: [], error: null };
      tombstoneResult = { data: [], error: null };
      eventQueryImpl = async () => eventResult;
      rpcImpl = async () => ({ data: new Date().toISOString(), error: null });
      upsertImpl = async () => ({ error: null });
      upserts.length = 0;
      rpcs.length = 0;
      handlers.clear();
    },
    setEvents(data: unknown[]) {
      eventResult = { data, error: null };
    },
    setEventsError(message: string) {
      eventResult = { data: [], error: { message } };
    },
    setEventQueryImpl(impl: () => Promise<Result>) {
      eventQueryImpl = impl;
    },
    setTombstones(data: unknown[]) {
      tombstoneResult = { data, error: null };
    },
    setUpsertImpl(impl: typeof upsertImpl) {
      upsertImpl = impl;
    },
    setRpcImpl(impl: typeof rpcImpl) {
      rpcImpl = impl;
    },
    emit(table: string, payload: unknown) {
      handlers.get(table)?.(payload);
    },
  };
});

const americanoCloud = vi.hoisted(() => ({
  save: vi.fn(),
  saveV3: vi.fn(),
  remove: vi.fn(),
}));

vi.mock('@/lib/supabase', () => ({ supabase: cloud.client }));
vi.mock('@/lib/americanoV2', () => ({
  saveAmericanoEventV2: americanoCloud.save,
  deleteAmericanoEventV2: americanoCloud.remove,
}));
vi.mock('@/lib/americanoV3', () => ({ saveAmericanoEventV3: americanoCloud.saveV3 }));

import {
  deleteCloudEvent,
  flushCloudSync,
  flushCloudEvent,
  markLocalEventMutation,
  startCloudSync,
  stopCloudSync,
  useCloudSyncStatus,
} from '@/store/cloudSync';
import { useEventCatalogStore } from '@/store/eventCatalog';
import {
  listLocalEventRecords,
  removeLocalEventRecord,
  saveLocalEventRecord,
} from '@/store/eventRepository';
import { useEventStore } from '@/store/eventStore';
import { DEFAULT_SETTINGS, type EventState } from '@/types/domain';
import { americanoV2Fixture } from '@/tests/americanoV2Fixtures';
import { createAmericanoEventV3 } from '@/logic/americanoV3/runtime';

function eventFixture(id: string, name: string): EventState {
  return {
    id,
    name,
    venue: '',
    createdAt: 1_700_000_000_000,
    status: 'setup',
    settings: { ...DEFAULT_SETTINGS },
    courts: [],
    teams: [],
    rounds: [],
    format: 'koc',
    formatConfig: {},
  };
}

function remoteRow(event: EventState, at = '2026-08-29T10:00:00.000Z') {
  return { id: event.id, state: event, updated_at: at };
}

async function saveLocal(event: EventState, updatedAt = 1_700_000_000_000) {
  await saveLocalEventRecord({
    id: event.id,
    state: event,
    createdAt: event.createdAt,
    updatedAt,
    archivedAt: null,
  });
}

async function settle(turns = 30): Promise<void> {
  for (let index = 0; index < turns; index += 1) await Promise.resolve();
}

describe('event-scoped cloud sync', () => {
  beforeEach(async () => {
    vi.useFakeTimers();
    stopCloudSync();
    cloud.reset();
    americanoCloud.save.mockReset();
    americanoCloud.saveV3.mockReset();
    americanoCloud.remove.mockReset();
    localStorage.clear();
    for (const record of await listLocalEventRecords()) {
      await removeLocalEventRecord(record.id);
    }
    useEventCatalogStore.setState({
      events: [],
      activeEventId: null,
      hydrated: false,
      lastError: null,
    });
    useEventStore.setState({ event: null, hydrated: true, lastError: null });
  });

  afterEach(() => {
    stopCloudSync();
    vi.useRealTimers();
  });

  it('pulls and stores the complete remote catalog without selecting one row', async () => {
    const alpha = eventFixture('event-alpha', 'Alpha');
    const bravo = eventFixture('event-bravo', 'Bravo');
    cloud.setEvents([remoteRow(alpha), remoteRow(bravo)]);

    startCloudSync('user-1');
    await settle();

    const records = await listLocalEventRecords();
    expect(records.map((record) => record.id).sort()).toEqual([
      alpha.id,
      bravo.id,
    ]);
    expect(useEventStore.getState().event).toBeNull();
  });

  it('settles only the selected event before an explicit owner action', async () => {
    const alpha = eventFixture('flush-alpha', 'Selected event');
    const bravo = eventFixture('flush-bravo', 'Unrelated event');
    await saveLocal(alpha);
    await saveLocal(bravo);
    startCloudSync('user-1');
    await settle();
    markLocalEventMutation(alpha, null);
    markLocalEventMutation(bravo, null);
    await flushCloudEvent(alpha.id);
    expect(cloud.upserts.map((row) => row.id)).toEqual([alpha.id]);
    expect(useCloudSyncStatus.getState().pendingEventIds).not.toContain(alpha.id);
    expect(useCloudSyncStatus.getState().pendingEventIds).toContain(bravo.id);
  });

  it('retains rapid v3 edits made during an in-flight save and uses the acknowledged revision next', async () => {
    const event = { ...createAmericanoEventV3('V3 rapid edits'), revision: '1' };
    await saveLocal(event as never);
    cloud.setEvents([remoteRow(event as never)]);
    await useEventStore.getState().selectEventById(event.id);
    startCloudSync('user-1');
    await settle();
    let release!: () => void;
    const delayed = new Promise<void>((resolve) => { release = resolve; });
    americanoCloud.saveV3.mockImplementation(async (state, revision) => {
      if (revision === '1') await delayed;
      const next = { ...state, revision: String(Number(revision) + 1) };
      return { status: 'applied', snapshot: { event: { state: next } } };
    });
    useEventStore.getState().loadEvent({ ...event, name: 'First edit' });
    await vi.advanceTimersByTimeAsync(1100);
    expect(americanoCloud.saveV3).toHaveBeenCalledTimes(1);
    useEventStore.getState().loadEvent({ ...event, name: 'Second edit during save' });
    release();
    await settle();
    await flushCloudEvent(event.id);
    expect(americanoCloud.saveV3).toHaveBeenCalledTimes(2);
    expect(americanoCloud.saveV3.mock.calls[1][1]).toBe('2');
    expect(americanoCloud.saveV3.mock.calls[1][0].name).toBe('Second edit during save');
    expect(useEventStore.getState().event).toMatchObject({ name: 'Second edit during save', revision: '3' });
    expect(useCloudSyncStatus.getState().pendingEventIds).not.toContain(event.id);
  });

  it('does not delete the prior competition when the active selection changes', async () => {
    const alpha = eventFixture('event-alpha', 'Alpha');
    const bravo = eventFixture('event-bravo', 'Bravo');
    await saveLocal(alpha, Date.parse('2026-08-29T10:00:00.000Z'));
    await saveLocal(bravo, Date.parse('2026-08-29T10:00:00.000Z'));
    cloud.setEvents([remoteRow(alpha), remoteRow(bravo)]);
    await useEventStore.getState().selectEventById(alpha.id);

    startCloudSync('user-1');
    await settle();
    await useEventStore.getState().selectEventById(bravo.id);
    await vi.advanceTimersByTimeAsync(1_100);
    await settle();

    expect(cloud.rpcs).toEqual([]);
    expect(cloud.upserts).toEqual([]);
    expect((await listLocalEventRecords()).map((record) => record.id)).toEqual(
      expect.arrayContaining([alpha.id, bravo.id]),
    );
  });

  it('flushes every dirty competition rather than only the active one', async () => {
    const alpha = eventFixture('event-alpha', 'Alpha offline edit');
    const bravo = eventFixture('event-bravo', 'Bravo offline edit');
    await saveLocal(alpha);
    await saveLocal(bravo);
    startCloudSync('user-1');
    await settle();
    markLocalEventMutation(alpha, null);
    markLocalEventMutation(bravo, null);
    await flushCloudSync();
    await settle();

    expect(cloud.upserts.map((row) => row.id)).toEqual(
      expect.arrayContaining([alpha.id, bravo.id]),
    );
  });

  it('does not upload another account\'s device-local catalog during bootstrap', async () => {
    const alpha = eventFixture('event-alpha', 'Alpha private draft');
    await saveLocal(alpha);

    startCloudSync('user-a');
    await settle();
    useEventStore.setState({ event: alpha });
    stopCloudSync();

    startCloudSync('user-b');
    await settle();
    await vi.advanceTimersByTimeAsync(1_100);
    await flushCloudSync();
    await settle();

    expect(cloud.upserts).toEqual([]);
    expect(localStorage.getItem('koc-cloud-sync-v3:user-b')).not.toContain(alpha.id);
  });

  it('ignores legacy cancellation markers instead of deleting an event', async () => {
    localStorage.setItem('koc-cloud-sync-v2:user-1', JSON.stringify({
      tombstoneEventId: 'silver-koc',
    }));
    localStorage.setItem('koc-local-mutation-v2:user-1', JSON.stringify({
      cancelledEventId: 'silver-koc',
    }));

    startCloudSync('user-1');
    await settle();
    await vi.advanceTimersByTimeAsync(1_100);

    expect(cloud.rpcs).toEqual([]);
    expect(localStorage.getItem('koc-cloud-sync-v2:user-1')).toBeNull();
    expect(localStorage.getItem('koc-local-mutation-v2:user-1')).toBeNull();
  });

  it('deletes through the exact-id RPC and never issues an account-wide delete', async () => {
    const alpha = eventFixture('event-alpha', 'Alpha');
    const bravo = eventFixture('event-bravo', 'Bravo');
    cloud.setEvents([remoteRow(alpha), remoteRow(bravo)]);
    startCloudSync('user-1');
    await settle();

    await deleteCloudEvent(alpha.id);
    await settle();

    expect(cloud.rpcs).toEqual([alpha.id]);
    expect((await listLocalEventRecords()).find((record) => record.id === bravo.id)).toBeTruthy();
    expect(localStorage.getItem('koc-cloud-sync-v3:user-1')).toContain(alpha.id);
  });

  it('applies realtime updates only to their matching catalog record', async () => {
    const alpha = eventFixture('event-alpha', 'Alpha');
    const bravo = eventFixture('event-bravo', 'Bravo');
    await saveLocal(alpha, Date.parse('2026-08-29T10:00:00.000Z'));
    await saveLocal(bravo, Date.parse('2026-08-29T10:00:00.000Z'));
    cloud.setEvents([remoteRow(alpha), remoteRow(bravo)]);
    useEventCatalogStore.setState({ activeEventId: alpha.id });
    useEventStore.setState({ event: alpha });
    startCloudSync('user-1');
    await settle();

    const updatedBravo = { ...bravo, name: 'Bravo remotely edited' };
    cloud.emit('events', {
      eventType: 'UPDATE',
      old: {},
      new: remoteRow(updatedBravo, '2026-08-29T11:00:00.000Z'),
    });
    await settle();

    expect(useEventStore.getState().event?.id).toBe(alpha.id);
    expect(
      (await listLocalEventRecords()).find((record) => record.id === bravo.id)?.state.name,
    ).toBe('Bravo remotely edited');
  });

  it('removes only the tombstoned event and keeps the active event intact', async () => {
    const alpha = eventFixture('event-alpha', 'Alpha');
    const bravo = eventFixture('event-bravo', 'Bravo');
    await saveLocal(alpha);
    await saveLocal(bravo);
    cloud.setEvents([remoteRow(alpha), remoteRow(bravo)]);
    useEventCatalogStore.setState({ activeEventId: alpha.id });
    useEventStore.setState({ event: alpha });
    startCloudSync('user-1');
    await settle();

    cloud.emit('event_tombstones', {
      eventType: 'INSERT',
      old: {},
      new: {
        event_id: bravo.id,
        deleted_at: '2026-08-29T11:00:00.000Z',
      },
    });
    await settle();

    expect(useEventStore.getState().event?.id).toBe(alpha.id);
    expect((await listLocalEventRecords()).find((record) => record.id === bravo.id)).toBeUndefined();
    expect((await listLocalEventRecords()).find((record) => record.id === alpha.id)).toBeTruthy();
  });

  it('does not turn legacy cancellation markers into exact-id deletions', async () => {
    const preserved = eventFixture('legacy-preserved-event', 'Preserved event');
    await saveLocal(preserved);
    localStorage.setItem('koc-cloud-sync-v2:user-1', JSON.stringify({
      lastSyncedEventId: preserved.id,
      tombstoneEventId: preserved.id,
    }));
    localStorage.setItem('koc-local-mutation-v2:user-1', JSON.stringify({
      cancelledEventId: preserved.id,
    }));

    startCloudSync('user-1');
    await settle();
    await vi.advanceTimersByTimeAsync(1_100);
    await settle();

    expect(cloud.rpcs).toEqual([]);
    expect((await listLocalEventRecords()).find((record) => record.id === preserved.id))
      .toBeTruthy();
    expect(localStorage.getItem('koc-cloud-sync-v2:user-1')).toBeNull();
    expect(localStorage.getItem('koc-local-mutation-v2:user-1')).toBeNull();
  });

  it('does not upload another account\'s local catalog during bootstrap', async () => {
    const accountA = eventFixture('account-a-local-event', 'Account A local event');
    const accountB = eventFixture('account-b-remote-event', 'Account B remote event');
    await saveLocal(accountA);
    localStorage.setItem('koc-local-mutation-v3:account-a', JSON.stringify({
      dirtyById: {
        [accountA.id]: { fingerprint: JSON.stringify(accountA), changedAt: Date.now() },
      },
      tombstonesById: {},
    }));
    cloud.setEvents([remoteRow(accountB)]);

    startCloudSync('account-b');
    await settle();
    await vi.advanceTimersByTimeAsync(1_100);
    await settle();

    expect(cloud.upserts.some((row) => row.id === accountA.id)).toBe(false);
    expect((await listLocalEventRecords()).map((record) => record.id)).toEqual(
      expect.arrayContaining([accountA.id, accountB.id]),
    );
  });

  it('does not cloud-upsert an event merely because it was selected', async () => {
    const alpha = eventFixture('pure-selection-alpha', 'Alpha');
    const bravo = eventFixture('pure-selection-bravo', 'Bravo');
    const remoteAt = Date.parse('2026-08-29T10:00:00.000Z');
    await saveLocal(alpha, remoteAt);
    await saveLocal(bravo, remoteAt);
    cloud.setEvents([remoteRow(alpha), remoteRow(bravo)]);
    useEventCatalogStore.setState({ activeEventId: alpha.id });
    useEventStore.setState({ event: alpha });

    startCloudSync('user-1');
    await settle();
    await useEventStore.getState().selectEventById(bravo.id);
    await vi.advanceTimersByTimeAsync(1_100);
    await settle();

    expect(useEventStore.getState().event?.id).toBe(bravo.id);
    expect(cloud.upserts.some((row) => row.id === bravo.id)).toBe(false);
    expect(cloud.rpcs).toEqual([]);
  });

  it('keeps an edit made while the initial pull is pending', async () => {
    const alpha = eventFixture('pending-pull-alpha', 'Before edit');
    const remoteAt = Date.parse('2026-08-29T10:00:00.000Z');
    await saveLocal(alpha, remoteAt);
    await useEventStore.getState().selectEventById(alpha.id);

    let resolvePull: (result: { data: unknown[]; error: null }) => void = () => undefined;
    cloud.setEventQueryImpl(() => new Promise((resolve) => {
      resolvePull = resolve;
    }));

    startCloudSync('user-1');
    await settle();
    const edited = { ...alpha, name: 'Edited while connecting' };
    useEventStore.setState({ event: edited });
    await settle();

    resolvePull({ data: [remoteRow(alpha)], error: null });
    await settle();
    await vi.advanceTimersByTimeAsync(1_100);
    await settle();

    expect(cloud.upserts).toHaveLength(1);
    expect((cloud.upserts[0].state as EventState).name).toBe(edited.name);
  });

  it('does not let a stopped delete session erase a newer event dirty marker', async () => {
    const alpha = eventFixture('late-delete-alpha', 'Delete me');
    const bravo = eventFixture('late-delete-bravo', 'Keep my pending edit');
    cloud.setEvents([remoteRow(alpha)]);
    startCloudSync('user-1');
    await settle();

    let resolveDelete: (result: { data: unknown; error: null }) => void = () => undefined;
    cloud.setRpcImpl(() => new Promise((resolve) => {
      resolveDelete = resolve;
    }));
    const deleting = deleteCloudEvent(alpha.id);
    await settle();
    expect(cloud.rpcs).toEqual([alpha.id]);
    stopCloudSync();

    cloud.setEvents([]);
    await saveLocal(bravo);
    startCloudSync('user-1');
    await settle();
    useEventStore.setState({ event: bravo });
    await settle();
    stopCloudSync();
    expect(localStorage.getItem('koc-cloud-sync-v3:user-1')).toContain(bravo.id);

    resolveDelete({ data: '2026-08-29T12:00:00.000Z', error: null });
    await deleting;
    await settle();
    expect(localStorage.getItem('koc-cloud-sync-v3:user-1')).toContain(bravo.id);

    startCloudSync('user-1');
    await settle();
    await vi.advanceTimersByTimeAsync(1_100);
    await settle();

    expect(cloud.upserts.some((row) => row.id === bravo.id)).toBe(true);
  });

  it('retries pending exact deletes and dirty saves even when the initial pull fails', async () => {
    const alpha = eventFixture('offline-delete-alpha', 'Delete offline');
    const bravo = eventFixture('offline-save-bravo', 'Save offline');
    await saveLocal(bravo);
    localStorage.setItem('koc-cloud-sync-v3:user-1', JSON.stringify({
      dirtyById: {
        [bravo.id]: { fingerprint: JSON.stringify(bravo), changedAt: Date.now() },
      },
      tombstonesById: {
        [alpha.id]: { deletedAt: Date.now(), pending: true },
      },
      remoteUpdatedAtById: {},
    }));
    cloud.setEventsError('network unavailable');

    startCloudSync('user-1');
    await settle();
    await vi.advanceTimersByTimeAsync(1_100);
    await settle();

    expect(cloud.rpcs).toContain(alpha.id);
    expect(cloud.upserts.some((row) => row.id === bravo.id)).toBe(true);
  });

  it('bounds a flush even while the initial cloud pull never resolves', async () => {
    cloud.setEventQueryImpl(() => new Promise(() => undefined));
    startCloudSync('user-1');
    await settle();

    const flush = flushCloudSync();
    await vi.advanceTimersByTimeAsync(4_100);
    await expect(flush).resolves.toMatchObject({ ok: false });
  });

  it('applies a clean active remote state without echoing it as a local upsert', async () => {
    const alpha = eventFixture('clean-active-alpha', 'Old local name');
    const updated = { ...alpha, name: 'Cloud name' };
    const localAt = Date.parse('2026-08-29T10:00:00.000Z');
    await saveLocal(alpha, localAt);
    await useEventStore.getState().selectEventById(alpha.id);
    cloud.setEvents([remoteRow(updated, '2026-08-29T11:00:00.000Z')]);

    startCloudSync('user-1');
    await settle();
    await vi.advanceTimersByTimeAsync(1_100);
    await settle();

    expect(useEventStore.getState().event?.name).toBe(updated.name);
    expect(cloud.upserts).toEqual([]);
  });

  it('does not resurrect an event when a tombstone arrives before the initial pull', async () => {
    const alpha = eventFixture('tombstone-first-alpha', 'Stale cloud event');
    await saveLocal(alpha);
    let resolvePull: (result: { data: unknown[]; error: null }) => void = () => undefined;
    cloud.setEventQueryImpl(() => new Promise((resolve) => {
      resolvePull = resolve;
    }));

    startCloudSync('user-1');
    await settle();
    cloud.emit('event_tombstones', {
      eventType: 'INSERT',
      old: {},
      new: {
        event_id: alpha.id,
        deleted_at: '2026-08-29T11:00:00.000Z',
      },
    });
    await settle();
    resolvePull({ data: [remoteRow(alpha)], error: null });
    await settle();
    await vi.advanceTimersByTimeAsync(1_100);

    expect((await listLocalEventRecords()).some((record) => record.id === alpha.id)).toBe(false);
    expect(cloud.upserts).toEqual([]);
  });

  it('rejects realtime state while a local edit is waiting to save', async () => {
    const alpha = eventFixture('dirty-realtime-alpha', 'Original');
    const remoteAt = Date.parse('2026-08-29T10:00:00.000Z');
    await saveLocal(alpha, remoteAt);
    cloud.setEvents([remoteRow(alpha)]);
    await useEventStore.getState().selectEventById(alpha.id);
    startCloudSync('user-1');
    await settle();

    const edited = { ...alpha, name: 'Local court edit' };
    useEventStore.setState({ event: edited });
    cloud.emit('events', {
      eventType: 'UPDATE',
      old: {},
      new: remoteRow({ ...alpha, name: 'Stale remote echo' }, '2026-08-29T11:00:00.000Z'),
    });
    await settle();

    expect(useEventStore.getState().event?.name).toBe(edited.name);
    await vi.advanceTimersByTimeAsync(1_100);
    await settle();
    expect((cloud.upserts.at(-1)?.state as EventState).name).toBe(edited.name);
  });

  it('serializes snapshots of the same id so an older write cannot finish last', async () => {
    const alpha = eventFixture('event-alpha', 'Alpha');
    await saveLocal(alpha);
    cloud.setEvents([remoteRow(alpha)]);
    useEventCatalogStore.setState({ activeEventId: alpha.id });
    useEventStore.setState({ event: alpha });
    startCloudSync('user-1');
    await settle();

    const resolvers: Array<() => void> = [];
    cloud.setUpsertImpl(() => new Promise((resolve) => {
      resolvers.push(() => resolve({ error: null }));
    }));

    const first = { ...alpha, name: 'First edit' };
    useEventStore.setState({ event: first });
    await vi.advanceTimersByTimeAsync(1_100);
    expect(cloud.upserts).toHaveLength(1);

    const second = { ...alpha, name: 'Second edit' };
    useEventStore.setState({ event: second });
    await vi.advanceTimersByTimeAsync(1_100);
    expect(cloud.upserts).toHaveLength(1);

    resolvers[0]();
    await settle();
    expect(cloud.upserts).toHaveLength(2);
    expect((cloud.upserts[1].state as EventState).name).toBe('Second edit');
    resolvers[1]();
    await settle();
  });

  it('keeps a stale Americano draft locally when the server returns a revision conflict', async () => {
    const event = { ...americanoV2Fixture(), id: 'versioned-conflict', revision: '4', name: 'Local draft' };
    await saveLocal(event as unknown as EventState);
    useEventStore.setState({ event: event as never });
    americanoCloud.save.mockResolvedValue({
      status: 'conflict', requestId: 'server-request', code: 'EVENT_REVISION_CONFLICT',
      snapshot: { event: { id: event.id, protocolVersion: 2, revision: '5', updatedAt: new Date().toISOString(), state: { ...event, revision: '5', name: 'Remote draft' } }, signup: null },
    });

    startCloudSync('user-1');
    await settle();
    markLocalEventMutation(event, null);
    const result = await flushCloudSync();
    await settle();

    expect(result.ok).toBe(false);
    expect(useCloudSyncStatus.getState().error).toMatch(/another device/i);
    expect((await listLocalEventRecords()).find((row) => row.id === event.id)?.state.name).toBe('Local draft');
    expect(localStorage.getItem('koc-cloud-sync-v3:user-1')).toContain(event.id);
  });

  it('does not discard a newer Americano edit when an earlier save is acknowledged', async () => {
    const original = { ...americanoV2Fixture(), id: 'versioned-in-flight', revision: '3', name: 'First local edit' };
    await saveLocal(original as unknown as EventState);
    useEventStore.setState({ event: original as never });
    let resolveSave: (value: unknown) => void = () => undefined;
    americanoCloud.save.mockImplementationOnce(() => new Promise((resolve) => { resolveSave = resolve; }));
    americanoCloud.save.mockImplementationOnce(async (next: typeof original) => ({
      status: 'applied', requestId: 'second-save', committedEventRevision: '5',
      snapshot: { event: { id: next.id, protocolVersion: 2, revision: '5', updatedAt: new Date().toISOString(), state: { ...next, revision: '5' } }, signup: null },
    }));

    startCloudSync('user-1');
    await settle();
    markLocalEventMutation(original, null);
    await vi.advanceTimersByTimeAsync(1_100);
    expect(americanoCloud.save).toHaveBeenCalledTimes(1);

    const newer = { ...original, name: 'Second local edit' };
    useEventStore.setState({ event: newer as never });
    markLocalEventMutation(newer, null);
    resolveSave({
      status: 'applied', requestId: 'first-save', committedEventRevision: '4',
      snapshot: { event: { id: original.id, protocolVersion: 2, revision: '4', updatedAt: new Date().toISOString(), state: { ...original, revision: '4' } }, signup: null },
    });
    await settle();
    await vi.advanceTimersByTimeAsync(1_100);
    await settle();

    expect(americanoCloud.save).toHaveBeenCalledTimes(2);
    expect(americanoCloud.save.mock.calls[1][0].name).toBe('Second local edit');
    expect(useEventStore.getState().event?.name).toBe('Second local edit');
  });

  it('deletes protocol-2 Americano events through the versioned tombstone RPC', async () => {
    const event = { ...americanoV2Fixture(), id: 'versioned-delete', revision: '9' };
    await saveLocal(event as unknown as EventState);
    useEventStore.setState({ event: event as never });
    americanoCloud.remove.mockResolvedValue({
      status: 'applied', requestId: 'delete-request', eventId: event.id, deletedAt: new Date().toISOString(),
    });
    startCloudSync('user-1');
    await settle();

    await deleteCloudEvent(event.id);
    await settle();

    expect(americanoCloud.remove).toHaveBeenCalledWith(expect.objectContaining({ eventId: event.id, baseEventRevision: '9' }));
    expect(cloud.rpcs).toEqual([]);
    expect(localStorage.getItem('koc-cloud-sync-v3:user-1')).toContain('"pending":false');
    // Local removal is deliberately owned by eventStore.deleteLocalEvent so a
    // failed remote request cannot erase the only recoverable draft.
    expect((await listLocalEventRecords()).find((row) => row.id === event.id)).toBeTruthy();
  });
});
