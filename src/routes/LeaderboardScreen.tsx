import { useEffect, useMemo, useState } from 'react';
import { useEventStore } from '@/store/eventStore';
import {
  leaderboard,
  rankMovements,
  teamLabelShort,
  teamMatchHistory,
  teamNameFor,
} from '@/store/selectors';
import { Icons } from '@/components/Icons';
import { RankMovement } from '@/components/RankMovement';

export function LeaderboardScreen() {
  const event = useEventStore((s) => s.event);
  const [openTeamId, setOpenTeamId] = useState<string | null>(null);
  const [editMode, setEditMode] = useState(false);

  if (!event) {
    return <p style={{ padding: 24, color: 'var(--text-2)' }}>No event.</p>;
  }
  const rows = leaderboard(event).filter((r) => {
    const team = event.teams.find((t) => t.id === r.teamId);
    return team?.active;
  });
  const movements = useMemo(() => rankMovements(event), [event]);
  const topId = rows[0]?.teamId;
  const completedRounds = event.rounds.filter((r) => r.completedAt).length;
  // Manual point correction is offered once the event is over.
  const canEdit = event.status === 'complete';

  return (
    <div className="lbfull">
      <div className="qual-head">
        <div>
          <div className="qual-title">Standings</div>
          <div className="qual-sub">
            {editMode
              ? 'Editing. Type the corrected total for any team. Standings re-sort as you go.'
              : 'Live nightly totals. Tap a team to see their round-by-round history.'}
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div className="qual-meta">
            {completedRounds > 0
              ? `Through Round ${completedRounds}`
              : 'No rounds completed yet'}
          </div>
          {canEdit && (
            <button
              className={'btn sm ' + (editMode ? 'primary' : '')}
              onClick={() => {
                setEditMode((v) => !v);
                setOpenTeamId(null);
              }}
            >
              {editMode ? 'Done' : 'Edit points'}
            </button>
          )}
        </div>
      </div>
      <div className="lbfull-table">
        <div className="lbfull-header">
          <span>RANK</span>
          <span>TEAM</span>
          <span style={{ textAlign: 'right' }}>WINS</span>
          <span style={{ textAlign: 'right' }}>LOSSES</span>
          <span style={{ textAlign: 'right' }} title="Games scored across all rounds">GF</span>
          <span style={{ textAlign: 'right' }} title="Games conceded across all rounds">GA</span>
          <span style={{ textAlign: 'right' }}>QUAL</span>
          <span style={{ textAlign: 'right' }}>POINTS</span>
        </div>
        <div className="lbfull-rows">
          {rows.map((row, idx) => {
            const team = event.teams.find((t) => t.id === row.teamId);
            const isKing = row.teamId === topId && row.total > 0;
            const cells = (
              <>
                <span className="lbfull-rank">#{idx + 1}</span>
                <span className="lbfull-name">
                  {isKing && <Icons.Crown className="icon lg" style={{ color: 'var(--gold)' }} />}
                  <RankMovement movement={movements.get(row.teamId)} />
                  {team ? teamLabelShort(team) : row.teamId}
                  {team && team.name && (
                    <span className="players">
                      · {team.players[0].name} & {team.players[1].name}
                    </span>
                  )}
                </span>
                <span className="lbfull-stat">{row.wins}</span>
                <span className="lbfull-stat">{row.losses}</span>
                <span className="lbfull-stat">{row.gamesFor}</span>
                <span className="lbfull-stat">{row.gamesAgainst}</span>
                <span className="lbfull-stat">{row.qualifierScore}</span>
                {editMode ? (
                  <PointsCell teamId={row.teamId} total={row.total} />
                ) : (
                  <span className="lbfull-pts">{row.total}</span>
                )}
              </>
            );
            if (editMode) {
              return (
                <div key={row.teamId} className={'lbfull-row ' + (isKing ? 'king' : '')}>
                  {cells}
                </div>
              );
            }
            return (
              <button
                key={row.teamId}
                className={'lbfull-row lbfull-row--clickable ' + (isKing ? 'king' : '')}
                onClick={() => setOpenTeamId(row.teamId)}
                type="button"
              >
                {cells}
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

      {openTeamId && !editMode && (
        <TeamHistoryModal
          teamId={openTeamId}
          onClose={() => setOpenTeamId(null)}
        />
      )}
    </div>
  );
}

/**
 * Editable points cell. Shows the team's current effective total (which
 * already reflects any override). Committing on blur/Enter stores the typed
 * value as the team's pointsOverride; the standings re-sort.
 */
function PointsCell({ teamId, total }: { teamId: string; total: number }) {
  const setPointsOverride = useEventStore((s) => s.setPointsOverride);
  const [text, setText] = useState(String(total));
  const [focused, setFocused] = useState(false);
  useEffect(() => {
    if (!focused) setText(String(total));
  }, [total, focused]);
  const commit = () => {
    setFocused(false);
    const n = parseInt(text, 10);
    if (!Number.isNaN(n) && n >= 0) {
      setPointsOverride(teamId, n);
      setText(String(n));
    } else {
      setText(String(total));
    }
  };
  return (
    <input
      className="lbfull-pts-input"
      type="text"
      inputMode="numeric"
      pattern="[0-9]*"
      maxLength={3}
      value={text}
      onChange={(e) => setText(e.target.value.replace(/[^0-9]/g, ''))}
      onFocus={(e) => {
        setFocused(true);
        e.currentTarget.select();
      }}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
      }}
    />
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
                  {h.won ? `+${h.pointsEarned}` : h.tied ? '·' : '0'}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
