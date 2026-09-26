import type { AmericanoEventStateV3, AmericanoStandingV3 } from '@/logic/americanoV3/types';

function entrantLabels(event: AmericanoEventStateV3, entrantId: string): { primary: string; secondary?: string } {
  if (event.formatConfig.pairingMode === 'fixed') {
    const team = event.teams.find((candidate) => candidate.id === entrantId);
    if (!team) return { primary: entrantId };
    const players = team.players.map((player) => player.name).join(' & ');
    return { primary: team.name?.trim() || players, secondary: team.name?.trim() ? players : undefined };
  }
  return { primary: event.participants.find((player) => player.id === entrantId)?.name ?? entrantId };
}

export function AmericanoLeaderboardV3({ event, standings, championId, page = 0, pageSize, onPageChange }: {
  event: AmericanoEventStateV3; standings: AmericanoStandingV3[]; championId?: string;
  page?: number; pageSize?: number; onPageChange?: (page: number) => void;
}) {
  const size = pageSize && pageSize > 0 ? pageSize : standings.length || 1;
  const totalPages = Math.max(1, Math.ceil(standings.length / size));
  const visiblePage = Math.min(page, totalPages - 1);
  const first = visiblePage * size;
  return <section className="amv3-panel amv3-leaderboard"><header><h2>Standings</h2><p>{event.formatConfig.scoring.kind === 'rally' ? 'Rally points' : 'Standings points'} · {standings.length} {event.formatConfig.pairingMode === 'fixed' ? 'teams' : 'players'}</p></header>
    {standings.length === 0 ? <p className="amv3-empty">No confirmed results yet.</p> : <ol start={first + 1}>{standings.slice(first, first + size).map((row) => {
      const label = entrantLabels(event, row.entrantId);
      return <li className={championId === row.entrantId ? 'champion' : ''} key={row.entrantId}><span className="amv3-rank">{row.rank}</span><span className="amv3-entrant"><strong>{label.primary}</strong>{label.secondary && <small>{label.secondary}</small>}<small>{row.matchesPlayed} matches · {row.wins}W {row.draws}D {row.losses}L</small></span><strong className="amv3-total">{row.total}</strong></li>;
    })}</ol>}
    {totalPages > 1 && onPageChange && <nav className="amv3-page-controls" aria-label="Standings pages"><button className="btn" aria-label="Previous standings page" disabled={visiblePage === 0} onClick={() => onPageChange(visiblePage - 1)}>←</button><span>{first + 1}–{Math.min(first + size, standings.length)} of {standings.length}</span><button className="btn" aria-label="Next standings page" disabled={visiblePage === totalPages - 1} onClick={() => onPageChange(visiblePage + 1)}>→</button></nav>}
  </section>;
}
