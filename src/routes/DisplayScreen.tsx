import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useEventStore } from '@/store/eventStore';
import {
  currentRound,
  leaderboard,
  rankMovements,
  teamLabelShort,
  teamNameFor,
} from '@/store/selectors';
import { isCentreCourt, type Court, type Match, type Team } from '@/types/domain';
import { useTimer } from '@/hooks/useTimer';
import { useStorageBroadcast } from '@/hooks/useStorageBroadcast';
import { formatMs, parseDurationInput } from '@/utils/time';
import { unresolvedTies, decideWinnerLoser } from '@/logic/rotation';
import { Icons } from '@/components/Icons';
import { BrandLogo } from '@/components/BrandLogo';
import { AppMenu } from '@/components/AppMenu';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { NightlyStatsModal } from '@/components/NightlyStatsModal';
import { RotateHint } from '@/components/RotateHint';
import { ShareCard } from '@/components/ShareCard';
import { SettingsModal } from '@/components/SettingsModal';
import { EditPointsModal } from '@/components/EditPointsModal';
import { TeamAvatars } from '@/components/Avatar';
import { RankMovement } from '@/components/RankMovement';
import { useBuzzer } from '@/hooks/useBuzzer';
import { MobileDisplay } from '@/components/MobileDisplay';
import { TvCompleteView } from '@/components/TvCompleteView';
import { captureAndShare } from '@/utils/shareCard';
import { useAnnouncements } from '@/hooks/useAnnouncements';
import { useIsMobileDisplay } from '@/hooks/useIsMobileDisplay';

type MovementArrow = 'up' | 'down' | 'stay' | 'king';
interface Movement {
  teamId: string;
  fromCourt: Court | undefined;
  toCourt: Court;
  arrow: MovementArrow;
}

export function DisplayScreen() {
  useStorageBroadcast();
  useAnnouncements();
  const event = useEventStore((s) => s.event);
  const round = currentRound(event);
  const [scale, setScale] = useState(1);
  const [menuOpen, setMenuOpen] = useState(false);
  const [confirmEnd, setConfirmEnd] = useState(false);
  const [confirmNew, setConfirmNew] = useState(false);
  const [confirmFinish, setConfirmFinish] = useState(false);
  const navigate = useNavigate();
  const isMobile = useIsMobileDisplay();

  const incrementScore = useEventStore((s) => s.incrementScore);
  const nominateTieWinner = useEventStore((s) => s.nominateTieWinner);
  const endRound = useEventStore((s) => s.endRound);
  const resetEvent = useEventStore((s) => s.resetEvent);
  const startRoundTimer = useEventStore((s) => s.startRoundTimer);
  const pauseRoundTimer = useEventStore((s) => s.pauseRoundTimer);
  const resetRoundTimer = useEventStore((s) => s.resetRoundTimer);
  const adjustTimer = useEventStore((s) => s.adjustTimer);
  const startNextRound = useEventStore((s) => s.startNextRound);
  const finishEventNow = useEventStore((s) => s.finishEventNow);
  const podiumShareRef = useRef<HTMLDivElement>(null);
  const [sharing, setSharing] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [showEditPoints, setShowEditPoints] = useState(false);
  const [showStats, setShowStats] = useState(false);

  // Fit-to-window scaling — design canvas is 1920x1080. Reserve room at the
  // bottom for the operator toolbar so the canvas doesn't get hidden behind
  // it. On phone landscape the toolbar shrinks (see (max-height: 500px) CSS
  // rules), so we reserve less and let the canvas grow.
  useEffect(() => {
    function recalc() {
      const w = window.innerWidth;
      const phoneLandscape =
        typeof window !== 'undefined' &&
        window.matchMedia('(max-height: 500px)').matches;
      const reserve = phoneLandscape ? 56 : 96;
      const h = window.innerHeight - reserve;
      setScale(Math.max(0.1, Math.min(w / 1920, h / 1080)));
    }
    recalc();
    window.addEventListener('resize', recalc);
    return () => window.removeEventListener('resize', recalc);
  }, []);

  // Close the menu on Escape, also reachable for keyboard users
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setMenuOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  if (!event) {
    return (
      <div className="splash" style={{ flexDirection: 'column', gap: 16 }}>
        <span>Open an event to drive the display.</span>
        <button className="btn primary" onClick={() => navigate('/setup')}>
          Go to setup
        </button>
      </div>
    );
  }

  const showOperatorRound = event.status === 'round-in-progress' && !!round;
  const showBetweenRounds = event.status === 'between-rounds' && !!event.pendingAssignments;
  const showCompleteCanvas = event.status === 'complete';

  // Round-end state for the bottom toolbar. When a round spans multiple waves
  // (more matches than courts), only the wave currently on court is live;
  // scoring/ties/end-button all key off that wave, and later waves wait.
  const currentWave = round?.currentWave ?? 0;
  const waveCount = round
    ? round.matches.reduce((mx, m) => Math.max(mx, m.wave ?? 0), 0) + 1
    : 1;
  const isLastWave = currentWave >= waveCount - 1;
  const waveMatches = round
    ? round.matches.filter((m) => (m.wave ?? 0) === currentWave)
    : [];
  const ties = round
    ? unresolvedTies({ ...round, matches: waveMatches }, event.settings.tieRule)
    : [];
  const realTies = ties.filter((m) => m.scoreA > 0 || m.scoreB > 0);
  const unscored = waveMatches.filter((m) => m.scoreA === 0 && m.scoreB === 0).length;
  const scored = waveMatches.length - unscored;
  const isFinalRound = round ? round.index >= event.settings.roundsTotal : false;

  // On phone portrait the bottom toolbar already carries a menu while a
  // round / preview is on screen, so the floating top-right gear would just
  // sit over the scoreboard. Keep it for the podium + all larger screens.
  const showFixedMenu = !(isMobile && (showOperatorRound || showBetweenRounds));

  return (
    <div className={'display-shell ' + (isMobile ? 'display-shell--mobile' : '')}>
      {showFixedMenu && (
        <div className="display-menu-fixed">
          <AppMenu event={event} />
        </div>
      )}
      {isMobile && showOperatorRound && round?.index === 1 && <RotateHint />}
      {isMobile ? (
        <MobileDisplay event={event} />
      ) : (
        <div className="display-canvas-wrap" style={{ height: 1080 * scale }}>
          <div
            className="display-canvas"
            style={{
              width: 1920,
              height: 1080,
              transform: `scale(${scale})`,
              transformOrigin: 'top center',
            }}
          >
            {showCompleteCanvas ? (
              <TvCompleteView event={event} />
            ) : showBetweenRounds ? (
              <TvBetweenCanvas event={event} />
            ) : (
              <TvLiveCanvas
                event={event}
                round={round}
                showControls={showOperatorRound}
                onIncrement={incrementScore}
                onNominateTieWinner={nominateTieWinner}
              />
            )}
          </div>
        </div>
      )}

      {/* Sticky operator toolbar — outside the scaled canvas so taps are sized
          to iPad pixels, not the 1920×1080 logical canvas. */}
      {showOperatorRound && round && (
        <DisplayToolbar
          event={event}
          unscored={unscored}
          scored={scored}
          realTiesCount={realTies.length}
          isFinalRound={isFinalRound}
          waveCount={waveCount}
          currentWave={currentWave}
          isLastWave={isLastWave}
          onTimerStart={startRoundTimer}
          onTimerPause={pauseRoundTimer}
          onTimerReset={resetRoundTimer}
          onTimerAdjust={adjustTimer}
          onEndRound={() => {
            // Between rounds: no dialog — end the round and start the next
            // one straight away (mirrors how the preview screen was dropped).
            // Only the irreversible final "end event" keeps a confirm.
            if (isFinalRound) {
              setConfirmEnd(true);
            } else {
              endRound();
              startNextRound();
            }
          }}
          onAdvanceWave={endRound}
          onMenuToggle={() => setMenuOpen((v) => !v)}
          menuOpen={menuOpen}
          onNavigate={navigate}
          onSettings={() => setShowSettings(true)}
          onFinishEvent={() => {
            setMenuOpen(false);
            setConfirmFinish(true);
          }}
          onNewEvent={() => {
            setMenuOpen(false);
            setConfirmNew(true);
          }}
        />
      )}

      {showBetweenRounds && (
        <div className="display-toolbar display-toolbar--between">
          <div className="display-toolbar-summary" style={{ justifyContent: 'flex-start' }}>
            <span style={{ color: 'var(--text-1)' }}>
              Round {event.rounds.at(-1)?.index ?? '·'} complete ·{' '}
              {event.format === 'koc' ? 'rotation preview' : 'next round preview'}
            </span>
          </div>
          <NextRoundDurationField
            defaultMs={event.rounds.at(-1)?.durationMs ?? event.settings.defaultRoundDurationMs}
            onStart={(ms) => startNextRound(ms)}
            nextRoundNumber={(event.rounds.at(-1)?.index ?? 0) + 1}
          />
          <div className="display-toolbar-menu">
            <button
              className="btn"
              aria-label="Menu"
              onClick={() => setMenuOpen((v) => !v)}
              aria-expanded={menuOpen}
            >
              ≡
            </button>
            {menuOpen && (
              <>
                <div className="display-menu-backdrop" onClick={() => setMenuOpen(false)} />
                <div className="display-menu">
                  <button
                    className="display-menu-item"
                    onClick={() => {
                      navigate('/leaderboard');
                      setMenuOpen(false);
                    }}
                  >
                    Full standings
                  </button>
                  <button
                    className="display-menu-item"
                    onClick={() => {
                      navigate('/setup');
                      setMenuOpen(false);
                    }}
                  >
                    Setup &amp; teams
                  </button>
                  <button
                    className="display-menu-item"
                    onClick={() => {
                      setMenuOpen(false);
                      setShowSettings(true);
                    }}
                  >
                    Settings
                  </button>
                  <button
                    className="display-menu-item"
                    onClick={() => {
                      setMenuOpen(false);
                      setConfirmFinish(true);
                    }}
                  >
                    Finish event → podium
                  </button>
                  <div className="display-menu-divider" />
                  <button
                    className="display-menu-item display-menu-danger"
                    onClick={() => {
                      setMenuOpen(false);
                      setConfirmNew(true);
                    }}
                  >
                    + New event
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {showCompleteCanvas && (
        <div className="display-toolbar display-toolbar--complete">
          <button className="btn primary lg" onClick={() => setShowStats(true)}>
            🏆 Nightly stats
          </button>
          <button
            className="btn"
            disabled={sharing}
            onClick={async () => {
              if (!podiumShareRef.current) return;
              setSharing(true);
              try {
                await captureAndShare(podiumShareRef.current, {
                  filename: `padel-${event.name.replace(/[^a-z0-9-_]+/gi, '-')}-podium.png`,
                  shareTitle: `${event.name} results`,
                  shareText: 'Tonight\'s padel results 🏆',
                });
              } finally {
                setSharing(false);
              }
            }}
          >
            {sharing ? 'Generating…' : 'Share results'}
          </button>
          <button className="btn" onClick={() => setShowEditPoints(true)}>
            Edit points
          </button>
          <button className="btn ghost" onClick={() => navigate('/leaderboard')}>
            Full standings
          </button>
        </div>
      )}

      {showCompleteCanvas && <ShareCard ref={podiumShareRef} variant="podium" event={event} />}

      {/* Only the irreversible final "end event" keeps a confirm; ending a
          round mid-tournament goes straight to the next round with no dialog. */}
      <ConfirmDialog
        open={confirmEnd}
        title={round ? `End event after Round ${round.index}?` : 'End event?'}
        message="Scores will be locked and the podium will be revealed."
        confirmLabel="End event"
        onConfirm={() => {
          setConfirmEnd(false);
          endRound();
        }}
        onCancel={() => setConfirmEnd(false)}
      />

      <ConfirmDialog
        open={confirmNew}
        title="Start a new event?"
        message="This clears the current event: teams, scores, rounds, podium. Export first if you want to keep them."
        confirmLabel="Yes, start fresh"
        destructive
        onConfirm={() => {
          resetEvent();
          setConfirmNew(false);
          setTimeout(() => navigate('/setup'), 0);
        }}
        onCancel={() => setConfirmNew(false)}
      />

      <ConfirmDialog
        open={confirmFinish}
        title="Finish the event now?"
        message="The podium is revealed with the scores entered so far. A round in progress that hasn't been scored is dropped."
        confirmLabel="Finish event"
        onConfirm={() => {
          setConfirmFinish(false);
          finishEventNow();
        }}
        onCancel={() => setConfirmFinish(false)}
      />

      <SettingsModal open={showSettings} onClose={() => setShowSettings(false)} />

      {showEditPoints && (
        <EditPointsModal onClose={() => setShowEditPoints(false)} />
      )}

      {showStats && (
        <NightlyStatsModal event={event} onClose={() => setShowStats(false)} />
      )}
    </div>
  );
}

// ============================================================
// Toolbar (operator chrome, outside the scaled canvas)
// ============================================================

interface DisplayToolbarProps {
  event: NonNullable<ReturnType<typeof useEventStore.getState>['event']>;
  unscored: number;
  scored: number;
  realTiesCount: number;
  isFinalRound: boolean;
  waveCount: number;
  currentWave: number;
  isLastWave: boolean;
  onTimerStart: () => void;
  onTimerPause: () => void;
  onTimerReset: () => void;
  onTimerAdjust: (deltaMs: number) => void;
  onEndRound: () => void;
  onAdvanceWave: () => void;
  onMenuToggle: () => void;
  menuOpen: boolean;
  onNavigate: (path: string) => void;
  onSettings: () => void;
  onFinishEvent: () => void;
  onNewEvent: () => void;
}

function NextRoundDurationField({
  defaultMs,
  nextRoundNumber,
  onStart,
}: {
  defaultMs: number;
  nextRoundNumber: number;
  onStart: (ms: number) => void;
}) {
  const [text, setText] = useState(formatMs(defaultMs));
  const commit = (): number => {
    const parsed = parseDurationInput(text);
    if (parsed === null) {
      setText(formatMs(defaultMs));
      return defaultMs;
    }
    setText(formatMs(parsed));
    return parsed;
  };
  return (
    <div className="display-next-duration">
      <label htmlFor="next-round-duration" className="display-next-duration-label">
        Duration
      </label>
      <input
        id="next-round-duration"
        type="text"
        inputMode="numeric"
        className="display-next-duration-input"
        value={text}
        onChange={(e) => setText(e.target.value)}
        onFocus={(e) => e.currentTarget.select()}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
        }}
      />
      <button
        className="btn lg primary display-end-round"
        onClick={() => {
          const ms = commit();
          onStart(ms);
        }}
      >
        Start Round {nextRoundNumber} →
      </button>
    </div>
  );
}

function DisplayToolbar({
  event,
  unscored,
  scored,
  realTiesCount,
  isFinalRound,
  waveCount,
  currentWave,
  isLastWave,
  onTimerStart,
  onTimerPause,
  onTimerReset,
  onTimerAdjust,
  onEndRound,
  onAdvanceWave,
  onMenuToggle,
  menuOpen,
  onNavigate,
  onSettings,
  onFinishEvent,
  onNewEvent,
}: DisplayToolbarProps) {
  const round = currentRound(event);
  const { buzz, tick } = useBuzzer();
  const soundOn = event.settings.soundOnTimerEnd;
  const timer = useTimer(round, () => {
    // Round timer hit zero — play the sustained finishing buzzer.
    // Gated on soundOnTimerEnd so the operator can mute it.
    if (!soundOn) return;
    buzz();
  });
  const isRunning = timer.isRunning;
  const hasStarted = timer.hasStarted;
  const isPaused = timer.isPaused;

  // Countdown ticks at T-3, T-2, T-1. `secondsLeft` only changes once per
  // second so the effect fires three times in the run-up to zero.
  const secondsLeft = Math.max(0, Math.ceil(timer.remainingMs / 1000));
  useEffect(() => {
    if (!soundOn || !isRunning) return;
    if (secondsLeft === 3 || secondsLeft === 2 || secondsLeft === 1) {
      tick();
    }
  }, [secondsLeft, isRunning, soundOn, tick]);

  const endDisabled = scored === 0;

  return (
    <div className="display-toolbar">
      <div className="display-toolbar-timer">
        <button
          className="btn"
          onClick={() => onTimerAdjust(-60_000)}
          aria-label="Subtract 1 minute"
        >
          −1m
        </button>
        <button className="btn" onClick={onTimerReset} aria-label="Reset timer">
          <Icons.Reset className="icon" />
        </button>
        <button
          className="btn"
          onClick={() => onTimerAdjust(60_000)}
          aria-label="Add 1 minute"
        >
          +1m
        </button>
        <button
          className={
            'btn display-play ' + (isPaused ? 'paused' : !hasStarted ? 'idle' : '')
          }
          onClick={isRunning ? onTimerPause : onTimerStart}
        >
          {isRunning ? (
            <>
              <Icons.Pause className="icon" /> PAUSE
            </>
          ) : (
            <>
              <Icons.Play className="icon" /> {hasStarted ? 'RESUME' : 'START'}
            </>
          )}
        </button>
      </div>

      <div className="display-toolbar-summary">
        {waveCount > 1 && (
          <>
            <span style={{ color: 'var(--text-1)' }}>
              Wave {currentWave + 1} of {waveCount}
            </span>
            <span style={{ opacity: 0.3 }}>•</span>
          </>
        )}
        {unscored > 0 ? (
          <span style={{ color: 'var(--amber)' }}>{unscored} unscored</span>
        ) : (
          <span style={{ color: 'var(--lime)' }}>all scored</span>
        )}
        {realTiesCount > 0 && (
          <>
            <span style={{ opacity: 0.3 }}>•</span>
            <span style={{ color: 'var(--amber)' }}>
              {realTiesCount} tie{realTiesCount === 1 ? '' : 's'} to resolve
            </span>
          </>
        )}
      </div>

      <button
        className="btn lg primary display-end-round"
        onClick={isLastWave ? onEndRound : onAdvanceWave}
        disabled={endDisabled || realTiesCount > 0}
      >
        {!isLastWave
          ? 'Next wave →'
          : isFinalRound
            ? 'End event → podium'
            : 'End round'}
      </button>

      <div className="display-toolbar-menu">
        <button
          className="btn"
          aria-label="Menu"
          onClick={onMenuToggle}
          aria-expanded={menuOpen}
        >
          ≡
        </button>
        {menuOpen && (
          <>
            <div className="display-menu-backdrop" onClick={onMenuToggle} />
            <div className="display-menu">
              <button
                className="display-menu-item"
                onClick={() => {
                  onNavigate('/leaderboard');
                  onMenuToggle();
                }}
              >
                Full standings
              </button>
              <button
                className="display-menu-item"
                onClick={() => {
                  onNavigate('/setup');
                  onMenuToggle();
                }}
              >
                Setup &amp; teams
              </button>
              <button
                className="display-menu-item"
                onClick={() => {
                  onMenuToggle();
                  onSettings();
                }}
              >
                Settings
              </button>
              <button className="display-menu-item" onClick={onFinishEvent}>
                Finish event → podium
              </button>
              <div className="display-menu-divider" />
              <button
                className="display-menu-item display-menu-danger"
                onClick={onNewEvent}
              >
                + New event
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// ============================================================
// Live canvas — header + standings rail + main grid
// ============================================================

/** Bracket round name from its position relative to the final. */
function bracketRoundName(roundIndex: number, totalRounds: number): string {
  const fromEnd = totalRounds - roundIndex; // 0 = final
  if (fromEnd <= 0) return 'Final';
  if (fromEnd === 1) return 'Semifinals';
  if (fromEnd === 2) return 'Quarterfinals';
  return `Round of ${2 ** (fromEnd + 1)}`;
}

function TvLiveCanvas({
  event,
  round,
  showControls,
  onIncrement,
  onNominateTieWinner,
}: {
  event: NonNullable<ReturnType<typeof useEventStore.getState>['event']>;
  round: ReturnType<typeof currentRound>;
  showControls: boolean;
  onIncrement: (matchId: string, side: 'A' | 'B', delta: number) => void;
  onNominateTieWinner: (matchId: string, winnerId: string) => void;
}) {
  const timerView = useTimer(round);
  const lb = useMemo(() => leaderboard(event), [event]);
  const movements = useMemo(() => rankMovements(event), [event]);
  const top5 = lb.slice(0, 5);
  const rest = lb.slice(5, 14);

  const sortedCourtsDesc = event.courts.slice().sort((a, b) => b.position - a.position);
  const centre = sortedCourtsDesc[0];
  const restCourts = sortedCourtsDesc.slice(1);
  // Left column gets the higher courts top-to-bottom, right column gets the
  // remainder. With 6 side courts → left [6,5,4], right [3,2,1]. With an odd
  // number of side courts the extra one falls on the left.
  const half = Math.ceil(restCourts.length / 2);
  const leftCol = restCourts.slice(0, half);
  const rightCol = restCourts.slice(half);

  // Only the wave currently on court is shown; later waves rest. A round
  // with matches <= courts is a single wave 0, so this is a no-op there.
  const liveWave = round?.currentWave ?? 0;
  const waveCountLive = round
    ? round.matches.reduce((mx, m) => Math.max(mx, m.wave ?? 0), 0) + 1
    : 1;
  const waveMatchesLive = round
    ? round.matches.filter((m) => (m.wave ?? 0) === liveWave)
    : [];
  const restingTeams =
    waveCountLive > 1 && round
      ? round.matches
          .filter((m) => (m.wave ?? 0) !== liveWave)
          .flatMap((m) => [m.teamAId, m.teamBId])
          .map((id) => event.teams.find((t) => t.id === id))
          .filter((t): t is Team => !!t)
      : [];

  const centreMatch = waveMatchesLive.find((m) => m.courtId === centre?.id);
  const centreA = centreMatch && event.teams.find((t) => t.id === centreMatch.teamAId);
  const centreB = centreMatch && event.teams.find((t) => t.id === centreMatch.teamBId);
  const centreResult =
    centreMatch && showControls
      ? decideWinnerLoser(centreMatch, event.settings.tieRule)
      : null;

  let timerCls = '';
  if (!timerView.hasStarted) timerCls = '';
  else if (timerView.remainingMs <= 60_000) timerCls = 'danger';
  else if (timerView.remainingMs <= event.settings.warningAtMs) timerCls = 'warn';

  const totalRounds = event.settings.roundsTotal;
  const roundIndex = round?.index ?? 0;
  const completed = event.rounds.filter((r) => r.completedAt).length;
  const progress = round
    ? Math.min(
        100,
        ((round.durationMs - Math.max(0, timerView.remainingMs)) / round.durationMs) * 100,
      )
    : 0;

  const king = lb[0];
  const kingLabel = king
    ? teamNameFor(event, king.teamId).split(' & ')[0].slice(0, 8)
    : 'TBD';

  // King-of-the-Court chrome (crown, "King's Court", climb/drop, King stat)
  // only makes sense for KoC. Other formats show a neutral label.
  const isKoc = event.format === 'koc';
  const isBracket = event.format === 'bracket';
  const featureLabel = isBracket
    ? bracketRoundName(roundIndex, totalRounds)
    : isKoc
      ? "King's Court"
      : (centre?.name ?? 'Featured court');

  return (
    <div className="tv-display">
      <div className="tv-header">
        <div className="tv-header-brand">
          <div className="brand-mark lg"><BrandLogo /></div>
          <div className="tv-header-event">
            <div className="tv-header-event-name">{event.name}</div>
            <div className="tv-header-event-meta">
              {event.venue ? `${event.venue} • ` : ''}
              {roundIndex > 0
                ? `Round ${roundIndex} of ${totalRounds}`
                : `${event.teams.filter((t) => t.active).length} teams • ${event.courts.length} courts`}
              {waveCountLive > 1 && ` • Wave ${liveWave + 1} of ${waveCountLive}`}
            </div>
          </div>
        </div>
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
                    {isKoc && isKing && <Icons.Crown className="tv-lb-crown" />}
                    {isKoc && <RankMovement movement={movements.get(row.teamId)} />}
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
                  {isKoc && <RankMovement movement={movements.get(row.teamId)} />}
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
                {isKoc && <Icons.Crown className="icon lg" />} {featureLabel}
              </div>
              {isKoc && <div className="tv-centre-name">{centre?.name ?? 'TBD'}</div>}
              {isKoc && (
                <div className="tv-centre-pts">{centre?.pointValue ?? 0} POINTS</div>
              )}
            </div>
            <div className="tv-centre-team">
              {centreA && <TeamAvatars players={centreA.players} size="md" />}
              {centreA?.name && <div className="tv-centre-team-label">{centreA.name}</div>}
              <div className="tv-centre-team-name">
                {centreA ? teamLabelShort(centreA) : 'TBD'}
              </div>
            </div>
            <div className="tv-centre-scores">
              <CentreScore
                value={centreMatch?.scoreA ?? 0}
                isWinner={
                  centreMatch
                    ? centreMatch.scoreA > centreMatch.scoreB ||
                      centreResult?.winnerId === centreMatch.teamAId
                    : false
                }
                showControls={showControls && !!centreMatch}
                onIncrement={(delta) =>
                  centreMatch && onIncrement(centreMatch.id, 'A', delta)
                }
              />
              <div className="tv-centre-vs">VS</div>
              <CentreScore
                value={centreMatch?.scoreB ?? 0}
                isWinner={
                  centreMatch
                    ? centreMatch.scoreB > centreMatch.scoreA ||
                      centreResult?.winnerId === centreMatch.teamBId
                    : false
                }
                showControls={showControls && !!centreMatch}
                onIncrement={(delta) =>
                  centreMatch && onIncrement(centreMatch.id, 'B', delta)
                }
              />
            </div>
            <div className="tv-centre-team right">
              {centreB && <TeamAvatars players={centreB.players} size="md" />}
              {centreB?.name && <div className="tv-centre-team-label">{centreB.name}</div>}
              <div className="tv-centre-team-name">
                {centreB ? teamLabelShort(centreB) : 'TBD'}
              </div>
            </div>
            <div />
          </div>

          {showControls && centreMatch && centreA && centreB && (
            <CentreTieRow
              match={centreMatch}
              teamA={centreA}
              teamB={centreB}
              onNominate={onNominateTieWinner}
            />
          )}

          <div className="tv-lower">
            <div className="tv-courts-col">
              {leftCol.map((c) => (
                <TvCourtCard
                  key={c.id}
                  court={c}
                  match={waveMatchesLive.find((m) => m.courtId === c.id)}
                  teams={event.teams}
                  showControls={showControls}
                  onIncrement={onIncrement}
                  onNominateTieWinner={onNominateTieWinner}
                  tieRule={event.settings.tieRule}
                />
              ))}
            </div>

            <div className="tv-timer-block">
              <div className="tv-timer-label">Time Remaining</div>
              <div className={'tv-timer-value size-xl ' + timerCls}>
                {round ? formatMs(timerView.remainingMs) : '·'}
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
                    {Math.round(
                      (round?.durationMs ?? event.settings.defaultRoundDurationMs) / 60000,
                    )}
                    m
                  </span>
                </div>
                <div className="tv-timer-stat">
                  <span className="tv-timer-stat-label">{isKoc ? 'King' : 'Leader'}</span>
                  <span
                    className="tv-timer-stat-value"
                    style={{ color: 'var(--gold)' }}
                  >
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
                  match={waveMatchesLive.find((m) => m.courtId === c.id)}
                  teams={event.teams}
                  showControls={showControls}
                  onIncrement={onIncrement}
                  onNominateTieWinner={onNominateTieWinner}
                  tieRule={event.settings.tieRule}
                />
              ))}
            </div>
          </div>
          {restingTeams.length > 0 && (
            <div className="tv-resting">
              <span className="tv-resting-label">Resting</span>
              {restingTeams.map((t) => (
                <span key={t.id} className="tv-resting-team">
                  {teamNameFor(event, t.id)}
                </span>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function CentreScore({
  value,
  isWinner,
  showControls,
  onIncrement,
}: {
  value: number;
  isWinner: boolean;
  showControls: boolean;
  onIncrement: (delta: number) => void;
}) {
  if (!showControls) {
    return (
      <div key={value} className={'tv-centre-score score-pop ' + (isWinner ? 'winner' : '')}>
        {value}
      </div>
    );
  }
  return (
    <div className="tv-centre-score-group">
      <button
        className="tv-score-btn tv-score-btn--minus"
        aria-label="Decrease"
        onClick={() => onIncrement(-1)}
      >
        <Icons.Minus className="icon" />
      </button>
      <div key={value} className={'tv-centre-score score-pop ' + (isWinner ? 'winner' : '')}>
        {value}
      </div>
      <button
        className="tv-score-btn tv-score-btn--plus"
        aria-label="Increase"
        onClick={() => onIncrement(1)}
      >
        <Icons.Plus className="icon" />
      </button>
    </div>
  );
}

function CentreTieRow({
  match,
  teamA,
  teamB,
  onNominate,
}: {
  match: Match;
  teamA: Team;
  teamB: Team;
  onNominate: (matchId: string, winnerId: string) => void;
}) {
  const tied = match.scoreA === match.scoreB && (match.scoreA > 0 || match.scoreB > 0);
  if (!tied) return null;
  return (
    <div className="tv-centre-tie">
      <span className="label">Tied. Pick winner:</span>
      <button
        className={
          'tv-tie-btn ' + (match.tieBreakWinnerId === teamA.id ? 'active' : '')
        }
        onClick={() => onNominate(match.id, teamA.id)}
      >
        {teamLabelShort(teamA)}
      </button>
      <button
        className={
          'tv-tie-btn ' + (match.tieBreakWinnerId === teamB.id ? 'active' : '')
        }
        onClick={() => onNominate(match.id, teamB.id)}
      >
        {teamLabelShort(teamB)}
      </button>
      {match.tieBreakWinnerId && (
        <button className="tv-tie-btn" onClick={() => onNominate(match.id, '')}>
          Clear
        </button>
      )}
    </div>
  );
}

function TvCourtCard({
  court,
  match,
  teams,
  showControls,
  onIncrement,
  onNominateTieWinner,
  tieRule,
}: {
  court: Court;
  match: Match | undefined;
  teams: Team[];
  showControls: boolean;
  onIncrement: (matchId: string, side: 'A' | 'B', delta: number) => void;
  onNominateTieWinner: (matchId: string, winnerId: string) => void;
  tieRule: NonNullable<ReturnType<typeof useEventStore.getState>['event']>['settings']['tieRule'];
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
        <div style={{ textAlign: 'center', color: 'var(--text-2)' }}>No match</div>
      </div>
    );
  }
  const teamA = teams.find((t) => t.id === match.teamAId);
  const teamB = teams.find((t) => t.id === match.teamBId);
  const result = showControls ? decideWinnerLoser(match, tieRule) : null;
  const aWin = match.scoreA > match.scoreB || result?.winnerId === match.teamAId;
  const bWin = match.scoreB > match.scoreA || result?.winnerId === match.teamBId;
  const tied =
    match.scoreA === match.scoreB && (match.scoreA > 0 || match.scoreB > 0);

  return (
    <div className="tv-court">
      <div className="tv-court-head">
        <div className="tv-court-name">{court.name}</div>
        <div className="tv-court-pts">
          <span>{court.pointValue}</span> PTS
        </div>
      </div>
      <div className="tv-court-row">
        <div className="tv-court-team">
          {teamA && <TeamAvatars players={teamA.players} size="sm" />}
          <div className="tv-court-team-text">
            {teamA?.name && <div className="tv-court-team-label">{teamA.name}</div>}
            <div className="tv-court-team-name">{teamA ? teamLabelShort(teamA) : 'TBD'}</div>
          </div>
        </div>
        <ScoreCell
          value={match.scoreA}
          winner={aWin}
          tied={tied && !result?.winnerId}
          showControls={showControls}
          onIncrement={(d) => onIncrement(match.id, 'A', d)}
        />
      </div>
      <div className="tv-court-row">
        <div className="tv-court-team">
          {teamB && <TeamAvatars players={teamB.players} size="sm" />}
          <div className="tv-court-team-text">
            {teamB?.name && <div className="tv-court-team-label">{teamB.name}</div>}
            <div className="tv-court-team-name">{teamB ? teamLabelShort(teamB) : 'TBD'}</div>
          </div>
        </div>
        <ScoreCell
          value={match.scoreB}
          winner={bWin}
          tied={tied && !result?.winnerId}
          showControls={showControls}
          onIncrement={(d) => onIncrement(match.id, 'B', d)}
        />
      </div>
      {showControls && tied && teamA && teamB && (
        <div className="tv-court-tie">
          <span className="label">Tied:</span>
          <button
            className={
              'tv-tie-btn ' + (match.tieBreakWinnerId === teamA.id ? 'active' : '')
            }
            onClick={() => onNominateTieWinner(match.id, teamA.id)}
          >
            {teamLabelShort(teamA)}
          </button>
          <button
            className={
              'tv-tie-btn ' + (match.tieBreakWinnerId === teamB.id ? 'active' : '')
            }
            onClick={() => onNominateTieWinner(match.id, teamB.id)}
          >
            {teamLabelShort(teamB)}
          </button>
        </div>
      )}
    </div>
  );
}

function ScoreCell({
  value,
  winner,
  tied,
  showControls,
  onIncrement,
}: {
  value: number;
  winner: boolean;
  tied: boolean;
  showControls: boolean;
  onIncrement: (delta: number) => void;
}) {
  if (!showControls) {
    return (
      <div key={value} className={'tv-court-score score-pop ' + (winner ? 'winner' : tied ? 'tied' : '')}>
        {value}
      </div>
    );
  }
  return (
    <div className="tv-court-score-group">
      <button
        className="tv-score-btn tv-score-btn--minus"
        aria-label="Decrease"
        onClick={() => onIncrement(-1)}
      >
        <Icons.Minus className="icon" />
      </button>
      <div key={value} className={'tv-court-score score-pop ' + (winner ? 'winner' : tied ? 'tied' : '')}>
        {value}
      </div>
      <button
        className="tv-score-btn tv-score-btn--plus"
        aria-label="Increase"
        onClick={() => onIncrement(1)}
      >
        <Icons.Plus className="icon" />
      </button>
    </div>
  );
}

// ============================================================
// TV Complete canvas (podium + final standings) — extracted to
// src/components/TvCompleteView.tsx so the ShareCard can reuse it.
// ============================================================

// ============================================================
// TV Between-rounds canvas — rotation preview rendered on /display
// ============================================================

function TvBetweenCanvas({
  event,
}: {
  event: NonNullable<ReturnType<typeof useEventStore.getState>['event']>;
}) {
  const lb = useMemo(() => leaderboard(event), [event]);
  const rankMoves = useMemo(() => rankMovements(event), [event]);
  const top5 = lb.slice(0, 5);
  const rest = lb.slice(5, 14);

  const lastRound = event.rounds.at(-1);
  const lastRoundIndex = lastRound?.index ?? 0;
  const nextRoundIndex = lastRoundIndex + 1;
  const totalRounds = event.settings.roundsTotal;
  const pending = event.pendingAssignments ?? [];

  // Compute UP/DOWN/STAY/KING for every team in the upcoming round
  const movements = useMemo(() => {
    const map = new Map<string, Movement>();
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
        let arrow: MovementArrow;
        if (!fromCourt) arrow = 'stay';
        else if (toCourt.position > fromCourt.position) arrow = 'up';
        else if (toCourt.position < fromCourt.position) arrow = 'down';
        else if (isCentre) arrow = 'king';
        else arrow = 'stay';
        map.set(teamId, { teamId, fromCourt, toCourt, arrow });
      }
    }
    return map;
  }, [event.courts, lastRound, pending]);

  const sortedCourtsDesc = event.courts.slice().sort((a, b) => b.position - a.position);
  const centre = sortedCourtsDesc[0];
  const restCourts = sortedCourtsDesc.slice(1);
  // Left column gets the higher courts top-to-bottom, right column gets the
  // remainder. With 6 side courts → left [6,5,4], right [3,2,1]. With an odd
  // number of side courts the extra one falls on the left.
  const half = Math.ceil(restCourts.length / 2);
  const leftCol = restCourts.slice(0, half);
  const rightCol = restCourts.slice(half);

  const centreAssign = pending.find((a) => a.courtId === centre?.id);
  const centreA = centreAssign && event.teams.find((t) => t.id === centreAssign.teamAId);
  const centreB = centreAssign && event.teams.find((t) => t.id === centreAssign.teamBId);

  const king = lb[0];
  const kingLabel = king
    ? teamNameFor(event, king.teamId).split(' & ')[0].slice(0, 8)
    : 'TBD';

  const isKoc = event.format === 'koc';
  const isBracket = event.format === 'bracket';
  const featureLabel = isBracket
    ? bracketRoundName(nextRoundIndex, totalRounds)
    : isKoc
      ? "King's Court"
      : (centre?.name ?? 'Featured court');

  return (
    <div className="tv-display tv-display--between">
      <div className="tv-header">
        <div className="tv-header-brand">
          <div className="brand-mark lg"><BrandLogo /></div>
          <div className="tv-header-event">
            <div className="tv-header-event-name">{event.name}</div>
            <div className="tv-header-event-meta">
              {event.venue ? `${event.venue} • ` : ''}
              Round {lastRoundIndex} complete · Round {nextRoundIndex} starting
            </div>
          </div>
        </div>
        <div className="tv-header-right">
          <span>{event.teams.filter((t) => t.active).length} teams</span>
          <span style={{ opacity: 0.3 }}>•</span>
          <span>{event.courts.length} courts</span>
          <span style={{ opacity: 0.3 }}>•</span>
          <div
            className="tv-header-live"
            style={{
              background: 'oklch(28% 0.06 75)',
              borderColor: 'color-mix(in oklch, var(--amber) 50%, transparent)',
            }}
          >
            <span
              style={{
                color: 'var(--amber)',
                letterSpacing: '0.18em',
                fontWeight: 700,
              }}
            >
              {isKoc ? 'ROTATION' : 'NEXT ROUND'}
            </span>
          </div>
        </div>
      </div>

      <div className="tv-body">
        <div className="tv-lb">
          <div className="tv-lb-header">
            <div className="tv-lb-title">Standings</div>
            <div className="tv-lb-subtitle">After Round {lastRoundIndex}</div>
          </div>
          <div className="tv-lb-list">
            {top5.map((row, idx) => {
              const isKing = idx === 0 && row.total > 0;
              return (
                <div key={row.teamId} className={'tv-lb-row ' + (isKing ? 'king' : '')}>
                  <span className="rank">{idx + 1}</span>
                  <div className="team-name">
                    {isKoc && isKing && <Icons.Crown className="tv-lb-crown" />}
                    {isKoc && <RankMovement movement={rankMoves.get(row.teamId)} />}
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
                  {isKoc && <RankMovement movement={rankMoves.get(row.teamId)} />}
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
                {isKoc && <Icons.Crown className="icon lg" />} {featureLabel}
              </div>
              {isKoc && <div className="tv-centre-name">{centre?.name ?? 'TBD'}</div>}
              {isKoc && (
                <div className="tv-centre-pts">{centre?.pointValue ?? 0} POINTS</div>
              )}
            </div>
            <div className="tv-centre-team">
              {centreA && <TeamAvatars players={centreA.players} size="md" />}
              {centreA?.name && <div className="tv-centre-team-label">{centreA.name}</div>}
              <div className="tv-centre-team-name">
                {centreA ? teamLabelShort(centreA) : 'TBD'}
              </div>
              {isKoc && centreA && (
                <MovementChip
                  arrow={movements.get(centreA.id)?.arrow ?? 'stay'}
                  large
                />
              )}
            </div>
            <div className="tv-centre-scores tv-centre-scores--between">
              <span className="tv-centre-vs">VS</span>
            </div>
            <div className="tv-centre-team right">
              {centreB && <TeamAvatars players={centreB.players} size="md" />}
              {centreB?.name && <div className="tv-centre-team-label">{centreB.name}</div>}
              <div className="tv-centre-team-name">
                {centreB ? teamLabelShort(centreB) : 'TBD'}
              </div>
              {isKoc && centreB && (
                <MovementChip
                  arrow={movements.get(centreB.id)?.arrow ?? 'stay'}
                  large
                />
              )}
            </div>
            <div />
          </div>

          <div className="tv-lower">
            <div className="tv-courts-col">
              {leftCol.map((c) => (
                <TvBetweenCourtCard
                  key={c.id}
                  court={c}
                  assignment={pending.find((a) => a.courtId === c.id)}
                  teams={event.teams}
                  movements={movements}
                  showMovement={isKoc}
                />
              ))}
            </div>

            <div className="tv-timer-block tv-timer-block--between">
              <div className="tv-timer-label">Next Round</div>
              <div className="tv-timer-value size-xl" style={{ color: 'var(--amber)' }}>
                R{nextRoundIndex}
              </div>
              <div className="tv-timer-round">
                Round <strong>{nextRoundIndex}</strong> of <strong>{totalRounds}</strong>
              </div>
              <div className="tv-timer-bottom">
                <div className="tv-timer-stat">
                  <span className="tv-timer-stat-label">Just played</span>
                  <span className="tv-timer-stat-value">R{lastRoundIndex}</span>
                </div>
                <div className="tv-timer-stat">
                  <span className="tv-timer-stat-label">Duration</span>
                  <span className="tv-timer-stat-value">
                    {Math.round(event.settings.defaultRoundDurationMs / 60000)}m
                  </span>
                </div>
                <div className="tv-timer-stat">
                  <span className="tv-timer-stat-label">{isKoc ? 'King' : 'Leader'}</span>
                  <span
                    className="tv-timer-stat-value"
                    style={{ color: 'var(--gold)' }}
                  >
                    {kingLabel}
                  </span>
                </div>
              </div>
            </div>

            <div className="tv-courts-col">
              {rightCol.map((c) => (
                <TvBetweenCourtCard
                  key={c.id}
                  court={c}
                  assignment={pending.find((a) => a.courtId === c.id)}
                  teams={event.teams}
                  movements={movements}
                  showMovement={isKoc}
                />
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function TvBetweenCourtCard({
  court,
  assignment,
  teams,
  movements,
  showMovement,
}: {
  court: Court;
  assignment: { teamAId: string; teamBId: string } | undefined;
  teams: Team[];
  movements: Map<string, Movement>;
  showMovement: boolean;
}) {
  if (!assignment) {
    return (
      <div className="tv-court" style={{ opacity: 0.5 }}>
        <div className="tv-court-head">
          <div className="tv-court-name">{court.name}</div>
          <div className="tv-court-pts">
            <span>{court.pointValue}</span> PTS
          </div>
        </div>
        <div style={{ textAlign: 'center', color: 'var(--text-2)' }}>No assignment</div>
      </div>
    );
  }
  const teamA = teams.find((t) => t.id === assignment.teamAId);
  const teamB = teams.find((t) => t.id === assignment.teamBId);
  return (
    <div className="tv-court">
      <div className="tv-court-head">
        <div className="tv-court-name">{court.name}</div>
        <div className="tv-court-pts">
          <span>{court.pointValue}</span> PTS
        </div>
      </div>
      <div className="tv-court-row">
        <div className="tv-court-team">
          {teamA && <TeamAvatars players={teamA.players} size="sm" />}
          <div className="tv-court-team-text">
            {teamA?.name && <div className="tv-court-team-label">{teamA.name}</div>}
            <div className="tv-court-team-name">{teamA ? teamLabelShort(teamA) : 'TBD'}</div>
          </div>
        </div>
        {showMovement && teamA && <MovementChip arrow={movements.get(teamA.id)?.arrow ?? 'stay'} />}
      </div>
      <div className="tv-court-row">
        <div className="tv-court-team">
          {teamB && <TeamAvatars players={teamB.players} size="sm" />}
          <div className="tv-court-team-text">
            {teamB?.name && <div className="tv-court-team-label">{teamB.name}</div>}
            <div className="tv-court-team-name">{teamB ? teamLabelShort(teamB) : 'TBD'}</div>
          </div>
        </div>
        {showMovement && teamB && <MovementChip arrow={movements.get(teamB.id)?.arrow ?? 'stay'} />}
      </div>
    </div>
  );
}

function MovementChip({ arrow, large }: { arrow: MovementArrow; large?: boolean }) {
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
    <div className={'tv-movement ' + arrow + (large ? ' large' : '')}>
      <Icon className="icon" />
      <span>{label}</span>
    </div>
  );
}
