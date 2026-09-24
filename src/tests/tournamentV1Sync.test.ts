import { describe, expect, it, vi } from 'vitest';
import {
  applyAuthorityGrantState,
  createTournamentV1,
  nextOwnerCommand,
  reduceTournamentWithEffects,
  type TournamentCommandEnvelope,
  type TournamentV1,
} from '@/logic/tournament';
import {
  createTournamentRecord,
  MemoryTournamentRepository,
  type TournamentLocalRecord,
} from '@/store/tournamentRepository';
import { syncTournament, type TournamentSyncTransport } from '@/store/tournamentSync';
import { createTournamentStore } from '@/store/tournamentStore';
import type { TournamentOwnerReply } from '@/lib/tournamentOwnerService';

const ownerId = 'owner-a';
const tournamentId = '11111111-1111-4111-8111-111111111111';
const tabId = 'tab-a';
const deviceId = 'device-a';
const commandId = (index: number) => `22222222-2222-4222-8222-${String(index).padStart(12, '0')}`;

function liveState(): TournamentV1 {
  const setup = createTournamentV1({ id: tournamentId, title: 'Sync', now: 1, divisionId: 'division-a', courtIds: ['court-a'] });
  return applyAuthorityGrantState(setup, {
    contractVersion: 2,
    action: 'begin',
    operationId: '33333333-3333-4333-8333-333333333333',
    tournamentId,
    baseRevision: '0',
    expectedEpoch: '0',
    deviceId,
    nonce: 'a'.repeat(43),
    reason: null,
    acknowledgeInaccessibleWork: false,
  }, ownerId, 2);
}

function makeCommand(state: TournamentV1, index: number, archived = index % 2 === 1): TournamentCommandEnvelope {
  return nextOwnerCommand(state, {
    commandId: commandId(index),
    deviceId,
    kind: 'archive-event',
    payload: { archived },
    issuedAt: 10 + index,
  }) as TournamentCommandEnvelope;
}

function makeSetupCommand(state: TournamentV1, index: number): TournamentCommandEnvelope {
  return nextOwnerCommand(state, {
    commandId: commandId(index),
    deviceId,
    kind: 'update-metadata',
    payload: { patch: { venue: `Venue ${index}` } },
    issuedAt: 10 + index,
  }) as TournamentCommandEnvelope;
}

function queuedRecord(state: TournamentV1, commands: TournamentCommandEnvelope[]): TournamentLocalRecord {
  let projected = state;
  for (const command of commands) projected = reduceTournamentWithEffects(projected, command, { actorId: ownerId, now: command.issuedAt }).state;
  const record = createTournamentRecord(ownerId, state, 1, 'connected');
  record.acknowledged = state;
  record.projected = projected;
  record.outbox = commands;
  record.remoteStatus = commands.length ? 'pending' : 'synced';
  record.localTabOwner = { tabId, version: 1, claimedAt: 1 };
  return record;
}

function options(repository: MemoryTournamentRepository, transport: TournamentSyncTransport, current = () => true) {
  return { ownerId, tournamentId, tabId, sessionGeneration: 1, isSessionCurrent: current, repository, transport, now: () => 50 };
}

function noFallback(): Pick<TournamentSyncTransport, 'get' | 'receipts'> {
  return {
    get: vi.fn(async () => { throw new Error('Unexpected authoritative get.'); }),
    receipts: vi.fn(async () => ({ status: 'applied' as const, receipts: [] })),
  };
}

describe('tournament connected ordered sync', () => {
  it('persists an exact create operation before send and retries it without creating a duplicate', async () => {
    const repository = new MemoryTournamentRepository();
    const calls: Record<string, unknown>[] = [];
    let failAfterCommit = true;
    const ownerRequest = async <T,>(body: Record<string, unknown>): Promise<TournamentOwnerReply<T>> => {
      calls.push(structuredClone(body));
      if (failAfterCommit) {
        failAfterCommit = false;
        throw new Error('Injected lost response.');
      }
      const snapshot = createTournamentV1({
        id: String(body.tournamentId),
        title: String(body.title),
        now: 1,
        divisionId: 'division-a',
        courtIds: Array.from({ length: Number(body.courtCount) }, (_, index) => `court-${index + 1}`),
      });
      snapshot.meta.timeZone = String(body.timeZone);
      return { status: 'replayed', snapshot } as TournamentOwnerReply<T>;
    };
    const store = createTournamentStore(repository, { tabId, deviceId }, { ownerRequest });
    await store.getState().hydrate(ownerId);
    await expect(store.getState().createConnectedTournament({ title: 'Durable create', courtCount: 2, timeZone: 'UTC' })).rejects.toThrow(/lost response/i);
    const pending = await repository.listPendingOperations(ownerId);
    expect(pending).toHaveLength(1);
    expect(pending[0].action).toBe('create');
    expect(await repository.list(ownerId)).toHaveLength(0);

    const saved = await store.getState().retryConnectedCreate(pending[0].operationId);
    expect(saved.mode).toBe('connected');
    expect(saved.remoteStatus).toBe('synced');
    expect(await repository.listPendingOperations(ownerId)).toEqual([]);
    expect(await repository.list(ownerId)).toHaveLength(1);
    expect(calls[1]).toEqual(calls[0]);
  });

  it('keeps a connected setup projection private until its exact receipt arrives', async () => {
    const repository = new MemoryTournamentRepository();
    const state = createTournamentV1({ id: tournamentId, title: 'Published setup', now: 1, divisionId: 'division-a', courtIds: ['court-a'] });
    state.meta.publicSlug = 'published-setup';
    const record = createTournamentRecord(ownerId, state, 1, 'connected');
    record.remoteStatus = 'synced';
    record.localTabOwner = { tabId, version: 1, claimedAt: 1 };
    await repository.create(record);
    const store = createTournamentStore(repository, { tabId, deviceId });
    await store.getState().hydrate(ownerId);
    await store.getState().openTournament(tournamentId);
    await store.getState().applyCommand('update-metadata', { patch: { venue: 'Pending venue' } });
    const saved = await repository.get(ownerId, tournamentId);
    expect(saved?.projected.meta.venue).toBe('Pending venue');
    expect(saved?.acknowledged.meta.venue).toBe('');
    expect(saved?.publicProjection?.venue).toBe('');
  });

  it('imports a connected copy with contacts atomically after an unknown outcome', async () => {
    const repository = new MemoryTournamentRepository();
    const imported = createTournamentV1({ id: tournamentId, title: 'Imported', now: 1, divisionId: 'division-a', courtIds: ['court-a'] });
    const entryCommand = nextOwnerCommand(imported, {
      commandId: commandId(90), deviceId, kind: 'add-entries', issuedAt: 2,
      payload: { entries: [{ divisionId: 'division-a', teamName: 'Pair', playerNames: ['One', 'Two'], ids: { entryId: 'entry-a', playerIds: ['player-a', 'player-b'], lineupRevisionId: 'lineup-a' } }] },
    }) as TournamentCommandEnvelope;
    const withEntry = reduceTournamentWithEffects(imported, entryCommand, { actorId: ownerId, now: 2 }).state;
    withEntry.revision = '0'; withEntry.audit = []; withEntry.updatedAt = withEntry.createdAt;
    const contacts = { 'entry-a': 'private@example.test' };
    let unknown = true;
    const ownerRequest = async <T,>(): Promise<TournamentOwnerReply<T>> => {
      if (unknown) { unknown = false; throw new Error('Unknown import outcome.'); }
      return { status: 'replayed', snapshot: withEntry, contacts } as TournamentOwnerReply<T>;
    };
    const store = createTournamentStore(repository, { tabId, deviceId }, { ownerRequest });
    await store.getState().hydrate(ownerId);
    await expect(store.getState().importConnectedTournament(withEntry, contacts)).rejects.toThrow(/unknown import/i);
    expect(await repository.list(ownerId)).toEqual([]);
    const pending = await repository.listPendingOperations(ownerId);
    const saved = await store.getState().retryPendingOperation(pending[0].operationId);
    expect(saved?.contacts).toEqual(contacts);
    expect(saved?.acknowledgedContacts).toEqual(contacts);
    expect(await repository.list(ownerId)).toHaveLength(1);
  });

  it('retains a connected tournament until an exact delete receipt is recovered', async () => {
    const repository = new MemoryTournamentRepository();
    const state = createTournamentV1({ id: tournamentId, title: 'Delete', now: 1, divisionId: 'division-a', courtIds: ['court-a'] });
    const record = createTournamentRecord(ownerId, state, 1, 'connected');
    record.remoteStatus = 'synced'; record.localTabOwner = { tabId, version: 1, claimedAt: 1 };
    await repository.create(record);
    let unknown = true;
    const ownerRequest = async <T,>(body: Record<string, unknown>): Promise<TournamentOwnerReply<T>> => {
      if (unknown) { unknown = false; throw new Error('Unknown delete outcome.'); }
      return { status: 'replayed', result: { tournamentId: body.tournamentId, deleted: true } } as TournamentOwnerReply<T>;
    };
    const store = createTournamentStore(repository, { tabId, deviceId }, { ownerRequest });
    await store.getState().hydrate(ownerId); await store.getState().openTournament(tournamentId);
    await expect(store.getState().deleteTournament(tournamentId)).rejects.toThrow(/unknown delete/i);
    expect(await repository.get(ownerId, tournamentId)).not.toBeNull();
    const pending = await repository.listPendingOperations(ownerId);
    await store.getState().retryPendingOperation(pending[0].operationId);
    expect(await repository.get(ownerId, tournamentId)).toBeNull();
    expect(await repository.listPendingOperations(ownerId)).toEqual([]);
  });

  it('sends and acknowledges live commands in exact head order without requiring snapshots', async () => {
    const repository = new MemoryTournamentRepository();
    const first = makeCommand(liveState(), 1);
    const afterFirst = reduceTournamentWithEffects(liveState(), first, { actorId: ownerId, now: first.issuedAt }).state;
    const second = makeCommand(afterFirst, 2);
    await repository.create(queuedRecord(liveState(), [first, second]));
    let server = liveState();
    const sent: string[] = [];
    const transport: TournamentSyncTransport = {
      ...noFallback(),
      command: vi.fn(async (command) => {
        sent.push(command.commandId);
        server = reduceTournamentWithEffects(server, command, { actorId: ownerId, now: command.issuedAt }).state;
        return { status: 'applied' as const, receipt: { commandId: command.commandId, resultingRevision: server.revision } };
      }),
    };

    expect(await syncTournament(options(repository, transport))).toEqual({ status: 'synced', applied: [first.commandId, second.commandId] });
    expect(sent).toEqual([first.commandId, second.commandId]);
    const saved = await repository.get(ownerId, tournamentId);
    expect(saved?.outbox).toEqual([]);
    expect(saved?.acknowledged.revision).toBe(server.revision);
    expect(saved?.projected.archivedAt).toBeNull();
  });

  it('preserves a command appended while the head response is in flight', async () => {
    const repository = new MemoryTournamentRepository();
    const first = makeCommand(liveState(), 1);
    await repository.create(queuedRecord(liveState(), [first]));
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    let server = liveState();
    const transport: TournamentSyncTransport = {
      ...noFallback(),
      command: vi.fn(async (command) => {
        await gate;
        server = reduceTournamentWithEffects(server, command, { actorId: ownerId, now: command.issuedAt }).state;
        return { status: 'applied' as const, receipt: { commandId: command.commandId, resultingRevision: server.revision } };
      }),
    };
    const syncing = syncTournament(options(repository, transport));
    await vi.waitFor(() => expect(transport.command).toHaveBeenCalledTimes(1));
    const latest = (await repository.get(ownerId, tournamentId))!;
    const second = makeCommand(latest.projected, 2);
    const secondState = reduceTournamentWithEffects(latest.projected, second, { actorId: ownerId, now: second.issuedAt }).state;
    await repository.mutate(ownerId, tournamentId, { expectedLocalVersion: latest.localVersion, tabId, now: 20 }, (record) => ({ ...record, projected: secondState, outbox: [...record.outbox, second] }));
    release();
    const result = await syncing;
    expect(result.status).toBe('synced');
    expect(result.applied).toEqual([first.commandId, second.commandId]);
    expect((await repository.get(ownerId, tournamentId))?.projected.archivedAt).toBeNull();
  });

  it('fetches an authoritative snapshot before acknowledging a setup replay', async () => {
    const repository = new MemoryTournamentRepository();
    const setup = createTournamentV1({ id: tournamentId, title: 'Setup', now: 1, divisionId: 'division-a', courtIds: ['court-a'] });
    const command = makeSetupCommand(setup, 1);
    const server = reduceTournamentWithEffects(setup, command, { actorId: ownerId, now: command.issuedAt }).state;
    await repository.create(queuedRecord(setup, [command]));
    const transport: TournamentSyncTransport = {
      command: vi.fn(async () => ({ status: 'replayed' as const, receipt: { commandId: command.commandId, resultingRevision: server.revision } })),
      get: vi.fn(async () => ({ status: 'applied' as const, snapshot: server, contacts: {}, revision: server.revision })),
      receipts: vi.fn(async () => ({ status: 'applied' as const, receipts: [] })),
    };
    expect((await syncTournament(options(repository, transport))).status).toBe('synced');
    expect(transport.get).toHaveBeenCalledOnce();
    expect((await repository.get(ownerId, tournamentId))?.acknowledged.meta.venue).toBe('Venue 1');
  });

  it('uses a receipt hint only to resend the exact immutable head', async () => {
    const repository = new MemoryTournamentRepository();
    const command = makeCommand(liveState(), 1);
    const server = reduceTournamentWithEffects(liveState(), command, { actorId: ownerId, now: command.issuedAt }).state;
    await repository.create(queuedRecord(liveState(), [command]));
    let calls = 0;
    const transport: TournamentSyncTransport = {
      ...noFallback(),
      receipts: vi.fn(async () => ({ status: 'applied' as const, receipts: [{ commandId: command.commandId, resultingRevision: server.revision }] })),
      command: vi.fn(async (sent) => {
        calls += 1;
        if (calls === 1) return { status: 'conflict' as const, code: 'REVISION_CONFLICT', message: 'Already committed.' };
        expect(sent).toEqual(command);
        return { status: 'replayed' as const, receipt: { commandId: command.commandId, resultingRevision: server.revision } };
      }),
    };
    expect((await syncTournament(options(repository, transport))).status).toBe('synced');
    expect(calls).toBe(2);
  });

  it('quarantines revision and authority conflicts without clearing the local branch', async () => {
    for (const code of ['REVISION_CONFLICT', 'AUTHORITY_CHANGED']) {
      const repository = new MemoryTournamentRepository();
      const command = makeCommand(liveState(), 1);
      await repository.create(queuedRecord(liveState(), [command]));
      const transport: TournamentSyncTransport = {
        command: vi.fn(async () => ({ status: 'conflict' as const, code, message: 'Conflict.' })),
        receipts: vi.fn(async () => ({ status: 'applied' as const, receipts: [] })),
        get: vi.fn(async () => ({ status: 'applied' as const, snapshot: liveState(), contacts: {}, revision: liveState().revision })),
      };
      const result = await syncTournament(options(repository, transport));
      expect(result.status).toBe('conflict');
      expect((await repository.get(ownerId, tournamentId))?.outbox).toHaveLength(1);
      const branch = (await repository.listRecoveryBranches(ownerId, tournamentId))[0];
      expect(branch.reason).toBe(code);
      expect(branch.acceptance).toBe(code === 'AUTHORITY_CHANGED' ? 'unknown' : 'known-unaccepted');
    }
  });

  it('ignores a late response after the account session changes', async () => {
    const repository = new MemoryTournamentRepository();
    const command = makeCommand(liveState(), 1);
    await repository.create(queuedRecord(liveState(), [command]));
    let current = true;
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const transport: TournamentSyncTransport = {
      ...noFallback(),
      command: vi.fn(async () => {
        await gate;
        const server = reduceTournamentWithEffects(liveState(), command, { actorId: ownerId, now: command.issuedAt }).state;
        return { status: 'applied' as const, receipt: { commandId: command.commandId, resultingRevision: server.revision } };
      }),
    };
    const syncing = syncTournament(options(repository, transport, () => current));
    await vi.waitFor(() => expect(transport.command).toHaveBeenCalledOnce());
    current = false;
    release();
    expect(await syncing).toMatchObject({ status: 'paused', code: 'SESSION_CHANGED' });
    expect((await repository.get(ownerId, tournamentId))?.outbox).toHaveLength(1);
  });

  it('pauses on authentication failure without acknowledging or clearing work', async () => {
    const repository = new MemoryTournamentRepository();
    const command = makeCommand(liveState(), 1);
    await repository.create(queuedRecord(liveState(), [command]));
    const transport: TournamentSyncTransport = {
      ...noFallback(),
      command: vi.fn(async () => ({ status: 'rejected' as const, code: 'AUTH_REQUIRED', message: 'Sign in.' })),
    };
    expect(await syncTournament(options(repository, transport))).toMatchObject({ status: 'paused', code: 'AUTH_REQUIRED' });
    expect((await repository.get(ownerId, tournamentId))?.outbox).toHaveLength(1);
  });
});
