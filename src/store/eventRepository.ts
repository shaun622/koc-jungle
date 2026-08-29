import type { EventState, EventStatus, TournamentFormatId } from '@/types/domain';

export const EVENT_CATALOG_DB_NAME = 'koc-event-catalog-v1';
export const EVENT_CATALOG_STORE_NAME = 'events';

export interface EventCatalogRecord {
  id: string;
  state: EventState;
  createdAt: number;
  updatedAt: number;
  archivedAt: number | null;
}

export interface EventCatalogMetadata {
  id: string;
  name: string;
  venue: string;
  format: TournamentFormatId;
  status: EventStatus;
  createdAt: number;
  updatedAt: number;
  archivedAt: number | null;
}

export interface EventRepository {
  list(): Promise<EventCatalogRecord[]>;
  get(id: string): Promise<EventCatalogRecord | null>;
  put(record: EventCatalogRecord): Promise<void>;
  delete(id: string): Promise<void>;
}

function cloneRecord(record: EventCatalogRecord): EventCatalogRecord {
  if (typeof globalThis.structuredClone === 'function') {
    return globalThis.structuredClone(record);
  }
  return JSON.parse(JSON.stringify(record)) as EventCatalogRecord;
}

/**
 * Volatile fallback for unit tests, SSR-like environments and browsers where
 * IndexedDB is unavailable. A present-but-broken IndexedDB is not silently
 * downgraded: those errors must reach the UI rather than pretending data was
 * saved durably.
 */
export class MemoryEventRepository implements EventRepository {
  private readonly records = new Map<string, EventCatalogRecord>();

  async list(): Promise<EventCatalogRecord[]> {
    return Array.from(this.records.values(), cloneRecord);
  }

  async get(id: string): Promise<EventCatalogRecord | null> {
    const record = this.records.get(id);
    return record ? cloneRecord(record) : null;
  }

  async put(record: EventCatalogRecord): Promise<void> {
    assertRecord(record);
    this.records.set(record.id, cloneRecord(record));
  }

  async delete(id: string): Promise<void> {
    this.records.delete(id);
  }
}

class IndexedDbEventRepository implements EventRepository {
  private databasePromise: Promise<IDBDatabase> | null = null;

  constructor(private readonly factory: IDBFactory) {}

  async list(): Promise<EventCatalogRecord[]> {
    const database = await this.open();
    return requestResult<EventCatalogRecord[]>(
      database.transaction(EVENT_CATALOG_STORE_NAME, 'readonly')
        .objectStore(EVENT_CATALOG_STORE_NAME)
        .getAll(),
    ).then((records) => records.map(cloneRecord));
  }

  async get(id: string): Promise<EventCatalogRecord | null> {
    const database = await this.open();
    const result = await requestResult<EventCatalogRecord | undefined>(
      database.transaction(EVENT_CATALOG_STORE_NAME, 'readonly')
        .objectStore(EVENT_CATALOG_STORE_NAME)
        .get(id),
    );
    return result ? cloneRecord(result) : null;
  }

  async put(record: EventCatalogRecord): Promise<void> {
    assertRecord(record);
    const database = await this.open();
    const transaction = database.transaction(EVENT_CATALOG_STORE_NAME, 'readwrite');
    transaction.objectStore(EVENT_CATALOG_STORE_NAME).put(cloneRecord(record));
    await transactionComplete(transaction);
  }

  async delete(id: string): Promise<void> {
    const database = await this.open();
    const transaction = database.transaction(EVENT_CATALOG_STORE_NAME, 'readwrite');
    transaction.objectStore(EVENT_CATALOG_STORE_NAME).delete(id);
    await transactionComplete(transaction);
  }

  private open(): Promise<IDBDatabase> {
    if (this.databasePromise) return this.databasePromise;
    this.databasePromise = new Promise<IDBDatabase>((resolve, reject) => {
      const request = this.factory.open(EVENT_CATALOG_DB_NAME, 1);
      request.onupgradeneeded = () => {
        const database = request.result;
        if (!database.objectStoreNames.contains(EVENT_CATALOG_STORE_NAME)) {
          database.createObjectStore(EVENT_CATALOG_STORE_NAME, { keyPath: 'id' });
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error ?? new Error('Could not open the local event catalog.'));
      request.onblocked = () => reject(new Error('The local event catalog upgrade is blocked by another tab.'));
    });
    return this.databasePromise;
  }
}

function assertRecord(record: EventCatalogRecord): void {
  if (!record.id || record.state.id !== record.id) {
    throw new Error('Event catalog record id must match its event state id.');
  }
}

function requestResult<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('Local event catalog request failed.'));
  });
}

function transactionComplete(transaction: IDBTransaction): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error ?? new Error('Local event catalog transaction failed.'));
    transaction.onabort = () => reject(transaction.error ?? new Error('Local event catalog transaction was cancelled.'));
  });
}

export function createEventRepository(factory: IDBFactory | undefined = globalThis.indexedDB): EventRepository {
  return factory ? new IndexedDbEventRepository(factory) : new MemoryEventRepository();
}

const eventRepository = createEventRepository();

export function listLocalEventRecords(): Promise<EventCatalogRecord[]> {
  return eventRepository.list();
}

export function getLocalEventRecord(id: string): Promise<EventCatalogRecord | null> {
  return eventRepository.get(id);
}

export function saveLocalEventRecord(record: EventCatalogRecord): Promise<void> {
  return eventRepository.put(record);
}

export function removeLocalEventRecord(id: string): Promise<void> {
  return eventRepository.delete(id);
}

export function metadataForRecord(record: EventCatalogRecord): EventCatalogMetadata {
  return {
    id: record.id,
    name: record.state.name,
    venue: record.state.venue ?? '',
    format: record.state.format ?? 'koc',
    status: record.state.status,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
    archivedAt: record.archivedAt,
  };
}
