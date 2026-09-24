import { describe, expect, it } from 'vitest';
import {
  createTournamentV1,
  makeFixture,
  nextOwnerCommand,
  parseTournamentCommandEnvelope,
  reduceTournament,
  stagePlanningDefaults,
  TournamentRuleError,
  upgradeTournamentV1,
  validateTournament,
  validateTournamentCommandEnvelope,
  type TournamentCommandKind,
  type TournamentStage,
  type TournamentV1,
} from '@/logic/tournament';

let sequence = 0;
const id = (prefix: string) => `${prefix}-${++sequence}`;
const base = () => createTournamentV1({ id: id('t'), title: 'Protocol', now: 1, divisionId: id('d'), courtIds: [id('c')] });
const command = (state: TournamentV1, kind: TournamentCommandKind, payload: Record<string, unknown> = {}) => nextOwnerCommand(state, {
  commandId: id('cmd'), deviceId: 'device-a', kind, payload, issuedAt: 10 + sequence,
});

describe('tournament v2 protocol', () => {
  it('requires version 2 and exact command keys', () => {
    const state = base();
    const valid = command(state, 'update-capacity', { divisionId: state.divisions[0].id, capacity: 12 });
    expect(validateTournamentCommandEnvelope(valid)).toBe(valid);
    expect(() => validateTournamentCommandEnvelope({ ...valid, contractVersion: 1 })).toThrow(TournamentRuleError);
    expect(() => validateTournamentCommandEnvelope({ ...valid, surprise: true })).toThrow(TournamentRuleError);
    expect(() => validateTournamentCommandEnvelope({ ...valid, payload: { ...valid.payload, surprise: true } })).toThrow(TournamentRuleError);
    expect(() => validateTournamentCommandEnvelope({ ...valid, kind: 'claim-controller' })).toThrow(TournamentRuleError);
    expect(() => validateTournamentCommandEnvelope({ ...valid, baseRevision: '00' })).toThrow(TournamentRuleError);
  });

  it('requires UUID wire keys at the external boundary', () => {
    const state = base();
    const local = command(state, 'archive-event', { archived: true });
    expect(() => parseTournamentCommandEnvelope(local)).toThrow(TournamentRuleError);
    const wire = {
      ...local,
      tournamentId: 'c6f5b9b0-7a6e-4c3f-9d88-1aa37ed70a43',
      commandId: 'f2f72b16-f7c0-4b45-9fd8-3788f4b93f72',
    };
    expect(parseTournamentCommandEnvelope(wire)).toMatchObject({ contractVersion: 2, kind: 'archive-event' });
  });

  it('upcasts legacy snapshots without rewriting historical rule profiles', () => {
    const state = base();
    const legacy = JSON.parse(JSON.stringify(state)) as Record<string, unknown>;
    delete legacy.dataVersion;
    const beforeProfiles = JSON.stringify(legacy.ruleProfiles);
    const upgraded = upgradeTournamentV1(legacy);
    expect(upgraded.dataVersion).toBe(2);
    expect(JSON.stringify(upgraded.ruleProfiles)).toBe(beforeProfiles);
    expect(upgraded.fixtures).toEqual([]);
    expect(() => upgradeTournamentV1({ ...upgraded, dataVersion: 3 })).toThrow(TournamentRuleError);
  });

  it('captures immutable participants and rules when a match starts', () => {
    let state = base();
    for (const team of ['A', 'B']) {
      state = reduceTournament(state, command(state, 'add-entry', {
        divisionId: state.divisions[0].id,
        teamName: team,
        playerNames: [`${team} One`, `${team} Two`],
        ids: { entryId: id('entry'), playerIds: [id('player'), id('player')], lineupRevisionId: id('lineup') },
      }), { actorId: 'owner', now: 999 });
    }
    const stage: TournamentStage = {
      id: id('stage'), divisionId: state.divisions[0].id, name: 'Manual', kind: 'manual', order: 1,
      entryIds: state.entries.map((entry) => entry.id), groupIds: [], defaultRuleProfileId: 'first-to-five',
      qualificationConfirmedAt: null, qualificationFingerprint: null, amended: false, closedAt: null,
      ...stagePlanningDefaults(),
    };
    state = reduceTournament(state, command(state, 'add-stage', { stage }), { actorId: 'owner', now: 999 });
    const fixture = makeFixture({ id: id('fixture'), divisionId: stage.divisionId, stageId: stage.id, label: 'M1', sideA: { kind: 'entry', entryId: state.entries[0].id }, sideB: { kind: 'entry', entryId: state.entries[1].id }, ruleProfileId: 'first-to-five', queueOrder: 1 });
    state = reduceTournament(state, command(state, 'add-manual-fixture', { fixture }), { actorId: 'owner', now: 999 });
    state = reduceTournament(state, command(state, 'begin-event'), { actorId: 'owner', now: 999 });
    state = reduceTournament(state, command(state, 'start-match', { fixtureId: fixture.id, courtId: state.courts[0].id }), { actorId: 'owner', now: 999 });
    const started = state.fixtures[0];
    expect(started.actualEntryIds).toEqual([state.entries[0].id, state.entries[1].id]);
    expect(started.actualPlayerIds?.flat()).toHaveLength(4);
    expect(started.actualRuleProfile).toEqual(state.ruleProfiles.find((profile) => profile.id === 'first-to-five'));
    expect(started.actualRuleProfile).not.toBe(state.ruleProfiles.find((profile) => profile.id === 'first-to-five'));
    expect(started.actualStartAt).toBeGreaterThan(0);
  });

  it('rejects closed-state generic edits without changing the input', () => {
    const state = base();
    state.lifecycle = 'complete';
    const before = JSON.stringify(state);
    expect(() => reduceTournament(state, command(state, 'update-capacity', { divisionId: state.divisions[0].id, capacity: 10 }), { actorId: 'owner', now: 999 })).toThrow(TournamentRuleError);
    expect(JSON.stringify(state)).toBe(before);
  });

  it('rejects forged actual participants on a new manual fixture', () => {
    const state = base();
    const forged = makeFixture({ id: id('fixture'), divisionId: state.divisions[0].id, stageId: id('stage'), label: 'Forged', sideA: { kind: 'bye' }, sideB: { kind: 'bye' }, ruleProfileId: 'first-to-five', queueOrder: 1 });
    forged.status = 'playing';
    forged.actualEntryIds = ['fake-a', 'fake-b'];
    forged.actualPlayerIds = [['fake-1', 'fake-2'], ['fake-3', 'fake-4']];
    forged.actualRuleProfile = state.ruleProfiles[0];
    expect(() => reduceTournament(state, command(state, 'add-manual-fixture', { fixture: forged }), { actorId: 'owner', now: 999 })).toThrow(TournamentRuleError);
  });

  it('rejects invalid lifecycle enums and future snapshots', () => {
    const state = base();
    expect(() => validateTournament({ ...state, lifecycle: 'mystery' } as unknown as TournamentV1)).toThrow(TournamentRuleError);
    const invalidReadiness = JSON.parse(JSON.stringify(state)) as TournamentV1;
    invalidReadiness.entries = [];
    expect(validateTournament(invalidReadiness)).toBe(invalidReadiness);
  });
});
