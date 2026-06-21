import { describe, expect, it } from 'vitest';
import {
  bergerRoundCount,
  bergerRounds,
  roundRobin,
  splitTeamsIntoGroups,
} from '@/logic/formats/roundRobin';
import type { Court, MainRound } from '@/types/domain';

// ---------------------------------------------------------------------------
// Berger schedule
// ---------------------------------------------------------------------------

describe('bergerRoundCount', () => {
  it('returns G-1 rounds for even group sizes', () => {
    expect(bergerRoundCount(2)).toBe(1);
    expect(bergerRoundCount(4)).toBe(3);
    expect(bergerRoundCount(6)).toBe(5);
    expect(bergerRoundCount(8)).toBe(7);
  });

  it('returns G rounds for odd group sizes (one bye each round)', () => {
    expect(bergerRoundCount(3)).toBe(3);
    expect(bergerRoundCount(5)).toBe(5);
    expect(bergerRoundCount(7)).toBe(7);
  });

  it('returns 0 for degenerate group sizes', () => {
    expect(bergerRoundCount(0)).toBe(0);
    expect(bergerRoundCount(1)).toBe(0);
  });
});

describe('bergerRounds', () => {
  it('produces 3 rounds × 2 matches for a group of 4', () => {
    const schedule = bergerRounds(['a', 'b', 'c', 'd']);
    expect(schedule).toHaveLength(3);
    schedule.forEach((round) => expect(round).toHaveLength(2));
  });

  it('every team plays every other team exactly once (G=4)', () => {
    const schedule = bergerRounds(['a', 'b', 'c', 'd']);
    const seen = new Set<string>();
    for (const round of schedule) {
      for (const [x, y] of round) {
        const key = [x, y].sort().join('|');
        expect(seen.has(key)).toBe(false);
        seen.add(key);
      }
    }
    // 4 teams → C(4,2) = 6 unique pairs
    expect(seen.size).toBe(6);
  });

  it('every team plays every other team exactly once (G=6)', () => {
    const schedule = bergerRounds(['a', 'b', 'c', 'd', 'e', 'f']);
    expect(schedule).toHaveLength(5);
    schedule.forEach((round) => expect(round).toHaveLength(3));
    const seen = new Set<string>();
    for (const round of schedule) {
      for (const [x, y] of round) {
        seen.add([x, y].sort().join('|'));
      }
    }
    expect(seen.size).toBe(15); // C(6, 2)
  });

  it('odd group sizes give each team exactly one bye', () => {
    // 5 teams → 5 rounds, each round 2 matches (1 team byes)
    const schedule = bergerRounds(['a', 'b', 'c', 'd', 'e']);
    expect(schedule).toHaveLength(5);
    schedule.forEach((round) => expect(round).toHaveLength(2));
    const playedPerRound = schedule.map((round) =>
      new Set(round.flatMap(([x, y]) => [x, y])),
    );
    const byes = playedPerRound.map((played) =>
      ['a', 'b', 'c', 'd', 'e'].filter((t) => !played.has(t)),
    );
    // One team byes per round, and over 5 rounds each team byes once.
    expect(byes.every((b) => b.length === 1)).toBe(true);
    const byeCounts = new Map<string, number>();
    for (const b of byes) byeCounts.set(b[0], (byeCounts.get(b[0]) ?? 0) + 1);
    for (const t of ['a', 'b', 'c', 'd', 'e']) {
      expect(byeCounts.get(t)).toBe(1);
    }
  });

  it('returns empty for groups of 0 or 1', () => {
    expect(bergerRounds([])).toEqual([]);
    expect(bergerRounds(['a'])).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// splitTeamsIntoGroups
// ---------------------------------------------------------------------------

describe('splitTeamsIntoGroups', () => {
  it('splits an ordered list into chunks of the requested size', () => {
    const groups = splitTeamsIntoGroups(['t1', 't2', 't3', 't4', 't5', 't6', 't7', 't8'], 4);
    expect(groups).toEqual([
      ['t1', 't2', 't3', 't4'],
      ['t5', 't6', 't7', 't8'],
    ]);
  });

  it('leaves a smaller trailing group when the count doesn\'t divide evenly', () => {
    const groups = splitTeamsIntoGroups(['t1', 't2', 't3', 't4', 't5'], 4);
    expect(groups).toEqual([['t1', 't2', 't3', 't4'], ['t5']]);
  });

  it('rejects groupSize < 2', () => {
    expect(() => splitTeamsIntoGroups(['t1', 't2'], 1)).toThrow();
  });
});

// ---------------------------------------------------------------------------
// roundRobin format methods
// ---------------------------------------------------------------------------

function courts(n: number): Court[] {
  return Array.from({ length: n }, (_, i) => ({
    id: `c${i + 1}`,
    position: n - i, // c1 = highest, descending
    name: `Court ${n - i}`,
    pointValue: 3 + (n - i),
  }));
}

describe('roundRobin.buildFirstRound', () => {
  it('schedules round 1 fixtures for a single group of 4', () => {
    const assignments = roundRobin.buildFirstRound({
      rankedTeamIds: ['a', 'b', 'c', 'd'],
      teams: [],
      courts: courts(4),
      config: { groupSize: 4, groups: [['a', 'b', 'c', 'd']] },
    });
    expect(assignments).toHaveLength(2);
    // Every team appears exactly once in round 1.
    const playing = new Set(assignments.flatMap((a) => [a.teamAId, a.teamBId]));
    expect(playing).toEqual(new Set(['a', 'b', 'c', 'd']));
  });

  it('packs matches from multiple groups onto enough courts', () => {
    const assignments = roundRobin.buildFirstRound({
      rankedTeamIds: ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'],
      teams: [],
      courts: courts(4),
      config: {
        groupSize: 4,
        groups: [
          ['a', 'b', 'c', 'd'],
          ['e', 'f', 'g', 'h'],
        ],
      },
    });
    // 2 groups × 2 matches/round = 4 matches, one per court.
    expect(assignments).toHaveLength(4);
    const playing = new Set(assignments.flatMap((a) => [a.teamAId, a.teamBId]));
    expect(playing.size).toBe(8);
  });

  it('runs more matches than courts in waves (no throw)', () => {
    // 2 groups × 2 matches = 4 matches on 2 courts → 2 waves of 2.
    const assignments = roundRobin.buildFirstRound({
      rankedTeamIds: ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'],
      teams: [],
      courts: courts(2),
      config: {
        groupSize: 4,
        groups: [
          ['a', 'b', 'c', 'd'],
          ['e', 'f', 'g', 'h'],
        ],
      },
    });
    expect(assignments).toHaveLength(4);
    const perWave = new Map<number, number>();
    for (const a of assignments) perWave.set(a.wave ?? 0, (perWave.get(a.wave ?? 0) ?? 0) + 1);
    expect(perWave.get(0)).toBe(2);
    expect(perWave.get(1)).toBe(2);
  });
});

describe('roundRobin.computeNextRound', () => {
  function fakeCompleted(idxs: number[]): MainRound[] {
    return idxs.map((i) => ({
      id: `r${i}`,
      index: i,
      durationMs: 0,
      totalPausedMs: 0,
      completedAt: 100 + i,
      matches: [],
    }));
  }

  it('returns round 2 fixtures after 1 completed round', () => {
    const next = roundRobin.computeNextRound({
      rounds: fakeCompleted([1]),
      teams: [],
      courts: courts(2),
      tieRule: 'operator-decides',
      config: { groupSize: 4, groups: [['a', 'b', 'c', 'd']] },
    });
    expect(next).toHaveLength(2);
    const playing = new Set(next.flatMap((a) => [a.teamAId, a.teamBId]));
    expect(playing).toEqual(new Set(['a', 'b', 'c', 'd']));
  });

  it('returns the full Berger sequence across rounds (no repeats)', () => {
    const cfg = { groupSize: 4, groups: [['a', 'b', 'c', 'd']] };
    const allPairs = new Set<string>();
    const r1 = roundRobin.buildFirstRound({
      rankedTeamIds: [],
      teams: [],
      courts: courts(2),
      config: cfg,
    });
    r1.forEach((a) => allPairs.add([a.teamAId, a.teamBId].sort().join('|')));
    const r2 = roundRobin.computeNextRound({
      rounds: [{ id: 'r1', index: 1, durationMs: 0, totalPausedMs: 0, completedAt: 1, matches: [] }],
      teams: [],
      courts: courts(2),
      tieRule: 'operator-decides',
      config: cfg,
    });
    r2.forEach((a) => allPairs.add([a.teamAId, a.teamBId].sort().join('|')));
    const r3 = roundRobin.computeNextRound({
      rounds: [
        { id: 'r1', index: 1, durationMs: 0, totalPausedMs: 0, completedAt: 1, matches: [] },
        { id: 'r2', index: 2, durationMs: 0, totalPausedMs: 0, completedAt: 2, matches: [] },
      ],
      teams: [],
      courts: courts(2),
      tieRule: 'operator-decides',
      config: cfg,
    });
    r3.forEach((a) => allPairs.add([a.teamAId, a.teamBId].sort().join('|')));
    // All 6 unique pairs played exactly once over the 3 rounds.
    expect(allPairs.size).toBe(6);
  });
});

describe('roundRobin.isComplete', () => {
  const cfg = { groupSize: 4, groups: [['a', 'b', 'c', 'd']] };
  const fake = (i: number) => ({
    id: `r${i}`,
    index: i,
    durationMs: 0,
    totalPausedMs: 0,
    completedAt: 100 + i,
    matches: [],
  });
  const settings = {
    defaultRoundDurationMs: 0,
    tieRule: 'operator-decides' as const,
    soundOnTimerEnd: false,
    warningAtMs: 0,
    roundsTotal: 99, // ignored by RR
    announceRoundStart: false,
  };

  it('false while group still has fixtures left to play', () => {
    expect(
      roundRobin.isComplete({ rounds: [fake(1)], settings, config: cfg }),
    ).toBe(false);
    expect(
      roundRobin.isComplete({ rounds: [fake(1), fake(2)], settings, config: cfg }),
    ).toBe(false);
  });

  it('true once every fixture has been played (G-1 rounds for G=4)', () => {
    expect(
      roundRobin.isComplete({
        rounds: [fake(1), fake(2), fake(3)],
        settings,
        config: cfg,
      }),
    ).toBe(true);
  });

  it('uses the LARGEST group when groups have different sizes', () => {
    const mixed = {
      groupSize: 4,
      groups: [
        ['a', 'b', 'c', 'd'],
        ['e', 'f', 'g', 'h', 'i', 'j'], // 6 → 5 rounds
      ],
    };
    // After 3 rounds the small group is done but the big group needs 2 more.
    expect(
      roundRobin.isComplete({ rounds: [fake(1), fake(2), fake(3)], settings, config: mixed }),
    ).toBe(false);
    expect(
      roundRobin.isComplete({
        rounds: [fake(1), fake(2), fake(3), fake(4), fake(5)],
        settings,
        config: mixed,
      }),
    ).toBe(true);
  });
});
