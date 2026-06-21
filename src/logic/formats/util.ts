/**
 * Shared helpers for tournament-format implementations.
 */

import type { Court, MainRound, PendingAssignment, Team, TieRule } from '@/types/domain';
import { decideWinnerLoser } from '@/logic/rotation';

/**
 * Pack scheduled matches onto the highest-position courts first.
 *
 * When there are more matches than courts, the surplus matches run in later
 * "waves" on the same courts: court assignment cycles through the courts and
 * each match is tagged with its wave (`floor(i / courtCount)`). A round with
 * matches <= courts is a single wave 0, identical to the original behaviour —
 * so KoC and every fitting round are unaffected. The operator advances wave
 * by wave; teams not in the current wave are shown resting.
 *
 *  - `_formatName` is retained for call-site compatibility (formats pass their
 *    own name); it's no longer needed now that we never throw.
 */
export function packMatchesOntoCourts(
  matches: Array<[string, string]>,
  courts: Court[],
  _formatName: string,
): PendingAssignment[] {
  const sortedCourts = courts.slice().sort((a, b) => b.position - a.position);
  if (sortedCourts.length === 0) return [];
  return matches.map(([teamAId, teamBId], i) => ({
    courtId: sortedCourts[i % sortedCourts.length].id,
    teamAId,
    teamBId,
    wave: Math.floor(i / sortedCourts.length),
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
