import type { Court, Match, PendingAssignment, QualifierRound, Team } from '@/types/domain';
import { newId } from './idGen';
import { seededShuffle } from './shuffle';

export interface QualifierScoreEntry {
  teamId: string;
  score: number;
}

/**
 * Compute every team's absolute qualifier score from the qualifier matches.
 * If a team didn't play (e.g. odd team count, future) returns score 0.
 */
export function qualifierScoresByTeam(
  qualifier: QualifierRound,
  teams: Team[],
): QualifierScoreEntry[] {
  const scoreById = new Map<string, number>();
  for (const team of teams) scoreById.set(team.id, 0);
  for (const m of qualifier.matches) {
    scoreById.set(m.teamAId, (scoreById.get(m.teamAId) ?? 0) + m.scoreA);
    scoreById.set(m.teamBId, (scoreById.get(m.teamBId) ?? 0) + m.scoreB);
  }
  return Array.from(scoreById.entries()).map(([teamId, score]) => ({ teamId, score }));
}

export function rankTeamsByQualifier(
  qualifier: QualifierRound,
  teams: Team[],
  teamNameFor: (id: string) => string,
): QualifierScoreEntry[] {
  const entries = qualifierScoresByTeam(qualifier, teams);
  entries.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return teamNameFor(a.teamId).localeCompare(teamNameFor(b.teamId));
  });
  return entries;
}

/**
 * Given a ranked list of team IDs (top → bottom), assign pairs onto courts.
 * Top 2 → highest-position court (Centre), next 2 → next court down, etc.
 */
export function assignRankedTeamsToCourts(
  rankedTeamIds: string[],
  courts: Court[],
): PendingAssignment[] {
  const sortedCourtsDesc = courts.slice().sort((a, b) => b.position - a.position);
  if (rankedTeamIds.length !== sortedCourtsDesc.length * 2) {
    throw new Error(
      `Expected ${sortedCourtsDesc.length * 2} ranked teams, got ${rankedTeamIds.length}.`,
    );
  }
  const out: PendingAssignment[] = [];
  for (let i = 0; i < sortedCourtsDesc.length; i++) {
    const court = sortedCourtsDesc[i];
    const teamAId = rankedTeamIds[i * 2];
    const teamBId = rankedTeamIds[i * 2 + 1];
    out.push({ courtId: court.id, teamAId, teamBId });
  }
  return out;
}

/**
 * Build the qualifier round: pair the 14 teams into 7 matches across
 * randomly-shuffled courts (one match per court).
 */
export function buildQualifierRound(
  teams: Team[],
  courts: Court[],
  seed: number,
  durationMs: number,
): QualifierRound {
  const activeTeams = teams.filter((t) => t.active);
  if (activeTeams.length !== courts.length * 2) {
    throw new Error(
      `Need exactly ${courts.length * 2} active teams to start qualifier, got ${activeTeams.length}.`,
    );
  }
  const shuffledTeams = seededShuffle(activeTeams, seed);
  const shuffledCourts = seededShuffle(courts, seed ^ 0x5a5a5a5a);
  const matches: Match[] = [];
  for (let i = 0; i < shuffledCourts.length; i++) {
    const court = shuffledCourts[i];
    const teamA = shuffledTeams[i * 2];
    const teamB = shuffledTeams[i * 2 + 1];
    matches.push({
      id: newId(),
      courtId: court.id,
      teamAId: teamA.id,
      teamBId: teamB.id,
      scoreA: 0,
      scoreB: 0,
      status: 'in-progress',
      pointValueAtTime: court.pointValue,
    });
  }
  return { matches, shuffleSeed: seed, totalPausedMs: 0, durationMs };
}

export const QUALIFIER_TOTAL = 16;
