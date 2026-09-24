import type {
  AmericanoEntrantView,
  AmericanoEventStateV2,
  AmericanoMatchV2,
  AmericanoSide,
  AmericanoSideView,
} from '@/logic/americanoV2/types';

export interface AmericanoStandingV2 {
  entrantId: string;
  rank: number;
  total: number;
  matchesPlayed: number;
  pointsFor: number;
  pointsAgainst: number;
  wins: number;
  draws: number;
  losses: number;
}

function entrantIdsForSide(side: AmericanoSide, event: AmericanoEventStateV2): string[] {
  if (event.formatConfig.pairingMode === 'fixed') {
    return side.kind === 'fixed-team' ? [side.teamId] : [];
  }
  return [...side.playerIds];
}

function addResult(
  standings: Map<string, AmericanoStandingV2>,
  entrantIds: string[],
  ownScore: number,
  opponentScore: number,
): void {
  for (const id of entrantIds) {
    const row = standings.get(id);
    if (!row) continue;
    row.total += ownScore;
    row.matchesPlayed += 1;
    row.pointsFor += ownScore;
    row.pointsAgainst += opponentScore;
    if (ownScore > opponentScore) row.wins += 1;
    else if (ownScore < opponentScore) row.losses += 1;
    else row.draws += 1;
  }
}

function completedMatch(match: AmericanoMatchV2): match is AmericanoMatchV2 & { scoreA: number; scoreB: number } {
  return match.resultConfirmed && match.scoreA !== null && match.scoreB !== null;
}

export function computeAmericanoStandings(event: AmericanoEventStateV2): AmericanoStandingV2[] {
  const orderedIds = event.americanoSchedule?.orderedEntrantIds
    ?? (event.formatConfig.pairingMode === 'fixed'
      ? event.teams.filter((team) => team.active).map((team) => team.id)
      : event.participants.filter((participant) => participant.active).map((participant) => participant.id));
  const order = new Map(orderedIds.map((id, index) => [id, index]));
  const standings = new Map<string, AmericanoStandingV2>(orderedIds.map((id) => [id, {
    entrantId: id,
    rank: 1,
    total: 0,
    matchesPlayed: 0,
    pointsFor: 0,
    pointsAgainst: 0,
    wins: 0,
    draws: 0,
    losses: 0,
  }]));
  for (const round of event.rounds) {
    if (!round.completedAt || round.excludedReason) continue;
    for (const match of round.matches) {
      if (!completedMatch(match)) continue;
      addResult(standings, entrantIdsForSide(match.sideA, event), match.scoreA, match.scoreB);
      addResult(standings, entrantIdsForSide(match.sideB, event), match.scoreB, match.scoreA);
    }
  }
  const rows = Array.from(standings.values()).sort((left, right) =>
    right.total - left.total || (order.get(left.entrantId) ?? 0) - (order.get(right.entrantId) ?? 0));
  for (const row of rows) {
    row.rank = 1 + rows.filter((other) => other.total > row.total).length;
  }
  return rows;
}

export function americanoPodium(event: AmericanoEventStateV2): AmericanoStandingV2[] {
  if (!event.rounds.some((round) => Boolean(round.completedAt) && !round.excludedReason)) return [];
  return computeAmericanoStandings(event).filter((row) => row.rank <= 3);
}

export function americanoEntrantView(event: AmericanoEventStateV2, entrantId: string): AmericanoEntrantView {
  if (event.formatConfig.pairingMode === 'fixed') {
    const team = event.teams.find((candidate) => candidate.id === entrantId);
    if (!team) return { id: entrantId, primaryLabel: entrantId, playerIds: [] };
    const players = `${team.players[0].name} & ${team.players[1].name}`;
    return {
      id: team.id,
      primaryLabel: team.name?.trim() || players,
      secondaryLabel: team.name?.trim() ? players : undefined,
      playerIds: team.players.map((player) => player.id),
    };
  }
  const participant = event.participants.find((candidate) => candidate.id === entrantId);
  return {
    id: entrantId,
    primaryLabel: participant?.name ?? entrantId,
    playerIds: [entrantId],
  };
}

export function americanoSideView(event: AmericanoEventStateV2, side: AmericanoSide): AmericanoSideView {
  const playerNames = side.playerIds.map((playerId) => {
    if (event.formatConfig.pairingMode === 'rotating') {
      return event.participants.find((participant) => participant.id === playerId)?.name ?? playerId;
    }
    for (const team of event.teams) {
      const player = team.players.find((candidate) => candidate.id === playerId);
      if (player) return player.name;
    }
    return playerId;
  });
  if (side.kind === 'fixed-team') {
    const team = event.teams.find((candidate) => candidate.id === side.teamId);
    return {
      key: `team:${side.teamId}`,
      primaryLabel: team?.name?.trim() || playerNames.join(' & '),
      secondaryLabel: playerNames.join(' & '),
      entrantIds: [side.teamId],
      playerIds: side.playerIds,
    };
  }
  return {
    key: `players:${side.playerIds.join(':')}`,
    primaryLabel: playerNames.join(' & '),
    secondaryLabel: playerNames.join(' & '),
    entrantIds: [...side.playerIds],
    playerIds: side.playerIds,
  };
}

export interface AmericanoMatchHistoryRowV2 {
  roundIndex: number;
  fixtureId: string;
  courtId: string;
  side: AmericanoSideView;
  opponents: AmericanoSideView;
  ownScore: number;
  opponentScore: number;
  excluded: boolean;
}

export function americanoMatchHistory(
  event: AmericanoEventStateV2,
  entrantId: string,
): AmericanoMatchHistoryRowV2[] {
  const rows: AmericanoMatchHistoryRowV2[] = [];
  for (const round of event.rounds) {
    for (const match of round.matches) {
      if (!completedMatch(match)) continue;
      const sideAEntrants = entrantIdsForSide(match.sideA, event);
      const sideBEntrants = entrantIdsForSide(match.sideB, event);
      const isA = sideAEntrants.includes(entrantId);
      if (!isA && !sideBEntrants.includes(entrantId)) continue;
      const own = isA ? match.sideA : match.sideB;
      const opponents = isA ? match.sideB : match.sideA;
      rows.push({
        roundIndex: round.index,
        fixtureId: match.id,
        courtId: match.courtId,
        side: americanoSideView(event, own),
        opponents: americanoSideView(event, opponents),
        ownScore: isA ? match.scoreA : match.scoreB,
        opponentScore: isA ? match.scoreB : match.scoreA,
        excluded: round.excludedReason === 'ended-early',
      });
    }
  }
  return rows;
}
