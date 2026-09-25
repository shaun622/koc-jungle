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

export function AmericanoLeaderboardV3({ event, standings, championId }: { event: AmericanoEventStateV3; standings: AmericanoStandingV3[]; championId?: string }) {
  return <section className="amv3-panel amv3-leaderboard"><header><h2>Standings</h2><p>{event.formatConfig.scoring.kind === 'rally' ? 'Rally points' : 'Standings points'} · {standings.length} {event.formatConfig.pairingMode === 'fixed' ? 'teams' : 'players'}</p></header>
    {standings.length === 0 ? <p className="amv3-empty">No confirmed results yet.</p> : <ol>{standings.map((row) => {
      const label = entrantLabels(event, row.entrantId);
      return <li className={championId === row.entrantId ? 'champion' : ''} key={row.entrantId}><span className="amv3-rank">{row.rank}</span><span className="amv3-entrant"><strong>{label.primary}</strong>{label.secondary && <small>{label.secondary}</small>}<small>{row.matchesPlayed} matches · {row.wins}W {row.draws}D {row.losses}L</small></span><strong className="amv3-total">{row.total}</strong></li>;
    })}</ol>}
  </section>;
}
