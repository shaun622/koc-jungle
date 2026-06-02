/**
 * Shared helpers for tournament-format implementations.
 */

import type { Court, MainRound, PendingAssignment, Team, TieRule } from '@/types/domain';
import { decideWinnerLoser } from '@/logic/rotation';

/**
 * Pack scheduled matches onto the highest-position courts first.
 * Throws if there are more matches than courts.
 *
 *  - `formatName` is just used in the thrown error message so each format
 *    reports its own context.
 */
export function packMatchesOntoCourts(
  matches: Array<[string, string]>,
  courts: Court[],
  formatName: string,
): PendingAssignment[] {
  const sortedCourts = courts.slice().sort((a, b) => b.position - a.position);
  if (matches.length > sortedCourts.length) {
    throw new Error(
      `${formatName}: ${matches.length} matches scheduled but only ${sortedCourts.length} courts available.`,
    );
  }
  return matches.map(([teamAId, teamBId], i) => ({
    courtId: sortedCourts[i].id,
    teamAId,
    teamBId,
  }));
}

/**
 * Rank teams by running points from completed rounds. Used by Mexicano
 * to compute the next round's adjacent-ranked pairings.
 *
 *  - Ties in points break by total games-for (higher is better), then
 *    by team id for stability.
 *  - Only completed rounds count.
 *  - Each team is returned exactly once. Active = false teams are kept
 *    in the ranking but moved to the bottom; the caller decides whether
 *    to include them in next-round scheduling.
 */
export function rankTeamsByPoints(
  rounds: MainRound[],
  teams: Team[],
  tieRule: TieRule,
): string[] {
  type Acc = { total: number; gf: number; active: boolean };
  const acc = new Map<string, Acc>();
  for (const t of teams) {
    acc.set(t.id, { total: 0, gf: 0, active: t.active });
  }
  for (const round of rounds) {
    if (!round.completedAt) continue;
    for (const m of round.matches) {
      const a = acc.get(m.teamAId);
      const b = acc.get(m.teamBId);
      if (a) a.gf += m.scoreA;
      if (b) b.gf += m.scoreB;
      const r = decideWinnerLoser(m, tieRule);
      if (r.isTied || !r.winnerId) continue;
      const w = acc.get(r.winnerId);
      if (w) w.total += m.pointValueAtTime;
    }
  }
  return [...acc.entries()]
    .sort(([idA, a], [idB, b]) => {
      if (a.active !== b.active) return a.active ? -1 : 1;
      if (b.total !== a.total) return b.total - a.total;
      if (b.gf !== a.gf) return b.gf - a.gf;
      return idA.localeCompare(idB);
    })
    .map(([id]) => id);
}
