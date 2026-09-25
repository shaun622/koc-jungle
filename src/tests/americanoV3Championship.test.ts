import { describe, expect, it } from 'vitest';
import { addAmericanoFixedTeamV3, addAmericanoParticipantV3, createAmericanoEventV3 } from '@/logic/americanoV3/runtime';
import {
  applyChampionshipFinalToStandingsV3,
  championshipBasisFingerprintV3,
  championshipStatusV3,
  confirmChampionshipFinalV3,
  prepareChampionshipFinalV3,
  resetChampionshipFinalV3,
} from '@/logic/americanoV3/championship';
import { computeAmericanoStandingsV3 } from '@/logic/americanoV3/standings';
import type { AmericanoEventStateV3, AmericanoMatchV3, AmericanoRoundV3 } from '@/logic/americanoV3/types';

function round(id: string, matches: AmericanoMatchV3[], index: number): AmericanoRoundV3 {
  return { id, fixtureRoundId: `f-${id}`, index, durationMs: 600_000, totalPausedMs: 0, matches, completedAt: 100 * index };
}

function pair(team: AmericanoEventStateV3['teams'][number]): AmericanoMatchV3['sideA'] {
  return { kind: 'fixed-team', teamId: team.id, playerIds: [team.players[0].id, team.players[1].id] };
}

function rally(id: string, sideA: AmericanoMatchV3['sideA'], sideB: AmericanoMatchV3['sideB'], scoreA: number, scoreB: number): AmericanoMatchV3 {
  return { id, courtId: 'court-1', sideA, sideB, result: { kind: 'rally', scoreA, scoreB }, resultConfirmed: true };
}

async function fixedTwoWayTie(policy: 'golden-point' | 'tiebreak-7' | 'tiebreak-10' = 'golden-point') {
  let event = createAmericanoEventV3('Fixed final', 'fixed', 1);
  event = addAmericanoFixedTeamV3(event, { teamName: 'Blue', playerOne: 'A1', playerTwo: 'A2' });
  event = addAmericanoFixedTeamV3(event, { teamName: 'Green', playerOne: 'B1', playerTwo: 'B2' });
  event.formatConfig = { ...event.formatConfig, ranking: { tiebreak: 'shared', championship: policy } };
  const [a, b] = event.teams;
  const fixture = { id: 'fixture-r1', index: 1, matches: [{ id: 'fixture-m1', courtId: 'court-1', sideA: pair(a), sideB: pair(b) }], restingEntrantIds: [], unusedCourtIds: [] };
  event.americanoSchedule = {
    id: 'schedule', algorithmVersion: 'americano-v2.1', fingerprintVersion: 3, seed: 1,
    inputFingerprint: 'fingerprint', orderedEntrantIds: [a.id, b.id], courtIds: ['court-1'],
    rounds: [fixture, { ...fixture, id: 'fixture-r2', index: 2, matches: [{ ...fixture.matches[0], id: 'fixture-m2' }] }],
    metrics: { appearances: {}, rests: {}, uniquePartners: {}, uniqueOpponents: {}, minimumPartnerFrequency: 0, maximumPartnerFrequency: 0, minimumOpponentFrequency: 0, maximumOpponentFrequency: 0, repeatedCompleteMatchups: 0, appearancesEqual: true, maximumAppearanceSpread: 0 },
    acknowledgements: { fingerprint: 'fingerprint', unevenAppearances: false, repeatedCycle: false }, rosterRevision: '0',
  };
  event = {
    ...event, status: 'complete',
    rounds: [round('r1', [rally('m1', pair(a), pair(b), 14, 10)], 1), round('r2', [rally('m2', pair(a), pair(b), 10, 14)], 2)],
  };
  return event;
}

describe('Americano v3 championship final', () => {
  it('requires exactly two tied first-place leaders and prepares a fingerprinted fixed final', async () => {
    const event = await fixedTwoWayTie();
    expect((await championshipStatusV3(event)).kind).toBe('available');
    const prepared = await prepareChampionshipFinalV3(event, {});
    expect(prepared.championshipFinal?.contenderIds).toEqual(event.teams.map((team) => team.id));
    expect(prepared.championshipFinal?.basisFingerprint).toBe(await championshipBasisFingerprintV3(event));
    expect(prepared.championshipFinal?.supportPlayerIds).toBeNull();
    expect((await championshipStatusV3(prepared)).kind).toBe('pending');
  });

  it('awards champion/runner-up ranks without changing regular points or match records', async () => {
    const event = await fixedTwoWayTie();
    const prepared = await prepareChampionshipFinalV3(event, {});
    const standingsBefore = computeAmericanoStandingsV3(prepared);
    const result = await confirmChampionshipFinalV3(prepared, { kind: 'golden-point', winner: 'B', confirmedAt: 500 });
    const status = await championshipStatusV3(result);
    const overlay = applyChampionshipFinalToStandingsV3(computeAmericanoStandingsV3(result), status);
    expect(status.kind).toBe('current');
    expect(overlay.find((row) => row.entrantId === event.teams[1].id)?.rank).toBe(1);
    expect(overlay.find((row) => row.entrantId === event.teams[0].id)?.rank).toBe(2);
    expect(overlay.map((row) => row.total)).toEqual(standingsBefore.map((row) => row.total));
    expect(overlay.map((row) => [row.wins, row.losses])).toEqual(standingsBefore.map((row) => [row.wins, row.losses]));
  });

  it('accepts only a terminal target tiebreak and marks a regular score correction stale', async () => {
    const event = await fixedTwoWayTie('tiebreak-7');
    const prepared = await prepareChampionshipFinalV3(event, {});
    await expect(confirmChampionshipFinalV3(prepared, { kind: 'tiebreak', pointsA: 7, pointsB: 6, confirmedAt: 500 })).rejects.toThrow(/wins by two/i);
    const confirmed = await confirmChampionshipFinalV3(prepared, { kind: 'tiebreak', pointsA: 8, pointsB: 6, confirmedAt: 501 });
    expect((await championshipStatusV3(confirmed)).kind).toBe('current');
    const changed: AmericanoEventStateV3 = {
      ...confirmed,
      rounds: confirmed.rounds.map((item, index) => index === 0 ? {
        ...item,
        matches: item.matches.map((match) => ({ ...match, result: { kind: 'rally' as const, scoreA: 15, scoreB: 9 } })),
      } : item),
    };
    expect((await championshipStatusV3(changed)).kind).toBe('stale');
    await expect(confirmChampionshipFinalV3(changed, { kind: 'tiebreak', pointsA: 8, pointsB: 6, confirmedAt: 502 })).rejects.toThrow(/results changed/i);
    expect(() => resetChampionshipFinalV3(changed, false)).toThrow(/confirm/i);
    expect(resetChampionshipFinalV3(changed, true).championshipFinal).toBeUndefined();
    expect((await championshipStatusV3(resetChampionshipFinalV3(changed, true))).kind).toBe('champion');
  });

  it('requires explicit distinct non-finalist support partners for rotating finals', async () => {
    let event = createAmericanoEventV3('Rotating final', 'rotating', 1);
    event.formatConfig = { ...event.formatConfig, ranking: { tiebreak: 'shared', championship: 'golden-point' } };
    for (let index = 1; index <= 6; index += 1) event = addAmericanoParticipantV3(event, `Player ${index}`);
    const [a, b, c, d, e, f] = event.participants;
    const matchA = { kind: 'rotating-pair' as const, playerIds: [a.id, c.id] as [string, string] };
    const matchB = { kind: 'rotating-pair' as const, playerIds: [b.id, e.id] as [string, string] };
    const matchC = { kind: 'rotating-pair' as const, playerIds: [a.id, d.id] as [string, string] };
    const matchD = { kind: 'rotating-pair' as const, playerIds: [b.id, f.id] as [string, string] };
    event = { ...event, status: 'complete', rounds: [
      round('r1', [rally('m1', matchA, matchB, 6, 18)], 1),
      round('r2', [rally('m2', matchC, matchD, 18, 6)], 2),
    ] };
    expect(computeAmericanoStandingsV3(event).filter((row) => row.rank === 1).map((row) => row.entrantId)).toEqual([a.id, b.id]);
    await expect(prepareChampionshipFinalV3(event, { supportPlayerIds: [c.id, f.id] })).rejects.toThrow(/Confirm that support partners/i);
    await expect(prepareChampionshipFinalV3(event, { supportPlayerIds: [a.id, f.id], acknowledgeSupportPlayersNoPoints: true })).rejects.toThrow(/not finalists/i);
    const prepared = await prepareChampionshipFinalV3(event, { supportPlayerIds: [c.id, f.id], acknowledgeSupportPlayersNoPoints: true });
    expect(prepared.championshipFinal?.supportPlayerIds).toEqual([c.id, f.id]);
  });
});
