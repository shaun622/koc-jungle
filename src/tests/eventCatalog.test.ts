import { describe, expect, it } from 'vitest';
import {
  ACTIVE_EVENT_STORAGE_KEY,
  LEGACY_EVENT_STORAGE_KEY,
  LEGACY_IMPORT_STORAGE_KEY,
  createEventCatalogStore,
} from '@/store/eventCatalog';
import {
  MemoryEventRepository,
  createEventRepository,
  type EventCatalogRecord,
} from '@/store/eventRepository';
import { DEFAULT_SETTINGS, type EventState } from '@/types/domain';

class TestStorage implements Storage {
  private readonly values = new Map<string, string>();

  get length(): number {
    return this.values.size;
  }

  clear(): void {
    this.values.clear();
  }

  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }

  key(index: number): string | null {
    return Array.from(this.values.keys())[index] ?? null;
  }

  removeItem(key: string): void {
    this.values.delete(key);
  }

  setItem(key: string, value: string): void {
    this.values.set(key, value);
  }
}

function makeEvent(id: string, name = id, createdAt = 100): EventState {
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
    format: 'americano',
    formatConfig: { rounds: 7 },
  };
}

function makeRecord(event: EventState, updatedAt = event.createdAt): EventCatalogRecord {
  return {
    id: event.id,
    state: event,
    createdAt: event.createdAt,
    updatedAt,
    archivedAt: null,
  };
}

describe('local event repository', () => {
  it('falls back to isolated memory storage when IndexedDB is unavailable', async () => {
    const repository = createEventRepository(undefined);
    expect(repository).toBeInstanceOf(MemoryEventRepository);

    const original = makeEvent('event-a', 'Original');
    await repository.put(makeRecord(original));
    const loaded = await repository.get(original.id);
    expect(loaded?.state).toEqual(original);

    loaded!.state.name = 'Changed outside the repository';
    expect((await repository.get(original.id))?.state.name).toBe('Original');
  });

  it('keeps one independently replaceable record per event id', async () => {
    const repository = new MemoryEventRepository();
    const first = makeEvent('event-a', 'First');
    const second = makeEvent('event-b', 'Second');
    await repository.put(makeRecord(first, 100));
    await repository.put(makeRecord(second, 200));
    await repository.put(makeRecord({ ...first, name: 'First edited' }, 300));

    expect(await repository.list()).toHaveLength(2);
    expect((await repository.get(first.id))?.state.name).toBe('First edited');
    expect((await repository.get(second.id))?.state.name).toBe('Second');
  });
});

describe('local event catalog', () => {
  it('imports the exact legacy event once and leaves the legacy key untouched', async () => {
    const repository = new MemoryEventRepository();
    const storage = new TestStorage();
    const legacyEvent = makeEvent('legacy-event', 'Legacy event', 123);
    const rawLegacyPayload = JSON.stringify({
      state: { event: legacyEvent },
      version: 1,
    });
    storage.setItem(LEGACY_EVENT_STORAGE_KEY, rawLegacyPayload);

    const catalog = createEventCatalogStore(repository, storage);
    await catalog.getState().initialize();
    await catalog.getState().initialize();

    expect((await repository.get(legacyEvent.id))?.state).toEqual(legacyEvent);
    expect(await repository.list()).toHaveLength(1);
    expect(storage.getItem(LEGACY_EVENT_STORAGE_KEY)).toBe(rawLegacyPayload);
    expect(storage.getItem(LEGACY_IMPORT_STORAGE_KEY)).toBe('1');
    expect(storage.getItem(ACTIVE_EVENT_STORAGE_KEY)).toBe(legacyEvent.id);

    await catalog.getState().deleteLocalEvent(legacyEvent.id);
    const reloadedCatalog = createEventCatalogStore(repository, storage);
    await reloadedCatalog.getState().initialize();
    expect(await repository.list()).toEqual([]);
    expect(reloadedCatalog.getState().activeEventId).toBeNull();
    expect(storage.getItem(LEGACY_EVENT_STORAGE_KEY)).toBe(rawLegacyPayload);
  });

  it('saves metadata, loads without selecting, selects, archives and deletes', async () => {
    const repository = new MemoryEventRepository();
    const storage = new TestStorage();
    storage.setItem(LEGACY_IMPORT_STORAGE_KEY, '1');
    const catalog = createEventCatalogStore(repository, storage);
    await catalog.getState().initialize();

    const first = makeEvent('event-a', 'Monday Night', 100);
    const second = makeEvent('event-b', 'Friday Night', 200);
    await catalog.getState().saveEvent(first, { updatedAt: 300 });
    await catalog.getState().saveEvent(second, { updatedAt: 400, makeActive: false });

    expect(catalog.getState().activeEventId).toBe(first.id);
    expect(catalog.getState().events.map(({ id }) => id)).toEqual([second.id, first.id]);
    expect(catalog.getState().events[0]).toMatchObject({
      id: second.id,
      name: 'Friday Night',
      venue: 'Jungle Padel',
      status: 'setup',
      archivedAt: null,
    });
    expect((await catalog.getState().loadEvent(second.id))?.id).toBe(second.id);
    expect(catalog.getState().activeEventId).toBe(first.id);

    expect((await catalog.getState().selectEvent(second.id))?.id).toBe(second.id);
    expect(catalog.getState().activeEventId).toBe(second.id);
    await catalog.getState().archiveEvent(second.id);
    expect(catalog.getState().events.find(({ id }) => id === second.id)?.archivedAt).not.toBeNull();
    expect(catalog.getState().activeEventId).toBe(first.id);

    await catalog.getState().archiveEvent(second.id, false);
    await catalog.getState().deleteLocalEvent(first.id);
    expect(catalog.getState().activeEventId).toBe(second.id);
    expect(await repository.get(first.id)).toBeNull();
    expect((await repository.get(second.id))?.state).toEqual(second);
  });

  it('works without pointer storage as well as without IndexedDB', async () => {
    const repository = createEventRepository(undefined);
    const catalog = createEventCatalogStore(repository, undefined);
    await catalog.getState().initialize();
    const event = makeEvent('memory-only');
    await catalog.getState().saveEvent(event);

    expect(catalog.getState().activeEventId).toBe(event.id);
    expect(await catalog.getState().loadEvent(event.id)).toEqual(event);
  });
});
