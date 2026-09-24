const DATABASE_NAME = 'koc-private-entry-drafts-v1';
const STORE_NAME = 'contacts';

interface PrivateEntryDraftRecord {
  key: string;
  eventId: string;
  entrantId: string;
  contact: string;
  updatedAt: number;
}

const memory = new Map<string, PrivateEntryDraftRecord>();

function recordKey(eventId: string, entrantId: string): string {
  return `${eventId}:${entrantId}`;
}

function openDatabase(): Promise<IDBDatabase | null> {
  if (!globalThis.indexedDB) return Promise.resolve(null);
  return new Promise((resolve, reject) => {
    const request = globalThis.indexedDB.open(DATABASE_NAME, 1);
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(STORE_NAME)) {
        const store = database.createObjectStore(STORE_NAME, { keyPath: 'key' });
        store.createIndex('eventId', 'eventId', { unique: false });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('Could not open private contact storage.'));
  });
}

function transactionDone(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error ?? new Error('Private contact storage failed.'));
    transaction.onabort = () => reject(transaction.error ?? new Error('Private contact storage was cancelled.'));
  });
}

export async function savePrivateEntryDraft(eventId: string, entrantId: string, contact: string): Promise<void> {
  const record: PrivateEntryDraftRecord = {
    key: recordKey(eventId, entrantId), eventId, entrantId, contact: contact.trim(), updatedAt: Date.now(),
  };
  const database = await openDatabase();
  if (!database) {
    if (record.contact) memory.set(record.key, record);
    else memory.delete(record.key);
    return;
  }
  const transaction = database.transaction(STORE_NAME, 'readwrite');
  if (record.contact) transaction.objectStore(STORE_NAME).put(record);
  else transaction.objectStore(STORE_NAME).delete(record.key);
  await transactionDone(transaction);
}

export async function readPrivateEntryDrafts(eventId: string): Promise<Record<string, string>> {
  const database = await openDatabase();
  if (!database) {
    return Object.fromEntries(Array.from(memory.values()).filter((record) => record.eventId === eventId).map((record) => [record.entrantId, record.contact]));
  }
  const transaction = database.transaction(STORE_NAME, 'readonly');
  const request = transaction.objectStore(STORE_NAME).index('eventId').getAll(eventId);
  const records = await new Promise<PrivateEntryDraftRecord[]>((resolve, reject) => {
    request.onsuccess = () => resolve(request.result as PrivateEntryDraftRecord[]);
    request.onerror = () => reject(request.error ?? new Error('Could not read private contacts.'));
  });
  return Object.fromEntries(records.map((record) => [record.entrantId, record.contact]));
}

export async function deletePrivateEntryDraft(eventId: string, entrantId: string): Promise<void> {
  return savePrivateEntryDraft(eventId, entrantId, '');
}

export async function deletePrivateEntryDraftsForEvent(eventId: string): Promise<void> {
  const database = await openDatabase();
  if (!database) {
    for (const [key, record] of memory) if (record.eventId === eventId) memory.delete(key);
    return;
  }
  const transaction = database.transaction(STORE_NAME, 'readwrite');
  const index = transaction.objectStore(STORE_NAME).index('eventId');
  const request = index.openKeyCursor(IDBKeyRange.only(eventId));
  request.onsuccess = () => {
    const cursor = request.result;
    if (!cursor) return;
    transaction.objectStore(STORE_NAME).delete(cursor.primaryKey);
    cursor.continue();
  };
  await transactionDone(transaction);
}
