import type { EventState, MainRound, Team } from '@/types/domain';
import { computeStandings, sortStandings, type TeamStanding } from '@/logic/scoring';
import { decideWinnerLoser } from '@/logic/rotation';

export function teamNameFor(event: EventState | null, id: string): string {
  if (!event) return id;
  const t = event.teams.find((tt) => tt.id === id);
  if (!t) return id;
  return t.name ?? `${t.players[0].name} & ${t.players[1].name}`;
}

export function teamLabelShort(team: Team): string {
  if (team.name) return team.name;
  return `${team.players[0].name} & ${team.players[1].name}`;
}

export function currentRound(event: EventState | null): MainRound | null {
  if (!event || event.rounds.length === 0) return null;
  return event.rounds[event.rounds.length - 1];
}

export function leaderboard(event: EventState | null): TeamStanding[] {
  if (!event) return [];
  const standings = computeStandings(event);
  return sortStandings(standings, (id) => teamNameFor(event, id));
}

export function activeTeams(event: EventState | null): Team[] {
  if (!event) return [];
  return event.teams.filter((t) => t.active);
}

export function courtById(event: EventState | null, id: string) {
  if (!event) return null;
  return event.courts.find((c) => c.id === id) ?? null;
}

export interface TeamMatchHistoryRow {
  roundIndex: number;
  courtName: string;
  courtPoints: number;
  opponentId: string;
  opponentName: string;
  ownScore: number;
  opponentScore: number;
  won: boolean;
  tied: boolean;
  pointsEarned: number;
}

export function teamMatchHistory(
  event: EventState | null,
  teamId: string,
): TeamMatchHistoryRow[] {
  if (!event) return [];
  const out: TeamMatchHistoryRow[] = [];
  for (const round of event.rounds) {
    if (!round.completedAt) continue;
    const match = round.matches.find(
      (m) => m.teamAId === teamId || m.teamBId === teamId,
    );
    if (!match) continue;
    const court = event.courts.find((c) => c.id === match.courtId);
    if (!court) continue;
    const isA = match.teamAId === teamId;
    const opponentId = isA ? match.teamBId : match.teamAId;
    const ownScore = isA ? match.scoreA : match.scoreB;
    const opponentScore = isA ? match.scoreB : match.scoreA;
    const decision = decideWinnerLoser(match, event.settings.tieRule);
    const won = decision.winnerId === teamId;
    const tied = decision.isTied;
    out.push({
      roundIndex: round.index,
      courtName: court.name,
      courtPoints: court.pointValue,
      opponentId,
      opponentName: teamNameFor(event, opponentId),
      ownScore,
      opponentScore,
      won,
      tied,
      pointsEarned: won ? match.pointValueAtTime : 0,
    });
  }
  return out;
}

/**
 * Per-team rank delta between the current standings and the standings
 * *before* the most recent completed round.
 *
 *   'up'   — team's rank improved (smaller index) after the latest round.
 *   'down' — team's rank dropped.
 *   'same' — no change.
 *   not in map — team didn't exist in the previous comparison (rare).
 *
 * Returns an empty map when no rounds have completed yet (nothing to
 * compare against).
 */
export function rankMovements(
  event: EventState | null,
): Map<string, 'up' | 'down' | 'same'> {
  const out = new Map<string, 'up' | 'down' | 'same'>();
  if (!event) return out;
  const completed = event.rounds.filter((r) => r.completedAt);
  if (completed.length === 0) return out;
  const lastCompleted = completed[completed.length - 1];
  const current = leaderboard(event);
  const eventPrev: EventState = {
    ...event,
    rounds: event.rounds.filter((r) => r !== lastCompleted),
  };
  const previous = leaderboard(eventPrev);
  const previousRanks = new Map(previous.map((r, i) => [r.teamId, i]));
  current.forEach((row, idx) => {
    const prevIdx = previousRanks.get(row.teamId);
    if (prevIdx === undefined) return;
    if (idx < prevIdx) out.set(row.teamId, 'up');
    else if (idx > prevIdx) out.set(row.teamId, 'down');
    else out.set(row.teamId, 'same');
  });
  return out;
}

export interface NightlyStat {
  label: string;
  value: string;
  detail?: string;
}

export function nightlyStats(event: EventState | null): NightlyStat[] {
  if (!event || event.rounds.filter((r) => r.completedAt).length === 0) return [];
  const completed = event.rounds.filter((r) => r.completedAt);
  const centreCourtId = (() => {
    const sorted = event.courts.slice().sort((a, b) => b.position - a.position);
    return sorted[0]?.id;
  })();

  // Most wins on Centre court
  const centreWins = new Map<string, number>();
  for (const round of completed) {
    const m = round.matches.find((mm) => mm.courtId === centreCourtId);
    if (!m) continue;
    const decision = decideWinnerLoser(m, event.settings.tieRule);
    if (!decision.winnerId) continue;
    centreWins.set(decision.winnerId, (centreWins.get(decision.winnerId) ?? 0) + 1);
  }
  let topCentreWinner: string | null = null;
  let topCentreCount = 0;
  centreWins.forEach((count, id) => {
    if (count > topCentreCount) {
      topCentreCount = count;
      topCentreWinner = id;
    }
  });

  // Longest win streak
  const teamHistories = new Map<string, boolean[]>();
  for (const round of completed) {
    for (const m of round.matches) {
      const decision = decideWinnerLoser(m, event.settings.tieRule);
      if (decision.winnerId === m.teamAId) {
        pushBool(teamHistories, m.teamAId, true);
        pushBool(teamHistories, m.teamBId, false);
      } else if (decision.winnerId === m.teamBId) {
        pushBool(teamHistories, m.teamBId, true);
        pushBool(teamHistories, m.teamAId, false);
      } else {
        pushBool(teamHistories, m.teamAId, false);
        pushBool(teamHistories, m.teamBId, false);
      }
    }
  }
  let bestStreak = 0;
  let bestStreakTeam: string | null = null;
  teamHistories.forEach((wins, id) => {
    let cur = 0;
    let best = 0;
    for (const w of wins) {
      if (w) {
        cur += 1;
        if (cur > best) best = cur;
      } else cur = 0;
    }
    if (best > bestStreak) {
      bestStreak = best;
      bestStreakTeam = id;
    }
  });

  // Biggest score margin
  let biggestMargin = 0;
  let biggestMarginText = '';
  for (const round of completed) {
    for (const m of round.matches) {
      const margin = Math.abs(m.scoreA - m.scoreB);
      if (margin > biggestMargin) {
        biggestMargin = margin;
        const winner = m.scoreA > m.scoreB ? m.teamAId : m.teamBId;
        const loser = m.scoreA > m.scoreB ? m.teamBId : m.teamAId;
        biggestMarginText = `${teamNameFor(event, winner)} ${Math.max(m.scoreA, m.scoreB)}–${Math.min(m.scoreA, m.scoreB)} ${teamNameFor(event, loser)}`;
      }
    }
  }

  const lb = leaderboard(event);

  const stats: NightlyStat[] = [];
  if (biggestMargin > 0) {
    stats.push({
      label: 'Biggest margin',
      value: `+${biggestMargin}`,
      detail: biggestMarginText,
    });
  }
  if (topCentreWinner && topCentreCount > 0) {
    stats.push({
      label: 'Centre Court king',
      value: teamNameFor(event, topCentreWinner),
      detail: `${topCentreCount} win${topCentreCount === 1 ? '' : 's'} on the top court`,
    });
  }
  if (bestStreak >= 2 && bestStreakTeam) {
    stats.push({
      label: 'Longest streak',
      value: teamNameFor(event, bestStreakTeam),
      detail: `${bestStreak} wins in a row`,
    });
  }
  // Sharpshooter: most games / points won across the night.
  if (lb.length) {
    const sharp = lb.slice().sort((a, b) => b.gamesFor - a.gamesFor)[0];
    if (sharp && sharp.gamesFor > 0) {
      stats.push({
        label: 'Sharpshooter',
        value: teamNameFor(event, sharp.teamId),
        detail: `${sharp.gamesFor} games won all night`,
      });
    }
  }
  // Wooden spoon: the team that finished on the fewest points. Explicitly
  // lowest total (ties broken by fewest games won) so it reads as a
  // points-based award rather than "whoever sorted last".
  if (lb.length >= 3) {
    const spoon = lb
      .slice()
      .sort((a, b) => a.total - b.total || a.gamesFor - b.gamesFor)[0];
    stats.push({
      label: 'Wooden spoon 🥄',
      value: teamNameFor(event, spoon.teamId),
      detail: `${spoon.total} pt${spoon.total === 1 ? '' : 's'} · ${spoon.wins} win${spoon.wins === 1 ? '' : 's'}. There's always next week.`,
    });
  }
  return stats;
}

function pushBool(map: Map<string, boolean[]>, id: string, v: boolean) {
  const arr = map.get(id) ?? [];
  arr.push(v);
  map.set(id, arr);
}
