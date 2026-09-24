import { describe, expect, it } from 'vitest';
import {
  createScheduleProposal,
  createTournamentV1,
  makeFixture,
  stagePlanningDefaults,
  suggestSchedule,
  TournamentRuleError,
  validateScheduleProposal,
  type TournamentFixture,
  type TournamentStage,
  type TournamentV1,
} from '@/logic/tournament';

const at = (time: string) => `2026-09-12T${time}:00.000Z`;

function base(courtIds = ['c1', 'c2'], entryCount = 6): TournamentV1 {
  const state = createTournamentV1({ id: 't', title: 'Schedule', now: 1, divisionId: 'd', courtIds });
  for (let index = 0; index < entryCount; index += 1) {
    const entryId = `e${index}`; const players = [`p${index}a`, `p${index}b`] as [string, string];
    state.players.push({ id: players[0], name: `P${index}A` }, { id: players[1], name: `P${index}B` });
    state.entries.push({ id: entryId, divisionId: 'd', teamName: `T${index}`, playerIds: players, admission: 'confirmed', readiness: 'ready', acceptedAt: index, waitRank: null, activeLineupRevisionId: `l${index}` });
    state.lineupRevisions.push({ id: `l${index}`, entryId, playerIds: players, effectiveFixtureIds: [], createdAt: 1, reason: 'Initial' });
  }
  const stage: TournamentStage = { id: 's', divisionId: 'd', name: 'Manual', kind: 'manual', order: 1, entryIds: state.entries.map((entry) => entry.id), groupIds: [], defaultRuleProfileId: 'first-to-five', qualificationConfirmedAt: null, qualificationFingerprint: null, amended: false, closedAt: null, ...stagePlanningDefaults(), seedOrder: state.entries.map((entry) => entry.id) };
  state.stages.push(stage);
  return state;
}

function match(state: TournamentV1, id: string, a: string, b: string, order: number): TournamentFixture {
  const fixture = makeFixture({ id, divisionId: 'd', stageId: 's', label: id, sideA: { kind: 'entry', entryId: a }, sideB: { kind: 'entry', entryId: b }, ruleProfileId: 'first-to-five', queueOrder: order });
  state.fixtures.push(fixture); return fixture;
}

describe('tournament v2 interval scheduling', () => {
  it('keeps independent courts moving and preserves a c1 pin', () => {
    const state = base();
    const pinned = match(state, 'pin', 'e0', 'e1', 1); pinned.pinned = true; pinned.courtId = 'c1'; pinned.plannedStartAt = at('10:00');
    match(state, 'free', 'e2', 'e3', 2);
    const suggestions = suggestSchedule(state, at('10:00'));
    expect(suggestions.find((item) => item.fixtureId === 'pin')).toMatchObject({ courtId: 'c1', plannedStartAt: at('10:00') });
    expect(suggestions.find((item) => item.fixtureId === 'free')?.courtId).toBe('c2');
  });

  it('reserves rest both before and after a later pin', () => {
    const state = base(['c1']);
    const before = match(state, 'before', 'e0', 'e2', 1);
    const pinned = match(state, 'pin', 'e0', 'e1', 2); pinned.pinned = true; pinned.courtId = 'c1'; pinned.plannedStartAt = at('10:40');
    const after = match(state, 'after', 'e0', 'e3', 3);
    const suggestions = suggestSchedule(state, at('10:00'));
    expect(suggestions.find((item) => item.fixtureId === before.id)?.plannedEndAt).toBe(at('10:20'));
    expect(suggestions.find((item) => item.fixtureId === after.id)?.plannedStartAt).toBe(at('11:15'));
  });

  it('lets another court proceed while an overrun reserves its court indefinitely', () => {
    const state = base();
    const active = match(state, 'active', 'e0', 'e1', 1);
    active.status = 'playing'; active.courtId = 'c1'; active.actualStartAt = Date.parse(at('09:00'));
    active.actualEntryIds = ['e0', 'e1']; active.actualPlayerIds = [state.entries[0].playerIds, state.entries[1].playerIds]; active.actualRuleProfile = { ...state.ruleProfiles[0] };
    match(state, 'free', 'e2', 'e3', 2);
    expect(suggestSchedule(state, at('10:00')).find((item) => item.fixtureId === 'free')?.courtId).toBe('c2');
  });

  it('a released suspended match frees the court but not its players', () => {
    const state = base(['c1']);
    const suspended = match(state, 'suspended', 'e0', 'e1', 1);
    suspended.status = 'suspended'; suspended.courtId = null; suspended.actualStartAt = Date.parse(at('09:50'));
    suspended.actualEntryIds = ['e0', 'e1']; suspended.actualPlayerIds = [state.entries[0].playerIds, state.entries[1].playerIds]; suspended.actualRuleProfile = { ...state.ruleProfiles[0] };
    match(state, 'blocked-player', 'e0', 'e2', 2);
    match(state, 'other-players', 'e3', 'e4', 3);
    const suggestions = suggestSchedule(state, at('10:00'));
    expect(suggestions.find((item) => item.fixtureId === 'blocked-player')).toMatchObject({ courtId: null, plannedStartAt: null });
    expect(suggestions.find((item) => item.fixtureId === 'other-players')?.courtId).toBe('c1');
  });

  it('uses the selected substitution identity for reservations', () => {
    const state = base(['c1']);
    state.players.push({ id: 'substitute', name: 'Substitute' });
    const selected = match(state, 'selected', 'e0', 'e1', 1);
    state.lineupRevisions.push({ id: 'sub-revision', entryId: 'e0', playerIds: ['substitute', 'p0b'], effectiveFixtureIds: [selected.id], createdAt: 2, reason: 'Selected' });
    const active = match(state, 'active', 'e2', 'e3', 2);
    active.status = 'suspended'; active.courtId = null; active.actualStartAt = Date.parse(at('09:50'));
    active.actualEntryIds = ['e2', 'e3']; active.actualPlayerIds = [['substitute', 'p2b'], state.entries[3].playerIds]; active.actualRuleProfile = { ...state.ruleProfiles[0] };
    expect(suggestSchedule(state, at('10:00')).find((item) => item.fixtureId === selected.id)).toMatchObject({ courtId: null, plannedStartAt: null });
  });

  it('reports closed windows and partial pins without inventing assignments', () => {
    const state = base(['c1']); state.courts[0].availabilityWindows = [];
    const unscheduled = match(state, 'unscheduled', 'e0', 'e1', 1);
    const partial = match(state, 'partial', 'e2', 'e3', 2); partial.pinned = true; partial.courtId = 'c1';
    const suggestions = suggestSchedule(state, at('10:00'));
    expect(suggestions.find((item) => item.fixtureId === unscheduled.id)?.reason).toMatch(/availability window/i);
    expect(suggestions.find((item) => item.fixtureId === partial.id)?.reason).toBe('Pinned fixture needs court/time.');
  });

  it('binds reviewed schedule proposals to the exact revision and content', () => {
    const state = base(); match(state, 'fixture', 'e0', 'e1', 1);
    const proposal = createScheduleProposal(state, at('10:00'));
    expect(() => validateScheduleProposal(proposal, '1')).toThrow(TournamentRuleError);
    expect(() => validateScheduleProposal({ ...proposal, suggestions: [{ ...proposal.suggestions[0], courtId: 'c2' }] }, state.revision)).toThrow(TournamentRuleError);
  });
});
