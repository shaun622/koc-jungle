import { describe, expect, it } from 'vitest';
import {
  bracket,
  bracketRoundCount,
  bracketSeedingOrder,
  buildBracketSlots,
  nextPowerOf2,
} from '@/logic/formats/bracket';
import type { Court, MainRound, Match } from '@/types/domain';

function courts(n: number): Court[] {
  return Array.from({ length: n }, (_, i) => ({
    id: `c${i + 1}`,
    position: n - i,
    name: `Court ${n - i}`,
    pointValue: 3 + (n - i),
  }));
}

function fakeMatch(
  teamAId: string,
  teamBId: string,
  scoreA: number,
  scoreB: number,
  courtId = 'c1',
): Match {
  return {
    id: `m-${teamAId}-${teamBId}`,
    courtId,
    teamAId,
    teamBId,
    scoreA,
    scoreB,
    status: 'completed',
    pointValueAtTime: 10,
  };
}

function fakeRound(i: number, matches: Match[]): MainRound {
  return {
    id: `r${i}`,
    index: i,
    durationMs: 0,
    totalPausedMs: 0,
    completedAt: 100 + i,
    matches,
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

describe('nextPowerOf2', () => {
  it('returns the next power of 2', () => {
    expect(nextPowerOf2(2)).toBe(2);
    expect(nextPowerOf2(3)).toBe(4);
    expect(nextPowerOf2(4)).toBe(4);
    expect(nextPowerOf2(5)).toBe(8);
    expect(nextPowerOf2(8)).toBe(8);
    expect(nextPowerOf2(9)).toBe(16);
  });

  it('floors at 2 for degenerate inputs', () => {
    expect(nextPowerOf2(0)).toBe(2);
    expect(nextPowerOf2(1)).toBe(2);
  });
});

describe('bracketRoundCount', () => {
  it('returns log2 of bracket size', () => {
    expect(bracketRoundCount(2)).toBe(1);
    expect(bracketRoundCount(4)).toBe(2);
    expect(bracketRoundCount(8)).toBe(3);
    expect(bracketRoundCount(16)).toBe(4);
  });
});

describe('bracketSeedingOrder', () => {
  it('places #1 against #N in slot positions', () => {
    // size 4: slots [#1, #4, #2, #3]
    expect(bracketSeedingOrder(4)).toEqual([0, 3, 1, 2]);
  });

  it('places higher seeds far apart for size 8', () => {
    const order = bracketSeedingOrder(8);
    // Round 1 pairings derived from this order: 1v8, 4v5, 2v7, 3v6
    expect(order).toEqual([0, 7, 3, 4, 1, 6, 2, 5]);
  });
});

describe('buildBracketSlots', () => {
  it('places teams into slots by seeding order', () => {
    const slots = buildBracketSlots(['a', 'b', 'c', 'd'], 4);
    // slots[0]=a (seed1), slots[1]=d (seed4), slots[2]=b (seed2), slots[3]=c (seed3)
    expect(slots).toEqual(['a', 'd', 'b', 'c']);
  });

  it('leaves null slots when teams < bracketSize (top seeds bye)', () => {
    // 3 teams in a 4-bracket: seed1 gets a bye (paired with null).
    const slots = buildBracketSlots(['a', 'b', 'c'], 4);
    // Order is [0, 3, 1, 2] → slots[0]=a, slots[1]=null (no seed4),
    // slots[2]=b, slots[3]=c.
    expect(slots).toEqual(['a', null, 'b', 'c']);
  });
});

// ---------------------------------------------------------------------------
// Format methods
// ---------------------------------------------------------------------------

describe('bracket.buildFirstRound', () => {
  it('generates round 1 pairings for a full 4-team bracket', () => {
    const assignments = bracket.buildFirstRound({
      rankedTeamIds: ['a', 'b', 'c', 'd'],
      teams: [],
      courts: courts(2),
      config: { bracketSize: 4, slots: ['a', 'd', 'b', 'c'] },
    });
    expect(assignments).toHaveLength(2);
    const playing = new Set(assignments.flatMap((a) => [a.teamAId, a.teamBId]));
    expect(playing).toEqual(new Set(['a', 'b', 'c', 'd']));
  });

  it('skips bye slots in round 1 (5 teams in an 8-bracket → 1 match)', () => {
    const slots = buildBracketSlots(['a', 'b', 'c', 'd', 'e'], 8);
    // Top 3 seeds bye; only the bottom two seeds (slot pair #4 vs #5)
    // actually play. Seeds 6/7/8 don't exist → null → those slots
    // pair with their partner as byes for #2 and #3 respectively.
    const assignments = bracket.buildFirstRound({
      rankedTeamIds: ['a', 'b', 'c', 'd', 'e'],
      teams: [],
      courts: courts(4),
      config: { bracketSize: 8, slots },
    });
    expect(assignments).toHaveLength(1);
    // The one match is between the bottom two seeds: d (#4) and e (#5).
    expect(new Set([assignments[0].teamAId, assignments[0].teamBId])).toEqual(
      new Set(['d', 'e']),
    );
  });

  it('runs more matches than courts in waves (no throw)', () => {
    // 4-team bracket = 2 round-1 matches on a single court → 2 waves.
    const assignments = bracket.buildFirstRound({
      rankedTeamIds: ['a', 'b', 'c', 'd'],
      teams: [],
      courts: courts(1),
      config: { bracketSize: 4, slots: ['a', 'd', 'b', 'c'] },
    });
    expect(assignments).toHaveLength(2);
    expect(new Set(assignments.map((a) => a.courtId)).size).toBe(1); // same court
    expect(assignments.map((a) => a.wave).sort()).toEqual([0, 1]);
    const playing = new Set(assignments.flatMap((a) => [a.teamAId, a.teamBId]));
    expect(playing).toEqual(new Set(['a', 'b', 'c', 'd']));
  });
});

describe('bracket.computeNextRound', () => {
  it('pairs winners in bracket order for the final', () => {
    const cfg = { bracketSize: 4, slots: ['a', 'd', 'b', 'c'] };
    // Round 1: a beats d 10-0; b beats c 10-0.
    const round1 = fakeRound(1, [
      fakeMatch('a', 'd', 10, 0, 'c1'),
      fakeMatch('b', 'c', 10, 0, 'c2'),
    ]);
    const next = bracket.computeNextRound({
      rounds: [round1],
      teams: [],
      courts: courts(1),
      tieRule: 'operator-decides',
      config: cfg,
    });
    // Final = winner(a/d) vs winner(b/c) = a vs b.
    expect(next).toHaveLength(1);
    const playing = new Set([next[0].teamAId, next[0].teamBId]);
    expect(playing).toEqual(new Set(['a', 'b']));
  });

  it('handles upsets correctly (lower seed advances)', () => {
    const cfg = { bracketSize: 4, slots: ['a', 'd', 'b', 'c'] };
    // d upsets a; c upsets b.
    const round1 = fakeRound(1, [
      fakeMatch('a', 'd', 4, 10, 'c1'),
      fakeMatch('b', 'c', 0, 10, 'c2'),
    ]);
    const next = bracket.computeNextRound({
      rounds: [round1],
      teams: [],
      courts: courts(1),
      tieRule: 'operator-decides',
      config: cfg,
    });
    expect(next).toHaveLength(1);
    const playing = new Set([next[0].teamAId, next[0].teamBId]);
    expect(playing).toEqual(new Set(['d', 'c']));
  });

  it('passes through bye slots (4-team bracket with 3 teams)', () => {
    const slots = buildBracketSlots(['a', 'b', 'c'], 4); // ['a', null, 'b', 'c']
    const cfg = { bracketSize: 4, slots };
    // Round 1: a byes; b beats c 10-0.
    const round1 = fakeRound(1, [fakeMatch('b', 'c', 10, 0, 'c1')]);
    const next = bracket.computeNextRound({
      rounds: [round1],
      teams: [],
      courts: courts(1),
      tieRule: 'operator-decides',
      config: cfg,
    });
    // Final = a (bye) vs b (won).
    expect(next).toHaveLength(1);
    expect(new Set([next[0].teamAId, next[0].teamBId])).toEqual(new Set(['a', 'b']));
  });

  it('returns empty when bracket is finished', () => {
    const cfg = { bracketSize: 4, slots: ['a', 'd', 'b', 'c'] };
    const round1 = fakeRound(1, [
      fakeMatch('a', 'd', 10, 0, 'c1'),
      fakeMatch('b', 'c', 10, 0, 'c2'),
    ]);
    const round2 = fakeRound(2, [fakeMatch('a', 'b', 10, 4, 'c1')]);
    const next = bracket.computeNextRound({
      rounds: [round1, round2],
      teams: [],
      courts: courts(1),
      tieRule: 'operator-decides',
      config: cfg,
    });
    expect(next).toEqual([]);
  });
});

describe('bracket.isComplete', () => {
  const cfg = { bracketSize: 4, slots: ['a', 'd', 'b', 'c'] };
  it('false before the final', () => {
    expect(
      bracket.isComplete({
        rounds: [fakeRound(1, [])],
        settings: {
          defaultRoundDurationMs: 0,
          tieRule: 'operator-decides',
          soundOnTimerEnd: false,
          warningAtMs: 0,
          roundsTotal: 2,
          announceRoundStart: false,
        },
        config: cfg,
      }),
    ).toBe(false);
  });

  it('true after the final', () => {
    expect(
      bracket.isComplete({
        rounds: [fakeRound(1, []), fakeRound(2, [])],
        settings: {
          defaultRoundDurationMs: 0,
          tieRule: 'operator-decides',
          soundOnTimerEnd: false,
          warningAtMs: 0,
          roundsTotal: 2,
          announceRoundStart: false,
        },
        config: cfg,
      }),
    ).toBe(true);
  });
});
