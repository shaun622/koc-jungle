import { create } from 'zustand';
import {
  createTournamentV1,
  createGrantNonce,
  nextOwnerCommand,
  publicProjection,
  reduceTournamentWithEffects,
  TOURNAMENT_CONTRACT_VERSION,
  type TournamentGrantAction,
  type TournamentGrantRequest,
  type TournamentReleaseRequest,
  type TournamentCommandEnvelope,
  type TournamentCommandKind,
  type TournamentPrivateContacts,
  type TournamentScore,
  type TournamentV1,
} from '@/logic/tournament';
import {
  createTournamentRecord,
  tournamentRepository,
  type TournamentLocalRecord,
  type TournamentDrafts,
  type TournamentPendingOperation,
  type TournamentRepository,
  type TournamentDeviceAuthority,
} from '@/store/tournamentRepository';
import { tournamentOwnerService, type TournamentOwnerReply } from '@/lib/tournamentOwnerService';
import { syncTournament, type TournamentSyncResult, type TournamentSyncTransport } from '@/store/tournamentSync';

export const LOCAL_TOURNAMENT_OWNER = 'local-preview-owner';

export interface TournamentStore {
  ownerId: string;
  records: TournamentLocalRecord[];
  pendingOperations: TournamentPendingOperation[];
  active: TournamentLocalRecord | null;
  hydrated: boolean;
  busy: boolean;
  error: string;
  readOnly: boolean;
  hydrate: (ownerId?: string) => Promise<void>;
  hydrateConnected: (ownerId: string) => Promise<void>;
  createTournament: (title?: string) => Promise<TournamentLocalRecord>;
  createConnectedTournament: (input: { title: string; courtCount: number; timeZone: string }) => Promise<TournamentLocalRecord>;
  retryConnectedCreate: (operationId: string) => Promise<TournamentLocalRecord>;
  importConnectedTournament: (state: TournamentV1, contacts?: TournamentPrivateContacts) => Promise<TournamentLocalRecord>;
  retryPendingOperation: (operationId: string) => Promise<TournamentLocalRecord | null>;
  restoreTournament: (state: TournamentV1, contacts?: TournamentPrivateContacts, drafts?: TournamentDrafts) => Promise<TournamentLocalRecord>;
  openTournament: (id: string) => Promise<TournamentLocalRecord | null>;
  applyCommand: (kind: TournamentCommandKind, payload?: Record<string, unknown>, reason?: string) => Promise<TournamentV1>;
  acknowledgeLocalPreview: () => Promise<void>;
  setContact: (entryId: string, contact: string) => Promise<void>;
  importEntries: (rows: Array<{ divisionId: string; teamName: string; playerNames: [string, string]; contact: string; allowDuplicate?: boolean }>, reason?: string) => Promise<void>;
  saveScoreDraft: (fixtureId: string, score: TournamentScore | null) => Promise<void>;
  saveFormDraft: (key: string, value: unknown | null) => Promise<void>;
  saveProposalDraft: (key: string, value: unknown | null) => Promise<void>;
  deleteTournament: (id: string) => Promise<void>;
  takeOverLocalTab: () => Promise<void>;
  requestAuthority: (action: TournamentGrantAction, reason?: string, acknowledgeInaccessibleWork?: boolean) => Promise<void>;
  releaseAuthority: (reason?: string) => Promise<void>;
  syncActive: (sessionGeneration: number, isSessionCurrent: (generation: number) => boolean) => Promise<TournamentSyncResult>;
  clearError: () => void;
}

const uuid = () => typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : `${Date.now().toString(16).padStart(8,'0')}-0000-4000-a000-${Math.random().toString(16).slice(2).padEnd(12,'0').slice(0,12)}`;
const makeId = (prefix: string) => `${prefix}-${uuid()}`;
const failureMessage = (error: unknown, fallback: string) => {
  if (error && typeof error === 'object' && 'name' in error && error.name === 'QuotaExceededError') return 'Tournament storage quota is full. Nothing was marked saved; export or free device storage, then retry.';
  if (error && typeof error === 'object' && 'message' in error && typeof error.message === 'string') return error.message;
  return fallback;
};

export interface TournamentStoreIdentity {
  tabId: string;
  deviceId: string;
}

export interface TournamentStoreServices {
  ownerRequest?: <T>(body: Record<string, unknown>, capability?: string) => Promise<TournamentOwnerReply<T>>;
  syncTransport?: TournamentSyncTransport;
}

function replaceRecord(records: TournamentLocalRecord[], record: TournamentLocalRecord): TournamentLocalRecord[] {
  const next = records.map((item) => item.tournamentId === record.tournamentId ? record : item);
  return next.some((item) => item.tournamentId === record.tournamentId) ? next : [record, ...records];
}

/**
 * Creates one document-scoped Tournament store. The tab ID is deliberately new
 * for every document, including duplicated and restored tabs; it is never read
 * from sessionStorage. Tests and explicit demo shells may inject a repository.
 */
export function createTournamentStore(
  repository: TournamentRepository = tournamentRepository,
  identity: TournamentStoreIdentity = { tabId: makeId('tab'), deviceId: makeId('device') },
  services: TournamentStoreServices = {},
) {
  const queues = new Map<string, Promise<unknown>>();
  let installationDeviceIdPromise: Promise<string> | null = null;

  function enqueue<T>(key: string, operation: () => Promise<T>): Promise<T> {
    const previous = queues.get(key) ?? Promise.resolve();
    const next = previous.catch(() => undefined).then(operation);
    queues.set(key, next);
    next.finally(() => { if (queues.get(key) === next) queues.delete(key); }).catch(() => undefined);
    return next;
  }

  return create<TournamentStore>((set, get) => {
    const ownerRequest = services.ownerRequest ?? tournamentOwnerService.request;
    const finishConnectedCreate = async (operationId: string, request: Record<string, unknown>): Promise<TournamentLocalRecord> => {
      const reply = await ownerRequest<{ snapshot: TournamentV1 }>({ action: 'create', ...request });
      if (reply.status !== 'applied' && reply.status !== 'replayed') throw new Error(reply.message);
      const now = Date.now(); const record = createTournamentRecord(get().ownerId, reply.snapshot, now, 'connected');
      record.acknowledged = reply.snapshot; record.projected = reply.snapshot; record.remoteStatus = 'synced';
      record.localTabOwner = { tabId: identity.tabId, version: 1, claimedAt: now };
      const existing = await repository.get(get().ownerId, record.tournamentId);
      const saved = existing ?? await repository.create(record);
      await repository.deletePendingOperation(get().ownerId, operationId);
      set((value) => ({ active: saved, records: replaceRecord(value.records, saved), pendingOperations: value.pendingOperations.filter((operation) => operation.operationId !== operationId), readOnly: false }));
      return saved;
    };
    const finishConnectedImport = async (operation: TournamentPendingOperation): Promise<TournamentLocalRecord> => {
      const reply = await ownerRequest<{ snapshot: TournamentV1; contacts: TournamentPrivateContacts }>({ action: 'import-copy', ...operation.request });
      if (reply.status !== 'applied' && reply.status !== 'replayed') throw new Error(reply.message);
      const now = Date.now(); const record = createTournamentRecord(get().ownerId, reply.snapshot, now, 'connected');
      record.acknowledgedContacts = { ...reply.contacts }; record.contacts = { ...reply.contacts };
      record.remoteStatus = 'synced'; record.localTabOwner = { tabId: identity.tabId, version: 1, claimedAt: now };
      const existing = await repository.get(get().ownerId, record.tournamentId);
      const saved = existing ?? await repository.create(record);
      await repository.deletePendingOperation(get().ownerId, operation.operationId);
      set((value) => ({ active: saved, records: replaceRecord(value.records, saved), pendingOperations: value.pendingOperations.filter((item) => item.operationId !== operation.operationId), readOnly: false }));
      return saved;
    };
    const finishConnectedDelete = async (operation: TournamentPendingOperation): Promise<null> => {
      const reply = await ownerRequest<{ result: { tournamentId: string; deleted: boolean } }>({ action: 'delete', ...operation.request });
      if (reply.status !== 'applied' && reply.status !== 'replayed') throw new Error(reply.message);
      const record = await repository.get(get().ownerId, operation.tournamentId);
      if (record) await repository.delete(get().ownerId, operation.tournamentId, { expectedLocalVersion: record.localVersion, tabId: identity.tabId, now: Date.now() });
      await repository.deletePendingOperation(get().ownerId, operation.operationId);
      set((value) => ({ records: value.records.filter((item) => item.tournamentId !== operation.tournamentId), active: value.active?.tournamentId === operation.tournamentId ? null : value.active, pendingOperations: value.pendingOperations.filter((item) => item.operationId !== operation.operationId), readOnly: value.active?.tournamentId === operation.tournamentId ? false : value.readOnly }));
      return null;
    };
    const storeRecord = (record: TournamentLocalRecord) => {
      set((value) => ({
        active: value.active?.tournamentId === record.tournamentId ? record : value.active,
        records: replaceRecord(value.records, record),
        readOnly: value.active?.tournamentId === record.tournamentId
          ? record.localTabOwner?.tabId !== identity.tabId
          : value.readOnly,
        error: '',
      }));
    };

    const mutatePrepared = async <T,>(
      tournamentId: string,
      now: number,
      prepare: () => Promise<T>,
      mutation: (record: TournamentLocalRecord, prepared: T) => TournamentLocalRecord,
    ): Promise<TournamentLocalRecord> => enqueue(`${get().ownerId}:${tournamentId}`, async () => {
      const prepared = await prepare();
      const latest = await repository.get(get().ownerId, tournamentId);
      if (!latest) throw new Error('Tournament not found on this device.');
      const updated = await repository.mutate(
        get().ownerId,
        tournamentId,
        { expectedLocalVersion: latest.localVersion, tabId: identity.tabId, now },
        (current) => {
          const proposed = mutation(current, prepared);
          const projectionState = proposed.mode === 'connected' && proposed.projected.lifecycle === 'setup' && proposed.outbox.length
            ? proposed.acknowledged
            : proposed.projected;
          return {
            ...proposed,
            publicProjection: projectionState.meta.publicSlug ? publicProjection(projectionState) : null,
          };
        },
      );
      storeRecord(updated);
      return updated;
    });
    const mutate = (
      tournamentId: string,
      now: number,
      mutation: (record: TournamentLocalRecord) => TournamentLocalRecord,
    ) => mutatePrepared(tournamentId, now, async () => undefined, (record) => mutation(record));
    const installationDeviceId = (now: number) => installationDeviceIdPromise ??= repository.getOrCreateInstallationDeviceId(get().ownerId, identity.deviceId, now);

    return {
      ownerId: LOCAL_TOURNAMENT_OWNER,
      records: [], pendingOperations: [], active: null, hydrated: false, busy: false, error: '', readOnly: false,
      hydrate: async (ownerId = LOCAL_TOURNAMENT_OWNER) => {
        set((value) => ({ busy: true, error: '', ownerId, ...(value.ownerId === ownerId ? {} : { records: [], pendingOperations: [], active: null, readOnly: false }) }));
        try {
          const records = (await repository.list(ownerId)).sort((a, b) => b.updatedAt - a.updatedAt);
          const active = get().active && records.find((record) => record.tournamentId === get().active?.tournamentId) || null;
          const pendingOperations = await repository.listPendingOperations(ownerId);
          set({ records, pendingOperations, active, hydrated: true, busy: false, readOnly: Boolean(active && active.localTabOwner?.tabId !== identity.tabId) });
        } catch (error) {
          set({ error: failureMessage(error, 'Could not load tournaments.'), hydrated: true, busy: false });
        }
      },
      hydrateConnected: async (ownerId) => {
        set((value) => ({ busy: true, error: '', ownerId, ...(value.ownerId === ownerId ? {} : { records: [], pendingOperations: [], active: null, readOnly: false }) }));
        try {
          const remote: Array<{ tournamentId: string }> = [];
          let cursor: string | null = null;
          do {
            const listed: TournamentOwnerReply<{ tournaments: Array<{ tournamentId: string }>; nextCursor: string | null }> = await ownerRequest({ action: 'list', limit: 100, cursor, archived: undefined });
            if (listed.status !== 'applied' && listed.status !== 'replayed') throw new Error(listed.message);
            remote.push(...listed.tournaments); cursor = listed.nextCursor;
          } while (cursor);
          for (const card of remote) {
            const loaded = await ownerRequest<{ snapshot: TournamentV1; contacts: TournamentPrivateContacts; revision: string }>({ action: 'get', tournamentId: card.tournamentId });
            if (loaded.status !== 'applied' && loaded.status !== 'replayed') continue;
            const existing = await repository.get(ownerId, card.tournamentId);
            if (!existing) {
              const now = Date.now(); const record = createTournamentRecord(ownerId, loaded.snapshot, now, 'connected');
              record.acknowledgedContacts = { ...loaded.contacts }; record.contacts = { ...loaded.contacts }; record.remoteStatus = 'synced';
              record.localTabOwner = { tabId: identity.tabId, version: 1, claimedAt: now };
              await repository.create(record);
            } else if (!existing.outbox.length) {
              await repository.mutate(ownerId, card.tournamentId, { expectedLocalVersion: existing.localVersion, tabId: null, now: Date.now() }, (record) => ({ ...record, acknowledged: loaded.snapshot, projected: loaded.snapshot, acknowledgedContacts: { ...loaded.contacts }, contacts: { ...loaded.contacts }, remoteStatus: 'synced', publicProjection: loaded.snapshot.meta.publicSlug ? publicProjection(loaded.snapshot) : null }));
            }
          }
          const records = (await repository.list(ownerId)).sort((a, b) => b.updatedAt - a.updatedAt);
          const pendingOperations = await repository.listPendingOperations(ownerId);
          set({ records, pendingOperations, active: null, hydrated: true, busy: false, readOnly: false });
        } catch (error) {
          set({ error: failureMessage(error, 'Could not load connected tournaments.'), hydrated: true, busy: false });
        }
      },
      createTournament: async (title = 'Padel Tournament') => {
        const now = Date.now();
        const state = createTournamentV1({ id: uuid(), title, now, divisionId: makeId('division'), courtIds: [makeId('court'), makeId('court'), makeId('court'), makeId('court')] });
        state.meta.timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
        const record = createTournamentRecord(get().ownerId, state, now);
        record.localTabOwner = { tabId: identity.tabId, version: 1, claimedAt: now };
        const created = await repository.create(record);
        set((value) => ({ active: created, records: replaceRecord(value.records, created), readOnly: false }));
        return created;
      },
      createConnectedTournament: async ({ title, courtCount, timeZone }) => {
        const operationId = uuid(); const tournamentId = uuid();
        const request = { operationId, tournamentId, title: title.trim(), courtCount, timeZone };
        const operation: TournamentPendingOperation = { key: `operation:${get().ownerId}:${operationId}`, kind: 'pending-operation', ownerId: get().ownerId, operationId, tournamentId, action: 'create', request, createdAt: Date.now() };
        await repository.putPendingOperation(operation);
        set((value) => ({ pendingOperations: [...value.pendingOperations, operation] }));
        return finishConnectedCreate(operationId, request);
      },
      retryConnectedCreate: async (operationId) => {
        const pending = await repository.getPendingOperation(get().ownerId, operationId);
        if (!pending || pending.action !== 'create') throw new Error('Pending Tournament creation was not found on this device.');
        return finishConnectedCreate(operationId, pending.request);
      },
      importConnectedTournament: async (state, contacts = {}) => {
        const operationId = uuid();
        const request = { operationId, tournamentId: state.id, snapshot: state, contacts };
        const operation: TournamentPendingOperation = { key: `operation:${get().ownerId}:${operationId}`, kind: 'pending-operation', ownerId: get().ownerId, operationId, tournamentId: state.id, action: 'import-copy', request, createdAt: Date.now() };
        await repository.putPendingOperation(operation);
        set((value) => ({ pendingOperations: [...value.pendingOperations, operation] }));
        return finishConnectedImport(operation);
      },
      retryPendingOperation: async (operationId) => {
        const pending = await repository.getPendingOperation(get().ownerId, operationId);
        if (!pending) throw new Error('Pending Tournament operation was not found on this device.');
        if (pending.action === 'create') return finishConnectedCreate(operationId, pending.request);
        if (pending.action === 'import-copy') return finishConnectedImport(pending);
        if (pending.action === 'delete') return finishConnectedDelete(pending);
        throw new Error('This pending Tournament operation is not supported by this client.');
      },
      restoreTournament: async (state, contacts = {}, drafts) => {
        const now = Date.now();
        const record = createTournamentRecord(get().ownerId, state, now);
        record.contacts = { ...contacts };
        record.acknowledgedContacts = { ...contacts };
        if (drafts) record.drafts = structuredClone(drafts);
        record.localTabOwner = { tabId: identity.tabId, version: 1, claimedAt: now };
        const created = await repository.create(record);
        set((value) => ({ active: created, records: replaceRecord(value.records, created), readOnly: false }));
        return created;
      },
      openTournament: async (id) => {
        set({ busy: true, error: '' });
        try {
          const record = await repository.get(get().ownerId, id);
          set({ active: record, busy: false, readOnly: Boolean(record?.localTabOwner?.tabId !== identity.tabId) });
          return record;
        } catch (error) {
          set({ busy: false, error: failureMessage(error, 'Could not open tournament.') });
          return null;
        }
      },
      applyCommand: async (kind, payload = {}, reason) => {
        const active = get().active;
        if (!active) throw new Error('Open a tournament first.');
        if (get().readOnly) throw new Error('Another tab controls this local tournament. Resume control before editing.');
        const issuedAt = Date.now();
        const commandId = uuid();
        try {
          const updated = await mutatePrepared(active.tournamentId, issuedAt, () => installationDeviceId(issuedAt), (record, deviceId) => {
            if (record.mode === 'connected' && record.projected.lifecycle === 'setup' && record.outbox.length) throw new Error('Wait for the current setup change to be confirmed before making another.');
            const command = nextOwnerCommand(record.projected, {
              commandId,
              deviceId: record.projected.controller.deviceId ?? deviceId,
              kind, payload, reason, issuedAt,
            }) as TournamentCommandEnvelope;
            const reduced = reduceTournamentWithEffects(record.projected, command, { actorId: get().ownerId, now: issuedAt });
            const scoreByFixture = { ...record.drafts.scoreByFixture };
            for (const fixtureId of reduced.effects.clearFixtureDraftIds) delete scoreByFixture[fixtureId];
            const formByKey = { ...record.drafts.formByKey };
            for (const key of reduced.effects.clearFormDraftKeys) delete formByKey[key];
            return {
              ...record,
              projected: reduced.state,
              drafts: { ...record.drafts, scoreByFixture, formByKey },
              outbox: [...record.outbox, command],
              remoteStatus: record.mode === 'connected' ? 'pending' : record.remoteStatus,
            };
          });
          return updated.projected;
        } catch (error) {
          set({ error: failureMessage(error, 'This change could not be saved durably.') });
          throw error;
        }
      },
      acknowledgeLocalPreview: async () => {
        const active = get().active;
        if (!active) return;
        if (active.mode !== 'demo') throw new Error('Connected tournaments can only be acknowledged by an exact server receipt.');
        const now = Date.now();
        await mutate(active.tournamentId, now, (record) => ({
          ...record,
          acknowledged: record.projected,
          acknowledgedContacts: record.contacts,
          outbox: [],
          contactChangesByCommand: {},
        }));
      },
      setContact: async (entryId, contact) => {
        const active = get().active;
        if (!active) return;
        if (get().readOnly) throw new Error('Another tab controls this local tournament.');
        const now = Date.now(); const commandId = uuid(); const normalized = contact.trim();
        await mutatePrepared(active.tournamentId, now, () => installationDeviceId(now), (record, deviceId) => {
          const contacts: TournamentPrivateContacts = { ...record.contacts };
          if (normalized) contacts[entryId] = normalized; else delete contacts[entryId];
          if (record.mode === 'demo') return { ...record, contacts };
          if (record.projected.lifecycle === 'setup' && record.outbox.length) throw new Error('Wait for the current setup change to be confirmed before making another.');
          const command = nextOwnerCommand(record.projected, {
            commandId, deviceId: record.projected.controller.deviceId ?? deviceId,
            kind: 'set-entry-contact', payload: { entryId, action: normalized ? 'set' : 'clear' }, issuedAt: now,
          }) as TournamentCommandEnvelope;
          const reduced = reduceTournamentWithEffects(record.projected, command, { actorId: get().ownerId, now });
          return { ...record, projected: reduced.state, contacts, outbox: [...record.outbox, command], contactChangesByCommand: { ...record.contactChangesByCommand, [commandId]: [{ entryId, contact: normalized || null }] }, remoteStatus: 'pending' };
        });
      },
      importEntries: async (rows, reason) => {
        const active = get().active;
        if (!active) throw new Error('Open a tournament first.');
        if (get().readOnly) throw new Error('Another tab controls this local tournament.');
        const entries = rows.map((row) => ({ divisionId: row.divisionId, teamName: row.teamName, playerNames: row.playerNames, allowDuplicate: Boolean(row.allowDuplicate), ids: { entryId: tournamentIds.entry(), playerIds: [tournamentIds.player(), tournamentIds.player()] as [string, string], lineupRevisionId: tournamentIds.lineup() } }));
        const issuedAt = Date.now();
        const commandId = uuid();
        await mutatePrepared(active.tournamentId, issuedAt, () => installationDeviceId(issuedAt), (record, deviceId) => {
          if (record.mode === 'connected' && record.projected.lifecycle === 'setup' && record.outbox.length) throw new Error('Wait for the current setup change to be confirmed before importing entries.');
          const command = nextOwnerCommand(record.projected, {
            commandId,
            deviceId: record.projected.controller.deviceId ?? deviceId,
            kind: 'add-entries', payload: { entries }, reason, issuedAt,
          }) as TournamentCommandEnvelope;
          const reduced = reduceTournamentWithEffects(record.projected, command, { actorId: get().ownerId, now: issuedAt });
          const contacts = { ...record.contacts };
          entries.forEach((entry, index) => { if (rows[index].contact.trim()) contacts[entry.ids.entryId] = rows[index].contact.trim(); });
          const contactChanges = entries.flatMap((entry, index) => rows[index].contact.trim() ? [{ entryId: entry.ids.entryId, contact: rows[index].contact.trim() }] : []);
          return {
            ...record,
            projected: reduced.state,
            contacts,
            outbox: [...record.outbox, command],
            contactChangesByCommand: contactChanges.length ? { ...record.contactChangesByCommand, [commandId]: contactChanges } : record.contactChangesByCommand,
            remoteStatus: record.mode === 'connected' ? 'pending' : record.remoteStatus,
          };
        });
      },
      saveScoreDraft: async (fixtureId, score) => {
        const active = get().active;
        if (!active) return;
        if (get().readOnly) throw new Error('Another tab controls this local tournament.');
        const now = Date.now();
        await mutate(active.tournamentId, now, (record) => {
          const scoreByFixture = { ...record.drafts.scoreByFixture };
          if (score) scoreByFixture[fixtureId] = score; else delete scoreByFixture[fixtureId];
          return { ...record, drafts: { ...record.drafts, scoreByFixture } };
        });
      },
      saveFormDraft: async (key, value) => {
        const active = get().active;
        if (!active) return;
        if (get().readOnly) throw new Error('Another tab controls this local tournament.');
        const now = Date.now();
        await mutate(active.tournamentId, now, (record) => {
          const formByKey = { ...record.drafts.formByKey };
          if (value === null) delete formByKey[key]; else formByKey[key] = value;
          return { ...record, drafts: { ...record.drafts, formByKey } };
        });
      },
      saveProposalDraft: async (key, value) => {
        const active = get().active;
        if (!active) return;
        if (get().readOnly) throw new Error('Another tab controls this local tournament.');
        const now = Date.now();
        await mutate(active.tournamentId, now, (record) => {
          const proposalByKey = { ...record.drafts.proposalByKey };
          if (value === null) delete proposalByKey[key]; else proposalByKey[key] = value;
          return { ...record, drafts: { ...record.drafts, proposalByKey } };
        });
      },
      deleteTournament: async (id) => enqueue(`${get().ownerId}:${id}`, async () => {
        const record = await repository.get(get().ownerId, id);
        if (!record) return;
        if (record.mode === 'connected') {
          const operationId = uuid(); const request = { operationId, tournamentId: id };
          const operation: TournamentPendingOperation = { key: `operation:${get().ownerId}:${operationId}`, kind: 'pending-operation', ownerId: get().ownerId, operationId, tournamentId: id, action: 'delete', request, createdAt: Date.now() };
          await repository.putPendingOperation(operation);
          set((value) => ({ pendingOperations: [...value.pendingOperations, operation] }));
          await finishConnectedDelete(operation);
          return;
        }
        await repository.delete(get().ownerId, id, { expectedLocalVersion: record.localVersion, tabId: identity.tabId, now: Date.now() });
        set((value) => ({
          records: value.records.filter((item) => item.tournamentId !== id),
          active: value.active?.tournamentId === id ? null : value.active,
          readOnly: value.active?.tournamentId === id ? false : value.readOnly,
        }));
      }),
      takeOverLocalTab: async () => {
        const active = get().active;
        if (!active) return;
        const expected = active.localTabOwner?.version ?? 0;
        const claimed = await repository.claimTab(get().ownerId, active.tournamentId, expected, identity.tabId, Date.now());
        if (!claimed) throw new Error('The local controller changed. Reload before resuming control.');
        set((value) => ({ active: claimed, readOnly: false, records: replaceRecord(value.records, claimed) }));
      },
      requestAuthority: async (action, reason = '', acknowledgeInaccessibleWork = false) => {
        const active = get().active;
        if (!active) throw new Error('Open a tournament first.');
        if (active.mode !== 'connected') {
          if (action !== 'begin' && action !== 'reopen') throw new Error('Local demos do not use cloud controller claims.');
          if (action === 'begin' && get().active?.projected.meta.signupOpen) {
            await get().applyCommand('update-metadata', { patch: { signupOpen: false } });
            await get().acknowledgeLocalPreview();
          }
          await get().applyCommand(action === 'begin' ? 'begin-event' : 'reopen-event', {}, reason || undefined);
          await get().acknowledgeLocalPreview();
          return;
        }
        if (active.outbox.length) throw new Error('Sync setup changes before requesting match-day control.');
        const now = Date.now(); const deviceId = await installationDeviceId(now);
        let authority = await repository.getAuthority(get().ownerId, active.tournamentId, deviceId);
        if (!authority?.pendingGrant) {
          const pendingGrant: NonNullable<TournamentDeviceAuthority['pendingGrant']> = {
            action, operationId: uuid(), baseRevision: active.projected.revision,
            expectedEpoch: active.projected.controller.epoch, nonce: createGrantNonce(),
            reason: reason.trim() || null, acknowledgeInaccessibleWork, requestedAt: now,
          };
          authority = await repository.mutateAuthority(get().ownerId, active.tournamentId, deviceId, authority?.version ?? null, (current) => ({
            key: `${get().ownerId}:${active.tournamentId}:${deviceId}`, ownerId: get().ownerId,
            tournamentId: active.tournamentId, deviceId, grantedEpoch: current?.grantedEpoch ?? null,
            capability: current?.capability ?? null, currentClaimId: current?.currentClaimId ?? null,
            pendingGrant, pendingRelease: current?.pendingRelease ?? null, version: current?.version ?? 0,
          }), now);
        } else if (authority.pendingGrant.action !== action) {
          throw new Error(`A ${authority.pendingGrant.action} controller request has an unknown outcome. Retry that exact request first.`);
        }
        const pending = authority.pendingGrant!;
        const request: TournamentGrantRequest = { contractVersion: TOURNAMENT_CONTRACT_VERSION, ...pending, tournamentId: active.tournamentId, deviceId };
        const reply = await ownerRequest<{ capability: string; snapshot?: TournamentV1; result: { grantedEpoch: string; resultingRevision: string; claimId: string } }>({ action, request });
        if (reply.status !== 'applied' && reply.status !== 'replayed') throw new Error(reply.message);
        const updatedAuthority = await repository.mutateAuthority(get().ownerId, active.tournamentId, deviceId, authority.version, (current) => ({
          ...current!, grantedEpoch: reply.result.grantedEpoch, capability: reply.capability,
          currentClaimId: reply.result.claimId, pendingGrant: null,
        }), Date.now());
        if (!reply.snapshot) throw new Error('Controller grant succeeded but the authoritative snapshot was unavailable. Reload before editing.');
        await mutate(active.tournamentId, Date.now(), (record) => ({
          ...record, acknowledged: reply.snapshot!, projected: reply.snapshot!, outbox: [], remoteStatus: 'synced',
          publicProjection: reply.snapshot!.meta.publicSlug ? publicProjection(reply.snapshot!) : null,
        }));
        if (!updatedAuthority.capability) throw new Error('Controller capability could not be saved. This device remains read-only.');
      },
      releaseAuthority: async (reason = '') => {
        const active = get().active;
        if (!active) throw new Error('Open a tournament first.');
        if (active.mode !== 'connected') throw new Error('Local demos do not hold cloud controller authority.');
        if (active.outbox.length) throw new Error('Sync all match-day changes before releasing control.');
        const now = Date.now(); const deviceId = await installationDeviceId(now);
        let authority = await repository.getAuthority(get().ownerId, active.tournamentId, deviceId);
        if (!authority?.capability) throw new Error('This device does not hold tournament control.');
        if (!authority.pendingRelease) {
          const pendingRelease: NonNullable<TournamentDeviceAuthority['pendingRelease']> = {
            operationId: uuid(), baseRevision: active.projected.revision, expectedEpoch: active.projected.controller.epoch,
            expectedSequence: active.projected.controller.nextSequence, reason: reason.trim() || null, requestedAt: now,
          };
          authority = await repository.mutateAuthority(get().ownerId, active.tournamentId, deviceId, authority.version, (current) => ({ ...current!, pendingRelease }), now);
        }
        const pending = authority.pendingRelease!;
        const request: TournamentReleaseRequest = { contractVersion: TOURNAMENT_CONTRACT_VERSION, action: 'release', ...pending, tournamentId: active.tournamentId, deviceId };
        const reply = await ownerRequest<{ snapshot?: TournamentV1; result: { resultingRevision: string; epoch: string } }>({ action: 'release', request }, authority.capability!);
        if (reply.status !== 'applied' && reply.status !== 'replayed') throw new Error(reply.message);
        await repository.mutateAuthority(get().ownerId, active.tournamentId, deviceId, authority.version, (current) => ({ ...current!, grantedEpoch: null, capability: null, currentClaimId: null, pendingRelease: null }), Date.now());
        if (reply.snapshot) await mutate(active.tournamentId, Date.now(), (record) => ({ ...record, acknowledged: reply.snapshot!, projected: reply.snapshot!, remoteStatus: 'synced', publicProjection: reply.snapshot!.meta.publicSlug ? publicProjection(reply.snapshot!) : null }));
      },
      syncActive: async (sessionGeneration, isSessionCurrent) => {
        const active = get().active;
        if (!active) return { status: 'paused', code: 'NOT_FOUND', message: 'Open a tournament first.', applied: [] };
        if (active.mode !== 'connected') return { status: 'synced', applied: [] };
        const result = await syncTournament({ ownerId: get().ownerId, tournamentId: active.tournamentId, tabId: identity.tabId, sessionGeneration, isSessionCurrent, repository, transport: services.syncTransport });
        const refreshed = await repository.get(get().ownerId, active.tournamentId);
        if (refreshed && isSessionCurrent(sessionGeneration)) set((value) => ({ active: refreshed, records: replaceRecord(value.records, refreshed), readOnly: refreshed.localTabOwner?.tabId !== identity.tabId }));
        return result;
      },
      clearError: () => set({ error: '' }),
    };
  });
}

export const useTournamentStore = createTournamentStore();

export const tournamentIds = {
  entry: () => makeId('entry'),
  player: () => makeId('player'),
  lineup: () => makeId('lineup'),
  court: () => makeId('court'),
  stage: () => makeId('stage'),
  group: () => makeId('group'),
  fixture: () => makeId('fixture'),
  decision: () => makeId('decision'),
  rule: () => makeId('rule'),
};
