import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useEventStore } from '@/store/eventStore';
import { currentRound, leaderboard, teamLabelShort, teamNameFor } from '@/store/selectors';
import type { Court, EventStatus, Match, Team } from '@/types/domain';
import { useTimer } from '@/hooks/useTimer';
import { useStorageBroadcast } from '@/hooks/useStorageBroadcast';
import { formatMs } from '@/utils/time';
import { Icons } from '@/components/Icons';

function operatorRouteFor(status: EventStatus | undefined): string {
  switch (status) {
    case 'qualifier':
      return '/qualifier';
    case 'seeding':
      return '/seeding';
    case 'round-in-progress':
      return '/round';
    case 'between-rounds':
      return '/between';
    case 'complete':
      return '/leaderboard';
    case 'setup':
    default:
      return '/setup';
  }
}

export function DisplayScreen() {
  useStorageBroadcast();
  const event = useEventStore((s) => s.event);
  const round = currentRound(event);
  const [scale, setScale] = useState(1);
  const navigate = useNavigate();

  const exitToOperator = useCallback(() => {
    navigate(operatorRouteFor(event?.status));
  }, [event?.status, navigate]);

  // Fit-to-window scaling — design canvas is 1920x1080
  useEffect(() => {
    function recalc() {
      const w = window.innerWidth;
      const h = window.innerHeight;
      setScale(Math.min(w / 1920, h / 1080));
    }
    recalc();
    window.addEventListener('resize', recalc);
    return () => window.removeEventListener('resize', recalc);
  }, []);

  // Escape key → operator view
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') exitToOperator();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [exitToOperator]);

  if (!event) {
    return (
      <div className="splash" style={{ flexDirection: 'column', gap: 16 }}>
        <span>Open an event on the operator device to drive this display.</span>
        <button className="btn" onClick={() => navigate('/setup')}>
          ← Operator view
        </button>
      </div>
    );
  }

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        background: 'var(--bg-0)',
        overflow: 'hidden',
        display: 'grid',
        placeItems: 'center',
      }}
    >
      <div
        style={{
          width: 1920 * scale,
          height: 1080 * scale,
          position: 'relative',
        }}
      >
        <div
          style={{
            width: 1920,
            height: 1080,
            transform: `scale(${scale})`,
            transformOrigin: 'top left',
            position: 'absolute',
            top: 0,
            left: 0,
          }}
        >
          <DisplayCanvas event={event} round={round} onExit={exitToOperator} />
        </div>
      </div>

      <button
        className="btn ghost sm"
        onClick={exitToOperator}
        style={{
          position: 'fixed',
          top: 12,
          right: 12,
          zIndex: 30,
          background: 'oklch(20% 0.03 245 / 0.85)',
          backdropFilter: 'blur(8px)',
        }}
      >
        ← Operator view
      </button>
    </div>
  );
}

function DisplayCanvas({
  event,
  round,
  onExit,
}: {
  event: ReturnType<typeof useEventStore.getState>['event'];
  round: ReturnType<typeof currentRound>;
  onExit: () => void;
}) {
  const timerView = useTimer(round);
  const lb = useMemo(() => (event ? leaderboard(event) : []), [event]);

  if (!event) return null;
  const top5 = lb.slice(0, 5);
  const rest = lb.slice(5, 14);

  const sortedCourtsDesc = event.courts.slice().sort((a, b) => b.position - a.position);
  const centre = sortedCourtsDesc[0];
  const rest_courts = sortedCourtsDesc.slice(1);
  const leftCol: Court[] = [];
  const rightCol: Court[] = [];
  rest_courts.forEach((c, i) => (i % 2 === 0 ? rightCol.push(c) : leftCol.push(c)));

  const centreMatch = round?.matches.find((m) => m.courtId === centre?.id);
  const centreA = centreMatch && event.teams.find((t) => t.id === centreMatch.teamAId);
  const centreB = centreMatch && event.teams.find((t) => t.id === centreMatch.teamBId);

  let timerCls = '';
  if (!timerView.hasStarted) timerCls = '';
  else if (timerView.remainingMs <= 60_000) timerCls = 'danger';
  else if (timerView.remainingMs <= event.settings.warningAtMs) timerCls = 'warn';

  const totalRounds = event.settings.roundsTotal;
  const roundIndex = round?.index ?? 0;
  const completed = event.rounds.filter((r) => r.completedAt).length;
  const progress = round
    ? Math.min(100, ((round.durationMs - Math.max(0, timerView.remainingMs)) / round.durationMs) * 100)
    : 0;

  const king = lb[0];
  const kingLabel = king
    ? teamNameFor(event, king.teamId).split(' & ')[0].slice(0, 8)
    : '—';

  return (
    <div className="tv-display">
      <div className="tv-header">
        <button
          className="tv-header-brand"
          onClick={onExit}
          style={{
            background: 'none',
            border: 'none',
            cursor: 'pointer',
            color: 'inherit',
            font: 'inherit',
            padding: 0,
            textAlign: 'left',
          }}
          title="Back to operator view (Esc)"
        >
          <div className="brand-mark lg">K</div>
          <div className="tv-header-event">
            <div className="tv-header-event-name">{event.name}</div>
            <div className="tv-header-event-meta">
              {event.venue ? `${event.venue} • ` : ''}
              {roundIndex > 0
                ? `Round ${roundIndex} of ${totalRounds}`
                : `${event.teams.filter((t) => t.active).length} teams • ${event.courts.length} courts`}
            </div>
          </div>
        </button>
        <div className="tv-header-right">
          <span>{event.teams.filter((t) => t.active).length} teams</span>
          <span style={{ opacity: 0.3 }}>•</span>
          <span>{event.courts.length} courts</span>
          <span style={{ opacity: 0.3 }}>•</span>
          <div className="tv-header-live">
            <div className="tv-live-dot" />
            <span>Live</span>
          </div>
        </div>
      </div>

      <div className="tv-body">
        <div className="tv-lb">
          <div className="tv-lb-header">
            <div className="tv-lb-title">Standings</div>
            <div className="tv-lb-subtitle">
              {completed > 0 ? `After Round ${completed}` : 'Pre-round'}
            </div>
          </div>
          <div className="tv-lb-list">
            {top5.map((row, idx) => {
              const isKing = idx === 0 && row.total > 0;
              return (
                <div key={row.teamId} className={'tv-lb-row ' + (isKing ? 'king' : '')}>
                  <span className="rank">{idx + 1}</span>
                  <div className="team-name">
                    {isKing && <Icons.Crown className="tv-lb-crown" />}
                    <span>{teamNameFor(event, row.teamId)}</span>
                  </div>
                  <span className="wl">
                    {row.wins}W-{row.losses}L
                  </span>
                  <span className="pts">{row.total}</span>
                </div>
              );
            })}
            {rest.length > 0 && <div style={{ height: 8 }} />}
            {rest.map((row, idx) => (
              <div key={row.teamId} className="tv-lb-row">
                <span className="rank">{idx + 6}</span>
                <div className="team-name">
                  <span>{teamNameFor(event, row.teamId)}</span>
                </div>
                <span className="wl">
                  {row.wins}W-{row.losses}L
                </span>
                <span className="pts">{row.total}</span>
              </div>
            ))}
          </div>
        </div>

        <div className="tv-main">
          <div className="tv-centre">
            <div className="tv-centre-label">
              <div className="tv-centre-crown">
                <Icons.Crown className="icon lg" /> King's Court
              </div>
              <div className="tv-centre-name">{centre?.name ?? '—'}</div>
              <div className="tv-centre-pts">{centre?.pointValue ?? 0} POINTS</div>
            </div>
            <div className="tv-centre-team">
              {centreA?.name && <div className="tv-centre-team-label">{centreA.name}</div>}
              <div className="tv-centre-team-name">
                {centreA ? teamLabelShort(centreA) : '—'}
              </div>
            </div>
            <div className="tv-centre-scores">
              <div
                className={
                  'tv-centre-score ' +
                  (centreMatch &&
                  centreMatch.scoreA > centreMatch.scoreB
                    ? 'winner'
                    : '')
                }
              >
                {centreMatch?.scoreA ?? 0}
              </div>
              <div className="tv-centre-vs">VS</div>
              <div
                className={
                  'tv-centre-score ' +
                  (centreMatch &&
                  centreMatch.scoreB > centreMatch.scoreA
                    ? 'winner'
                    : '')
                }
              >
                {centreMatch?.scoreB ?? 0}
              </div>
            </div>
            <div className="tv-centre-team right">
              {centreB?.name && <div className="tv-centre-team-label">{centreB.name}</div>}
              <div className="tv-centre-team-name">
                {centreB ? teamLabelShort(centreB) : '—'}
              </div>
            </div>
            <div />
          </div>

          <div className="tv-lower">
            <div className="tv-courts-col">
              {leftCol.map((c) => (
                <TvCourtCard
                  key={c.id}
                  court={c}
                  match={round?.matches.find((m) => m.courtId === c.id)}
                  teams={event.teams}
                />
              ))}
            </div>

            <div className="tv-timer-block">
              <div className="tv-timer-label">Time Remaining</div>
              <div className={'tv-timer-value size-xl ' + timerCls}>
                {round ? formatMs(timerView.remainingMs) : '—'}
              </div>
              <div className="tv-timer-progress">
                <div className="tv-timer-progress-bar" style={{ width: `${progress}%` }} />
              </div>
              <div className="tv-timer-round">
                Round <strong>{roundIndex}</strong> of <strong>{totalRounds}</strong>
              </div>
              <div className="tv-timer-bottom">
                <div className="tv-timer-stat">
                  <span className="tv-timer-stat-label">Next up</span>
                  <span className="tv-timer-stat-value">
                    R{Math.min(totalRounds, roundIndex + 1)}
                  </span>
                </div>
                <div className="tv-timer-stat">
                  <span className="tv-timer-stat-label">Round</span>
                  <span className="tv-timer-stat-value">
                    {Math.round((round?.durationMs ?? event.settings.defaultRoundDurationMs) / 60000)}m
                  </span>
                </div>
                <div className="tv-timer-stat">
                  <span className="tv-timer-stat-label">King</span>
                  <span className="tv-timer-stat-value" style={{ color: 'var(--gold)' }}>
                    {kingLabel}
                  </span>
                </div>
              </div>
            </div>

            <div className="tv-courts-col">
              {rightCol.map((c) => (
                <TvCourtCard
                  key={c.id}
                  court={c}
                  match={round?.matches.find((m) => m.courtId === c.id)}
                  teams={event.teams}
                />
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function TvCourtCard({
  court,
  match,
  teams,
}: {
  court: Court;
  match: Match | undefined;
  teams: Team[];
}) {
  if (!match) {
    return (
      <div className="tv-court" style={{ opacity: 0.5 }}>
        <div className="tv-court-head">
          <div className="tv-court-name">{court.name}</div>
          <div className="tv-court-pts">
            <span>{court.pointValue}</span> PTS
          </div>
        </div>
        <div style={{ gridColumn: '2 / -1', textAlign: 'center', color: 'var(--text-2)' }}>
          No match
        </div>
      </div>
    );
  }
  const teamA = teams.find((t) => t.id === match.teamAId);
  const teamB = teams.find((t) => t.id === match.teamBId);
  const aWin = match.scoreA > match.scoreB;
  const bWin = match.scoreB > match.scoreA;
  const tied = match.scoreA === match.scoreB && match.scoreA > 0;

  return (
    <div className="tv-court">
      <div className="tv-court-head">
        <div className="tv-court-name">{court.name}</div>
        <div className="tv-court-pts">
          <span>{court.pointValue}</span> PTS
        </div>
      </div>
      <div className="tv-court-team">
        {teamA?.name && <div className="tv-court-team-label">{teamA.name}</div>}
        <div className="tv-court-team-name">{teamA ? teamLabelShort(teamA) : '—'}</div>
      </div>
      <div className={'tv-court-score ' + (aWin ? 'winner' : tied ? 'tied' : '')}>
        {match.scoreA}
      </div>
      <div className="tv-court-team">
        {teamB?.name && <div className="tv-court-team-label">{teamB.name}</div>}
        <div className="tv-court-team-name">{teamB ? teamLabelShort(teamB) : '—'}</div>
      </div>
      <div className={'tv-court-score ' + (bWin ? 'winner' : tied ? 'tied' : '')}>
        {match.scoreB}
      </div>
    </div>
  );
}
