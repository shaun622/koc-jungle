import { describe, expect, it } from 'vitest';
import { createTournamentV1, firstPlayedLossEligibility, makeFixture, stagePlanningDefaults, type TournamentResult, type TournamentStage } from '@/logic/tournament';

function result(kind: TournamentResult['kind'], winnerEntryId: string): TournamentResult {
  return { revision: 1, kind, winnerEntryId, score: kind === 'played' ? { sets: [{ gamesA: winnerEntryId === 'e1' ? 5 : 3, gamesB: winnerEntryId === 'e1' ? 3 : 5 }] } : null, reason: kind === 'played' ? '' : 'Recorded by organiser', confirmedAt: 10, retrospective: false };
}

describe('tournament v1 first-played-loss plate', () => {
  it('ignores a bye and walkover win before a first played loss', () => {
    const state = createTournamentV1({ id: 't', title: 'Plate', now: 1, divisionId: 'd', courtIds: ['c'] });
    const stage: TournamentStage = { id: 'main', divisionId: 'd', name: 'Main', kind: 'knockout', order: 1, entryIds: ['e1'], groupIds: [], defaultRuleProfileId: 'first-to-five', qualificationConfirmedAt: null, qualificationFingerprint: null, amended: false, closedAt: null, ...stagePlanningDefaults() };
    state.stages.push(stage);
    const bye = makeFixture({ id: 'bye', divisionId: 'd', stageId: 'main', label: 'Bye', sideA: { kind: 'entry', entryId: 'e1' }, sideB: { kind: 'bye' }, ruleProfileId: 'first-to-five', queueOrder: 1 });
    bye.status = 'resolved-bye';
    const walkover = makeFixture({ id: 'walkover', divisionId: 'd', stageId: 'main', label: 'Walkover', sideA: { kind: 'entry', entryId: 'e1' }, sideB: { kind: 'entry', entryId: 'e2' }, ruleProfileId: 'first-to-five', queueOrder: 2 });
    walkover.status = 'completed'; walkover.actualEntryIds = ['e1', 'e2']; walkover.actualStartAt = 20; walkover.result = result('walkover', 'e1');
    const played = makeFixture({ id: 'played', divisionId: 'd', stageId: 'main', label: 'Played', sideA: { kind: 'entry', entryId: 'e1' }, sideB: { kind: 'entry', entryId: 'e3' }, ruleProfileId: 'first-to-five', queueOrder: 3 });
    played.status = 'completed'; played.actualEntryIds = ['e1', 'e3']; played.actualStartAt = 30; played.result = result('played', 'e3');
    state.fixtures.push(bye, walkover, played);
    expect(firstPlayedLossEligibility(state, 'main').eligible).toEqual(['e1']);
  });

  it('excludes a later loser that already won a played match and leaves administrative outcomes unresolved', () => {
    const state = createTournamentV1({ id: 't', title: 'Plate', now: 1, divisionId: 'd', courtIds: ['c'] });
    state.stages.push({ id: 'main', divisionId: 'd', name: 'Main', kind: 'knockout', order: 1, entryIds: ['winner-then-loser', 'retired-loser', 'admin'], groupIds: [], defaultRuleProfileId: 'first-to-five', qualificationConfirmedAt: null, qualificationFingerprint: null, amended: false, closedAt: null, ...stagePlanningDefaults() });
    const add = (id: string, a: string, b: string, winner: string, kind: TournamentResult['kind'], at: number) => {
      const fixture = makeFixture({ id, divisionId: 'd', stageId: 'main', label: id, sideA: { kind: 'entry', entryId: a }, sideB: { kind: 'entry', entryId: b }, ruleProfileId: 'first-to-five', queueOrder: at });
      fixture.status = 'completed'; fixture.actualEntryIds = [a, b]; fixture.actualStartAt = at; fixture.result = result(kind, winner); state.fixtures.push(fixture);
    };
    add('m1', 'winner-then-loser', 'other-1', 'winner-then-loser', 'played', 10);
    add('m2', 'winner-then-loser', 'other-2', 'other-2', 'played', 20);
    add('m3', 'retired-loser', 'other-3', 'other-3', 'retirement', 30);
    add('m4', 'admin', 'other-4', 'other-4', 'administrative', 40);
    expect(firstPlayedLossEligibility(state, 'main')).toEqual({ eligible: ['retired-loser'], unresolved: ['admin'], excluded: ['winner-then-loser'] });
    expect(firstPlayedLossEligibility(state, 'main', [{ entryId: 'admin', decision: 'include', reason: 'Organiser ruling' }])).toEqual({ eligible: ['retired-loser', 'admin'], unresolved: [], excluded: ['winner-then-loser'] });
  });
});
