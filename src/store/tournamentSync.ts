import { publicProjection, reduceTournamentWithEffects, upgradeTournamentV1, type TournamentCommandEnvelope, type TournamentPrivateContacts, type TournamentV1 } from '@/logic/tournament';
import { tournamentOwnerService, type TournamentOwnerReply } from '@/lib/tournamentOwnerService';
import { tournamentRepository, type TournamentLocalRecord, type TournamentRecoveryBranch, type TournamentRepository } from '@/store/tournamentRepository';

export interface OwnerCommandSuccess {
  receipt: { commandId: string; resultingRevision: string };
  snapshot?: TournamentV1;
  contacts?: TournamentPrivateContacts;
}

export interface TournamentSyncTransport {
  command(command: TournamentCommandEnvelope, privateContactChanges: Array<{ entryId: string; contact: string | null }>, capability?: string): Promise<TournamentOwnerReply<OwnerCommandSuccess>>;
  get(tournamentId: string): Promise<TournamentOwnerReply<{ snapshot: TournamentV1; contacts: TournamentPrivateContacts; revision: string }>>;
  receipts(tournamentId: string, commandIds: string[]): Promise<TournamentOwnerReply<{ receipts: Array<{ commandId: string; resultingRevision: string; kind?: string; acceptedAt?: string }> }>>;
}

export const defaultTournamentSyncTransport: TournamentSyncTransport = {
  command: (command, privateContactChanges, capability) => tournamentOwnerService.request<OwnerCommandSuccess>({ action: 'command', command, privateContactChanges }, capability),
  get: (tournamentId) => tournamentOwnerService.request({ action: 'get', tournamentId }),
  receipts: (tournamentId, commandIds) => tournamentOwnerService.request({ action: 'receipts', tournamentId, commandIds }),
};

export interface TournamentSyncOptions {
  ownerId: string;
  tournamentId: string;
  tabId: string;
  sessionGeneration: number;
  isSessionCurrent: (generation: number) => boolean;
  repository?: TournamentRepository;
  transport?: TournamentSyncTransport;
  now?: () => number;
}

export type TournamentSyncResult =
  | { status: 'synced'; applied: string[] }
  | { status: 'paused'; code: string; message: string; applied: string[] }
  | { status: 'conflict'; code: string; recoveryKey: string; applied: string[] };

const queues = new Map<string, Promise<TournamentSyncResult>>();
const clone = <T,>(value: T): T => structuredClone(value);

function applyContactChanges(contacts: TournamentPrivateContacts, changes: Array<{ entryId: string; contact: string | null }>): TournamentPrivateContacts {
  const next = { ...contacts };
  for (const change of changes) { if (change.contact === null) delete next[change.entryId]; else next[change.entryId] = change.contact; }
  return next;
}

async function acknowledgeHead(
  repository: TournamentRepository,
  options: TournamentSyncOptions,
  command: TournamentCommandEnvelope,
  response: OwnerCommandSuccess & { status: 'applied' | 'replayed' },
): Promise<TournamentLocalRecord> {
  const latest = await repository.get(options.ownerId, options.tournamentId);
  if (!latest) throw new Error('Tournament disappeared before acknowledgement.');
  const now = (options.now ?? Date.now)();
  return repository.mutate(options.ownerId, options.tournamentId, { expectedLocalVersion: latest.localVersion, tabId: options.tabId, now }, (record) => {
    if (!options.isSessionCurrent(options.sessionGeneration)) throw new Error('Account session changed before acknowledgement.');
    const head = record.outbox[0];
    if (!head || head.commandId !== command.commandId) throw new Error('Tournament sync head changed before acknowledgement.');
    let acknowledged: TournamentV1;
    if (response.snapshot) acknowledged = upgradeTournamentV1(response.snapshot);
    else {
      if (record.acknowledged.lifecycle === 'setup') throw new Error('Setup acknowledgement requires the authoritative server snapshot.');
      const reduced = reduceTournamentWithEffects(record.acknowledged, head, { actorId: options.ownerId, now: head.issuedAt });
      acknowledged = reduced.state;
    }
    if (acknowledged.revision !== response.receipt.resultingRevision) throw new Error('Server receipt revision does not match the acknowledged snapshot.');
    const changes = record.contactChangesByCommand[head.commandId] ?? [];
    const acknowledgedContacts = response.contacts ? clone(response.contacts) : applyContactChanges(record.acknowledgedContacts, changes);
    const outbox = record.outbox.slice(1);
    const contactChangesByCommand = { ...record.contactChangesByCommand }; delete contactChangesByCommand[head.commandId];
    const projected = outbox.length ? record.projected : acknowledged;
    return {
      ...record, acknowledged, acknowledgedContacts, projected,
      contacts: outbox.length ? record.contacts : acknowledgedContacts,
      outbox, contactChangesByCommand,
      receipts: [...record.receipts.filter((receipt) => receipt.commandId !== head.commandId), { commandId: head.commandId, status: response.status, resultingRevision: response.receipt.resultingRevision, kind: head.kind }],
      remoteStatus: outbox.length ? 'pending' : 'synced',
      publicProjection: projected.meta.publicSlug ? publicProjection(projected) : null,
    };
  });
}

async function quarantineConflict(
  repository: TournamentRepository,
  options: TournamentSyncOptions,
  code: string,
  acceptance: TournamentRecoveryBranch['acceptance'],
): Promise<string> {
  const current = await repository.get(options.ownerId, options.tournamentId);
  if (!current) throw new Error('Tournament disappeared during conflict recovery.');
  const remoteReply = await (options.transport ?? defaultTournamentSyncTransport).get(options.tournamentId);
  const remoteSnapshot = remoteReply.status === 'applied' || remoteReply.status === 'replayed' ? upgradeTournamentV1(remoteReply.snapshot) : null;
  const recoveryKey = `recovery:${options.ownerId}:${options.tournamentId}:${crypto.randomUUID()}`;
  await repository.createRecoveryBranch({ key: recoveryKey, kind: 'recovery-branch', ownerId: options.ownerId, tournamentId: options.tournamentId, createdAt: (options.now ?? Date.now)(), reason: code, acceptance, local: clone(current), remoteSnapshot });
  const latest = await repository.get(options.ownerId, options.tournamentId);
  if (latest) await repository.mutate(options.ownerId, options.tournamentId, { expectedLocalVersion: latest.localVersion, tabId: options.tabId, now: (options.now ?? Date.now)() }, (record) => ({ ...record, remoteStatus: 'conflict' }));
  return recoveryKey;
}

async function flush(options: TournamentSyncOptions): Promise<TournamentSyncResult> {
  const repository = options.repository ?? tournamentRepository;
  const transport = options.transport ?? defaultTournamentSyncTransport;
  const applied: string[] = [];
  let hintedHead: string | null = null;
  while (true) {
    if (!options.isSessionCurrent(options.sessionGeneration)) return { status: 'paused', code: 'SESSION_CHANGED', message: 'Account session changed; late sync response was ignored.', applied };
    const record = await repository.get(options.ownerId, options.tournamentId);
    if (!record) return { status: 'paused', code: 'NOT_FOUND', message: 'Tournament is no longer available on this device.', applied };
    const command = record.outbox[0];
    if (!command) return { status: 'synced', applied };
    const authority = await repository.getAuthority(options.ownerId, options.tournamentId, command.deviceId);
    const changes = record.contactChangesByCommand[command.commandId] ?? [];
    let reply = await transport.command(command, changes, authority?.capability ?? undefined);
    if (!options.isSessionCurrent(options.sessionGeneration)) return { status: 'paused', code: 'SESSION_CHANGED', message: 'Account session changed; late sync response was ignored.', applied };
    if (reply.status === 'applied' || reply.status === 'replayed') {
      if (!reply.snapshot && record.acknowledged.lifecycle === 'setup') {
        const loaded = await transport.get(options.tournamentId);
        if (loaded.status !== 'applied' && loaded.status !== 'replayed') return { status: 'paused', code: loaded.code, message: loaded.message, applied };
        reply = { ...reply, snapshot: loaded.snapshot, contacts: loaded.contacts };
      }
      await acknowledgeHead(repository, options, command, reply);
      applied.push(command.commandId); hintedHead = null; continue;
    }
    if (reply.code === 'AUTH_REQUIRED' || reply.code === 'AUTH_INVALID') return { status: 'paused', code: reply.code, message: reply.message, applied };
    if (reply.code === 'NETWORK' || reply.code === 'TIMEOUT' || reply.code === 'DEPENDENCY') return { status: 'paused', code: reply.code, message: reply.message, applied };
    if (reply.code === 'REVISION_CONFLICT' && hintedHead !== command.commandId) {
      const hints = await transport.receipts(options.tournamentId, record.outbox.slice(0, 100).map((item) => item.commandId));
      if ((hints.status === 'applied' || hints.status === 'replayed') && hints.receipts.some((receipt) => receipt.commandId === command.commandId)) {
        hintedHead = command.commandId;
        continue; // resend the exact immutable head; the receipt endpoint alone never acknowledges it
      }
    }
    const acceptance: TournamentRecoveryBranch['acceptance'] = reply.code === 'AUTHORITY_CHANGED' || reply.code === 'TOURNAMENT_DELETED' ? 'unknown' : applied.length ? 'partially-accepted' : 'known-unaccepted';
    const recoveryKey = await quarantineConflict(repository, options, reply.code, acceptance);
    return { status: 'conflict', code: reply.code, recoveryKey, applied };
  }
}

export function syncTournament(options: TournamentSyncOptions): Promise<TournamentSyncResult> {
  const key = `${options.ownerId}:${options.tournamentId}`;
  const previous = queues.get(key) ?? Promise.resolve({ status: 'synced', applied: [] } as TournamentSyncResult);
  const next = previous.catch(() => ({ status: 'paused', code: 'PREVIOUS_FAILURE', message: 'Previous sync failed.', applied: [] } as TournamentSyncResult)).then(() => flush(options));
  queues.set(key, next); next.finally(() => { if (queues.get(key) === next) queues.delete(key); }).catch(() => undefined);
  return next;
}

export async function syncTournamentWithBackoff(options: TournamentSyncOptions): Promise<TournamentSyncResult> {
  const delays = [1,2,4,8,16,30];
  for (let attempt = 0; ; attempt += 1) {
    const result = await syncTournament(options);
    if (result.status !== 'paused' || !['NETWORK','TIMEOUT','DEPENDENCY'].includes(result.code)) return result;
    if (!options.isSessionCurrent(options.sessionGeneration) || typeof navigator !== 'undefined' && !navigator.onLine || typeof document !== 'undefined' && document.visibilityState !== 'visible') return result;
    const base = delays[Math.min(attempt, delays.length - 1)] * 1000;
    const jitter = Math.floor(base * (0.8 + Math.random() * 0.4));
    await new Promise((resolve) => setTimeout(resolve, jitter));
  }
}
