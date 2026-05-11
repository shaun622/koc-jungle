import { useEventStore } from '@/store/eventStore';
import { leaderboard, teamLabelShort } from '@/store/selectors';
import { Icons } from '@/components/Icons';

export function LeaderboardScreen() {
  const event = useEventStore((s) => s.event);
  if (!event) {
    return <p style={{ padding: 24, color: 'var(--text-2)' }}>No event.</p>;
  }
  const rows = leaderboard(event).filter((r) => {
    const team = event.teams.find((t) => t.id === r.teamId);
    return team?.active;
  });
  const topId = rows[0]?.teamId;
  const completedRounds = event.rounds.filter((r) => r.completedAt).length;

  return (
    <div className="lbfull">
      <div className="qual-head">
        <div>
          <div className="qual-title">Standings</div>
          <div className="qual-sub">Live nightly totals. Updated after every round.</div>
        </div>
        <div className="qual-meta">
          {completedRounds > 0
            ? `Through Round ${completedRounds}`
            : 'No rounds completed yet'}
        </div>
      </div>
      <div className="lbfull-table">
        <div className="lbfull-header">
          <span>RANK</span>
          <span>TEAM</span>
          <span style={{ textAlign: 'right' }}>WINS</span>
          <span style={{ textAlign: 'right' }}>LOSSES</span>
          <span style={{ textAlign: 'right' }}>QUAL</span>
          <span style={{ textAlign: 'right' }}>POINTS</span>
        </div>
        <div className="lbfull-rows">
          {rows.map((row, idx) => {
            const team = event.teams.find((t) => t.id === row.teamId);
            const isKing = row.teamId === topId && row.total > 0;
            return (
              <div key={row.teamId} className={'lbfull-row ' + (isKing ? 'king' : '')}>
                <span className="lbfull-rank">#{idx + 1}</span>
                <span className="lbfull-name">
                  {isKing && <Icons.Crown className="icon lg" style={{ color: 'var(--gold)' }} />}
                  {team ? teamLabelShort(team) : row.teamId}
                  {team && team.name && (
                    <span className="players">
                      · {team.players[0].name} & {team.players[1].name}
                    </span>
                  )}
                </span>
                <span className="lbfull-stat">{row.wins}</span>
                <span className="lbfull-stat">{row.losses}</span>
                <span className="lbfull-stat">{row.qualifierScore}</span>
                <span className="lbfull-pts">{row.total}</span>
              </div>
            );
          })}
          {rows.length === 0 && (
            <div
              className="lbfull-row"
              style={{
                gridColumn: '1 / -1',
                color: 'var(--text-2)',
                fontStyle: 'italic',
              }}
            >
              No teams yet.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
