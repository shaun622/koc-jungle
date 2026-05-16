import { useState } from 'react';
import { useEventStore } from '@/store/eventStore';
import {
  leaderboard,
  teamLabelShort,
  teamMatchHistory,
  teamNameFor,
} from '@/store/selectors';
import { Icons } from '@/components/Icons';

export function LeaderboardScreen() {
  const event = useEventStore((s) => s.event);
  const [openTeamId, setOpenTeamId] = useState<string | null>(null);

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
          <div className="qual-sub">
            Live nightly totals. Tap a team to see their round-by-round history.
          </div>
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
              <button
                key={row.teamId}
                className={'lbfull-row lbfull-row--clickable ' + (isKing ? 'king' : '')}
                onClick={() => setOpenTeamId(row.teamId)}
                type="button"
              >
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
              </button>
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

      {openTeamId && (
        <TeamHistoryModal
          teamId={openTeamId}
          onClose={() => setOpenTeamId(null)}
        />
      )}
    </div>
  );
}

function TeamHistoryModal({ teamId, onClose }: { teamId: string; onClose: () => void }) {
  const event = useEventStore((s) => s.event);
  if (!event) return null;
  const history = teamMatchHistory(event, teamId);
  const teamName = teamNameFor(event, teamId);
  const total = history.reduce((sum, h) => sum + h.pointsEarned, 0);
  const wins = history.filter((h) => h.won).length;
  const losses = history.filter((h) => !h.won && !h.tied).length;

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div
        className="modal team-history-modal"
        onClick={(e) => e.stopPropagation()}
        style={{ maxWidth: '40rem' }}
      >
        <div className="team-history-head">
          <div>
            <h2 style={{ marginBottom: 4 }}>{teamName}</h2>
            <div style={{ fontSize: 12, color: 'var(--text-2)', letterSpacing: '0.06em' }}>
              {wins} wins · {losses} losses · {total} points
            </div>
          </div>
          <button
            className="op-score-btn"
            onClick={onClose}
            aria-label="Close"
            style={{ background: 'transparent', border: 0 }}
          >
            <Icons.Close className="icon" />
          </button>
        </div>

        {history.length === 0 ? (
          <p style={{ color: 'var(--text-2)' }}>No completed rounds yet.</p>
        ) : (
          <div className="team-history-list">
            {history.map((h) => (
              <div
                key={h.roundIndex}
                className={'team-history-row ' + (h.won ? 'won' : h.tied ? 'tied' : 'lost')}
              >
                <span className="round-tag">R{h.roundIndex}</span>
                <span className="court-tag">
                  {h.courtName}
                  <span className="court-pts">{h.courtPoints} pts</span>
                </span>
                <span className="score">
                  <strong>{h.ownScore}</strong>–{h.opponentScore}
                </span>
                <span className="opponent">vs {h.opponentName}</span>
                <span className="earned">
                  {h.won ? `+${h.pointsEarned}` : h.tied ? '—' : '0'}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
