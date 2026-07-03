import type { TeamStanding } from '@/logic/scoring';

/**
 * Small secondary line shown under a team in the standings: games won-lost
 * across the event plus the game difference (always signed). It's what
 * explains why two teams tied on points are ordered the way they are — the
 * sort tie-breaks on game difference (see sortStandings).
 */
export function GamesLine({ row, className }: { row: TeamStanding; className?: string }) {
  const diff = row.gamesFor - row.gamesAgainst;
  const signed = diff >= 0 ? `+${diff}` : `${diff}`;
  return (
    <span className={className}>
      {row.gamesFor}-{row.gamesAgainst} games · {signed}
    </span>
  );
}
