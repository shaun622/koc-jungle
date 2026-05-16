import { useMemo, useState } from 'react';
import { useEventStore } from '@/store/eventStore';
import {
  currentRound,
  leaderboard,
  nightlyStats,
  teamLabelShort,
  teamNameFor,
} from '@/store/selectors';
import { isCentreCourt, type Court, type EventState, type Match, type Team } from '@/types/domain';
import { useTimer } from '@/hooks/useTimer';
import { formatMs } from '@/utils/time';
import { decideWinnerLoser } from '@/logic/rotation';
import { Icons } from './Icons';
import { TeamAvatars } from './Avatar';

type MovementArrow = 'up' | 'down' | 'stay' | 'king';

/**
 * Phone-friendly /display layout. Replaces the 1920×1080 scaled canvas with
 * a vertical scroll list optimised for touch input. Renders the right
 * subview based on `event.status`:
 *
 *   round-in-progress → scoring list (Centre Court first, then descending)
 *   between-rounds    → rotation preview list (UP/DOWN/STAY/KING chips)
 *   complete          → compact podium + final standings
 *
 * The operator toolbar (already responsive) stays mounted from DisplayScreen
 * below this component.
 */
export function MobileDisplay({ event }: { event: EventState }) {
  if (event.status === 'complete') return <MobileComplete event={event} />;
  if (event.status === 'between-rounds' && event.pendingAssignments)
    return <MobileBetween event={event} />;
  return <MobileLive event={event} />;
}

// ============================================================
// Round-in-progress
// ============================================================

function MobileLive({ event }: { event: EventState }) {
  const round = currentRound(event);
  const incrementScore = useEventStore((s) => s.incrementScore);
  const nominateTieWinner = useEventStore((s) => s.nominateTieWinner);
  const [showStandings, setShowStandings] = useState(false);
  const timer = useTimer(round);

  const sortedCourtsDesc = useMemo(
    () => event.courts.slice().sort((a, b) => b.position - a.position),
    [event.courts],
  );
  const lb = useMemo(() => leaderboard(event), [event]);
  const completed = event.rounds.filter((r) => r.completedAt).length;

  if (!round) return null;

  let timerCls = '';
  if (!timer.hasStarted) timerCls = 'idle';
  else if (timer.remainingMs <= 60_000) timerCls = 'danger';
  else if (timer.remainingMs <= event.settings.warningAtMs) timerCls = 'warn';

  return (
    <div className="mobile-display">
      <header className="mobile-display-header">
        <div className="mobile-display-header-left">
          <div className="mobile-display-event">{event.name}</div>
          <div className="mobile-display-meta">
            Round {round.index} of {event.settings.roundsTotal}
            {event.venue ? ` · ${event.venue}` : ''}
          </div>
        </div>
        <div className={'mobile-display-timer ' + timerCls}>
          {formatMs(timer.remainingMs)}
        </div>
      </header>

      <div className="mobile-display-body">
        {sortedCourtsDesc.map((court) => {
          const match = round.matches.find((m) => m.courtId === court.id);
          return (
            <MobileCourtScore
              key={court.id}
              court={court}
              isCentre={isCentreCourt(court, event.courts)}
              match={match}
              teams={event.teams}
              tieRule={event.settings.tieRule}
              onIncrement={incrementScore}
              onNominate={nominateTieWinner}
            />
          );
        })}

        <button
          className="mobile-standings-toggle"
          onClick={() => setShowStandings((v) => !v)}
        >
          {showStandings ? 'Hide standings' : 'Show standings'}
          <Icons.ArrowDown
            className="icon"
            style={{ transform: showStandings ? 'rotate(180deg)' : 'none' }}
          />
        </button>
        {showStandings && (
          <MobileStandings event={event} lb={lb} completed={completed} />
        )}
      </div>
    </div>
  );
}

function MobileCourtScore({
  court,
  isCentre,
  match,
  teams,
  tieRule,
  onIncrement,
  onNominate,
}: {
  court: Court;
  isCentre: boolean;
  match: Match | undefined;
  teams: Team[];
  tieRule: EventState['settings']['tieRule'];
  onIncrement: (matchId: string, side: 'A' | 'B', delta: number) => void;
  onNominate: (matchId: string, winnerId: string) => void;
}) {
  if (!match) {
    return (
      <div className="mobile-court" style={{ opacity: 0.5 }}>
        <div className="mobile-court-head">
          <span className="mobile-court-name">{court.name}</span>
          <span className="mobile-court-pts">{court.pointValue} pts</span>
        </div>
        <div className="mobile-court-empty">No match</div>
      </div>
    );
  }
  const teamA = teams.find((t) => t.id === match.teamAId);
  const teamB = teams.find((t) => t.id === match.teamBId);
  const decision = decideWinnerLoser(match, tieRule);
  const aWin = match.scoreA > match.scoreB || decision.winnerId === match.teamAId;
  const bWin = match.scoreB > match.scoreA || decision.winnerId === match.teamBId;
  const tied = match.scoreA === match.scoreB && (match.scoreA > 0 || match.scoreB > 0);

  return (
    <div className={'mobile-court ' + (isCentre ? 'mobile-court--centre' : '')}>
      <div className="mobile-court-head">
        <span className="mobile-court-name">
          {isCentre && <Icons.Crown className="icon" />}
          {court.name}
        </span>
        <span className="mobile-court-pts">{court.pointValue} pts</span>
      </div>
      <MobileTeamRow
        team={teamA}
        score={match.scoreA}
        isWinner={aWin}
        isTied={tied && !decision.winnerId}
        onIncrement={(d) => onIncrement(match.id, 'A', d)}
      />
      <MobileTeamRow
        team={teamB}
        score={match.scoreB}
        isWinner={bWin}
        isTied={tied && !decision.winnerId}
        onIncrement={(d) => onIncrement(match.id, 'B', d)}
      />
      {tied && teamA && teamB && (
        <div className="mobile-court-tie">
          <span className="mobile-court-tie-label">Pick winner</span>
          <button
            className={
              'mobile-tie-btn ' +
              (match.tieBreakWinnerId === teamA.id ? 'active' : '')
            }
            onClick={() => onNominate(match.id, teamA.id)}
          >
            {teamLabelShort(teamA)}
          </button>
          <button
            className={
              'mobile-tie-btn ' +
              (match.tieBreakWinnerId === teamB.id ? 'active' : '')
            }
            onClick={() => onNominate(match.id, teamB.id)}
          >
            {teamLabelShort(teamB)}
          </button>
          {match.tieBreakWinnerId && (
            <button className="mobile-tie-btn" onClick={() => onNominate(match.id, '')}>
              Clear
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function MobileTeamRow({
  team,
  score,
  isWinner,
  isTied,
  onIncrement,
}: {
  team: Team | undefined;
  score: number;
  isWinner: boolean;
  isTied: boolean;
  onIncrement: (delta: number) => void;
}) {
  return (
    <div className="mobile-court-row">
      {team && <TeamAvatars players={team.players} size="sm" />}
      <span className="mobile-court-team-name">
        {team ? teamLabelShort(team) : '—'}
      </span>
      <div className="mobile-score-group">
        <button
          className="mobile-score-btn"
          onClick={() => onIncrement(-1)}
          aria-label="Decrease"
        >
          −
        </button>
        <span
          className={
            'mobile-score-value ' +
            (isWinner ? 'winner' : isTied ? 'tied' : '')
          }
        >
          {score}
        </span>
        <button
          className="mobile-score-btn"
          onClick={() => onIncrement(1)}
          aria-label="Increase"
        >
          +
        </button>
      </div>
    </div>
  );
}

function MobileStandings({
  event,
  lb,
  completed,
}: {
  event: EventState;
  lb: ReturnType<typeof leaderboard>;
  completed: number;
}) {
  return (
    <div className="mobile-standings">
      <div className="mobile-standings-head">
        <span>Standings</span>
        <span>{completed > 0 ? `After R${completed}` : 'Pre-round'}</span>
      </div>
      {lb.map((row, idx) => {
        const isKing = idx === 0 && row.total > 0;
        return (
          <div
            key={row.teamId}
            className={'mobile-standings-row ' + (isKing ? 'king' : '')}
          >
            <span className="rank">{idx + 1}</span>
            <span className="name">
              {isKing && <Icons.Crown className="icon" />}
              {teamNameFor(event, row.teamId)}
            </span>
            <span className="wl">
              {row.wins}W-{row.losses}L
            </span>
            <span className="pts">{row.total}</span>
          </div>
        );
      })}
    </div>
  );
}

// ============================================================
// Between rounds (rotation preview)
// ============================================================

function MobileBetween({ event }: { event: EventState }) {
  const lastRound = event.rounds.at(-1);
  const pending = event.pendingAssignments ?? [];
  const sortedCourtsDesc = useMemo(
    () => event.courts.slice().sort((a, b) => b.position - a.position),
    [event.courts],
  );

  const movements = useMemo(() => {
    const map = new Map<string, MovementArrow>();
    if (!lastRound) return map;
    const prevByTeam = new Map<string, string>();
    for (const m of lastRound.matches) {
      prevByTeam.set(m.teamAId, m.courtId);
      prevByTeam.set(m.teamBId, m.courtId);
    }
    for (const a of pending) {
      const toCourt = event.courts.find((c) => c.id === a.courtId);
      if (!toCourt) continue;
      const isCentre = isCentreCourt(toCourt, event.courts);
      for (const teamId of [a.teamAId, a.teamBId]) {
        const fromCourtId = prevByTeam.get(teamId);
        const fromCourt = fromCourtId
          ? event.courts.find((c) => c.id === fromCourtId)
          : undefined;
        let arrow: MovementArrow = 'stay';
        if (!fromCourt) arrow = 'stay';
        else if (toCourt.position > fromCourt.position) arrow = 'up';
        else if (toCourt.position < fromCourt.position) arrow = 'down';
        else if (isCentre) arrow = 'king';
        map.set(teamId, arrow);
      }
    }
    return map;
  }, [event.courts, lastRound, pending]);

  return (
    <div className="mobile-display">
      <header className="mobile-display-header">
        <div className="mobile-display-header-left">
          <div className="mobile-display-event">{event.name}</div>
          <div className="mobile-display-meta">
            Round {lastRound?.index ?? '—'} complete · rotation preview
          </div>
        </div>
        <div className="mobile-display-timer warn">
          R{(lastRound?.index ?? 0) + 1}
        </div>
      </header>

      <div className="mobile-display-body">
        {sortedCourtsDesc.map((court) => {
          const assignment = pending.find((a) => a.courtId === court.id);
          if (!assignment) {
            return (
              <div key={court.id} className="mobile-court" style={{ opacity: 0.5 }}>
                <div className="mobile-court-head">
                  <span className="mobile-court-name">{court.name}</span>
                  <span className="mobile-court-pts">{court.pointValue} pts</span>
                </div>
                <div className="mobile-court-empty">No assignment</div>
              </div>
            );
          }
          const teamA = event.teams.find((t) => t.id === assignment.teamAId);
          const teamB = event.teams.find((t) => t.id === assignment.teamBId);
          const isCentre = isCentreCourt(court, event.courts);
          return (
            <div
              key={court.id}
              className={'mobile-court ' + (isCentre ? 'mobile-court--centre' : '')}
            >
              <div className="mobile-court-head">
                <span className="mobile-court-name">
                  {isCentre && <Icons.Crown className="icon" />}
                  {court.name}
                </span>
                <span className="mobile-court-pts">{court.pointValue} pts</span>
              </div>
              <MobilePreviewRow team={teamA} arrow={teamA && movements.get(teamA.id)} />
              <MobilePreviewRow team={teamB} arrow={teamB && movements.get(teamB.id)} />
            </div>
          );
        })}
      </div>
    </div>
  );
}

function MobilePreviewRow({
  team,
  arrow,
}: {
  team: Team | undefined;
  arrow: MovementArrow | undefined;
}) {
  return (
    <div className="mobile-court-row">
      {team && <TeamAvatars players={team.players} size="sm" />}
      <span className="mobile-court-team-name">
        {team ? teamLabelShort(team) : '—'}
      </span>
      <MobileMovementChip arrow={arrow ?? 'stay'} />
    </div>
  );
}

function MobileMovementChip({ arrow }: { arrow: MovementArrow }) {
  const Icon =
    arrow === 'up'
      ? Icons.ArrowUp
      : arrow === 'down'
        ? Icons.ArrowDown
        : arrow === 'king'
          ? Icons.Crown
          : Icons.Dash;
  const label =
    arrow === 'up' ? 'UP' : arrow === 'down' ? 'DOWN' : arrow === 'king' ? 'KING' : 'STAY';
  return (
    <div className={'mobile-movement ' + arrow}>
      <Icon className="icon" />
      <span>{label}</span>
    </div>
  );
}

// ============================================================
// Complete (podium)
// ============================================================

function MobileComplete({ event }: { event: EventState }) {
  const rows = useMemo(
    () =>
      leaderboard(event).filter((r) => {
        const t = event.teams.find((tt) => tt.id === r.teamId);
        return t?.active;
      }),
    [event],
  );
  const stats = useMemo(() => nightlyStats(event), [event]);
  const completed = event.rounds.filter((r) => r.completedAt).length;

  const first = rows[0];
  const second = rows[1];
  const third = rows[2];
  const rest = rows.slice(3);

  return (
    <div className="mobile-display">
      <header className="mobile-display-header">
        <div className="mobile-display-header-left">
          <div className="mobile-display-event">{event.name}</div>
          <div className="mobile-display-meta">
            {completed} rounds played · {rows.length} teams
          </div>
        </div>
        <div className="mobile-display-timer" style={{ color: 'var(--gold)' }}>
          FINAL
        </div>
      </header>

      <div className="mobile-display-body">
        <div className="mobile-podium">
          {first && (
            <MobilePodiumRow place="1st" row={first} event={event} highlight />
          )}
          {second && <MobilePodiumRow place="2nd" row={second} event={event} />}
          {third && <MobilePodiumRow place="3rd" row={third} event={event} />}
        </div>

        {rest.length > 0 && (
          <div className="mobile-podium-rest">
            <div className="mobile-podium-rest-head">Rest of the field</div>
            {rest.map((row, idx) => (
              <div key={row.teamId} className="mobile-standings-row">
                <span className="rank">{idx + 4}</span>
                <span className="name">{teamNameFor(event, row.teamId)}</span>
                <span className="wl">
                  {row.wins}W-{row.losses}L
                </span>
                <span className="pts">{row.total}</span>
              </div>
            ))}
          </div>
        )}

        {stats.length > 0 && (
          <div className="mobile-stats">
            <div className="mobile-stats-head">Nightly stats</div>
            {stats.map((s) => (
              <div key={s.label} className="mobile-stat">
                <div className="mobile-stat-label">{s.label}</div>
                <div className="mobile-stat-value">{s.value}</div>
                {s.detail && <div className="mobile-stat-detail">{s.detail}</div>}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function MobilePodiumRow({
  place,
  row,
  event,
  highlight,
}: {
  place: '1st' | '2nd' | '3rd';
  row: ReturnType<typeof leaderboard>[number];
  event: EventState;
  highlight?: boolean;
}) {
  const team = event.teams.find((t) => t.id === row.teamId);
  return (
    <div className={'mobile-podium-row ' + (highlight ? 'mobile-podium-row--first' : '')}>
      <span className="place">{place}</span>
      {team && <TeamAvatars players={team.players} size="sm" />}
      <div className="info">
        <div className="name">
          {highlight && <Icons.Crown className="icon" />}
          {team ? teamLabelShort(team) : teamNameFor(event, row.teamId)}
        </div>
        <div className="meta">
          {row.wins}W-{row.losses}L
        </div>
      </div>
      <div className="pts">{row.total}</div>
    </div>
  );
}
