import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useEventStore } from '@/store/eventStore';
import { currentRound, leaderboard, teamLabelShort, teamNameFor } from '@/store/selectors';
import { isCentreCourt, type Court, type Match, type Team } from '@/types/domain';
import { Timer } from '@/components/Timer';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { Icons } from '@/components/Icons';
import { useTimer } from '@/hooks/useTimer';
import { unresolvedTies, decideWinnerLoser } from '@/logic/rotation';
import { formatMs } from '@/utils/time';

export function RoundScreen() {
  const event = useEventStore((s) => s.event);
  const incrementScore = useEventStore((s) => s.incrementScore);
  const nominateTieWinner = useEventStore((s) => s.nominateTieWinner);
  const endRound = useEventStore((s) => s.endRound);
  const resetTimer = useEventStore((s) => s.resetRoundTimer);
  const navigate = useNavigate();

  const round = currentRound(event);
  const timerView = useTimer(round);
  const [confirmEnd, setConfirmEnd] = useState(false);

  if (!event || !round) {
    return <p style={{ padding: 24, color: 'var(--text-2)' }}>No round in progress.</p>;
  }

  const matchesSorted = round.matches.slice().sort((a, b) => {
    const pa = event.courts.find((c) => c.id === a.courtId)?.position ?? 0;
    const pb = event.courts.find((c) => c.id === b.courtId)?.position ?? 0;
    return pb - pa;
  });

  const ties = unresolvedTies(round, event.settings.tieRule);
  const realTies = ties.filter((m) => m.scoreA > 0 || m.scoreB > 0);
  const unscored = round.matches.filter((m) => m.scoreA === 0 && m.scoreB === 0).length;
  const scored = round.matches.length - unscored;
  const cols = event.courts.length > 4 ? 'cols-3' : '';

  const lb = leaderboard(event);
  const topId = lb[0]?.teamId;

  return (
    <div className="op-body">
      <div className="op-side">
        <Timer
          round={round}
          warningAtMs={event.settings.warningAtMs}
          soundEnabled={event.settings.soundOnTimerEnd}
        />

        <div className="op-mini-lb">
          <div className="op-mini-lb-head">
            <div className="op-mini-lb-title">Standings</div>
            <span className="op-mini-lb-meta">
              {event.rounds.filter((r) => r.completedAt).length > 0
                ? `After R${event.rounds.filter((r) => r.completedAt).length}`
                : `Round ${round.index} in play`}
            </span>
          </div>
          <div className="op-mini-lb-list">
            {lb.map((row, idx) => (
              <div
                key={row.teamId}
                className={'op-mini-lb-row ' + (row.teamId === topId && row.total > 0 ? 'king' : '')}
              >
                <span className="r">{idx + 1}</span>
                <span className="n">{teamNameFor(event, row.teamId)}</span>
                <span className="p">{row.total}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="op-main">
        <div className={'op-court-grid ' + cols}>
          {matchesSorted.map((m) => {
            const court = event.courts.find((c) => c.id === m.courtId);
            const teamA = event.teams.find((t) => t.id === m.teamAId);
            const teamB = event.teams.find((t) => t.id === m.teamBId);
            if (!court || !teamA || !teamB) return null;
            return (
              <OpCourtCard
                key={m.id}
                court={court}
                isCentre={isCentreCourt(court, event.courts)}
                match={m}
                teamA={teamA}
                teamB={teamB}
                onIncrement={(side, delta) => incrementScore(m.id, side, delta)}
                onPickTieWinner={(winnerId) => nominateTieWinner(m.id, winnerId)}
              />
            );
          })}
        </div>

        <div className="op-end-bar">
          <div className="op-end-summary">
            <strong>{round.matches.length}</strong> matches •{' '}
            {unscored > 0 ? (
              <span style={{ color: 'var(--amber)' }}>{unscored} unscored</span>
            ) : (
              <span style={{ color: 'var(--lime)' }}>all scored</span>
            )}{' '}
            •{' '}
            {realTies.length > 0 ? (
              <span style={{ color: 'var(--amber)' }}>
                {realTies.length} tie(s) need nomination
              </span>
            ) : (
              <span style={{ color: 'var(--text-2)' }}>no ties</span>
            )}
          </div>
          <button className="btn" onClick={resetTimer}>
            <Icons.Reset className="icon" /> Restart timer
          </button>
          <button
            className="btn lg primary"
            onClick={() => setConfirmEnd(true)}
            disabled={scored === 0}
          >
            End round → preview rotation
          </button>
        </div>
      </div>

      <ConfirmDialog
        open={confirmEnd}
        title={`End Round ${round.index}?`}
        message={
          timerView.remainingMs > 0
            ? `${formatMs(timerView.remainingMs)} remaining on the clock. Scores will be locked and the next round's assignments will be computed.`
            : 'Scores will be locked and the next round’s assignments will be computed.'
        }
        confirmLabel="End round"
        onConfirm={() => {
          setConfirmEnd(false);
          endRound();
          setTimeout(() => navigate('/between'), 0);
        }}
        onCancel={() => setConfirmEnd(false)}
      />
    </div>
  );
}

function OpCourtCard({
  court,
  isCentre,
  match,
  teamA,
  teamB,
  onIncrement,
  onPickTieWinner,
}: {
  court: Court;
  isCentre: boolean;
  match: Match;
  teamA: Team;
  teamB: Team;
  onIncrement: (side: 'A' | 'B', delta: number) => void;
  onPickTieWinner: (winnerId: string) => void;
}) {
  const result = decideWinnerLoser(match, 'operator-decides');
  const aWin = result.winnerId === teamA.id;
  const bWin = result.winnerId === teamB.id;
  const tied = result.isTied && (match.scoreA > 0 || match.scoreB > 0);

  return (
    <div className={'op-court ' + (isCentre ? 'centre' : '')}>
      <div className="op-court-head">
        <div className="op-court-title">
          {isCentre && <Icons.Crown className="icon" />}
          {court.name}
        </div>
        <div className="op-court-pts-chip">{court.pointValue} PTS</div>
      </div>
      <div className="op-court-body">
        <TeamCell
          team={teamA}
          score={match.scoreA}
          win={aWin}
          tied={tied}
          tieWinner={match.tieBreakWinnerId === teamA.id}
          showTiePick={tied}
          onIncrement={(d) => onIncrement('A', d)}
          onPickTie={() => onPickTieWinner(teamA.id)}
        />
        <TeamCell
          team={teamB}
          score={match.scoreB}
          win={bWin}
          tied={tied}
          tieWinner={match.tieBreakWinnerId === teamB.id}
          showTiePick={tied}
          onIncrement={(d) => onIncrement('B', d)}
          onPickTie={() => onPickTieWinner(teamB.id)}
        />
      </div>
    </div>
  );
}

function TeamCell({
  team,
  score,
  win,
  tied,
  tieWinner,
  showTiePick,
  onIncrement,
  onPickTie,
}: {
  team: Team;
  score: number;
  win: boolean;
  tied: boolean;
  tieWinner: boolean;
  showTiePick: boolean;
  onIncrement: (delta: number) => void;
  onPickTie: () => void;
}) {
  return (
    <div className={'op-team ' + (tieWinner ? 'tie-winner' : '')}>
      <div className="op-team-head">
        <div className="op-team-name">{teamLabelShort(team)}</div>
        {team.name && (
          <div className="op-team-players">
            {team.players[0].name} · {team.players[1].name}
          </div>
        )}
      </div>
      <div className="op-team-score-row">
        <button
          className="op-score-btn"
          onClick={() => onIncrement(-1)}
          aria-label="Decrease score"
        >
          <Icons.Minus className="icon" />
        </button>
        <div className={'op-score ' + (win ? 'winner' : tied ? 'tied' : '')}>{score}</div>
        <button
          className="op-score-btn"
          onClick={() => onIncrement(1)}
          aria-label="Increase score"
        >
          <Icons.Plus className="icon" />
        </button>
      </div>
      {showTiePick && (
        <div className="op-team-tie-pick">
          <button className={tieWinner ? 'active' : ''} onClick={onPickTie}>
            Wins tie-break
          </button>
        </div>
      )}
    </div>
  );
}
