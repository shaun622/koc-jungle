import type { EventState, MainRound } from '@/types/domain';
import { decideWinnerLoser } from './rotation';

export interface TeamStanding {
  teamId: string;
  total: number;
  wins: number;
  losses: number;
  ties: number;
  qualifierScore: number;
  matchesPlayed: number;
  /** Sum of own scores across all completed main rounds. */
  gamesFor: number;
  /** Sum of opponent scores across all completed main rounds. */
  gamesAgainst: number;
}

export function computeStandings(event: EventState): TeamStanding[] {
  const standings = new Map<string, TeamStanding>();
  for (const team of event.teams) {
    standings.set(team.id, {
      teamId: team.id,
      total: 0,
      wins: 0,
      losses: 0,
      ties: 0,
      qualifierScore: 0,
      matchesPlayed: 0,
      gamesFor: 0,
      gamesAgainst: 0,
    });
  }

  if (event.qualifier) {
    for (const m of event.qualifier.matches) {
      const a = standings.get(m.teamAId);
      const b = standings.get(m.teamBId);
      if (a) a.qualifierScore += m.scoreA;
      if (b) b.qualifierScore += m.scoreB;
    }
  }

  for (const round of event.rounds) {
    if (!round.completedAt) continue;
    accumulateRound(round, standings, event.settings.tieRule);
  }

  // Operator manual corrections — a set pointsOverride replaces the
  // match-derived total (post-event wrong-score fix).
  for (const team of event.teams) {
    if (typeof team.pointsOverride === 'number') {
      const s = standings.get(team.id);
      if (s) s.total = team.pointsOverride;
    }
  }

  return Array.from(standings.values());
}

function accumulateRound(
  round: MainRound,
  standings: Map<string, TeamStanding>,
  tieRule: EventState['settings']['tieRule'],
): void {
  for (const m of round.matches) {
    const a = standings.get(m.teamAId);
    const b = standings.get(m.teamBId);
    if (a) {
      a.matchesPlayed += 1;
      a.gamesFor += m.scoreA;
      a.gamesAgainst += m.scoreB;
    }
    if (b) {
      b.matchesPlayed += 1;
      b.gamesFor += m.scoreB;
      b.gamesAgainst += m.scoreA;
    }

    const result = decideWinnerLoser(m, tieRule);
    if (result.isTied) {
      if (a) a.ties += 1;
      if (b) b.ties += 1;
      continue;
    }
    if (result.winnerId === m.teamAId) {
      if (a) {
        a.wins += 1;
        a.total += m.pointValueAtTime;
      }
      if (b) b.losses += 1;
    } else if (result.winnerId === m.teamBId) {
      if (b) {
        b.wins += 1;
        b.total += m.pointValueAtTime;
      }
      if (a) a.losses += 1;
    }
  }
}

export function sortStandings(
  standings: TeamStanding[],
  teamNameFor: (id: string) => string,
): TeamStanding[] {
  // Tie-break chain (operator decision):
  //   1. points total (court pointValue per win + manual overrides)
  //   2. games for — total scores accumulated in the rounds
  //   3. qualifier score — best of QUALIFIER_TOTAL per match
  //   4. team name (deterministic fallback)
  return standings.slice().sort((a, b) => {
    if (b.total !== a.total) return b.total - a.total;
    if (b.gamesFor !== a.gamesFor) return b.gamesFor - a.gamesFor;
    if (b.qualifierScore !== a.qualifierScore) return b.qualifierScore - a.qualifierScore;
    return teamNameFor(a.teamId).localeCompare(teamNameFor(b.teamId));
  });
}
