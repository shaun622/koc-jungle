import { describe, expect, it } from 'vitest';
import { createTournamentV1 } from '@/logic/tournament';
import {
  createTournamentRecord,
  MemoryTournamentRepository,
  TOURNAMENT_DB_NAME,
  type TournamentLocalRecord,
} from '@/store/tournamentRepository';
import { createTournamentStore } from '@/store/tournamentStore';
import { EVENT_CATALOG_DB_NAME } from '@/store/eventRepository';

const identity = (tabId: string) => ({ tabId, deviceId: `device-${tabId}` });

class QuotaRepository extends MemoryTournamentRepository {
  override async mutate(): Promise<TournamentLocalRecord> {
    throw new DOMException('Injected quota failure', 'QuotaExceededError');
  }
}

describe('tournament v1 repository isolation and durability', () => {
  it('uses a separate database and owner namespace', async () => {
    expect(TOURNAMENT_DB_NAME).not.toBe(EVENT_CATALOG_DB_NAME);
    const repository = new MemoryTournamentRepository();
    const state = createTournamentV1({ id: 't', title: 'Test', now: 1, divisionId: 'd', courtIds: ['c'] });
    await repository.create(createTournamentRecord('owner-a', state, 1));
    expect(await repository.list('owner-a')).toHaveLength(1);
    expect(await repository.list('owner-b')).toHaveLength(0);
  });

  it('fences a second document and rejects the stale controller without BroadcastChannel', async () => {
    const repository = new MemoryTournamentRepository();
    const first = createTournamentStore(repository, identity('tab-a'));
    const second = createTournamentStore(repository, identity('tab-b'));
    const created = await first.getState().createTournament('Fence test');

    await second.getState().hydrate(first.getState().ownerId);
    await second.getState().openTournament(created.tournamentId);
    expect(second.getState().readOnly).toBe(true);
    await expect(second.getState().applyCommand('update-metadata', { patch: { venue: 'Blocked' } })).rejects.toThrow(/another tab controls/i);

    await second.getState().takeOverLocalTab();
    expect(second.getState().readOnly).toBe(false);
    await second.getState().applyCommand('update-metadata', { patch: { venue: 'Court house' } });
    await expect(first.getState().applyCommand('update-metadata', { patch: { venue: 'Stale write' } })).rejects.toThrow(/no longer controls/i);
    expect((await repository.get(first.getState().ownerId, created.tournamentId))?.projected.meta.venue).toBe('Court house');
  });

  it('serializes 100 concurrent command, draft and acknowledgement intents without loss', async () => {
    const repository = new MemoryTournamentRepository();
    const store = createTournamentStore(repository, identity('tab-main'));
    const created = await store.getState().createTournament('Concurrent test');
    const operations: Array<Promise<unknown>> = [];

    for (let index = 0; index < 25; index += 1) {
      operations.push(store.getState().applyCommand('update-metadata', { patch: { notes: `edit-${index}` } }));
      operations.push(store.getState().saveFormDraft(`form-${index}`, { index }));
      operations.push(store.getState().saveProposalDraft(`proposal-${index}`, { index }));
      operations.push(store.getState().acknowledgeLocalPreview());
    }
    await Promise.all(operations);

    const saved = await repository.get(store.getState().ownerId, created.tournamentId);
    expect(saved?.localVersion).toBe('100');
    expect(saved?.projected.audit).toHaveLength(25);
    expect(Object.keys(saved?.drafts.formByKey ?? {})).toHaveLength(25);
    expect(Object.keys(saved?.drafts.proposalByKey ?? {})).toHaveLength(25);
    expect(saved?.outbox).toEqual([]);
    expect(saved?.acknowledged.revision).toBe(saved?.projected.revision);
  });

  it('serializes private contact changes against the current record', async () => {
    const repository = new MemoryTournamentRepository();
    const store = createTournamentStore(repository, identity('tab-contact'));
    const created = await store.getState().createTournament('Contact test');
    const divisionId = created.projected.divisions[0].id;
    await store.getState().importEntries([{ divisionId, teamName: 'Pair', playerNames: ['A', 'B'], contact: '' }]);
    const entryId = store.getState().active!.projected.entries[0].id;
    await Promise.all(Array.from({ length: 25 }, (_, index) => store.getState().setContact(entryId, `contact-${index}`)));
    const saved = await repository.get(store.getState().ownerId, created.tournamentId);
    expect(saved?.contacts[entryId]).toBe('contact-24');
    expect(saved?.localVersion).toBe('26');
  });

  it('rejects a stale local version and leaves the durable record unchanged', async () => {
    const repository = new MemoryTournamentRepository();
    const state = createTournamentV1({ id: 't', title: 'Test', now: 1, divisionId: 'd', courtIds: ['c'] });
    const record = createTournamentRecord('owner', state, 1);
    record.localTabOwner = { tabId: 'tab', version: 1, claimedAt: 1 };
    await repository.create(record);
    await repository.mutate('owner', 't', { expectedLocalVersion: '0', tabId: 'tab', now: 2 }, (current) => ({ ...current, drafts: { ...current.drafts, formByKey: { first: true } } }));
    await expect(repository.mutate('owner', 't', { expectedLocalVersion: '0', tabId: 'tab', now: 3 }, (current) => ({ ...current, drafts: { ...current.drafts, formByKey: { stale: true } } }))).rejects.toThrow(/changed on this device/i);
    expect((await repository.get('owner', 't'))?.drafts.formByKey).toEqual({ first: true });
  });

  it('does not update the visible record when durable storage rejects the mutation', async () => {
    const repository = new QuotaRepository();
    const store = createTournamentStore(repository, identity('tab-quota'));
    await store.getState().createTournament('Quota test');
    await expect(store.getState().applyCommand('update-metadata', { patch: { venue: 'Not durable' } })).rejects.toThrow(/quota/i);
    expect(store.getState().active?.projected.meta.venue).toBe('');
    expect(store.getState().active?.localVersion).toBe('0');
    expect(store.getState().error).toMatch(/quota/i);
  });
});
