import { describe, expect, it } from 'vitest';
import type { AmericanoEventStateV2, AmericanoMatchV2, AmericanoRoundV2 } from '@/logic/americanoV2/types';
import { americanoPodium, computeAmericanoStandings } from '@/logic/americanoV2/standings';
import { complementaryAmericanoScore, validateAmericanoResult } from '@/logic/americanoV2/validation';
import { americanoV2Fixture } from '@/tests/americanoV2Fixtures';

function round(match: AmericanoMatchV2, completed = true): AmericanoRoundV2 {
  return {
    id: 'round-1', index: 1, fixtureRoundId: 'fixture-round-1', durationMs: 600_000,
    totalPausedMs: 0, completedAt: completed ? 1 : undefined, matches: [match],
  };
}

function rotatingMatch(scoreA: number, scoreB: number): AmericanoMatchV2 {
  return {
    id: 'match-1', courtId: 'court-1',
    sideA: { kind: 'rotating-pair', playerIds: ['player-1', 'player-2'] },
    sideB: { kind: 'rotating-pair', playerIds: ['player-3', 'player-4'] },
    scoreA, scoreB, resultConfirmed: true,
  };
}

function withRounds(event: AmericanoEventStateV2, rounds: AmericanoRoundV2[]): AmericanoEventStateV2 {
  return { ...event, status: 'complete', rounds };
}

describe('Americano v2 result validation', () => {
  it('accepts explicit 0–24 and 12–12 results', () => {
    expect(validateAmericanoResult(0, 24, 24)).toEqual({ scoreA: undefined, scoreB: undefined });
    expect(validateAmericanoResult(12, 12, 24)).toEqual({ scoreA: undefined, scoreB: undefined });
  });

  it.each([
    [null, 24], [Number.NaN, 24], [Number.POSITIVE_INFINITY, 0], [1.5, 22.5], [-1, 25], [25, -1], [10, 10],
  ])('rejects invalid result %s–%s at 24', (scoreA, scoreB) => {
    expect(Object.values(validateAmericanoResult(scoreA, scoreB, 24)).some(Boolean)).toBe(true);
  });

  it('only derives a complement for a valid whole score', () => {
    expect(complementaryAmericanoScore(10, 24)).toBe(14);
    expect(complementaryAmericanoScore(25, 24)).toBeNull();
    expect(complementaryAmericanoScore(1.5, 24)).toBeNull();
  });
});

describe('Americano v2 standings', () => {
  it('awards 10 and 14 to both players on the corresponding rotating side', () => {
    const event = withRounds(americanoV2Fixture('rotating'), [round(rotatingMatch(10, 14))]);
    const rows = new Map(computeAmericanoStandings(event).map((row) => [row.entrantId, row]));
    expect(rows.get('player-1')).toMatchObject({ total: 10, pointsFor: 10, pointsAgainst: 14, matchesPlayed: 1 });
    expect(rows.get('player-2')?.total).toBe(10);
    expect(rows.get('player-3')?.total).toBe(14);
    expect(rows.get('player-4')?.total).toBe(14);
  });

  it('awards a fixed result once to each team rather than doubling or using court value', () => {
    const base = americanoV2Fixture('fixed');
    const match: AmericanoMatchV2 = {
      id: 'match-1', courtId: 'court-1',
      sideA: { kind: 'fixed-team', teamId: 'team-1', playerIds: ['player-1', 'player-2'] },
      sideB: { kind: 'fixed-team', teamId: 'team-2', playerIds: ['player-3', 'player-4'] },
      scoreA: 10, scoreB: 14, resultConfirmed: true,
    };
    const rows = new Map(computeAmericanoStandings(withRounds(base, [round(match)])).map((row) => [row.entrantId, row]));
    expect(rows.get('team-1')?.total).toBe(10);
    expect(rows.get('team-2')?.total).toBe(14);
  });

  it('assigns shared competition ranks and includes every rank-three-or-better tie', () => {
    const event = americanoV2Fixture('rotating');
    event.participants.push({ id: 'player-5', name: 'Five', active: true, createdAt: 5 });
    event.rounds = [round(rotatingMatch(12, 12))];
    event.status = 'complete';
    const rows = computeAmericanoStandings(event);
    expect(rows.map(({ rank }) => rank)).toEqual([1, 1, 1, 1, 5]);
    expect(americanoPodium(event)).toHaveLength(4);
  });

  it('does not count a current or ended-early round and shows no podium without a completed round', () => {
    const current = withRounds(americanoV2Fixture('rotating'), [round(rotatingMatch(10, 14), false)]);
    expect(computeAmericanoStandings(current).every((row) => row.matchesPlayed === 0)).toBe(true);
    expect(americanoPodium(current)).toEqual([]);
    current.rounds[0].completedAt = 1;
    current.rounds[0].excludedReason = 'ended-early';
    expect(computeAmericanoStandings(current).every((row) => row.matchesPlayed === 0)).toBe(true);
  });
});
