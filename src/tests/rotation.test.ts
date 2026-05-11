import { describe, expect, it } from 'vitest';
import { computeNextRoundAssignments, decideWinnerLoser, unresolvedTies } from '@/logic/rotation';
import type { Court, MainRound, Match } from '@/types/domain';

function court(position: number): Court {
  return {
    id: `court-${position}`,
    position,
    name: `Court ${position}`,
    pointValue: position + 2,
  };
}

function match(courtPos: number, teamAId: string, teamBId: string, scoreA: number, scoreB: number, tieBreakWinnerId?: string): Match {
  return {
    id: `m-${courtPos}`,
    courtId: `court-${courtPos}`,
    teamAId,
    teamBId,
    scoreA,
    scoreB,
    tieBreakWinnerId,
    status: 'in-progress',
    pointValueAtTime: courtPos + 2,
  };
}

function makeRound(matches: Match[]): MainRound {
  return {
    id: 'round-1',
    index: 1,
    matches,
    durationMs: 20 * 60 * 1000,
    totalPausedMs: 0,
  };
}

describe('decideWinnerLoser', () => {
  it('picks higher score', () => {
    expect(decideWinnerLoser(match(1, 'A', 'B', 10, 5), 'operator-decides')).toEqual({
      winnerId: 'A',
      loserId: 'B',
      isTied: false,
    });
  });

  it('signals tie when scores equal and no nominee', () => {
    expect(decideWinnerLoser(match(1, 'A', 'B', 7, 7), 'operator-decides')).toMatchObject({ isTied: true });
  });

  it('uses tieBreakWinnerId when set', () => {
    expect(
      decideWinnerLoser(match(1, 'A', 'B', 7, 7, 'B'), 'operator-decides'),
    ).toEqual({ winnerId: 'B', loserId: 'A', isTied: false });
  });

  it('respects team-a-wins rule on tie', () => {
    expect(decideWinnerLoser(match(1, 'A', 'B', 4, 4), 'team-a-wins')).toEqual({
      winnerId: 'A',
      loserId: 'B',
      isTied: false,
    });
  });
});

describe('computeNextRoundAssignments — 7 courts', () => {
  const courts = [court(1), court(2), court(3), court(4), court(5), court(6), court(7)];

  it('rotates winners up and losers down with king-stays and bottom-loser-stays', () => {
    // Team naming: WP = winner on court P, LP = loser on court P
    const matches = [
      match(1, 'W1', 'L1', 10, 5),
      match(2, 'W2', 'L2', 10, 5),
      match(3, 'W3', 'L3', 10, 5),
      match(4, 'W4', 'L4', 10, 5),
      match(5, 'W5', 'L5', 10, 5),
      match(6, 'W6', 'L6', 10, 5),
      match(7, 'W7', 'L7', 10, 5),
    ];
    const round = makeRound(matches);
    const next = computeNextRoundAssignments(round, courts, 'operator-decides');

    const by = (pos: number) => next.find((a) => a.courtId === `court-${pos}`)!;

    // Centre court (7): king stays, winner from court 6 moves up
    expect(new Set([by(7).teamAId, by(7).teamBId])).toEqual(new Set(['W7', 'W6']));

    // Court 6: winner of 5 moves up, loser of 7 moves down
    expect(new Set([by(6).teamAId, by(6).teamBId])).toEqual(new Set(['W5', 'L7']));

    // Court 5: W4 up, L6 down
    expect(new Set([by(5).teamAId, by(5).teamBId])).toEqual(new Set(['W4', 'L6']));

    // Court 4: W3 up, L5 down
    expect(new Set([by(4).teamAId, by(4).teamBId])).toEqual(new Set(['W3', 'L5']));

    // Court 3: W2 up, L4 down
    expect(new Set([by(3).teamAId, by(3).teamBId])).toEqual(new Set(['W2', 'L4']));

    // Court 2: W1 up, L3 down
    expect(new Set([by(2).teamAId, by(2).teamBId])).toEqual(new Set(['W1', 'L3']));

    // Court 1: bottom loser stays, L2 moves down
    expect(new Set([by(1).teamAId, by(1).teamBId])).toEqual(new Set(['L1', 'L2']));
  });

  it('preserves every team exactly once across the next round', () => {
    const matches = [
      match(1, 'a1', 'b1', 10, 5),
      match(2, 'a2', 'b2', 3, 12),
      match(3, 'a3', 'b3', 8, 9),
      match(4, 'a4', 'b4', 11, 2),
      match(5, 'a5', 'b5', 6, 7),
      match(6, 'a6', 'b6', 15, 1),
      match(7, 'a7', 'b7', 4, 5),
    ];
    const round = makeRound(matches);
    const next = computeNextRoundAssignments(round, courts, 'operator-decides');
    const allTeams = next.flatMap((a) => [a.teamAId, a.teamBId]).sort();
    const expected = matches.flatMap((m) => [m.teamAId, m.teamBId]).sort();
    expect(allTeams).toEqual(expected);
  });

  it('throws on unresolved tie', () => {
    const matches = [
      match(1, 'a1', 'b1', 10, 5),
      match(2, 'a2', 'b2', 10, 5),
      match(3, 'a3', 'b3', 8, 8), // tie, no nominee
      match(4, 'a4', 'b4', 10, 5),
      match(5, 'a5', 'b5', 10, 5),
      match(6, 'a6', 'b6', 10, 5),
      match(7, 'a7', 'b7', 10, 5),
    ];
    const round = makeRound(matches);
    expect(() => computeNextRoundAssignments(round, courts, 'operator-decides')).toThrow();
  });

  it('resolves tie via tieBreakWinnerId', () => {
    const matches = [
      match(1, 'a1', 'b1', 10, 5),
      match(2, 'a2', 'b2', 10, 5),
      match(3, 'a3', 'b3', 8, 8, 'b3'),
      match(4, 'a4', 'b4', 10, 5),
      match(5, 'a5', 'b5', 10, 5),
      match(6, 'a6', 'b6', 10, 5),
      match(7, 'a7', 'b7', 10, 5),
    ];
    const round = makeRound(matches);
    expect(() => computeNextRoundAssignments(round, courts, 'operator-decides')).not.toThrow();
  });
});

describe('unresolvedTies', () => {
  it('lists only unresolved ties', () => {
    const courts = [court(1), court(2)];
    const matches = [
      match(1, 'a', 'b', 5, 5),
      match(2, 'c', 'd', 5, 5, 'c'),
    ];
    const round = makeRound(matches);
    const ties = unresolvedTies(round, 'operator-decides');
    expect(ties).toHaveLength(1);
    expect(ties[0].courtId).toBe('court-1');
    void courts;
  });
});
