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
});

describe('sortStandings', () => {
  it('orders by total desc then wins desc', () => {
    const event = build();
    const standings = sortStandings(computeStandings(event), (id) =>
      event.teams.find((t) => t.id === id)?.name ?? id,
    );
    expect(standings.map((s) => s.teamId)).toEqual(['a', 'd', 'c', 'b']);
  });
});
