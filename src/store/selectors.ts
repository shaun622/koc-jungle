import type { EventState, MainRound, Team } from '@/types/domain';
import { computeStandings, sortStandings, type TeamStanding } from '@/logic/scoring';

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
