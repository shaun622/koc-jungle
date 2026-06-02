import { describe, expect, it } from 'vitest';
import { mexicano } from '@/logic/formats/mexicano';
import type { Court, MainRound, Match, Player, Team } from '@/types/domain';

function courts(n: number): Court[] {
  return Array.from({ length: n }, (_, i) => ({
    id: `c${i + 1}`,
    position: n - i,
    name: `Court ${n - i}`,
    pointValue: 3 + (n - i),
  }));
}

function fakePlayer(name: string): Player {
  return { id: `p-${name}`, name };
}

function fakeTeam(id: string): Team {
  return {
    id,
    players: [fakePlayer(`${id}-1`), fakePlayer(`${id}-2`)],
    createdAt: 0,
    active: true,
  };
}

function fakeMatch(
  teamAId: string,
  teamBId: string,
  scoreA: number,
  scoreB: number,
  courtId = 'c1',
  pointValueAtTime = 10,
): Match {
  return {
    id: `m-${teamAId}-${teamBId}`,
    courtId,
    teamAId,
    teamBId,
    scoreA,
    scoreB,
    status: 'completed',
    pointValueAtTime,
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

const SETTINGS = {
  defaultRoundDurationMs: 0,
  tieRule: 'operator-decides' as const,
  soundOnTimerEnd: false,
  warningAtMs: 0,
  roundsTotal: 4,
  announceRoundStart: false,
};

describe('mexicano.buildFirstRound', () => {
  it('pairs consecutive teams in stored order', () => {
    const assignments = mexicano.buildFirstRound({
      rankedTeamIds: ['a', 'b', 'c', 'd'],
      teams: [],
      courts: courts(2),
      config: { teams: ['a', 'b', 'c', 'd'] },
    });
    expect(assignments).toHaveLength(2);
    // [a,b] should go on the top court (position 2).
    const top = assignments.find((x) => x.courtId === 'c1');
    expect(top).toBeTruthy();
    expect([top!.teamAId, top!.teamBId].sort()).toEqual(['a', 'b']);
  });

  it('falls back to rankedTeamIds when config.teams is missing', () => {
    const assignments = mexicano.buildFirstRound({
      rankedTeamIds: ['x', 'y', 'z', 'w'],
      teams: [],
      courts: courts(2),
      config: {},
    });
    expect(assignments).toHaveLength(2);
  });

  it('odd team counts cause the last team to bye round 1', () => {
    const assignments = mexicano.buildFirstRound({
      rankedTeamIds: ['a', 'b', 'c'],
      teams: [],
      courts: courts(2),
      config: { teams: ['a', 'b', 'c'] },
    });
    // 3 teams → 1 pair, 1 bye.
    expect(assignments).toHaveLength(1);
    const playing = new Set(assignments.flatMap((a) => [a.teamAId, a.teamBId]));
    expect(playing.size).toBe(2);
    expect(playing.has('c')).toBe(false); // bottom of the list byes
  });
});

describe('mexicano.computeNextRound', () => {
  it('re-pairs adjacent ranked teams after round 1', () => {
    // Set up 4 teams where standings after round 1 are: c > a > b > d.
    // (c won c-vs-d 10-0; a won a-vs-b 10-0.) Court c1 is highest.
    const teams: Team[] = [fakeTeam('a'), fakeTeam('b'), fakeTeam('c'), fakeTeam('d')];
    const round1 = fakeRound(1, [
      fakeMatch('c', 'd', 10, 0, 'c1', 10), // c wins +10
      fakeMatch('a', 'b', 10, 0, 'c2', 8), // a wins +8
    ]);

    const next = mexicano.computeNextRound({
      rounds: [round1],
      teams,
      courts: courts(2),
      tieRule: 'operator-decides',
      config: { teams: ['a', 'b', 'c', 'd'] },
    });

    expect(next).toHaveLength(2);
    // Ranking: c (10), a (8), b (0), d (0). Adjacent pairing:
    //   c vs a → top court c1 (position 2)
    //   b vs d → c2 (position 1)
    const top = next.find((x) => x.courtId === 'c1')!;
    const second = next.find((x) => x.courtId === 'c2')!;
    expect([top.teamAId, top.teamBId].sort()).toEqual(['a', 'c']);
    expect([second.teamAId, second.teamBId].sort()).toEqual(['b', 'd']);
  });

  it('skips inactive teams when computing the next round', () => {
    // Deactivate team d mid-event; only a/b/c should be paired.
    const teams: Team[] = [
      fakeTeam('a'),
      fakeTeam('b'),
      fakeTeam('c'),
      { ...fakeTeam('d'), active: false },
    ];
    const round1 = fakeRound(1, [
      fakeMatch('a', 'b', 6, 4, 'c1', 10),
      fakeMatch('c', 'd', 8, 8, 'c2', 8),
    ]);
    const next = mexicano.computeNextRound({
      rounds: [round1],
      teams,
      courts: courts(2),
      tieRule: 'operator-decides',
      config: { teams: ['a', 'b', 'c', 'd'] },
    });
    // d still in formatConfig.teams pool, so still ranked — but the
    // ranker sinks inactive teams to the bottom and an odd count means
    // the last-ranked team byes. d is inactive so should bye.
    const playing = new Set(next.flatMap((a) => [a.teamAId, a.teamBId]));
    expect(playing.has('d')).toBe(false);
  });
});

describe('mexicano.isComplete', () => {
  it('honours settings.roundsTotal', () => {
    const r = (i: number) => fakeRound(i, []);
    expect(
      mexicano.isComplete({
        rounds: [r(1), r(2), r(3)],
        settings: SETTINGS, // roundsTotal: 4
        config: { teams: ['a', 'b', 'c', 'd'] },
      }),
    ).toBe(false);
    expect(
      mexicano.isComplete({
        rounds: [r(1), r(2), r(3), r(4)],
        settings: SETTINGS,
        config: { teams: ['a', 'b', 'c', 'd'] },
      }),
    ).toBe(true);
  });
});
