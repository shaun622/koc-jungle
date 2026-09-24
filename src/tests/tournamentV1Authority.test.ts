import { describe, expect, it } from 'vitest';
import {
  applyAuthorityGrantState,
  applyAuthorityReleaseState,
  createTournamentV1,
  validateGrantRequest,
  type TournamentGrantRequest,
} from '@/logic/tournament';
import { createTournamentRecord, MemoryTournamentRepository } from '@/store/tournamentRepository';
import { createTournamentStore } from '@/store/tournamentStore';
import type { TournamentOwnerReply } from '@/lib/tournamentOwnerService';

const tournamentId = '11111111-1111-4111-8111-111111111111';
const operation = (suffix: string) => `22222222-2222-4222-8222-2222222222${suffix}`;
const grant = (action: TournamentGrantRequest['action'], revision: string, epoch: string, suffix: string): TournamentGrantRequest => ({
  contractVersion: 2, action, operationId: operation(suffix), tournamentId,
  baseRevision: revision, expectedEpoch: epoch, deviceId: `device-${suffix}`,
  nonce: 'a'.repeat(43), reason: action === 'takeover' || action === 'reopen' ? 'Reviewed recovery' : null,
  acknowledgeInaccessibleWork: action === 'takeover',
});

describe('tournament controller authority', () => {
  it('uses explicit persistent grants without a time lease', () => {
    const setup = createTournamentV1({ id: tournamentId, title: 'Authority', now: 1, divisionId: 'division-a', courtIds: ['court-a'] });
    const begun = applyAuthorityGrantState(setup, grant('begin', '0', '0', '01'), 'owner', 2);
    expect(begun.lifecycle).toBe('live'); expect(begun.controller).toEqual({ deviceId: 'device-01', epoch: '1', nextSequence: 1 });
    const released = applyAuthorityReleaseState(begun, { contractVersion: 2, action: 'release', operationId: operation('02'), tournamentId, baseRevision: '1', expectedEpoch: '1', expectedSequence: 1, deviceId: 'device-01', reason: null }, 'owner', 3);
    expect(released.controller).toEqual({ deviceId: null, epoch: '2', nextSequence: 0 });
    const claimed = applyAuthorityGrantState(released, grant('claim', '2', '2', '03'), 'owner', 4);
    const taken = applyAuthorityGrantState(claimed, grant('takeover', '3', '3', '04'), 'owner', 5);
    expect(taken.controller).toEqual({ deviceId: 'device-04', epoch: '4', nextSequence: 1 });
    expect(taken.audit.map((entry) => entry.kind)).toEqual(['authority-begin','authority-release','authority-claim','authority-takeover']);
  });

  it('requires 256-bit nonce shape and explicit takeover acknowledgement', () => {
    expect(() => validateGrantRequest({ ...grant('begin', '0', '0', '05'), nonce: 'short' })).toThrow(/256 random bits/i);
    expect(() => validateGrantRequest({ ...grant('takeover', '0', '0', '06'), acknowledgeInaccessibleWork: false })).toThrow(/acknowledge/i);
  });

  it('stores installation identity and capability only in the private authority store', async () => {
    const repository = new MemoryTournamentRepository();
    expect(await repository.getOrCreateInstallationDeviceId('owner', 'device-first', 1)).toBe('device-first');
    expect(await repository.getOrCreateInstallationDeviceId('owner', 'device-second', 2)).toBe('device-first');
    const authority = await repository.mutateAuthority('owner', tournamentId, 'device-first', null, () => ({
      key: `owner:${tournamentId}:device-first`, ownerId: 'owner', tournamentId, deviceId: 'device-first',
      grantedEpoch: '1', capability: 'private-capability-sentinel', currentClaimId: operation('07'), pendingGrant: null, version: 0,
    }), 3);
    expect(authority.version).toBe(1);
    const state = createTournamentV1({ id: tournamentId, title: 'Private', now: 1, divisionId: 'division-a', courtIds: ['court-a'] });
    await repository.create(createTournamentRecord('owner', state, 1));
    expect(JSON.stringify(await repository.get('owner', tournamentId))).not.toContain('private-capability-sentinel');
    expect((await repository.getAuthority('owner', tournamentId, 'device-first'))?.capability).toBe('private-capability-sentinel');
  });

  it('persists and retries the exact controller grant after a lost response', async () => {
    const ownerId = 'owner'; const tabId = 'tab-a'; const deviceId = 'device-a';
    const repository = new MemoryTournamentRepository();
    const setup = createTournamentV1({ id: tournamentId, title: 'Grant retry', now: 1, divisionId: 'division-a', courtIds: ['court-a'] });
    const record = createTournamentRecord(ownerId, setup, 1, 'connected');
    record.remoteStatus = 'synced'; record.localTabOwner = { tabId, version: 1, claimedAt: 1 };
    await repository.create(record);
    const calls: Record<string, unknown>[] = []; let loseFirst = true;
    const ownerRequest = async <T,>(body: Record<string, unknown>): Promise<TournamentOwnerReply<T>> => {
      calls.push(structuredClone(body));
      if (loseFirst) { loseFirst = false; throw new Error('Injected lost grant response.'); }
      const request = body.request as TournamentGrantRequest;
      const snapshot = applyAuthorityGrantState(setup, request, ownerId, 2);
      return { status: 'replayed', capability: 'private-grant-capability', snapshot, result: { grantedEpoch: snapshot.controller.epoch, resultingRevision: snapshot.revision, claimId: operation('08') } } as TournamentOwnerReply<T>;
    };
    const store = createTournamentStore(repository, { tabId, deviceId }, { ownerRequest });
    await store.getState().hydrate(ownerId); await store.getState().openTournament(tournamentId);
    await expect(store.getState().requestAuthority('begin')).rejects.toThrow(/lost grant/i);
    const pending = await repository.getAuthority(ownerId, tournamentId, deviceId);
    expect(pending?.pendingGrant?.nonce).toHaveLength(43);
    await store.getState().requestAuthority('begin');
    expect(calls[1]).toEqual(calls[0]);
    const authority = await repository.getAuthority(ownerId, tournamentId, deviceId);
    expect(authority).toMatchObject({ capability: 'private-grant-capability', pendingGrant: null, grantedEpoch: '1' });
    expect(store.getState().active?.projected.lifecycle).toBe('live');
  });

  it('persists and retries the exact controller release after a lost response', async () => {
    const ownerId = 'owner'; const tabId = 'tab-release'; const deviceId = 'device-release';
    const repository = new MemoryTournamentRepository();
    const setup = createTournamentV1({ id: tournamentId, title: 'Release retry', now: 1, divisionId: 'division-a', courtIds: ['court-a'] });
    const live = applyAuthorityGrantState(setup, { ...grant('begin', '0', '0', '09'), deviceId }, ownerId, 2);
    const record = createTournamentRecord(ownerId, live, 2, 'connected');
    record.remoteStatus = 'synced'; record.localTabOwner = { tabId, version: 1, claimedAt: 2 };
    await repository.create(record);
    await repository.mutateAuthority(ownerId, tournamentId, deviceId, null, () => ({
      key: `${ownerId}:${tournamentId}:${deviceId}`, ownerId, tournamentId, deviceId,
      grantedEpoch: live.controller.epoch, capability: 'private-release-capability', currentClaimId: operation('09'), pendingGrant: null, pendingRelease: null, version: 0,
    }), 2);
    const calls: Record<string, unknown>[] = []; let loseFirst = true;
    const ownerRequest = async <T,>(body: Record<string, unknown>, capability?: string): Promise<TournamentOwnerReply<T>> => {
      expect(capability).toBe('private-release-capability'); calls.push(structuredClone(body));
      if (loseFirst) { loseFirst = false; throw new Error('Injected lost release response.'); }
      const request = body.request as Parameters<typeof applyAuthorityReleaseState>[1];
      const snapshot = applyAuthorityReleaseState(live, request, ownerId, 3);
      return { status: 'replayed', snapshot, result: { resultingRevision: snapshot.revision, epoch: snapshot.controller.epoch } } as TournamentOwnerReply<T>;
    };
    const store = createTournamentStore(repository, { tabId, deviceId }, { ownerRequest });
    await store.getState().hydrate(ownerId); await store.getState().openTournament(tournamentId);
    await expect(store.getState().releaseAuthority()).rejects.toThrow(/lost release/i);
    expect((await repository.getAuthority(ownerId, tournamentId, deviceId))?.pendingRelease).not.toBeNull();
    await store.getState().releaseAuthority();
    expect(calls[1]).toEqual(calls[0]);
    expect(await repository.getAuthority(ownerId, tournamentId, deviceId)).toMatchObject({ capability: null, pendingRelease: null, grantedEpoch: null });
    expect(store.getState().active?.projected.controller.deviceId).toBeNull();
  });
});
