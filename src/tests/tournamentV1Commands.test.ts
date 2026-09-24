import { describe, expect, it } from 'vitest';
import {
  createTournamentV1,
  createCourtClosureProposal,
  createDrawProposal,
  createGroupAmendmentProposal,
  generateRoundRobinFixtures,
  makeFixture,
  nextOwnerCommand,
  reduceTournament,
  resolveFixtureSources,
  stagePlanningDefaults,
  TournamentRuleError,
  type TournamentCommandEnvelope,
  type TournamentCommandKind,
  type TournamentStage,
  type TournamentV1,
} from '@/logic/tournament';

let counter = 0;
const id = (prefix = 'id') => `${prefix}-${++counter}`;
function base(): TournamentV1 {
  counter = 0;
  return createTournamentV1({ id: id('t'), title: 'Test', now: 1, divisionId: id('d'), courtIds: [id('c'), id('c')] });
}
function command(state: TournamentV1, kind: TournamentCommandKind, payload: Record<string, unknown> = {}, reason?: string): TournamentCommandEnvelope {
  return nextOwnerCommand(state, { commandId: id('cmd'), deviceId: 'device-a', kind, payload, reason, issuedAt: 10 });
}
function apply(state: TournamentV1, kind: TournamentCommandKind, payload: Record<string, unknown> = {}, reason?: string): TournamentV1 {
  return reduceTournament(state, command(state, kind, payload, reason), { actorId: 'owner', now: Number(state.revision) + 10 });
}
function addPair(state: TournamentV1, teamName: string): TournamentV1 {
  return apply(state, 'add-entry', { divisionId: state.divisions[0].id, teamName, playerNames: [`${teamName} One`, `${teamName} Two`], ids: { entryId: id('e'), playerIds: [id('p'), id('p')], lineupRevisionId: id('l') } });
}
function withManualFixture(): TournamentV1 {
  let state = addPair(addPair(base(), 'Alpha'), 'Bravo');
  const stage: TournamentStage = { id: id('s'), divisionId: state.divisions[0].id, name: 'Manual', kind: 'manual', order: 1, entryIds: state.entries.map((entry) => entry.id), groupIds: [], defaultRuleProfileId: 'first-to-five', qualificationConfirmedAt: null, qualificationFingerprint: null, amended: false, closedAt: null, ...stagePlanningDefaults() };
  state = apply(state, 'add-stage', { stage });
  const fixture = makeFixture({ id: id('f'), divisionId: stage.divisionId, stageId: stage.id, label: 'M1', sideA: { kind: 'entry', entryId: state.entries[0].id }, sideB: { kind: 'entry', entryId: state.entries[1].id }, ruleProfileId: stage.defaultRuleProfileId, queueOrder: 1 });
  state = apply(state, 'add-manual-fixture', { fixture });
  return state;
}

describe('tournament v1 commands', () => {
  it('keeps capacity independent when a court closes', () => {
    let state = base();
    const capacity = state.divisions[0].capacity;
    state = apply(state, 'set-court-availability', { courtId: state.courts[0].id, available: false });
    expect(state.divisions[0].capacity).toBe(capacity);
    expect(state.courts[0].available).toBe(false);
  });

  it('promotes before draw publication but never after it', () => {
    let state = base();
    state = apply(state, 'update-capacity', { divisionId: state.divisions[0].id, capacity: 1 });
    state = addPair(addPair(state, 'Alpha'), 'Bravo');
    expect(state.entries.map((entry) => entry.admission)).toEqual(['confirmed', 'waiting']);
    state = apply(state, 'cancel-entry', { entryId: state.entries[0].id });
    expect(state.entries[1].admission).toBe('confirmed');
    state = addPair(state, 'Charlie');
    state = apply(state, 'publish-draw', { divisionId: state.divisions[0].id });
    state = apply(state, 'cancel-entry', { entryId: state.entries[1].id });
    expect(state.entries.find((entry) => entry.teamName === 'Charlie')?.admission).toBe('waiting');
  });

  it('requires an audited reason for a deliberate duplicate pair', () => {
    let state = addPair(base(), 'Alpha');
    const payload = { divisionId: state.divisions[0].id, teamName: 'Alpha again', playerNames: ['Alpha One', 'Alpha Two'], ids: { entryId: id('e'), playerIds: [id('p'), id('p')], lineupRevisionId: id('l') }, allowDuplicate: true };
    expect(() => apply(state, 'add-entry', payload)).toThrow(/reason/i);
    state = apply(state, 'add-entry', payload, 'Separate paid entry confirmed by organiser');
    expect(state.entries).toHaveLength(2);
  });

  it('can explicitly link an existing player without duplicating that player record', () => {
    let state = addPair(base(), 'Alpha');
    const existing = state.players[0];
    state = apply(state, 'add-entry', {
      divisionId: state.divisions[0].id,
      teamName: 'Linked pair',
      playerNames: [existing.name, 'Charlie'],
      existingPlayerIds: [existing.id, null],
      ids: { entryId: id('e'), playerIds: [id('p'), id('p')], lineupRevisionId: id('l') },
    });
    expect(state.players).toHaveLength(3);
    expect(state.entries[1].playerIds[0]).toBe(existing.id);
  });

  it('applies a reviewed multi-stage draw bundle atomically', () => {
    let state = addPair(addPair(base(), 'Alpha'), 'Bravo');
    const proposals = ['Gold', 'Silver'].map((name, index) => {
      const stage: TournamentStage = { id: id('s'), divisionId: state.divisions[0].id, name, kind: 'knockout', order: index + 1, entryIds: state.entries.map((entry) => entry.id), groupIds: [], defaultRuleProfileId: 'standard-set', qualificationConfirmedAt: null, qualificationFingerprint: null, amended: false, closedAt: null, ...stagePlanningDefaults() };
      const fixture = makeFixture({ id: id('f'), divisionId: stage.divisionId, stageId: stage.id, label: `${name} final`, sideA: { kind: 'entry', entryId: state.entries[0].id }, sideB: { kind: 'entry', entryId: state.entries[1].id }, ruleProfileId: stage.defaultRuleProfileId, queueOrder: index + 1 });
      return createDrawProposal({ baseRevision: state.revision, stage, groups: [], fixtures: [fixture] });
    });
    state = apply(state, 'apply-draw-bundle', { proposals });
    expect(state.stages.slice(-2).map((stage) => stage.name)).toEqual(['Gold', 'Silver']);
    expect(state.fixtures.slice(-2).map((fixture) => fixture.label)).toEqual(['Gold final', 'Silver final']);
  });

  it('rejects a stale draw bundle without applying any stage', () => {
    let state = addPair(addPair(base(), 'Alpha'), 'Bravo');
    const stage: TournamentStage = { id: id('s'), divisionId: state.divisions[0].id, name: 'Gold', kind: 'knockout', order: 1, entryIds: state.entries.map((entry) => entry.id), groupIds: [], defaultRuleProfileId: 'standard-set', qualificationConfirmedAt: null, qualificationFingerprint: null, amended: false, closedAt: null, ...stagePlanningDefaults() };
    const fixture = makeFixture({ id: id('f'), divisionId: stage.divisionId, stageId: stage.id, label: 'Gold final', sideA: { kind: 'entry', entryId: state.entries[0].id }, sideB: { kind: 'entry', entryId: state.entries[1].id }, ruleProfileId: stage.defaultRuleProfileId, queueOrder: 1 });
    const proposal = createDrawProposal({ baseRevision: state.revision, stage, groups: [], fixtures: [fixture] });
    state = apply(state, 'update-metadata', { patch: { venue: 'Changed after review' } });
    expect(() => apply(state, 'apply-draw-bundle', { proposals: [proposal] })).toThrow(/changed after this draw/i);
    expect(state.stages).toHaveLength(0);
    expect(state.fixtures).toHaveLength(0);
  });

  it('amends a started group by adding only reviewed future fixtures and preserving played history', () => {
    let state = addPair(addPair(addPair(base(), 'Alpha'), 'Bravo'), 'Charlie');
    const existingEntryIds = state.entries.slice(0, 2).map((entry) => entry.id);
    const stage: TournamentStage = { id: id('s'), divisionId: state.divisions[0].id, name: 'Groups', kind: 'group', order: 1, entryIds: existingEntryIds, groupIds: [], defaultRuleProfileId: 'first-to-five', qualificationConfirmedAt: null, qualificationFingerprint: null, amended: false, closedAt: null, ...stagePlanningDefaults() };
    const group = { id: id('g'), stageId: stage.id, name: 'Group A', entryIds: existingEntryIds, fixtureIds: [] as string[], qualifierOrder: null };
    stage.groupIds = [group.id];
    const fixtures = generateRoundRobinFixtures({ divisionId: stage.divisionId, stageId: stage.id, groups: [group], ruleProfileId: stage.defaultRuleProfileId, id });
    group.fixtureIds = fixtures.map((fixture) => fixture.id);
    state = apply(state, 'apply-draw-proposal', { proposal: createDrawProposal({ baseRevision: state.revision, stage, groups: [group], fixtures }) });
    state = apply(state, 'update-metadata', { patch: { signupOpen: false } });
    state = apply(state, 'begin-event');
    state = apply(state, 'record-result', { fixtureId: fixtures[0].id, result: { kind: 'played', winnerEntryId: existingEntryIds[0], score: { sets: [{ gamesA: 5, gamesB: 3 }] }, reason: '', retrospective: true } });
    const playedBefore = JSON.stringify(state.fixtures.find((fixture) => fixture.id === fixtures[0].id));
    const lateEntryId = state.entries[2].id;
    const proposal = createGroupAmendmentProposal(state, stage.id, group.id, lateEntryId, id);
    expect(() => apply(state, 'apply-group-amendment', { proposal })).toThrow(/reason/i);
    state = apply(state, 'apply-group-amendment', { proposal }, 'Paid late arrival accepted by organiser');
    expect(JSON.stringify(state.fixtures.find((fixture) => fixture.id === fixtures[0].id))).toBe(playedBefore);
    expect(state.groups[0].entryIds).toEqual([...existingEntryIds, lateEntryId]);
    expect(state.groups[0].fixtureIds).toHaveLength(3);
    expect(state.fixtures.filter((fixture) => fixture.stageId === stage.id && fixture.status === 'planned')).toHaveLength(2);
    expect(state.stages[0]).toMatchObject({ amended: true, qualificationConfirmedAt: null, qualificationFingerprint: null });
    expect(() => apply(state, 'confirm-qualifiers', { stageId: stage.id, policy: stage.standingsPolicy, manual: false, orderedByGroup: { [group.id]: state.groups[0].entryIds }, decisionId: id('decision') })).toThrow(/amended group/i);
  });

  it('rejects a stale group amendment without changing the group', () => {
    let state = addPair(addPair(addPair(base(), 'Alpha'), 'Bravo'), 'Charlie');
    const stage: TournamentStage = { id: id('s'), divisionId: state.divisions[0].id, name: 'Groups', kind: 'group', order: 1, entryIds: state.entries.slice(0, 2).map((entry) => entry.id), groupIds: [], defaultRuleProfileId: 'first-to-five', qualificationConfirmedAt: null, qualificationFingerprint: null, amended: false, closedAt: null, ...stagePlanningDefaults() };
    const group = { id: id('g'), stageId: stage.id, name: 'Group A', entryIds: [...stage.entryIds], fixtureIds: [] as string[], qualifierOrder: null };
    stage.groupIds = [group.id];
    const fixtures = generateRoundRobinFixtures({ divisionId: stage.divisionId, stageId: stage.id, groups: [group], ruleProfileId: stage.defaultRuleProfileId, id });
    group.fixtureIds = fixtures.map((fixture) => fixture.id);
    state = apply(state, 'apply-draw-proposal', { proposal: createDrawProposal({ baseRevision: state.revision, stage, groups: [group], fixtures }) });
    const proposal = createGroupAmendmentProposal(state, stage.id, group.id, state.entries[2].id, id);
    state = apply(state, 'update-metadata', { patch: { venue: 'Changed after review' } });
    const before = JSON.stringify(state.groups[0]);
    expect(() => apply(state, 'apply-group-amendment', { proposal }, 'Late arrival')).toThrow(/changed after this group amendment/i);
    expect(JSON.stringify(state.groups[0])).toBe(before);
  });

  it('resolves a structural bye without a result or win', () => {
    let state = addPair(base(), 'Alpha');
    const stage: TournamentStage = { id: id('s'), divisionId: state.divisions[0].id, name: 'KO', kind: 'knockout', order: 1, entryIds: [state.entries[0].id], groupIds: [], defaultRuleProfileId: 'standard-set', qualificationConfirmedAt: null, qualificationFingerprint: null, amended: false, closedAt: null, ...stagePlanningDefaults() };
    state = apply(state, 'add-stage', { stage });
    const fixture = makeFixture({ id: id('f'), divisionId: stage.divisionId, stageId: stage.id, label: 'Bye', sideA: { kind: 'entry', entryId: state.entries[0].id }, sideB: { kind: 'bye' }, ruleProfileId: stage.defaultRuleProfileId, queueOrder: 1 });
    state.fixtures.push(fixture);
    state = resolveFixtureSources(state);
    expect(state.fixtures[0]).toMatchObject({ status: 'resolved-bye', result: null });
  });

  it('prevents closing an occupied court and preserves suspended score when moved', () => {
    let state = withManualFixture();
    state = apply(state, 'update-metadata', { patch: { signupOpen: false } });
    state = apply(state, 'begin-event');
    const fixtureId = state.fixtures[0].id;
    state = apply(state, 'start-match', { fixtureId, courtId: state.courts[0].id });
    expect(() => apply(state, 'set-court-availability', { courtId: state.courts[0].id, available: false })).toThrow(TournamentRuleError);
    state = apply(state, 'publish-progress', { fixtureId, score: { sets: [{ gamesA: 2, gamesB: 1 }] } });
    state = apply(state, 'suspend-match', { fixtureId });
    state = apply(state, 'release-court', { fixtureId });
    state = apply(state, 'resume-match', { fixtureId, courtId: state.courts[1].id });
    expect(state.fixtures[0]).toMatchObject({ status: 'playing', courtId: state.courts[1].id, liveScore: { sets: [{ gamesA: 2, gamesB: 1 }] } });
  });

  it('applies an occupied-court closure as one reviewed change', () => {
    let state = withManualFixture();
    state = apply(state, 'begin-event');
    const fixtureId = state.fixtures[0].id; const courtId = state.courts[0].id; const capacity = state.divisions[0].capacity;
    state = apply(state, 'start-match', { fixtureId, courtId });
    const proposal = createCourtClosureProposal(state, courtId, [{ fixtureId, action: 'suspend-release', reason: 'Court surface unsafe' }]);
    state = apply(state, 'apply-court-closure', { proposal });
    expect(state.fixtures[0]).toMatchObject({ status: 'suspended', courtId: null });
    expect(state.courts[0].available).toBe(false);
    expect(state.divisions[0].capacity).toBe(capacity);
  });

  it('requires review to start inside a prior player rest window', () => {
    let state = withManualFixture();
    const stage = state.stages[0];
    const second = makeFixture({ id: id('f'), divisionId: stage.divisionId, stageId: stage.id, label: 'M2', sideA: { kind: 'entry', entryId: state.entries[0].id }, sideB: { kind: 'entry', entryId: state.entries[1].id }, ruleProfileId: stage.defaultRuleProfileId, queueOrder: 2 });
    state = apply(state, 'add-manual-fixture', { fixture: second });
    state = apply(state, 'begin-event');
    state = apply(state, 'record-result', { fixtureId: state.fixtures[0].id, result: { kind: 'played', winnerEntryId: state.entries[0].id, score: { sets: [{ gamesA: 5, gamesB: 3 }] }, reason: '', retrospective: true } });
    expect(() => apply(state, 'start-match', { fixtureId: second.id, courtId: state.courts[0].id })).toThrow(TournamentRuleError);
    state = apply(state, 'start-match', { fixtureId: second.id, courtId: state.courts[0].id, acknowledgeRest: true }, 'Schedule running late');
    expect(state.fixtures.find((fixture) => fixture.id === second.id)?.status).toBe('playing');
  });

  it('rejects stale revisions and duplicate live sequences', () => {
    let state = withManualFixture();
    state = apply(state, 'begin-event');
    const next = command(state, 'start-match', { fixtureId: state.fixtures[0].id, courtId: state.courts[0].id });
    const applied = reduceTournament(state, next, { actorId: 'owner', now: 20 });
    expect(() => reduceTournament(applied, next, { actorId: 'owner', now: 21 })).toThrow(TournamentRuleError);
  });

  it('undoes only while the touched records still match the audited after-state', () => {
    let state = base();
    state = apply(state, 'update-metadata', { patch: { venue: 'Court A' } });
    const venueCommand = state.audit.at(-1)!.commandId;
    state = apply(state, 'update-capacity', { divisionId: state.divisions[0].id, capacity: 12 });
    state = apply(state, 'undo-command', { commandId: venueCommand }, 'Correct venue');
    expect(state.meta.venue).toBe('');
    expect(state.divisions[0].capacity).toBe(12);
  });
});
