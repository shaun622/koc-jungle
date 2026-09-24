import { publicProjection, upgradeTournamentV1, validateContactMap, validateDecimal, validateTournament } from '@/logic/tournament';
import type {
  TournamentCommandEnvelope,
  TournamentCommandReceipt,
  TournamentPrivateContacts,
  TournamentPublicProjection,
  TournamentScore,
  TournamentV1,
} from '@/logic/tournament';

export const TOURNAMENT_DB_NAME = 'koc-tournament-v1';
export const TOURNAMENT_DEMO_DB_NAME = 'koc-tournament-demo-v1';
export const TOURNAMENT_STORAGE_VERSION = 2 as const;
const DATABASE_VERSION = 2;
const RECORDS = 'records';
const AUTHORITIES = 'authorities';
const QUARANTINE = 'quarantine';
const RECOVERY = 'recovery';

export interface TournamentDrafts {
  version: 1;
  scoreByFixture: Record<string, TournamentScore>;
  formByKey: Record<string, unknown>;
  proposalByKey: Record<string, unknown>;
}

export interface TournamentLocalRecord {
  storageVersion: typeof TOURNAMENT_STORAGE_VERSION;
  key: string;
  ownerId: string;
  tournamentId: string;
  localVersion: string;
  mode: 'demo' | 'connected';
  remoteStatus: 'unpublished' | 'synced' | 'pending' | 'conflict' | 'deleted';
  acknowledged: TournamentV1;
  projected: TournamentV1;
  acknowledgedContacts: TournamentPrivateContacts;
  /** Private projected contact map; retained under this short name for UI callers. */
  contacts: TournamentPrivateContacts;
  drafts: TournamentDrafts;
  outbox: TournamentCommandEnvelope[];
  contactChangesByCommand: Record<string, Array<{ entryId: string; contact: string | null }>>;
  receipts: TournamentCommandReceipt[];
  publicProjection: TournamentPublicProjection | null;
  localTabOwner: { tabId: string; version: number; claimedAt: number } | null;
  createdAt: number;
  updatedAt: number;
}

export interface TournamentDeviceAuthority {
  key: string;
  ownerId: string;
  tournamentId: string;
  deviceId: string;
  grantedEpoch: string | null;
  capability: string | null;
  currentClaimId: string | null;
  pendingGrant: {
    action: 'begin' | 'claim' | 'takeover' | 'reopen';
    operationId: string;
    baseRevision: string;
    expectedEpoch: string;
    nonce: string;
    reason: string | null;
    acknowledgeInaccessibleWork: boolean;
    requestedAt: number;
  } | null;
  pendingRelease?: {
    operationId: string;
    baseRevision: string;
    expectedEpoch: string;
    expectedSequence: number;
    reason: string | null;
    requestedAt: number;
  } | null;
  version: number;
}

export interface TournamentInstallationIdentity {
  key: string;
  ownerId: string;
  deviceId: string;
  createdAt: number;
}

export interface TournamentQuarantineRecord {
  key: string;
  ownerId: string | null;
  tournamentId: string | null;
  quarantinedAt: number;
  reason: string;
  original: unknown;
}

export interface TournamentRecoveryBranch {
  key: string;
  kind: 'recovery-branch';
  ownerId: string;
  tournamentId: string;
  createdAt: number;
  reason: string;
  acceptance: 'known-unaccepted' | 'partially-accepted' | 'unknown';
  local: TournamentLocalRecord;
  remoteSnapshot: TournamentV1 | null;
}

export interface TournamentPendingOperation {
  key: string;
  kind: 'pending-operation';
  ownerId: string;
  operationId: string;
  tournamentId: string;
  action: 'create' | 'import-copy' | 'archive' | 'unarchive' | 'delete';
  request: Record<string, unknown>;
  createdAt: number;
}

export interface TournamentMutationOptions {
  expectedLocalVersion: string;
  tabId: string | null;
  /** Immutable operation time, computed before entering the storage transaction. */
  now: number;
}

export interface TournamentRepository {
  list(ownerId: string): Promise<TournamentLocalRecord[]>;
  get(ownerId: string, tournamentId: string): Promise<TournamentLocalRecord | null>;
  create(record: TournamentLocalRecord): Promise<TournamentLocalRecord>;
  mutate(ownerId: string, tournamentId: string, options: TournamentMutationOptions, mutation: (record: TournamentLocalRecord) => TournamentLocalRecord): Promise<TournamentLocalRecord>;
  delete(ownerId: string, tournamentId: string, options: TournamentMutationOptions): Promise<void>;
  claimTab(ownerId: string, tournamentId: string, expectedFenceVersion: number, tabId: string, now: number): Promise<TournamentLocalRecord | null>;
  getOrCreateInstallationDeviceId(ownerId: string, candidateDeviceId: string, now: number): Promise<string>;
  getAuthority(ownerId: string, tournamentId: string, deviceId: string): Promise<TournamentDeviceAuthority | null>;
  mutateAuthority(ownerId: string, tournamentId: string, deviceId: string, expectedVersion: number | null, mutation: (current: TournamentDeviceAuthority | null) => TournamentDeviceAuthority, now: number): Promise<TournamentDeviceAuthority>;
  deleteAuthority(ownerId: string, tournamentId: string, deviceId: string, expectedVersion: number): Promise<void>;
  createRecoveryBranch(branch: TournamentRecoveryBranch): Promise<void>;
  listRecoveryBranches(ownerId: string, tournamentId?: string): Promise<TournamentRecoveryBranch[]>;
  putPendingOperation(operation: TournamentPendingOperation): Promise<void>;
  getPendingOperation(ownerId: string, operationId: string): Promise<TournamentPendingOperation | null>;
  listPendingOperations(ownerId: string): Promise<TournamentPendingOperation[]>;
  deletePendingOperation(ownerId: string, operationId: string): Promise<void>;
  listQuarantine(): Promise<TournamentQuarantineRecord[]>;
}

const recordKey = (ownerId: string, tournamentId: string) => `${ownerId}:${tournamentId}`;
const authorityKey = (ownerId: string, tournamentId: string, deviceId: string) => `${ownerId}:${tournamentId}:${deviceId}`;
const installationKey = (ownerId: string) => `installation:${ownerId}`;
const clone = <T,>(value: T): T => typeof structuredClone === 'function'
  ? structuredClone(value)
  : JSON.parse(JSON.stringify(value)) as T;

function assertRecord(record: TournamentLocalRecord): TournamentLocalRecord {
  if (record.storageVersion !== TOURNAMENT_STORAGE_VERSION) throw new Error('Tournament cache storage version is unsupported.');
  if (record.key !== recordKey(record.ownerId, record.tournamentId)) throw new Error('Tournament cache key does not match its owner and tournament.');
  if (record.acknowledged.id !== record.tournamentId || record.projected.id !== record.tournamentId) throw new Error('Tournament cache contains a mismatched snapshot.');
  validateDecimal(record.localVersion, 'localVersion');
  validateTournament(record.acknowledged);
  validateTournament(record.projected);
  validateContactMap(record.acknowledged, record.acknowledgedContacts);
  validateContactMap(record.projected, record.contacts);
  if (record.drafts.version !== 1) throw new Error('Tournament draft version is unsupported.');
  return record;
}

export function createTournamentRecord(ownerId: string, state: TournamentV1, now = Date.now(), mode: 'demo' | 'connected' = 'demo'): TournamentLocalRecord {
  validateTournament(state);
  return {
    storageVersion: TOURNAMENT_STORAGE_VERSION,
    key: recordKey(ownerId, state.id), ownerId, tournamentId: state.id, localVersion: '0', mode,
    remoteStatus: mode === 'demo' ? 'unpublished' : 'pending',
    acknowledged: clone(state), projected: clone(state), acknowledgedContacts: {}, contacts: {},
    drafts: { version: 1, scoreByFixture: {}, formByKey: {}, proposalByKey: {} }, outbox: [], contactChangesByCommand: {}, receipts: [],
    publicProjection: state.meta.publicSlug ? publicProjection(state) : null,
    localTabOwner: null, createdAt: now, updatedAt: now,
  };
}

function upgradeRecord(value: unknown): TournamentLocalRecord {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Tournament cache record is not an object.');
  const legacy = clone(value as Record<string, unknown>) as Partial<TournamentLocalRecord> & Record<string, unknown>;
  const acknowledged = upgradeTournamentV1(legacy.acknowledged);
  const projected = upgradeTournamentV1(legacy.projected ?? legacy.acknowledged);
  const ownerId = String(legacy.ownerId ?? ''); const tournamentId = String(legacy.tournamentId ?? projected.id);
  const upgraded: TournamentLocalRecord = {
    storageVersion: TOURNAMENT_STORAGE_VERSION,
    key: recordKey(ownerId, tournamentId), ownerId, tournamentId,
    localVersion: typeof legacy.localVersion === 'string' ? legacy.localVersion : '0',
    mode: legacy.mode === 'connected' ? 'connected' : 'demo',
    remoteStatus: ['unpublished', 'synced', 'pending', 'conflict', 'deleted'].includes(String(legacy.remoteStatus)) ? legacy.remoteStatus as TournamentLocalRecord['remoteStatus'] : 'unpublished',
    acknowledged, projected,
    acknowledgedContacts: clone(legacy.acknowledgedContacts ?? {}),
    contacts: clone(legacy.contacts ?? {}),
    drafts: {
      version: 1,
      scoreByFixture: clone(legacy.drafts?.scoreByFixture ?? {}),
      formByKey: clone(legacy.drafts?.formByKey ?? {}),
      proposalByKey: clone(legacy.drafts?.proposalByKey ?? {}),
    },
    outbox: clone(legacy.outbox ?? []), contactChangesByCommand: clone(legacy.contactChangesByCommand ?? {}), receipts: clone(legacy.receipts ?? []),
    publicProjection: legacy.publicProjection ? clone(legacy.publicProjection) : projected.meta.publicSlug ? publicProjection(projected) : null,
    localTabOwner: legacy.localTabOwner ? clone(legacy.localTabOwner) : null,
    createdAt: Number(legacy.createdAt ?? projected.createdAt), updatedAt: Number(legacy.updatedAt ?? projected.updatedAt),
  };
  return assertRecord(upgraded);
}

export class MemoryTournamentRepository implements TournamentRepository {
  private records = new Map<string, TournamentLocalRecord>();
  private authorities = new Map<string, TournamentDeviceAuthority>();
  private quarantined = new Map<string, TournamentQuarantineRecord>();
  private recoveries = new Map<string, TournamentRecoveryBranch>();
  private operations = new Map<string, TournamentPendingOperation>();
  private queues = new Map<string, Promise<unknown>>();

  async list(ownerId: string) { return [...this.records.values()].filter((record) => record.ownerId === ownerId).map((record) => clone(assertRecord(record))); }
  async get(ownerId: string, tournamentId: string) { const value = this.records.get(recordKey(ownerId, tournamentId)); return value ? clone(assertRecord(value)) : null; }
  async create(record: TournamentLocalRecord) {
    return this.serial(record.key, () => {
      if (this.records.has(record.key)) throw new Error('Tournament already exists on this device.');
      const next = clone(assertRecord(record)); this.records.set(next.key, next); return clone(next);
    });
  }
  async mutate(ownerId: string, tournamentId: string, options: TournamentMutationOptions, mutation: (record: TournamentLocalRecord) => TournamentLocalRecord) {
    const key = recordKey(ownerId, tournamentId);
    return this.serial(key, () => {
      const current = this.records.get(key); if (!current) throw new Error('Tournament not found on this device.');
      const next = mutateRecord(current, options, mutation); this.records.set(key, next); return clone(next);
    });
  }
  async delete(ownerId: string, tournamentId: string, options: TournamentMutationOptions) {
    const key = recordKey(ownerId, tournamentId);
    await this.serial(key, () => { const current = this.records.get(key); if (!current) return; assertMutationFence(current, options); this.records.delete(key); });
  }
  async claimTab(ownerId: string, tournamentId: string, expectedFenceVersion: number, tabId: string, now: number) {
    const key = recordKey(ownerId, tournamentId);
    return this.serial(key, () => {
      const current = this.records.get(key); if (!current || (current.localTabOwner?.version ?? 0) !== expectedFenceVersion) return null;
      const next = clone(current); next.localTabOwner = { tabId, version: expectedFenceVersion + 1, claimedAt: now }; next.localVersion = incrementDecimal(next.localVersion); next.updatedAt = now;
      this.records.set(key, assertRecord(next)); return clone(next);
    });
  }
  async getOrCreateInstallationDeviceId(ownerId: string, candidateDeviceId: string, now: number) {
    const key = installationKey(ownerId);
    return this.serial(key, () => {
      const current = this.authorities.get(key) as unknown as TournamentInstallationIdentity | undefined;
      if (current) return current.deviceId;
      this.authorities.set(key, clone({ key, ownerId, deviceId: candidateDeviceId, createdAt: now }) as unknown as TournamentDeviceAuthority);
      return candidateDeviceId;
    });
  }
  async getAuthority(ownerId: string, tournamentId: string, deviceId: string) { return clone(this.authorities.get(authorityKey(ownerId, tournamentId, deviceId)) ?? null); }
  async mutateAuthority(ownerId: string, tournamentId: string, deviceId: string, expectedVersion: number | null, mutation: (current: TournamentDeviceAuthority | null) => TournamentDeviceAuthority, _now: number) {
    const key = authorityKey(ownerId, tournamentId, deviceId);
    return this.serial(key, () => {
      const current = this.authorities.get(key) ?? null;
      if ((current?.version ?? null) !== expectedVersion) throw new Error('Tournament authority changed on this device. Reload and retry.');
      const proposed = clone(mutation(clone(current)));
      if (proposed.key !== key || proposed.ownerId !== ownerId || proposed.tournamentId !== tournamentId || proposed.deviceId !== deviceId) throw new Error('Tournament authority identity changed.');
      proposed.version = (current?.version ?? 0) + 1;
      this.authorities.set(key, proposed); return clone(proposed);
    });
  }
  async deleteAuthority(ownerId: string, tournamentId: string, deviceId: string, expectedVersion: number) {
    const key = authorityKey(ownerId, tournamentId, deviceId);
    await this.serial(key, () => { const current = this.authorities.get(key); if (!current || current.version !== expectedVersion) throw new Error('Tournament authority changed on this device.'); this.authorities.delete(key); });
  }
  async createRecoveryBranch(branch: TournamentRecoveryBranch) { if (this.recoveries.has(branch.key)) throw new Error('Recovery branch already exists.'); this.recoveries.set(branch.key, clone(branch)); }
  async listRecoveryBranches(ownerId: string, tournamentId?: string) { return [...this.recoveries.values()].filter((branch) => branch.ownerId === ownerId && (!tournamentId || branch.tournamentId === tournamentId)).map((branch) => clone(branch)); }
  async putPendingOperation(operation: TournamentPendingOperation) {
    const current = this.operations.get(operation.key);
    if (current && JSON.stringify(current) !== JSON.stringify(operation)) throw new Error('Pending operation ID was already used.');
    this.operations.set(operation.key, clone(operation));
  }
  async getPendingOperation(ownerId: string, operationId: string) { return clone(this.operations.get(`operation:${ownerId}:${operationId}`) ?? null); }
  async listPendingOperations(ownerId: string) { return [...this.operations.values()].filter((operation) => operation.ownerId === ownerId).map((operation) => clone(operation)); }
  async deletePendingOperation(ownerId: string, operationId: string) { this.operations.delete(`operation:${ownerId}:${operationId}`); }
  async listQuarantine() { return [...this.quarantined.values()].map((value) => clone(value)); }

  private serial<T>(key: string, operation: () => T | Promise<T>): Promise<T> {
    const previous = this.queues.get(key) ?? Promise.resolve();
    const next = previous.catch(() => undefined).then(operation);
    this.queues.set(key, next); next.finally(() => { if (this.queues.get(key) === next) this.queues.delete(key); }).catch(() => undefined);
    return next;
  }
}

class IndexedDbTournamentRepository implements TournamentRepository {
  private databasePromise: Promise<IDBDatabase> | null = null;
  constructor(private factory: IDBFactory, private databaseName = TOURNAMENT_DB_NAME) {}

  async list(ownerId: string) {
    const values = await this.readAll<TournamentLocalRecord>(RECORDS);
    const valid: TournamentLocalRecord[] = [];
    for (const value of values.filter((record) => record.ownerId === ownerId)) {
      try { valid.push(clone(assertRecord(value))); }
      catch (error) { await this.quarantine(value, error); }
    }
    return valid;
  }
  async get(ownerId: string, tournamentId: string) {
    const value = await this.read<TournamentLocalRecord>(RECORDS, recordKey(ownerId, tournamentId));
    if (!value) return null;
    try { return clone(assertRecord(value)); }
    catch (error) { await this.quarantine(value, error); return null; }
  }
  async create(record: TournamentLocalRecord) {
    const next = clone(assertRecord(record));
    const database = await this.open();
    return new Promise<TournamentLocalRecord>((resolve, reject) => {
      const transaction = database.transaction(RECORDS, 'readwrite'); const store = transaction.objectStore(RECORDS);
      const request = store.add(next); request.onerror = () => transaction.abort();
      transaction.oncomplete = () => resolve(clone(next)); transaction.onerror = transaction.onabort = () => reject(transaction.error ?? request.error ?? new Error('Tournament create transaction failed.'));
    });
  }
  async mutate(ownerId: string, tournamentId: string, options: TournamentMutationOptions, mutation: (record: TournamentLocalRecord) => TournamentLocalRecord) {
    const database = await this.open(); const key = recordKey(ownerId, tournamentId);
    return new Promise<TournamentLocalRecord>((resolve, reject) => {
      const transaction = database.transaction(RECORDS, 'readwrite'); const store = transaction.objectStore(RECORDS); const request = store.get(key);
      let written: TournamentLocalRecord | null = null; let failure: unknown = null;
      request.onsuccess = () => {
        try {
          const current = request.result as TournamentLocalRecord | undefined; if (!current) throw new Error('Tournament not found on this device.');
          written = mutateRecord(current, options, mutation); store.put(written);
        } catch (error) { failure = error; transaction.abort(); }
      };
      request.onerror = () => { failure = request.error; transaction.abort(); };
      transaction.oncomplete = () => resolve(clone(written!));
      transaction.onerror = transaction.onabort = () => reject(failure ?? transaction.error ?? new Error('Tournament storage transaction was cancelled.'));
    });
  }
  async delete(ownerId: string, tournamentId: string, options: TournamentMutationOptions) {
    const database = await this.open(); const key = recordKey(ownerId, tournamentId);
    await new Promise<void>((resolve, reject) => {
      const transaction = database.transaction(RECORDS, 'readwrite'); const store = transaction.objectStore(RECORDS); const request = store.get(key); let failure: unknown = null;
      request.onsuccess = () => { try { const current = request.result as TournamentLocalRecord | undefined; if (!current) return; assertMutationFence(current, options); store.delete(key); } catch (error) { failure = error; transaction.abort(); } };
      request.onerror = () => { failure = request.error; transaction.abort(); };
      transaction.oncomplete = () => resolve(); transaction.onerror = transaction.onabort = () => reject(failure ?? transaction.error ?? new Error('Tournament delete transaction failed.'));
    });
  }
  async claimTab(ownerId: string, tournamentId: string, expectedFenceVersion: number, tabId: string, now: number) {
    const current = await this.get(ownerId, tournamentId); if (!current) return null;
    try {
      return await this.mutate(ownerId, tournamentId, { expectedLocalVersion: current.localVersion, tabId: null, now }, (record) => {
        if ((record.localTabOwner?.version ?? 0) !== expectedFenceVersion) throw new Error('Local tab control changed.');
        return { ...record, localTabOwner: { tabId, version: expectedFenceVersion + 1, claimedAt: now } };
      });
    } catch { return null; }
  }
  async getOrCreateInstallationDeviceId(ownerId: string, candidateDeviceId: string, now: number) {
    const database = await this.open(); const key = installationKey(ownerId);
    return new Promise<string>((resolve, reject) => {
      const transaction = database.transaction(RECOVERY, 'readwrite'); const store = transaction.objectStore(RECOVERY); const request = store.get(key);
      let deviceId = candidateDeviceId; let failure: unknown = null;
      request.onsuccess = () => {
        try {
          const current = request.result as TournamentInstallationIdentity | undefined;
          if (current) deviceId = current.deviceId;
          else store.add({ key, ownerId, deviceId: candidateDeviceId, createdAt: now } satisfies TournamentInstallationIdentity);
        } catch (error) { failure = error; transaction.abort(); }
      };
      request.onerror = () => { failure = request.error; transaction.abort(); };
      transaction.oncomplete = () => resolve(deviceId);
      transaction.onerror = transaction.onabort = () => reject(failure ?? transaction.error ?? new Error('Tournament device identity could not be saved.'));
    });
  }
  async getAuthority(ownerId: string, tournamentId: string, deviceId: string) { return clone(await this.read<TournamentDeviceAuthority>(AUTHORITIES, authorityKey(ownerId, tournamentId, deviceId)) ?? null); }
  async mutateAuthority(ownerId: string, tournamentId: string, deviceId: string, expectedVersion: number | null, mutation: (current: TournamentDeviceAuthority | null) => TournamentDeviceAuthority) {
    const database = await this.open(); const key = authorityKey(ownerId, tournamentId, deviceId);
    return new Promise<TournamentDeviceAuthority>((resolve, reject) => {
      const transaction = database.transaction(AUTHORITIES, 'readwrite'); const store = transaction.objectStore(AUTHORITIES); const request = store.get(key);
      let written: TournamentDeviceAuthority | null = null; let failure: unknown = null;
      request.onsuccess = () => {
        try {
          const current = request.result as TournamentDeviceAuthority | undefined;
          if ((current?.version ?? null) !== expectedVersion) throw new Error('Tournament authority changed on this device. Reload and retry.');
          const proposed = clone(mutation(current ? clone(current) : null));
          if (proposed.key !== key || proposed.ownerId !== ownerId || proposed.tournamentId !== tournamentId || proposed.deviceId !== deviceId) throw new Error('Tournament authority identity changed.');
          proposed.version = (current?.version ?? 0) + 1; written = proposed; store.put(proposed);
        } catch (error) { failure = error; transaction.abort(); }
      };
      request.onerror = () => { failure = request.error; transaction.abort(); };
      transaction.oncomplete = () => resolve(clone(written!));
      transaction.onerror = transaction.onabort = () => reject(failure ?? transaction.error ?? new Error('Tournament authority transaction failed.'));
    });
  }
  async deleteAuthority(ownerId: string, tournamentId: string, deviceId: string, expectedVersion: number) {
    const database = await this.open(); const key = authorityKey(ownerId, tournamentId, deviceId);
    await new Promise<void>((resolve, reject) => {
      const transaction = database.transaction(AUTHORITIES, 'readwrite'); const store = transaction.objectStore(AUTHORITIES); const request = store.get(key); let failure: unknown = null;
      request.onsuccess = () => { const current = request.result as TournamentDeviceAuthority | undefined; if (!current || current.version !== expectedVersion) { failure = new Error('Tournament authority changed on this device.'); transaction.abort(); return; } store.delete(key); };
      request.onerror = () => { failure = request.error; transaction.abort(); };
      transaction.oncomplete = () => resolve(); transaction.onerror = transaction.onabort = () => reject(failure ?? transaction.error ?? new Error('Tournament authority delete failed.'));
    });
  }
  async createRecoveryBranch(branch: TournamentRecoveryBranch) {
    const database = await this.open();
    await new Promise<void>((resolve, reject) => {
      const transaction = database.transaction(RECOVERY, 'readwrite'); const request = transaction.objectStore(RECOVERY).add(clone(branch));
      transaction.oncomplete = () => resolve(); transaction.onerror = transaction.onabort = () => reject(transaction.error ?? request.error ?? new Error('Recovery branch could not be saved.'));
    });
  }
  async listRecoveryBranches(ownerId: string, tournamentId?: string) {
    const values = await this.readAll<TournamentRecoveryBranch | TournamentInstallationIdentity>(RECOVERY);
    return values.filter((value): value is TournamentRecoveryBranch => 'kind' in value && value.kind === 'recovery-branch' && value.ownerId === ownerId && (!tournamentId || value.tournamentId === tournamentId)).map((value) => clone(value));
  }
  async putPendingOperation(operation: TournamentPendingOperation) {
    const database = await this.open();
    await new Promise<void>((resolve, reject) => {
      const transaction = database.transaction(RECOVERY, 'readwrite'); const store = transaction.objectStore(RECOVERY); const request = store.get(operation.key); let failure: unknown = null;
      request.onsuccess = () => { const current = request.result as TournamentPendingOperation | undefined; if (current && JSON.stringify(current) !== JSON.stringify(operation)) { failure = new Error('Pending operation ID was already used.'); transaction.abort(); return; } if (!current) store.add(clone(operation)); };
      request.onerror = () => { failure = request.error; transaction.abort(); };
      transaction.oncomplete = () => resolve(); transaction.onerror = transaction.onabort = () => reject(failure ?? transaction.error ?? new Error('Pending operation could not be saved.'));
    });
  }
  async getPendingOperation(ownerId: string, operationId: string) { return clone(await this.read<TournamentPendingOperation>(RECOVERY, `operation:${ownerId}:${operationId}`) ?? null); }
  async listPendingOperations(ownerId: string) { const values = await this.readAll<TournamentPendingOperation | TournamentRecoveryBranch | TournamentInstallationIdentity>(RECOVERY); return values.filter((value): value is TournamentPendingOperation => 'kind' in value && value.kind === 'pending-operation' && value.ownerId === ownerId).map((value) => clone(value)); }
  async deletePendingOperation(ownerId: string, operationId: string) { const database = await this.open(); await new Promise<void>((resolve, reject) => { const transaction = database.transaction(RECOVERY, 'readwrite'); transaction.objectStore(RECOVERY).delete(`operation:${ownerId}:${operationId}`); transaction.oncomplete = () => resolve(); transaction.onerror = transaction.onabort = () => reject(transaction.error ?? new Error('Pending operation could not be cleared.')); }); }
  async listQuarantine() { return (await this.readAll<TournamentQuarantineRecord>(QUARANTINE)).map(clone); }

  private async quarantine(original: unknown, error: unknown) {
    const value = original as Partial<TournamentLocalRecord>;
    const key = `quarantine:${Date.now()}:${Math.random().toString(16).slice(2)}`;
    const record: TournamentQuarantineRecord = { key, ownerId: typeof value.ownerId === 'string' ? value.ownerId : null, tournamentId: typeof value.tournamentId === 'string' ? value.tournamentId : null, quarantinedAt: Date.now(), reason: error instanceof Error ? error.message : 'Invalid tournament record.', original: clone(original) };
    const database = await this.open();
    await new Promise<void>((resolve, reject) => {
      const transaction = database.transaction([RECORDS, QUARANTINE], 'readwrite');
      transaction.objectStore(QUARANTINE).put(record);
      if (typeof value.key === 'string') transaction.objectStore(RECORDS).delete(value.key);
      transaction.oncomplete = () => resolve(); transaction.onerror = transaction.onabort = () => reject(transaction.error ?? new Error('Could not quarantine invalid tournament data.'));
    });
  }
  private async read<T>(storeName: string, key: IDBValidKey): Promise<T | undefined> { const db = await this.open(); return requestResult<T | undefined>(db.transaction(storeName, 'readonly').objectStore(storeName).get(key)); }
  private async readAll<T>(storeName: string): Promise<T[]> { const db = await this.open(); return requestResult<T[]>(db.transaction(storeName, 'readonly').objectStore(storeName).getAll()); }
  private open() {
    if (this.databasePromise) return this.databasePromise;
    this.databasePromise = new Promise<IDBDatabase>((resolve, reject) => {
      const request = this.factory.open(this.databaseName, DATABASE_VERSION);
      request.onupgradeneeded = (event) => {
        const database = request.result; const transaction = request.transaction!;
        const records = database.objectStoreNames.contains(RECORDS) ? transaction.objectStore(RECORDS) : database.createObjectStore(RECORDS, { keyPath: 'key' });
        if (!database.objectStoreNames.contains(AUTHORITIES)) database.createObjectStore(AUTHORITIES, { keyPath: 'key' });
        const quarantine = database.objectStoreNames.contains(QUARANTINE) ? transaction.objectStore(QUARANTINE) : database.createObjectStore(QUARANTINE, { keyPath: 'key' });
        if (!database.objectStoreNames.contains(RECOVERY)) database.createObjectStore(RECOVERY, { keyPath: 'key' });
        const oldVersion = event.oldVersion;
        if (oldVersion < 2 && oldVersion > 0) {
          const cursorRequest = records.openCursor();
          cursorRequest.onsuccess = () => {
            const cursor = cursorRequest.result; if (!cursor) return;
            try { cursor.update(upgradeRecord(cursor.value)); }
            catch (error) {
              quarantine.put({ key: `migration:${String(cursor.primaryKey)}`, ownerId: cursor.value?.ownerId ?? null, tournamentId: cursor.value?.tournamentId ?? null, quarantinedAt: Date.now(), reason: error instanceof Error ? error.message : 'Invalid legacy tournament record.', original: clone(cursor.value) } satisfies TournamentQuarantineRecord);
              cursor.delete();
            }
            cursor.continue();
          };
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => { this.databasePromise = null; reject(request.error ?? new Error('Could not open the tournament database.')); };
      request.onblocked = () => { this.databasePromise = null; reject(new Error('Tournament storage upgrade is blocked. Close other tabs, then retry.')); };
    });
    return this.databasePromise;
  }
}

function mutateRecord(currentValue: TournamentLocalRecord, options: TournamentMutationOptions, mutation: (record: TournamentLocalRecord) => TournamentLocalRecord): TournamentLocalRecord {
  const current = clone(assertRecord(currentValue)); assertMutationFence(current, options);
  const proposed = mutation(clone(current));
  const next = clone(proposed); next.localVersion = incrementDecimal(current.localVersion); next.updatedAt = options.now;
  return assertRecord(next);
}

function assertMutationFence(record: TournamentLocalRecord, options: TournamentMutationOptions): void {
  if (record.localVersion !== options.expectedLocalVersion) throw new Error('Tournament changed on this device. Reload and retry.');
  if (options.tabId !== null && record.localTabOwner?.tabId !== options.tabId) throw new Error('This tab no longer controls the tournament. Resume control before editing.');
}

function incrementDecimal(value: string): string { validateDecimal(value, 'localVersion'); return String(BigInt(value) + 1n); }

function requestResult<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => { request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error ?? new Error('Tournament storage request failed.')); });
}
class UnavailableTournamentRepository implements TournamentRepository {
  private unavailable(): never { throw new Error('IndexedDB is unavailable. Tournament controls are read-only; use an explicit demo/test repository instead.'); }
  async list(): Promise<TournamentLocalRecord[]> { return this.unavailable(); }
  async get(): Promise<TournamentLocalRecord | null> { return this.unavailable(); }
  async create(): Promise<TournamentLocalRecord> { return this.unavailable(); }
  async mutate(): Promise<TournamentLocalRecord> { return this.unavailable(); }
  async delete(): Promise<void> { return this.unavailable(); }
  async claimTab(): Promise<TournamentLocalRecord | null> { return this.unavailable(); }
  async getOrCreateInstallationDeviceId(): Promise<string> { return this.unavailable(); }
  async getAuthority(): Promise<TournamentDeviceAuthority | null> { return this.unavailable(); }
  async mutateAuthority(): Promise<TournamentDeviceAuthority> { return this.unavailable(); }
  async deleteAuthority(): Promise<void> { return this.unavailable(); }
  async createRecoveryBranch(): Promise<void> { return this.unavailable(); }
  async listRecoveryBranches(): Promise<TournamentRecoveryBranch[]> { return this.unavailable(); }
  async putPendingOperation(): Promise<void> { return this.unavailable(); }
  async getPendingOperation(): Promise<TournamentPendingOperation | null> { return this.unavailable(); }
  async listPendingOperations(): Promise<TournamentPendingOperation[]> { return this.unavailable(); }
  async deletePendingOperation(): Promise<void> { return this.unavailable(); }
  async listQuarantine(): Promise<TournamentQuarantineRecord[]> { return this.unavailable(); }
}

export function createTournamentRepository(factory: IDBFactory | undefined = globalThis.indexedDB, options: { demo?: boolean; databaseName?: string } = {}): TournamentRepository {
  if (!factory) return new UnavailableTournamentRepository();
  return new IndexedDbTournamentRepository(factory, options.databaseName ?? (options.demo ? TOURNAMENT_DEMO_DB_NAME : TOURNAMENT_DB_NAME));
}

/** Memory is opt-in for deterministic unit tests and explicit demo injection only. */
export function createMemoryTournamentRepository(): TournamentRepository { return new MemoryTournamentRepository(); }

export const tournamentRepository = createTournamentRepository();
