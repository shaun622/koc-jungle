import { describe, expect, it } from 'vitest';
import { computeStandings, sortStandings } from '@/logic/scoring';
import { DEFAULT_SETTINGS, type EventState } from '@/types/domain';

function build(): EventState {
  return {
    id: 'e',
    name: 'Test',
    createdAt: 0,
    status: 'round-in-progress',
    settings: { ...DEFAULT_SETTINGS },
    courts: [
      { id: 'c1', position: 1, name: 'C1', pointValue: 3 },
      { id: 'c2', position: 2, name: 'C2', pointValue: 4 },
    ],
    teams: [
      { id: 'a', name: 'A', players: [{ id: 'ap1', name: 'A1' }, { id: 'ap2', name: 'A2' }], createdAt: 0, active: true },
      { id: 'b', name: 'B', players: [{ id: 'bp1', name: 'B1' }, { id: 'bp2', name: 'B2' }], createdAt: 0, active: true },
      { id: 'c', name: 'C', players: [{ id: 'cp1', name: 'C1' }, { id: 'cp2', name: 'C2' }], createdAt: 0, active: true },
      { id: 'd', name: 'D', players: [{ id: 'dp1', name: 'D1' }, { id: 'dp2', name: 'D2' }], createdAt: 0, active: true },
    ],
    rounds: [
      {
        id: 'r1',
        index: 1,
        durationMs: 0,
        totalPausedMs: 0,
        completedAt: 1,
        matches: [
          { id: 'r1m1', courtId: 'c1', teamAId: 'a', teamBId: 'b', scoreA: 10, scoreB: 5, status: 'completed', pointValueAtTime: 3 },
          { id: 'r1m2', courtId: 'c2', teamAId: 'c', teamBId: 'd', scoreA: 7, scoreB: 9, status: 'completed', pointValueAtTime: 4 },
        ],
      },
      {
        id: 'r2',
        index: 2,
        durationMs: 0,
        totalPausedMs: 0,
        completedAt: 2,
        matches: [
          // After rotation: A (winner of c1) moves up to c2. D (winner of c2) moves up to "centre" but we only have 2 courts so D stays on c2.
          // We just simulate any plausible second round.
          { id: 'r2m1', courtId: 'c2', teamAId: 'a', teamBId: 'd', scoreA: 12, scoreB: 4, status: 'completed', pointValueAtTime: 4 },
          { id: 'r2m2', courtId: 'c1', teamAId: 'b', teamBId: 'c', scoreA: 3, scoreB: 3, tieBreakWinnerId: 'c', status: 'completed', pointValueAtTime: 3 },
        ],
      },
    ],
  };
}

describe('computeStandings', () => {
  it('totals court pointValue per win, counts W/L/T', () => {
    const event = build();
    const standings = computeStandings(event);
    const map = new Map(standings.map((s) => [s.teamId, s]));
    // A won on c1 (3) then on c2 (4) = 7
    expect(map.get('a')!.total).toBe(7);
    expect(map.get('a')!.wins).toBe(2);
    // D won on c2 (4) then lost on c2 = 4
    expect(map.get('d')!.total).toBe(4);
    expect(map.get('d')!.wins).toBe(1);
    expect(map.get('d')!.losses).toBe(1);
    // C lost r1 then beat B via tie-break on c1 (3) = 3
    expect(map.get('c')!.total).toBe(3);
    // B lost both = 0
    expect(map.get('b')!.total).toBe(0);
  });

  it('accumulates gamesFor / gamesAgainst from main-round match scores', () => {
    const event = build();
    const map = new Map(computeStandings(event).map((s) => [s.teamId, s]));
    // r1m1: a 10 vs b 5  → a gf+10/ga+5, b gf+5/ga+10
    // r2m1: a 12 vs d 4  → a gf+12/ga+4, d gf+4/ga+12
    expect(map.get('a')!.gamesFor).toBe(22);
    expect(map.get('a')!.gamesAgainst).toBe(9);
    // r1m1 b loses 5–10, r2m2 b ties 3–3
    expect(map.get('b')!.gamesFor).toBe(8);
    expect(map.get('b')!.gamesAgainst).toBe(13);
    // r1m2 c loses 7–9, r2m2 c wins via tiebreak 3–3
    expect(map.get('c')!.gamesFor).toBe(10);
    expect(map.get('c')!.gamesAgainst).toBe(12);
    // r1m2 d wins 9–7, r2m1 d loses 4–12
    expect(map.get('d')!.gamesFor).toBe(13);
    expect(map.get('d')!.gamesAgainst).toBe(19);
  });
});

describe('sortStandings', () => {
  it('orders by total desc primarily', () => {
    const event = build();
    const standings = sortStandings(computeStandings(event), (id) =>
      event.teams.find((t) => t.id === id)?.name ?? id,
    );
    expect(standings.map((s) => s.teamId)).toEqual(['a', 'd', 'c', 'b']);
  });

  it('breaks ties on equal totals by gamesFor', () => {
    // Two teams both with total = 5; team x has more gamesFor → ranks first.
    const standings = sortStandings(
      [
        {
          teamId: 'x',
          total: 5,
          wins: 1,
          losses: 0,
          ties: 0,
          qualifierScore: 10,
          matchesPlayed: 1,
          gamesFor: 12,
          gamesAgainst: 4,
        },
        {
          teamId: 'y',
          total: 5,
          wins: 1,
          losses: 0,
          ties: 0,
          qualifierScore: 15, // higher qual but should NOT trump gamesFor
          matchesPlayed: 1,
          gamesFor: 8,
          gamesAgainst: 4,
        },
      ],
      (id) => id,
    );
    expect(standings.map((s) => s.teamId)).toEqual(['x', 'y']);
  });

  it('falls back to qualifierScore when totals + gamesFor are tied', () => {
    const standings = sortStandings(
      [
        {
          teamId: 'p',
          total: 5,
          wins: 1,
          losses: 0,
          ties: 0,
          qualifierScore: 8,
          matchesPlayed: 1,
          gamesFor: 10,
          gamesAgainst: 5,
        },
        {
          teamId: 'q',
          total: 5,
          wins: 1,
          losses: 0,
          ties: 0,
          qualifierScore: 12,
          matchesPlayed: 1,
          gamesFor: 10,
          gamesAgainst: 5,
        },
      ],
      (id) => id,
    );
    expect(standings.map((s) => s.teamId)).toEqual(['q', 'p']);
  });
});
