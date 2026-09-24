import { describe, expect, it } from 'vitest';
import {
  computeGroupStandings,
  createTournamentV1,
  makeFixture,
  stagePlanningDefaults,
  standingsFingerprint,
  type RuleProfile,
  type TournamentFixture,
  type TournamentStage,
} from '@/logic/tournament';

function groupState() {
  const state = createTournamentV1({ id: 't', title: 'Standings', now: 1, divisionId: 'd', courtIds: ['c'] });
  for (const id of ['a', 'b', 'c']) {
    state.players.push({ id: `${id}1`, name: `${id} one` }, { id: `${id}2`, name: `${id} two` });
    state.entries.push({ id, divisionId: 'd', teamName: id, playerIds: [`${id}1`, `${id}2`], admission: 'confirmed', readiness: 'ready', acceptedAt: 1, waitRank: null, activeLineupRevisionId: `l${id}` });
    state.lineupRevisions.push({ id: `l${id}`, entryId: id, playerIds: [`${id}1`, `${id}2`], effectiveFixtureIds: [], createdAt: 1, reason: 'Initial' });
  }
  const stage: TournamentStage = { id: 's', divisionId: 'd', name: 'Groups', kind: 'group', order: 1, entryIds: ['a', 'b', 'c'], groupIds: ['g'], defaultRuleProfileId: 'first-to-five', qualificationConfirmedAt: null, qualificationFingerprint: null, amended: false, closedAt: null, ...stagePlanningDefaults(), seedOrder: ['a', 'b', 'c'] };
  state.stages.push(stage);
  state.groups.push({ id: 'g', stageId: 's', name: 'A', entryIds: ['a', 'b', 'c'], fixtureIds: ['ab', 'bc', 'ca'], qualifierOrder: null });
  return state;
}

function completed(state: ReturnType<typeof groupState>, id: string, a: string, b: string, winner: string, profile: RuleProfile, kind: 'played' | 'walkover' = 'played'): TournamentFixture {
  const fixture = makeFixture({ id, divisionId: 'd', stageId: 's', groupId: 'g', label: id, sideA: { kind: 'entry', entryId: a }, sideB: { kind: 'entry', entryId: b }, ruleProfileId: profile.id, queueOrder: state.fixtures.length + 1 });
  fixture.status = 'completed'; fixture.actualEntryIds = [a, b];
  fixture.actualPlayerIds = [state.entries.find((entry) => entry.id === a)!.playerIds, state.entries.find((entry) => entry.id === b)!.playerIds];
  fixture.actualRuleProfile = { ...profile }; fixture.actualStartAt = 10; fixture.actualEndAt = 20;
  const loserGames = profile.gameMargin === 1 ? profile.gamesToWin - 1 : profile.gamesToWin - 2;
  fixture.result = { revision: 1, kind, winnerEntryId: winner, score: kind === 'played' ? { sets: [{ gamesA: winner === a ? profile.gamesToWin : loserGames, gamesB: winner === b ? profile.gamesToWin : loserGames }] } : null, reason: kind === 'played' ? '' : 'No show', confirmedAt: 20, retrospective: false };
  return fixture;
}

describe('tournament v2 standings and qualification inputs', () => {
  it('leaves a full three-way cohort unresolved until a full explicit order is supplied', () => {
    const state = groupState();
    const profile = state.ruleProfiles.find((item) => item.id === 'first-to-five')!;
    state.fixtures.push(completed(state, 'ab', 'a', 'b', 'a', profile), completed(state, 'bc', 'b', 'c', 'b', profile), completed(state, 'ca', 'c', 'a', 'c', profile));
    const unresolved = computeGroupStandings(state, 'g');
    expect(unresolved.unresolvedCohorts).toEqual([['a', 'b', 'c']]);
    expect(unresolved.rows.every((row) => row.tied)).toBe(true);
    const resolved = computeGroupStandings(state, 'g', { winPoints: 2, lossPoints: 0, includeSetDifference: false, explicitOrder: ['c', 'a', 'b'] });
    expect(resolved.unresolvedCohorts).toEqual([]);
    expect(resolved.rows.map((row) => row.entryId)).toEqual(['c', 'a', 'b']);
  });

  it('disables differentials only for mixed confirmed played profiles', () => {
    const state = groupState();
    const games = state.ruleProfiles.find((item) => item.id === 'first-to-five')!;
    const sets = state.ruleProfiles.find((item) => item.id === 'standard-set')!;
    state.fixtures.push(completed(state, 'ab', 'a', 'b', 'a', games), completed(state, 'bc', 'b', 'c', 'b', sets), completed(state, 'ca', 'c', 'a', 'c', sets, 'walkover'));
    expect(computeGroupStandings(state, 'g').differentialDisabled).toBe(true);
    state.fixtures[1].actualRuleProfile = { ...games };
    state.fixtures[1].result = { ...state.fixtures[1].result!, score: { sets: [{ gamesA: 5, gamesB: 4 }] } };
    expect(computeGroupStandings(state, 'g').differentialDisabled).toBe(false);
  });

  it('fingerprints a same-winner differential correction', () => {
    const state = groupState();
    const profile = state.ruleProfiles.find((item) => item.id === 'first-to-five')!;
    state.fixtures.push(completed(state, 'ab', 'a', 'b', 'a', profile), completed(state, 'bc', 'b', 'c', 'b', profile), completed(state, 'ca', 'c', 'a', 'c', profile));
    const before = standingsFingerprint(state, ['g']);
    state.fixtures[0].result = { ...state.fixtures[0].result!, revision: 2, score: { sets: [{ gamesA: 5, gamesB: 0 }] } };
    expect(standingsFingerprint(state, ['g'])).not.toBe(before);
  });
});
