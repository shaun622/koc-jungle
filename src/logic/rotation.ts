import type { Court, MainRound, Match, PendingAssignment, TieRule } from '@/types/domain';

export interface WinnerLoser {
  courtId: string;
  position: number;
  winnerId: string | null;
  loserId: string | null;
  isTied: boolean;
}

export function decideWinnerLoser(
  match: Match,
  tieRule: TieRule,
): { winnerId: string | null; loserId: string | null; isTied: boolean } {
  if (match.scoreA > match.scoreB) {
    return { winnerId: match.teamAId, loserId: match.teamBId, isTied: false };
  }
  if (match.scoreB > match.scoreA) {
    return { winnerId: match.teamBId, loserId: match.teamAId, isTied: false };
  }
  if (match.tieBreakWinnerId) {
    const winnerId = match.tieBreakWinnerId;
    const loserId = winnerId === match.teamAId ? match.teamBId : match.teamAId;
    return { winnerId, loserId, isTied: false };
  }
  if (tieRule === 'team-a-wins') {
    return { winnerId: match.teamAId, loserId: match.teamBId, isTied: false };
  }
  return { winnerId: null, loserId: null, isTied: true };
}

export function unresolvedTies(round: MainRound, tieRule: TieRule): Match[] {
  return round.matches.filter((m) => {
    const r = decideWinnerLoser(m, tieRule);
    return r.isTied;
  });
}

/**
 * Compute next round's court assignments using classic KOC rotation rules:
 *  - Top court (position N): winner stays, winner of N-1 moves up.
 *  - Bottom court (position 1): loser stays, loser of 2 moves down.
 *  - Middle court P: winner of P-1 moves up; loser of P+1 moves down.
 */
export function computeNextRoundAssignments(
  round: MainRound,
  courts: Court[],
  tieRule: TieRule,
): PendingAssignment[] {
  const sortedCourts = courts.slice().sort((a, b) => a.position - b.position);
  const N = sortedCourts.length;
  if (N === 0) return [];

  const byPosition = new Map<number, WinnerLoser>();
  for (const court of sortedCourts) {
    const match = round.matches.find((m) => m.courtId === court.id);
    if (!match) {
      throw new Error(`Missing match for court ${court.name} (position ${court.position}).`);
    }
    const r = decideWinnerLoser(match, tieRule);
    if (r.isTied) {
      throw new Error(`Unresolved tie on court ${court.name}.`);
    }
    byPosition.set(court.position, {
      courtId: court.id,
      position: court.position,
      winnerId: r.winnerId,
      loserId: r.loserId,
      isTied: false,
    });
  }

  const out: PendingAssignment[] = [];

  for (const court of sortedCourts) {
    const p = court.position;
    let teamAId: string;
    let teamBId: string;

    if (N === 1) {
      const self = byPosition.get(p)!;
      teamAId = self.winnerId!;
      teamBId = self.loserId!;
    } else if (p === N) {
      const self = byPosition.get(p)!;
      const below = byPosition.get(p - 1)!;
      teamAId = self.winnerId!;
      teamBId = below.winnerId!;
    } else if (p === 1) {
      const self = byPosition.get(p)!;
      const above = byPosition.get(p + 1)!;
      teamAId = self.loserId!;
      teamBId = above.loserId!;
    } else {
      const below = byPosition.get(p - 1)!;
      const above = byPosition.get(p + 1)!;
      teamAId = below.winnerId!;
      teamBId = above.loserId!;
    }

    out.push({ courtId: court.id, teamAId, teamBId });
  }

  return out;
}
