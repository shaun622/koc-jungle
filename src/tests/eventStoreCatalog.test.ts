import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { useEventCatalogStore } from '@/store/eventCatalog';
import { getLocalEventRecord } from '@/store/eventRepository';
import {
  STORAGE_KEY,
  flushEventCatalogPersistence,
  saveEventToLocalCatalog,
  useEventStore,
} from '@/store/eventStore';
import { DEFAULT_SETTINGS, type EventState } from '@/types/domain';

function makeEvent(id: string, name: string, createdAt: number): EventState {
  return {
    id,
    name,
    venue: 'Jungle Padel',
    createdAt,
    status: 'setup',
    settings: { ...DEFAULT_SETTINGS },
    courts: [],
    teams: [],
    rounds: [],
    format: 'koc',
    formatConfig: {},
  };
}

async function clearDefaultCatalog(): Promise<void> {
  await useEventCatalogStore.getState().initialize();
  const ids = useEventCatalogStore.getState().events.map(({ id }) => id);
  for (const id of ids) await useEventCatalogStore.getState().deleteLocalEvent(id);
  useEventStore.setState({ event: null, lastError: null });
}

describe.sequential('active event catalog facade', () => {
  beforeEach(async () => {
    await flushEventCatalogPersistence();
    await clearDefaultCatalog();
    localStorage.clear();
  });

  afterEach(async () => {
    await flushEventCatalogPersistence();
    await clearDefaultCatalog();
    localStorage.clear();
  });

  it('persists every active-event mutation and retains independent events', async () => {
    const first = makeEvent('catalog-facade-a', 'Monday', 100);
    const second = makeEvent('catalog-facade-b', 'Friday', 200);

    useEventStore.getState().loadEvent(first);
    useEventStore.getState().setEventName('Monday edited');
    useEventStore.getState().addCourt();
    await flushEventCatalogPersistence();

    const firstSnapshot = useEventStore.getState().event!;
    expect((await getLocalEventRecord(first.id))?.state).toEqual(firstSnapshot);
    expect(firstSnapshot.name).toBe('Monday edited');
    expect(firstSnapshot.courts).toHaveLength(1);

    useEventStore.getState().loadEvent(second);
    await flushEventCatalogPersistence();
    expect((await getLocalEventRecord(first.id))?.state).toEqual(firstSnapshot);
    expect((await getLocalEventRecord(second.id))?.state).toEqual(second);
  });

  it('selects, archives and deletes while keeping the active facade in sync', async () => {
    const first = makeEvent('catalog-select-a', 'Monday', 100);
    const second = makeEvent('catalog-select-b', 'Friday', 200);
    useEventStore.getState().loadEvent(first);
    useEventStore.getState().loadEvent(second);
    await flushEventCatalogPersistence();

    expect((await useEventStore.getState().selectEventById(first.id))?.id).toBe(first.id);
    expect(useEventStore.getState().event?.id).toBe(first.id);

    await useEventStore.getState().archiveLocalEvent(first.id);
    expect(useEventStore.getState().event?.id).toBe(second.id);
    expect(useEventCatalogStore.getState().events.find(({ id }) => id === first.id)?.archivedAt)
      .not.toBeNull();

    await useEventStore.getState().deleteLocalEvent(second.id);
    expect(useEventStore.getState().event).toBeNull();
    expect(await getLocalEventRecord(second.id)).toBeNull();
    expect(await getLocalEventRecord(first.id)).not.toBeNull();
  });

  it('never overwrites the legacy rollback payload with new event bodies', async () => {
    const untouchedLegacyPayload = '{"state":{"event":{"legacy":"exact"}},"version":1}';
    localStorage.setItem(STORAGE_KEY, untouchedLegacyPayload);
    const event = makeEvent('catalog-new-event', 'New event', 300);

    useEventStore.getState().loadEvent(event);
    useEventStore.getState().setEventVenue('New venue');
    await flushEventCatalogPersistence();

    expect(localStorage.getItem(STORAGE_KEY)).toBe(untouchedLegacyPayload);
    expect((await getLocalEventRecord(event.id))?.state.venue).toBe('New venue');
  });

  it('serializes delete behind queued writes so a removed event cannot reappear', async () => {
    const event = makeEvent('catalog-delete-race', 'Delete me', 400);
    useEventStore.getState().loadEvent(event);
    useEventStore.getState().setEventName('Last-second edit');

    await useEventStore.getState().deleteLocalEvent(event.id);
    await flushEventCatalogPersistence();

    expect(await getLocalEventRecord(event.id)).toBeNull();
    expect(useEventCatalogStore.getState().events.some(({ id }) => id === event.id)).toBe(false);
  });

  it('prevents a queued external upsert from recreating an exactly deleted event', async () => {
    const event = makeEvent('catalog-external-delete-race', 'Delete during sync', 450);
    useEventStore.getState().loadEvent(event);
    await flushEventCatalogPersistence();

    const incoming = { ...event, name: 'Late cross-tab snapshot' };
    const pendingSave = saveEventToLocalCatalog(incoming, { makeActive: false });
    const pendingDelete = useEventStore.getState().deleteLocalEvent(event.id);

    await Promise.all([pendingSave, pendingDelete]);
    expect(await getLocalEventRecord(event.id)).toBeNull();

    expect(await saveEventToLocalCatalog(incoming, { makeActive: false })).toBe(false);
    expect(await getLocalEventRecord(event.id)).toBeNull();
  });

  it('serializes archive behind queued writes without losing the archived state', async () => {
    const event = makeEvent('catalog-archive-race', 'Archive me', 500);
    useEventStore.getState().loadEvent(event);
    useEventStore.getState().setEventVenue('Edited just before archive');

    await useEventStore.getState().archiveLocalEvent(event.id);
    await flushEventCatalogPersistence();

    const metadata = useEventCatalogStore.getState().events.find(({ id }) => id === event.id);
    expect(metadata?.archivedAt).not.toBeNull();
    expect((await getLocalEventRecord(event.id))?.state.venue).toBe('Edited just before archive');
  });
});
