import { describe, expect, it } from 'vitest';
import { addAmericanoFixedTeamV3, addAmericanoParticipantV3, createAmericanoEventV3 } from '@/logic/americanoV3/runtime';
import { computeAmericanoStandingsV3 } from '@/logic/americanoV3/standings';
import { AMERICANO_V3_TRADITIONAL_PRESETS } from '@/logic/americanoV3/scoring';
import type { AmericanoMatchV3, AmericanoRoundV3 } from '@/logic/americanoV3/types';

function completedRound(id: string, matches: AmericanoMatchV3[], index = 1): AmericanoRoundV3 {
  return { id, fixtureRoundId: `fixture-${id}`, index, matches, durationMs: 600_000, totalPausedMs: 0, completedAt: index * 100 };
}

function rallyMatch(id: string, sideA: AmericanoMatchV3['sideA'], sideB: AmericanoMatchV3['sideB'], scoreA: number, scoreB: number): AmericanoMatchV3 {
  return { id, courtId: 'court-1', sideA, sideB, result: { kind: 'rally', scoreA, scoreB }, resultConfirmed: true };
}

describe('Americano v3 standings', () => {
  it('credits each rotating player with their side rally score and sorts by total', () => {
    let event = createAmericanoEventV3('Rally', 'rotating', 1);
    for (let index = 1; index <= 4; index += 1) event = addAmericanoParticipantV3(event, `Player ${index}`);
    const [a, b, c, d] = event.participants;
    event = {
      ...event,
      status: 'complete',
      rounds: [completedRound('r1', [rallyMatch('m1', { kind: 'rotating-pair', playerIds: [a.id, b.id] }, { kind: 'rotating-pair', playerIds: [c.id, d.id] }, 10, 14)])],
    };
    const rows = computeAmericanoStandingsV3(event);
    expect(rows.map(({ total, rank }) => [total, rank])).toEqual([[14, 1], [14, 1], [10, 3], [10, 3]]);
    expect(rows.every((row) => row.matchesPlayed === 1)).toBe(true);
  });

  it('applies configured per-game points and match-win bonus to fixed teams', () => {
    let event = createAmericanoEventV3('Games', 'fixed', 1);
    event = addAmericanoFixedTeamV3(event, { teamName: 'A', playerOne: 'A1', playerTwo: 'A2' });
    event = addAmericanoFixedTeamV3(event, { teamName: 'B', playerOne: 'B1', playerTwo: 'B2' });
    event.formatConfig = {
      ...event.formatConfig,
      scoring: {
        kind: 'traditional', preset: 'first-to-five',
        rule: AMERICANO_V3_TRADITIONAL_PRESETS['first-to-five'].rule,
        standings: { pointsPerGameWon: 2, matchWinBonus: 3 },
      },
    };
    const [a, b] = event.teams;
    const match: AmericanoMatchV3 = {
      id: 'm1', courtId: 'court-1',
      sideA: { kind: 'fixed-team', teamId: a.id, playerIds: [a.players[0].id, a.players[1].id] },
      sideB: { kind: 'fixed-team', teamId: b.id, playerIds: [b.players[0].id, b.players[1].id] },
      result: { kind: 'traditional', sets: [{ kind: 'set', gamesA: 5, gamesB: 3, tiebreakPointsA: null, tiebreakPointsB: null }] },
      resultConfirmed: true,
    };
    event = { ...event, status: 'complete', rounds: [completedRound('r1', [match])] };
    expect(computeAmericanoStandingsV3(event).map((row) => [row.entrantId, row.total])).toEqual([[a.id, 13], [b.id, 6]]);
  });

  it('does not use pairwise head-to-head to split a three-way tie', () => {
    let event = createAmericanoEventV3('Three-way', 'fixed', 1);
    for (let index = 1; index <= 3; index += 1) event = addAmericanoFixedTeamV3(event, { teamName: `Team ${index}`, playerOne: `A${index}`, playerTwo: `B${index}` });
    event.formatConfig = { ...event.formatConfig, ranking: { tiebreak: 'head-to-head', championship: 'none' } };
    const [a, b, c] = event.teams;
    const fixed = (left: typeof a, right: typeof a, scoreA: number, scoreB: number, id: string) => rallyMatch(
      id,
      { kind: 'fixed-team', teamId: left.id, playerIds: [left.players[0].id, left.players[1].id] },
      { kind: 'fixed-team', teamId: right.id, playerIds: [right.players[0].id, right.players[1].id] },
      scoreA, scoreB,
    );
    event = { ...event, status: 'complete', rounds: [completedRound('r1', [fixed(a, b, 14, 10, 'ab'), fixed(b, c, 14, 10, 'bc'), fixed(c, a, 14, 10, 'ca')])] };
    const rows = computeAmericanoStandingsV3(event);
    expect(rows.map((row) => row.total)).toEqual([24, 24, 24]);
    expect(rows.map((row) => row.rank)).toEqual([1, 1, 1]);
  });
});
