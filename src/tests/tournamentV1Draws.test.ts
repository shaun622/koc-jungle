import { describe, expect, it } from 'vitest';
import { assertTournamentDependencyAcyclic, balancedSeedOrder, bergerRounds, bracketSlots, createDrawProposal, createTournamentV1, defaultGroups, deterministicIdFactory, generateKnockoutFixtures, goldSilverSources, makeFixture, resolveFixtureSources, seededOrder, stagePlanningDefaults, TournamentRuleError, validateDrawProposal, type TournamentStage } from '@/logic/tournament';

describe('tournament v1 draw generation', () => {
  it('uses the fixed five-entry grouping vector', () => {
    expect(defaultGroups(['1', '2', '3', '4', '5'])).toEqual([['1', '2', '3'], ['4', '5']]);
    const rounds = bergerRounds(['1', '2', '3', '4', '5']);
    expect(rounds).toHaveLength(5);
    expect(new Set(rounds.flat().map((pair) => pair.slice().sort().join('-'))).size).toBe(10);
  });

  it('uses balanced slots and explicit byes for six seeds', () => {
    const sources = ['1', '2', '3', '4', '5', '6'].map((entryId) => ({ kind: 'entry' as const, entryId }));
    expect(balancedSeedOrder(8)).toEqual([0, 7, 3, 4, 1, 6, 2, 5]);
    expect(bracketSlots(sources)).toEqual([
      sources[0], { kind: 'bye' }, sources[3], sources[4], sources[1], { kind: 'bye' }, sources[2], sources[5],
    ]);
  });

  it('keeps group order in Gold and Silver bands', () => {
    const sources = goldSilverSources(['A', 'B', 'C', 'D']);
    expect(sources.gold.map((source) => source.kind === 'group-position' ? `${source.groupId}${source.position}` : '')).toEqual(['A1', 'B1', 'C1', 'D1', 'A2', 'B2', 'C2', 'D2']);
    expect(sources.silver.map((source) => source.kind === 'group-position' ? `${source.groupId}${source.position}` : '')).toEqual(['A3', 'B3', 'C3', 'D3', 'A4', 'B4', 'C4', 'D4']);
  });

  it('uses the exact 16-entry Gold and Silver quarterfinal vectors', () => {
    const bands = goldSilverSources(['A', 'B', 'C', 'D']);
    const pairings = (sources: typeof bands.gold) => generateKnockoutFixtures({
      divisionId: 'division', stageId: 'stage', sources, ruleProfileId: 'standard-set', id: (_prefix) => crypto.randomUUID(),
    }).filter((fixture) => fixture.label.startsWith('Quarterfinal')).map((fixture) => [fixture.sideA, fixture.sideB].map((source) => source.kind === 'group-position' ? `${source.groupId}${source.position}` : source.kind));
    expect(pairings(bands.gold)).toEqual([['A1', 'D2'], ['D1', 'A2'], ['B1', 'C2'], ['C1', 'B2']]);
    expect(pairings(bands.silver)).toEqual([['A3', 'D4'], ['D3', 'A4'], ['B3', 'C4'], ['C3', 'B4']]);
  });

  it('creates deterministic reviewed proposals and rejects stale or altered Apply', () => {
    const stage: TournamentStage = { id: 'stage', divisionId: 'division', name: 'KO', kind: 'knockout', order: 1, entryIds: ['a', 'b'], groupIds: [], defaultRuleProfileId: 'standard-set', qualificationConfirmedAt: null, qualificationFingerprint: null, amended: false, closedAt: null, ...stagePlanningDefaults(), seedOrder: ['a', 'b'] };
    const generate = () => generateKnockoutFixtures({ divisionId: 'division', stageId: 'stage', sources: seededOrder(['a', 'b'], 'seed').map((entryId) => ({ kind: 'entry' as const, entryId })), ruleProfileId: 'standard-set', id: deterministicIdFactory('0|seed|stage') });
    const first = createDrawProposal({ baseRevision: '0', stage, groups: [], fixtures: generate() });
    const second = createDrawProposal({ baseRevision: '0', stage, groups: [], fixtures: generate() });
    expect(second).toEqual(first);
    expect(() => validateDrawProposal(first, '1')).toThrow(TournamentRuleError);
    expect(() => validateDrawProposal({ ...first, stage: { ...stage, name: 'Changed' } }, '0')).toThrow(TournamentRuleError);
  });

  it('rejects cycles that cross a group qualification node', () => {
    const fixture = makeFixture({ id: 'fixture', divisionId: 'division', stageId: 'stage', groupId: 'group', label: 'Cycle', sideA: { kind: 'group-position', groupId: 'group', position: 1 }, sideB: { kind: 'bye' }, ruleProfileId: 'first-to-five', queueOrder: 1 });
    expect(() => assertTournamentDependencyAcyclic([fixture], [{ id: 'group', stageId: 'stage', name: 'A', entryIds: [], fixtureIds: ['fixture'], qualifierOrder: null }])).toThrow(TournamentRuleError);
  });

  it('propagates winner-of-bye but leaves loser-of-bye structurally empty', () => {
    const state = createTournamentV1({ id: 't', title: 'Bye', now: 1, divisionId: 'division', courtIds: ['court'] });
    state.players.push({ id: 'p1', name: 'One' }, { id: 'p2', name: 'Two' });
    state.entries.push({ id: 'entry', divisionId: 'division', teamName: 'Pair', playerIds: ['p1', 'p2'], admission: 'confirmed', readiness: 'ready', acceptedAt: 1, waitRank: null, activeLineupRevisionId: 'lineup' });
    state.lineupRevisions.push({ id: 'lineup', entryId: 'entry', playerIds: ['p1', 'p2'], effectiveFixtureIds: [], createdAt: 1, reason: 'Initial' });
    const stage: TournamentStage = { id: 'stage', divisionId: 'division', name: 'KO', kind: 'knockout', order: 1, entryIds: ['entry'], groupIds: [], defaultRuleProfileId: 'first-to-five', qualificationConfirmedAt: null, qualificationFingerprint: null, amended: false, closedAt: null, ...stagePlanningDefaults(), seedOrder: ['entry'] };
    state.stages.push(stage);
    const bye = makeFixture({ id: 'bye-match', divisionId: 'division', stageId: 'stage', label: 'Bye', sideA: { kind: 'entry', entryId: 'entry' }, sideB: { kind: 'bye' }, ruleProfileId: 'first-to-five', queueOrder: 1 });
    const winner = makeFixture({ id: 'winner-match', divisionId: 'division', stageId: 'stage', label: 'Winner', sideA: { kind: 'winner-of-match', fixtureId: 'bye-match' }, sideB: { kind: 'bye' }, ruleProfileId: 'first-to-five', queueOrder: 2 });
    const loser = makeFixture({ id: 'loser-match', divisionId: 'division', stageId: 'stage', label: 'Loser', sideA: { kind: 'loser-of-match', fixtureId: 'bye-match' }, sideB: { kind: 'bye' }, ruleProfileId: 'first-to-five', queueOrder: 3 });
    state.fixtures.push(bye, winner, loser);
    const resolved = resolveFixtureSources(state);
    expect(resolved.fixtures.find((fixture) => fixture.id === 'winner-match')?.resolvedEntryAId).toBe('entry');
    expect(resolved.fixtures.find((fixture) => fixture.id === 'loser-match')?.resolvedEntryAId).toBeNull();
  });
});
