import { act, cleanup, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  EVENT_BROADCAST_KEY,
  resetStorageBroadcastStateForTests,
  useStorageBroadcast,
} from '@/hooks/useStorageBroadcast';
import { useEventCatalogStore } from '@/store/eventCatalog';
import {
  listLocalEventRecords,
  metadataForRecord,
  removeLocalEventRecord,
  saveLocalEventRecord,
  type EventCatalogRecord,
} from '@/store/eventRepository';
import { flushEventCatalogPersistence, useEventStore } from '@/store/eventStore';
import { DEFAULT_SETTINGS, type EventState } from '@/types/domain';

function Harness({ pinnedEventId = null }: { pinnedEventId?: string | null }) {
  useStorageBroadcast(true, pinnedEventId);
  return null;
}

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

async function saveEvents(...events: EventState[]): Promise<void> {
  const records: EventCatalogRecord[] = events.map((event, index) => ({
    id: event.id,
    state: event,
    createdAt: event.createdAt,
    updatedAt: event.createdAt + index,
    archivedAt: null,
  }));
  for (const record of records) await saveLocalEventRecord(record);
  useEventCatalogStore.setState({
    events: records.map(metadataForRecord),
    hydrated: true,
    lastError: null,
  });
}

function send(message: unknown): void {
  window.dispatchEvent(new StorageEvent('storage', {
    key: EVENT_BROADCAST_KEY,
    newValue: JSON.stringify(message),
  }));
}

function sendLegacy(message: unknown): void {
  window.dispatchEvent(new StorageEvent('storage', {
    key: 'koc-event-broadcast-v2',
    newValue: JSON.stringify(message),
  }));
}

async function settle(turns = 30): Promise<void> {
  for (let index = 0; index < turns; index += 1) await Promise.resolve();
}

describe('event-scoped cross-tab broadcast', () => {
  beforeEach(async () => {
    localStorage.clear();
    resetStorageBroadcastStateForTests();
    for (const record of await listLocalEventRecords()) {
      await removeLocalEventRecord(record.id);
    }
    useEventCatalogStore.setState({
      events: [],
      activeEventId: null,
      hydrated: true,
      lastError: null,
    });
    useEventStore.setState({ event: null, hydrated: true, lastError: null });
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('orders snapshots per event so activity on B cannot suppress A', async () => {
    const alpha = eventFixture('event-alpha', 'Alpha');
    const bravo = eventFixture('event-bravo', 'Bravo');
    await saveEvents(alpha, bravo);
    useEventCatalogStore.setState({ activeEventId: alpha.id });
    useEventStore.setState({ event: alpha });
    render(<Harness />);

    const editedAlpha = { ...alpha, name: 'Alpha local edit' };
    act(() => useEventStore.setState({ event: editedAlpha }));
    const own = JSON.parse(localStorage.getItem(EVENT_BROADCAST_KEY)!) as {
      version: { at: number; source: string };
    };

    act(() => send({
      schema: 3,
      operation: 'upsert',
      eventId: alpha.id,
      event: alpha,
      version: { at: own.version.at - 1, source: 'other-tab' },
    }));
    expect(useEventStore.getState().event?.name).toBe('Alpha local edit');

    const editedBravo = { ...bravo, name: 'Bravo independent update' };
    act(() => send({
      schema: 3,
      operation: 'upsert',
      eventId: bravo.id,
      event: editedBravo,
      // Deliberately older than A; it is newer for B's independent stream.
      version: { at: own.version.at - 100, source: 'other-tab' },
    }));
    await settle();

    expect(useEventStore.getState().event?.id).toBe(alpha.id);
    expect(
      (await listLocalEventRecords()).find((record) => record.id === bravo.id)?.state.name,
    ).toBe('Bravo independent update');
  });

  it('deletes one exact id without clearing or switching an unrelated event', async () => {
    const alpha = eventFixture('event-alpha', 'Alpha');
    const bravo = eventFixture('event-bravo', 'Bravo');
    await saveEvents(alpha, bravo);
    useEventCatalogStore.setState({ activeEventId: alpha.id });
    useEventStore.setState({ event: alpha });
    render(<Harness />);

    act(() => send({
      schema: 3,
      operation: 'delete',
      eventId: bravo.id,
      version: { at: 10, source: 'other-tab' },
    }));
    await settle();

    expect(useEventStore.getState().event?.id).toBe(alpha.id);
    expect((await listLocalEventRecords()).find((record) => record.id === alpha.id)).toBeTruthy();
    expect((await listLocalEventRecords()).find((record) => record.id === bravo.id)).toBeUndefined();
  });

  it('keeps a TV pinned while still storing updates for other competitions', async () => {
    // Production event UUIDs are never reused after an exact tombstone.
    const alpha = eventFixture('pinned-event-alpha', 'Alpha');
    const bravo = eventFixture('pinned-event-bravo', 'Bravo');
    await saveEvents(alpha, bravo);
    useEventCatalogStore.setState({ activeEventId: alpha.id });
    useEventStore.setState({ event: alpha });
    render(<Harness pinnedEventId={alpha.id} />);

    act(() => {
      send({
        schema: 3,
        operation: 'select',
        eventId: bravo.id,
        version: { at: 20, source: 'other-tab' },
      });
      send({
        schema: 3,
        operation: 'upsert',
        eventId: bravo.id,
        event: { ...bravo, name: 'Bravo live' },
        version: { at: 21, source: 'other-tab' },
      });
    });
    await settle();

    expect(useEventStore.getState().event?.id).toBe(alpha.id);
    expect(
      (await listLocalEventRecords()).find((record) => record.id === bravo.id)?.state.name,
    ).toBe('Bravo live');

    act(() => send({
      schema: 3,
      operation: 'upsert',
      eventId: alpha.id,
      event: { ...alpha, name: 'Alpha live score' },
      version: { at: 22, source: 'other-tab' },
    }));
    expect(useEventStore.getState().event?.name).toBe('Alpha live score');
  });

  it('broadcasts only selection and never an upsert or delete when switching events', async () => {
    // Use ids that no earlier exact-deletion test has tombstoned. Production
    // UUIDs are never reused, and the deletion guard deliberately survives
    // for the lifetime of the page.
    const alpha = eventFixture('selection-event-alpha', 'Alpha');
    const bravo = eventFixture('selection-event-bravo', 'Bravo');
    await saveEvents(alpha, bravo);
    useEventCatalogStore.setState({ activeEventId: alpha.id });
    useEventStore.setState({ event: alpha });
    await flushEventCatalogPersistence();
    const writes: string[] = [];
    const originalSetItem = Storage.prototype.setItem;
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (
      this: Storage,
      key: string,
      value: string,
    ) {
      if (key === EVENT_BROADCAST_KEY) writes.push(value);
      return originalSetItem.call(this, key, value);
    });
    render(<Harness />);

    // Reproduce the real operator path: a last-second edit queues an IndexedDB
    // save for A, then the operator immediately opens B.
    act(() => useEventStore.getState().setEventName('Alpha just edited'));
    await act(async () => {
      await useEventStore.getState().selectEventById(bravo.id);
    });
    await flushEventCatalogPersistence();

    const messages = writes.map((value) => JSON.parse(value) as { operation: string; eventId: string });
    expect(messages.filter((message) => message.operation === 'select')).toEqual([
      expect.objectContaining({ operation: 'select', eventId: bravo.id }),
    ]);
    expect(messages.some(
      (message) => message.operation === 'upsert' && message.eventId === bravo.id,
    )).toBe(false);
    expect(messages.some((message) => message.operation === 'delete')).toBe(false);
    expect(useEventCatalogStore.getState().activeEventId).toBe(bravo.id);
    expect(useEventStore.getState().event?.id).toBe(bravo.id);
  });

  it('ignores a legacy null broadcast instead of deleting the selected competition', async () => {
    const alpha = eventFixture('event-alpha', 'Alpha');
    await saveEvents(alpha);
    useEventCatalogStore.setState({ activeEventId: alpha.id });
    useEventStore.setState({ event: alpha });
    render(<Harness />);

    act(() => sendLegacy({
      version: { at: 10, source: 'old-installed-pwa' },
      event: null,
    }));
    await settle();

    expect(useEventStore.getState().event?.id).toBe(alpha.id);
    expect(useEventCatalogStore.getState().activeEventId).toBe(alpha.id);
    expect((await listLocalEventRecords()).map((record) => record.id)).toContain(alpha.id);
  });
});
