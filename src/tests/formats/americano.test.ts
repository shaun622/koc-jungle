import { describe, expect, it } from 'vitest';
import { americano } from '@/logic/formats/americano';
import type { Court, MainRound } from '@/types/domain';

function courts(n: number): Court[] {
  return Array.from({ length: n }, (_, i) => ({
    id: `c${i + 1}`,
    position: n - i,
    name: `Court ${n - i}`,
    pointValue: 3 + (n - i),
  }));
}

function fakeRound(i: number): MainRound {
  return {
    id: `r${i}`,
    index: i,
    durationMs: 0,
    totalPausedMs: 0,
    completedAt: 100 + i,
    matches: [],
  };
}

const SETTINGS = {
  defaultRoundDurationMs: 0,
  tieRule: 'operator-decides' as const,
  soundOnTimerEnd: false,
  warningAtMs: 0,
  roundsTotal: 4,
  announceRoundStart: false,
};

describe('americano.buildFirstRound', () => {
  it('schedules round 1 for 4 teams across 2 courts', () => {
    const assignments = americano.buildFirstRound({
      rankedTeamIds: ['a', 'b', 'c', 'd'],
      teams: [],
      courts: courts(2),
      config: { teams: ['a', 'b', 'c', 'd'] },
    });
    expect(assignments).toHaveLength(2);
    const playing = new Set(assignments.flatMap((a) => [a.teamAId, a.teamBId]));
    expect(playing).toEqual(new Set(['a', 'b', 'c', 'd']));
  });

  it('falls back to rankedTeamIds when config.teams is missing', () => {
    const assignments = americano.buildFirstRound({
      rankedTeamIds: ['x', 'y', 'z', 'w'],
      teams: [],
      courts: courts(2),
      config: {},
    });
    expect(assignments).toHaveLength(2);
    const playing = new Set(assignments.flatMap((a) => [a.teamAId, a.teamBId]));
    expect(playing).toEqual(new Set(['x', 'y', 'z', 'w']));
  });

  it('runs matches that exceed courts in waves (no throw)', () => {
    // 4 teams = 2 matches on a single court → 2 waves.
    const assignments = americano.buildFirstRound({
      rankedTeamIds: ['a', 'b', 'c', 'd'],
      teams: [],
      courts: courts(1),
      config: { teams: ['a', 'b', 'c', 'd'] },
    });
    expect(assignments).toHaveLength(2);
    expect(new Set(assignments.map((a) => a.courtId)).size).toBe(1); // same court
    expect(assignments.map((a) => a.wave).sort()).toEqual([0, 1]);
  });
});

describe('americano.computeNextRound', () => {
  it('produces a stable Berger sequence across rounds', () => {
    const cfg = { teams: ['a', 'b', 'c', 'd'] };
    const seen = new Set<string>();
    const r1 = americano.buildFirstRound({
      rankedTeamIds: ['a', 'b', 'c', 'd'],
      teams: [],
      courts: courts(2),
      config: cfg,
    });
    r1.forEach((a) => seen.add([a.teamAId, a.teamBId].sort().join('|')));
    const r2 = americano.computeNextRound({
      rounds: [fakeRound(1)],
      teams: [],
      courts: courts(2),
      tieRule: 'operator-decides',
      config: cfg,
    });
    r2.forEach((a) => seen.add([a.teamAId, a.teamBId].sort().join('|')));
    const r3 = americano.computeNextRound({
      rounds: [fakeRound(1), fakeRound(2)],
      teams: [],
      courts: courts(2),
      tieRule: 'operator-decides',
      config: cfg,
    });
    r3.forEach((a) => seen.add([a.teamAId, a.teamBId].sort().join('|')));
    // Over the 3 rounds of a full 4-team Berger schedule every pair is seen.
    expect(seen.size).toBe(6);
  });

  it('wraps around when operator sets more rounds than the schedule has', () => {
    const cfg = { teams: ['a', 'b', 'c', 'd'] }; // 3 Berger rounds total
    const r4 = americano.computeNextRound({
      rounds: [fakeRound(1), fakeRound(2), fakeRound(3)],
      teams: [],
      courts: courts(2),
      tieRule: 'operator-decides',
      config: cfg,
    });
    // 4th round should equal round 1 again (index 3 % 3 === 0).
    const playing = new Set(r4.flatMap((a) => [a.teamAId, a.teamBId]));
    expect(playing.size).toBe(4);
  });

  it('throws when config.teams missing on a follow-up round', () => {
    expect(() =>
      americano.computeNextRound({
        rounds: [fakeRound(1)],
        teams: [],
        courts: courts(2),
        tieRule: 'operator-decides',
        config: {},
      }),
    ).toThrow(/teams is required/);
  });
});

describe('americano.isComplete', () => {
  it('respects the operator-set roundsTotal', () => {
    expect(
      americano.isComplete({
        rounds: [fakeRound(1), fakeRound(2), fakeRound(3)],
        settings: SETTINGS, // roundsTotal: 4
        config: { teams: ['a', 'b', 'c', 'd'] },
      }),
    ).toBe(false);
    expect(
      americano.isComplete({
        rounds: [fakeRound(1), fakeRound(2), fakeRound(3), fakeRound(4)],
        settings: SETTINGS,
        config: { teams: ['a', 'b', 'c', 'd'] },
      }),
    ).toBe(true);
  });
});
