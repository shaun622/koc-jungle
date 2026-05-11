import { describe, expect, it } from 'vitest';
import {
  assignRankedTeamsToCourts,
  qualifierScoresByTeam,
  rankTeamsByQualifier,
} from '@/logic/seeding';
import type { Court, Match, QualifierRound, Team } from '@/types/domain';

function team(id: string, name: string): Team {
  return {
    id,
    name,
    players: [
      { id: `${id}-p1`, name: `${name} A` },
      { id: `${id}-p2`, name: `${name} B` },
    ],
    createdAt: 0,
    active: true,
  };
}

function court(position: number): Court {
  return {
    id: `c-${position}`,
    position,
    name: `Court ${position}`,
    pointValue: position + 2,
  };
}

function qmatch(courtId: string, a: string, b: string, scoreA: number, scoreB: number): Match {
  return {
    id: `m-${a}-${b}`,
    courtId,
    teamAId: a,
    teamBId: b,
    scoreA,
    scoreB,
    status: 'in-progress',
    pointValueAtTime: 0,
  };
}

describe('qualifierScoresByTeam', () => {
  it('sums each team\'s absolute qualifier score', () => {
    const teams = [team('a', 'A'), team('b', 'B'), team('c', 'C'), team('d', 'D')];
    const qualifier: QualifierRound = {
      shuffleSeed: 1,
      matches: [qmatch('c-1', 'a', 'b', 12, 4), qmatch('c-2', 'c', 'd', 8, 8)],
    };
    const scores = qualifierScoresByTeam(qualifier, teams);
    expect(new Map(scores.map((s) => [s.teamId, s.score]))).toEqual(
      new Map([
        ['a', 12],
        ['b', 4],
        ['c', 8],
        ['d', 8],
      ]),
    );
  });
});

describe('rankTeamsByQualifier', () => {
  it('orders by descending score, tie-breaks by team name', () => {
    const teams = [team('a', 'Alpha'), team('b', 'Bravo'), team('c', 'Charlie'), team('d', 'Delta')];
    const qualifier: QualifierRound = {
      shuffleSeed: 1,
      matches: [qmatch('c-1', 'a', 'b', 10, 6), qmatch('c-2', 'c', 'd', 8, 8)],
    };
    const ranked = rankTeamsByQualifier(qualifier, teams, (id) => teams.find((t) => t.id === id)!.name!);
    expect(ranked.map((r) => r.teamId)).toEqual(['a', 'c', 'd', 'b']);
  });
});

describe('assignRankedTeamsToCourts', () => {
  it('places top 2 on Centre court (highest position) and bottom 2 on Court 1', () => {
    const courts = [court(1), court(2), court(3)];
    const ranked = ['t1', 't2', 't3', 't4', 't5', 't6'];
    const assignments = assignRankedTeamsToCourts(ranked, courts);
    const by = (id: string) => assignments.find((a) => a.courtId === id)!;
    expect([by('c-3').teamAId, by('c-3').teamBId]).toEqual(['t1', 't2']);
    expect([by('c-2').teamAId, by('c-2').teamBId]).toEqual(['t3', 't4']);
    expect([by('c-1').teamAId, by('c-1').teamBId]).toEqual(['t5', 't6']);
  });

  it('throws when team count does not match courts × 2', () => {
    const courts = [court(1), court(2)];
    expect(() => assignRankedTeamsToCourts(['a', 'b', 'c'], courts)).toThrow();
  });
});
