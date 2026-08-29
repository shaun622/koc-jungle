import { create } from 'zustand';
import type { EventState } from '@/types/domain';
import {
  createEventRepository,
  getLocalEventRecord,
  listLocalEventRecords,
  metadataForRecord,
  removeLocalEventRecord,
  saveLocalEventRecord,
  type EventCatalogMetadata,
  type EventCatalogRecord,
  type EventRepository,
} from './eventRepository';

export const LEGACY_EVENT_STORAGE_KEY = 'koc-event-v1';
export const ACTIVE_EVENT_STORAGE_KEY = 'koc-event-catalog-active-v1';
export const LEGACY_IMPORT_STORAGE_KEY = 'koc-event-catalog-legacy-imported-v1';

export interface SaveCatalogEventOptions {
  updatedAt?: number;
  archivedAt?: number | null;
  makeActive?: boolean;
}

export interface EventCatalogState {
  events: EventCatalogMetadata[];
  activeEventId: string | null;
  hydrated: boolean;
  lastError: string | null;

  initialize: () => Promise<void>;
  refresh: () => Promise<void>;
  loadEvent: (id: string) => Promise<EventState | null>;
  selectEvent: (id: string) => Promise<EventState | null>;
  saveEvent: (event: EventState, options?: SaveCatalogEventOptions) => Promise<void>;
  archiveEvent: (id: string, archived?: boolean) => Promise<void>;
  deleteLocalEvent: (id: string) => Promise<void>;
  clearError: () => void;
}

function defaultStorage(): Storage | undefined {
  try {
    return globalThis.localStorage;
  } catch {
    return undefined;
  }
}

function catalogError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function sortMetadata(events: EventCatalogMetadata[]): EventCatalogMetadata[] {
  return events.slice().sort((a, b) => {
    const archiveDifference = Number(a.archivedAt !== null) - Number(b.archivedAt !== null);
    if (archiveDifference) return archiveDifference;
    return b.updatedAt - a.updatedAt || b.createdAt - a.createdAt || a.id.localeCompare(b.id);
  });
}

function metadataFromRecords(records: EventCatalogRecord[]): EventCatalogMetadata[] {
  return sortMetadata(records.map(metadataForRecord));
}

function readActiveId(storage: Storage | undefined): string | null {
  try {
    return storage?.getItem(ACTIVE_EVENT_STORAGE_KEY) ?? null;
  } catch {
    return null;
  }
}

function writeActiveId(storage: Storage | undefined, id: string | null): void {
  try {
    if (id) storage?.setItem(ACTIVE_EVENT_STORAGE_KEY, id);
    else storage?.removeItem(ACTIVE_EVENT_STORAGE_KEY);
  } catch {
    // The catalog remains usable for this session when small pointer storage is
    // unavailable; event bodies are still stored in IndexedDB.
  }
}

function hasImportedLegacyEvent(storage: Storage | undefined): boolean {
  try {
    return storage?.getItem(LEGACY_IMPORT_STORAGE_KEY) === '1';
  } catch {
    return false;
  }
}

function markLegacyEventImported(storage: Storage | undefined): void {
  try {
    storage?.setItem(LEGACY_IMPORT_STORAGE_KEY, '1');
  } catch {
    // Import remains idempotent because records are keyed by the event id.
  }
}

export function parseLegacyStoredEvent(raw: string | null | undefined): EventState | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as {
      state?: { event?: unknown };
      event?: unknown;
    };
    const candidate = parsed?.state?.event ?? parsed?.event;
    if (!candidate || typeof candidate !== 'object') return null;
    const event = candidate as Partial<EventState>;
    if (
      typeof event.id !== 'string' ||
      typeof event.name !== 'string' ||
      !Array.isArray(event.courts) ||
      !Array.isArray(event.teams) ||
      !Array.isArray(event.rounds)
    ) return null;
    return candidate as EventState;
  } catch {
    return null;
  }
}

function readLegacyEvent(storage: Storage | undefined): EventState | null {
  try {
    return parseLegacyStoredEvent(storage?.getItem(LEGACY_EVENT_STORAGE_KEY));
  } catch {
    return null;
  }
}

function nextActiveId(events: EventCatalogMetadata[], excludedId?: string): string | null {
  return sortMetadata(events)
    .find((event) => event.id !== excludedId && event.archivedAt === null)?.id ?? null;
}

export function createEventCatalogStore(
  repository: EventRepository = createEventRepository(),
  pointerStorage: Storage | undefined = defaultStorage(),
) {
  let initializePromise: Promise<void> | null = null;

  return create<EventCatalogState>((set, get) => {
    const refreshFromRepository = async (): Promise<EventCatalogRecord[]> => {
      const records = await repository.list();
      set({ events: metadataFromRecords(records), lastError: null });
      return records;
    };

    const initialize = async (): Promise<void> => {
      if (get().hydrated) return;
      if (initializePromise) return initializePromise;

      initializePromise = (async () => {
        try {
          let records = await repository.list();
          const legacyEvent = hasImportedLegacyEvent(pointerStorage)
            ? null
            : readLegacyEvent(pointerStorage);
          if (legacyEvent && !records.some((record) => record.id === legacyEvent.id)) {
            const imported: EventCatalogRecord = {
              id: legacyEvent.id,
              state: legacyEvent,
              createdAt: legacyEvent.createdAt,
              updatedAt: legacyEvent.createdAt,
              archivedAt: null,
            };
            await repository.put(imported);
            records = [...records, imported];
          }
          markLegacyEventImported(pointerStorage);

          const requestedActiveId = readActiveId(pointerStorage);
          const activeEventId =
            records.some((record) => record.id === requestedActiveId)
              ? requestedActiveId
              : legacyEvent && records.some((record) => record.id === legacyEvent.id)
                ? legacyEvent.id
                : nextActiveId(metadataFromRecords(records));
          writeActiveId(pointerStorage, activeEventId);
          set({
            events: metadataFromRecords(records),
            activeEventId,
            hydrated: true,
            lastError: null,
          });
        } catch (error) {
          set({ hydrated: true, lastError: catalogError(error) });
          throw error;
        }
      })().finally(() => {
        initializePromise = null;
      });
      return initializePromise;
    };

    const ensureInitialized = async (): Promise<void> => {
      if (!get().hydrated) await initialize();
    };

    return {
      events: [],
      activeEventId: null,
      hydrated: false,
      lastError: null,

      initialize,

      async refresh() {
        await ensureInitialized();
        try {
          const records = await refreshFromRepository();
          const currentActiveId = get().activeEventId;
          if (currentActiveId && !records.some((record) => record.id === currentActiveId)) {
            const activeEventId = nextActiveId(metadataFromRecords(records));
            writeActiveId(pointerStorage, activeEventId);
            set({ activeEventId });
          }
        } catch (error) {
          set({ lastError: catalogError(error) });
          throw error;
        }
      },

      async loadEvent(id) {
        await ensureInitialized();
        try {
          const record = await repository.get(id);
          set({ lastError: null });
          return record?.state ?? null;
        } catch (error) {
          set({ lastError: catalogError(error) });
          throw error;
        }
      },

      async selectEvent(id) {
        await ensureInitialized();
        try {
          const record = await repository.get(id);
          if (!record) return null;
          writeActiveId(pointerStorage, id);
          set({ activeEventId: id, lastError: null });
          return record.state;
        } catch (error) {
          set({ lastError: catalogError(error) });
          throw error;
        }
      },

      async saveEvent(event, options = {}) {
        await ensureInitialized();
        try {
          const existing = await repository.get(event.id);
          const updatedAt = options.updatedAt
            ?? Math.max(Date.now(), (existing?.updatedAt ?? 0) + 1);
          const record: EventCatalogRecord = {
            id: event.id,
            state: event,
            createdAt: existing?.createdAt ?? event.createdAt,
            updatedAt,
            archivedAt: options.archivedAt === undefined
              ? existing?.archivedAt ?? null
              : options.archivedAt,
          };
          await repository.put(record);
          const events = sortMetadata([
            ...get().events.filter((metadata) => metadata.id !== event.id),
            metadataForRecord(record),
          ]);
          const makeActive = options.makeActive !== false;
          if (makeActive) writeActiveId(pointerStorage, event.id);
          set({
            events,
            activeEventId: makeActive ? event.id : get().activeEventId,
            lastError: null,
          });
        } catch (error) {
          set({ lastError: catalogError(error) });
          throw error;
        }
      },

      async archiveEvent(id, archived = true) {
        await ensureInitialized();
        try {
          const existing = await repository.get(id);
          if (!existing) return;
          const record: EventCatalogRecord = {
            ...existing,
            updatedAt: Math.max(Date.now(), existing.updatedAt + 1),
            archivedAt: archived ? Date.now() : null,
          };
          await repository.put(record);
          const events = sortMetadata([
            ...get().events.filter((metadata) => metadata.id !== id),
            metadataForRecord(record),
          ]);
          let activeEventId = get().activeEventId;
          if (archived && activeEventId === id) activeEventId = nextActiveId(events, id);
          writeActiveId(pointerStorage, activeEventId);
          set({ events, activeEventId, lastError: null });
        } catch (error) {
          set({ lastError: catalogError(error) });
          throw error;
        }
      },

      async deleteLocalEvent(id) {
        await ensureInitialized();
        try {
          await repository.delete(id);
          const events = get().events.filter((metadata) => metadata.id !== id);
          let activeEventId = get().activeEventId;
          if (activeEventId === id) activeEventId = nextActiveId(events, id);
          writeActiveId(pointerStorage, activeEventId);
          set({ events, activeEventId, lastError: null });
        } catch (error) {
          set({ lastError: catalogError(error) });
          throw error;
        }
      },

      clearError() {
        set({ lastError: null });
      },
    };
  });
}

/**
 * Default observable catalog. Consumers can use the React hook or its
 * `.getState()` / `.subscribe()` methods from sync and broadcast layers.
 */
export const useEventCatalogStore = createEventCatalogStore(
  {
    list: listLocalEventRecords,
    get: getLocalEventRecord,
    put: saveLocalEventRecord,
    delete: removeLocalEventRecord,
  },
  defaultStorage(),
);
