import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { ThemeSwitch } from '@/components/ThemeSwitch';
import { AmericanoChampionshipFinal } from '@/components/americano/AmericanoChampionshipFinal';
import { AmericanoLeaderboardV3 } from '@/components/americano/AmericanoLeaderboardV3';
import { AmericanoResultEditorV3 } from '@/components/americano/AmericanoResultEditorV3';
import { eventRoute } from '@/lib/eventRoutes';
import { useEventStore } from '@/store/eventStore';
import {
  confirmAmericanoResultV3,
  correctAmericanoResultV3,
  endAmericanoRoundV3,
  finishAmericanoEarlyV3,
  setAmericanoResultDraftV3,
  startNextAmericanoRoundV3,
  updateAmericanoClockV3,
} from '@/logic/americanoV3/runtime';
import { applyChampionshipFinalToStandingsV3, championshipStatusV3 } from '@/logic/americanoV3/championship';
import { computeAmericanoStandingsV3 } from '@/logic/americanoV3/standings';
import type { AmericanoEventStateV3, AmericanoMatchV3, AmericanoResultDraftV3 } from '@/logic/americanoV3/types';

function currentRound(event: AmericanoEventStateV3) { return event.rounds.at(-1) ?? null; }
function clockLabel(ms: number) {
  const seconds = Math.ceil(ms / 1000);
  return `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
}
function remainingMs(event: AmericanoEventStateV3, now: number): number {
  const round = currentRound(event);
  if (!round) return 0;
  if (!event.formatConfig.paceClockEnabled || !round.startedAt) return round.durationMs;
  const effectiveNow = round.pausedAt ?? now;
  return Math.max(0, round.durationMs - (effectiveNow - round.startedAt - round.totalPausedMs));
}
function sideName(event: AmericanoEventStateV3, match: Pick<AmericanoMatchV3, 'sideA' | 'sideB'>, side: 'A' | 'B') {
  const value = side === 'A' ? match.sideA : match.sideB;
  if (value.kind === 'fixed-team') {
    const team = event.teams.find((candidate) => candidate.id === value.teamId);
    return team?.name?.trim() || team?.players.map((player) => player.name).join(' & ') || value.teamId;
  }
  return value.playerIds.map((id) => event.participants.find((player) => player.id === id)?.name ?? id).join(' & ');
}

export function AmericanoDisplayV3({ event }: { event: AmericanoEventStateV3 }) {
  const loadEvent = useEventStore((state) => state.loadEvent);
  const navigate = useNavigate();
  const [now, setNow] = useState(Date.now());
  const [message, setMessage] = useState('');
  const [finishOpen, setFinishOpen] = useState(false);
  const [editingHistory, setEditingHistory] = useState<string | null>(null);
  const [finalStatus, setFinalStatus] = useState<Awaited<ReturnType<typeof championshipStatusV3>>>({ kind: 'no-results' });
  const readOnly = typeof window !== 'undefined' && (
    new URLSearchParams(window.location.search).get('tv') === '1'
    || new URLSearchParams(window.location.hash.split('?')[1] ?? '').get('tv') === '1'
  );
  const round = currentRound(event);
  const completedRounds = event.rounds.filter((candidate) => candidate.completedAt && !candidate.excludedReason).length;
  const baseStandings = useMemo(() => computeAmericanoStandingsV3(event), [event]);
  const standings = useMemo(() => applyChampionshipFinalToStandingsV3(baseStandings, finalStatus), [baseStandings, finalStatus]);
  const clock = remainingMs(event, now);

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);
  useEffect(() => {
    let active = true;
    void championshipStatusV3(event).then((status) => { if (active) setFinalStatus(status); });
    return () => { active = false; };
  }, [event]);

  function commit(next: AmericanoEventStateV3, success = '') {
    loadEvent(next);
    setMessage(success);
  }
  function action(operation: () => AmericanoEventStateV3) {
    try { commit(operation()); }
    catch (error) { setMessage(error instanceof Error ? error.message : 'That event change could not be saved.'); }
  }
  function saveResult(matchId: string, result: AmericanoResultDraftV3, confirm: boolean) {
    try {
      let next = setAmericanoResultDraftV3(event, matchId, result);
      if (confirm) next = confirmAmericanoResultV3(next, matchId);
      commit(next, confirm ? 'Result confirmed.' : 'Draft score saved.');
    } catch (error) { setMessage(error instanceof Error ? error.message : 'The score could not be saved.'); }
  }
  function correctResult(roundId: string, matchId: string, result: AmericanoResultDraftV3) {
    try { commit(correctAmericanoResultV3(event, roundId, matchId, result), 'History correction saved. The championship final will be reviewed against the updated results.'); setEditingHistory(null); }
    catch (error) { setMessage(error instanceof Error ? error.message : 'The correction could not be saved.'); }
  }
  const currentMatches = round?.matches ?? [];
  const allConfirmed = currentMatches.length > 0 && currentMatches.every((match) => match.resultConfirmed);
  const modeLabel = event.formatConfig.pairingMode === 'fixed' ? 'FIXED PAIRS' : 'ROTATING PAIRS';
  const rulesLabel = event.formatConfig.scoring.kind === 'rally'
    ? `${event.formatConfig.scoring.pointsPerMatch} rally points per match`
    : `${event.formatConfig.scoring.preset === 'custom' ? (event.formatConfig.scoring.rule.family === 'games' ? `First to ${event.formatConfig.scoring.rule.gamesToWin} games` : `${event.formatConfig.scoring.rule.bestOfSets === 1 ? 'One set' : 'Best of three sets'}`) : event.formatConfig.scoring.preset} · ${event.formatConfig.scoring.standings.pointsPerGameWon} standings ${event.formatConfig.scoring.standings.pointsPerGameWon === 1 ? 'point' : 'points'} per game${event.formatConfig.scoring.standings.matchWinBonus ? ` · +${event.formatConfig.scoring.standings.matchWinBonus} match bonus` : ''}`;

  if (event.status === 'complete') {
    const finalWinner = finalStatus.kind === 'current' && finalStatus.final.outcome
      ? finalStatus.final.outcome.kind === 'golden-point'
        ? finalStatus.final.contenderIds[finalStatus.final.outcome.winner === 'A' ? 0 : 1]
        : finalStatus.final.contenderIds[finalStatus.final.outcome.pointsA > finalStatus.final.outcome.pointsB ? 0 : 1]
      : undefined;
    return <main className="americano-night amv3-night amv3-complete">
      <Header event={event} readOnly={readOnly} modeLabel={modeLabel} rulesLabel={rulesLabel} onTv={() => openTvView()} />
      {event.completionReason === 'early' && <div className="amv3-callout warning">Event ended early. Only fully completed rounds count. Appearance counts may be uneven.</div>}
      {completedRounds === 0 && <div className="amv3-callout">No completed rounds, so there are no results or champion yet.</div>}
      <div className="amv3-complete-grid">
        <AmericanoLeaderboardV3 event={event} standings={standings} championId={finalWinner} />
        <AmericanoChampionshipFinal event={event} readOnly={readOnly} onChange={commit} />
      </div>
      <History event={event} readOnly={readOnly} editingId={editingHistory} setEditingId={setEditingHistory} onCorrect={correctResult} />
      {!readOnly && <footer className="amv3-footer"><button className="btn" onClick={() => { navigate(eventRoute(event.id, 'setup')); }}>Event setup</button></footer>}
      {message && <p className="amv3-message" role="status">{message}</p>}
    </main>;
  }

  if (event.status === 'between-rounds') {
    const next = event.americanoSchedule?.rounds[event.rounds.length];
    return <main className="americano-night amv3-night">
      <Header event={event} readOnly={readOnly} modeLabel={modeLabel} rulesLabel={rulesLabel} onTv={() => openTvView()} />
      <div className="amv3-break-grid"><AmericanoLeaderboardV3 event={event} standings={baseStandings} />
        <section className="amv3-panel"><p className="amv3-eyebrow">ROUND {completedRounds} COMPLETE</p><h2>Next up · Round {completedRounds + 1}</h2>
          {next?.matches.map((match) => <article className="amv3-next-match" key={match.id}><strong>{event.courts.find((court) => court.id === match.courtId)?.name}</strong><span>{sideName(event, match, 'A')}</span><b>vs</b><span>{sideName(event, match, 'B')}</span></article>)}
          {next?.restingEntrantIds.length ? <p className="amv3-help">Resting: {next.restingEntrantIds.map((id) => event.formatConfig.pairingMode === 'fixed' ? event.teams.find((team) => team.id === id)?.name ?? id : event.participants.find((player) => player.id === id)?.name ?? id).join(', ')}</p> : null}
          {!readOnly && <button className="btn primary" disabled={!next} onClick={() => action(() => startNextAmericanoRoundV3(event))}>Start round {completedRounds + 1}</button>}
        </section>
      </div>
      {message && <p className="amv3-message" role="status">{message}</p>}
    </main>;
  }

  if (!round) return <main className="americano-night amv3-night"><p className="amv3-empty">Preview and start this Americano from setup.</p></main>;
  return <main className="americano-night amv3-night">
    <Header event={event} readOnly={readOnly} modeLabel={modeLabel} rulesLabel={rulesLabel} onTv={() => openTvView()} />
    <div className="amv3-live-grid">
      <AmericanoLeaderboardV3 event={event} standings={baseStandings} />
      <section className="amv3-courts" aria-label="Current round matches">
        <header className="amv3-section-title"><div><p className="amv3-eyebrow">LIVE RESULTS</p><h2>Round {round.index} of {event.americanoSchedule?.rounds.length ?? event.settings.roundsTotal}</h2></div><strong>{currentMatches.filter((match) => match.resultConfirmed).length}/{currentMatches.length} confirmed</strong></header>
        {currentMatches.map((match) => <AmericanoResultEditorV3 key={match.id} event={event} match={match} readOnly={readOnly} correcting={false} onSave={(result, confirm) => saveResult(match.id, result, confirm)} />)}
        {(event.americanoSchedule?.rounds[round.index - 1]?.unusedCourtIds.length ?? 0) > 0 && <p className="amv3-help">Unused courts this round: {event.americanoSchedule!.rounds[round.index - 1].unusedCourtIds.map((id) => event.courts.find((court) => court.id === id)?.name ?? id).join(', ')}</p>}
      </section>
      <aside className="amv3-panel amv3-round-control"><p className="amv3-eyebrow">ROUND CONTROL</p><div><strong className="amv3-progress">{currentMatches.filter((match) => match.resultConfirmed).length}<small> / {currentMatches.length}</small></strong><span>results confirmed</span></div>
        {event.formatConfig.paceClockEnabled && <div className="amv3-clock"><span>ADVISORY PACE CLOCK · {event.formatConfig.paceMinutes} MIN</span><strong>{clockLabel(clock)}</strong>{clock === 0 && <small>Time is up. Enter and confirm scores as usual; the clock never ends a match.</small>}{!readOnly && <div className="amv3-action-row"><button className="btn" onClick={() => action(() => updateAmericanoClockV3(event, 'start'))}>{round.startedAt && round.pausedAt === undefined ? 'Running' : round.pausedAt ? 'Resume' : 'Start'}</button><button className="btn" onClick={() => action(() => updateAmericanoClockV3(event, 'pause'))}>Pause</button><button className="btn" onClick={() => action(() => updateAmericanoClockV3(event, 'reset'))}>Reset</button></div>}</div>}
        {!readOnly && <><button className="btn primary" disabled={!allConfirmed} title={!allConfirmed ? 'Confirm every court score before ending the round.' : undefined} onClick={() => action(() => endAmericanoRoundV3(event))}>{round.index === event.americanoSchedule?.rounds.length ? 'End final round' : 'End round'}</button><button className="btn danger" onClick={() => setFinishOpen(true)}>Finish event early</button></>}
        <p className="amv3-help">Scores are independent for each side. {event.formatConfig.scoring.kind === 'rally' ? 'Rally scores must total the match target.' : 'Enter games and any tiebreak separately; a match confirms only when its selected rule is complete.'}</p>
      </aside>
    </div>
    <History event={event} readOnly={readOnly} editingId={editingHistory} setEditingId={setEditingHistory} onCorrect={correctResult} />
    {message && <p className="amv3-message" role="status">{message}</p>}
    <ConfirmDialog open={finishOpen} title="Finish this Americano early?" message="Completed rounds stay official. The entire unfinished round will remain in history as excluded and will not count in standings." confirmLabel="Finish early" destructive onCancel={() => setFinishOpen(false)} onConfirm={() => { action(() => finishAmericanoEarlyV3(event)); setFinishOpen(false); }} />
  </main>;
}

function openTvView() {
  const url = new URL(window.location.href);
  url.searchParams.set('tv', '1');
  window.open(url.toString(), '_blank', 'noopener,noreferrer');
}

function Header({ event, readOnly, modeLabel, rulesLabel, onTv }: { event: AmericanoEventStateV3; readOnly: boolean; modeLabel: string; rulesLabel: string; onTv: () => void }) {
  return <header className="americano-night-header amv3-header"><div><span>AMERICANO · {modeLabel}{readOnly ? ' · SPECTATOR' : ''}</span><h1>{event.name}</h1><p>{rulesLabel}</p></div><div className="americano-night-tools"><ThemeSwitch />{!readOnly && <button className="btn" onClick={onTv}>Open read-only TV view</button>}</div></header>;
}

function History({ event, readOnly, editingId, setEditingId, onCorrect }: {
  event: AmericanoEventStateV3; readOnly: boolean; editingId: string | null; setEditingId: (id: string | null) => void;
  onCorrect: (roundId: string, matchId: string, result: AmericanoResultDraftV3) => void;
}) {
  const rounds = event.rounds.filter((round) => round.completedAt || round.excludedReason);
  if (!rounds.length) return null;
  return <details className="amv3-history"><summary>Match history · {rounds.reduce((sum, round) => sum + round.matches.length, 0)} fixtures</summary>{rounds.map((round) => <section key={round.id}><h3>Round {round.index}{round.excludedReason ? ' · excluded' : ''}</h3>{round.matches.map((match) => {
    const key = `${round.id}:${match.id}`;
    return <div className="amv3-history-match" key={match.id}><div className="amv3-history-summary"><span>{event.courts.find((court) => court.id === match.courtId)?.name}</span><strong>{sideName(event, match, 'A')} {formatResult(match.result)} {sideName(event, match, 'B')}</strong>{!readOnly && !round.excludedReason && <button className="btn" onClick={() => setEditingId(editingId === key ? null : key)}>{editingId === key ? 'Cancel edit' : 'Correct score'}</button>}</div>{editingId === key && <AmericanoResultEditorV3 event={event} match={match} readOnly={false} correcting onSave={(result) => onCorrect(round.id, match.id, result)} />}</div>;
  })}</section>)}</details>;
}

function formatResult(result: AmericanoResultDraftV3): string {
  if (result.kind === 'rally') return `${result.scoreA ?? '—'}–${result.scoreB ?? '—'}`;
  return result.sets.map((row) => row.kind === 'set'
    ? `${row.gamesA ?? '—'}–${row.gamesB ?? '—'}${row.tiebreakPointsA !== null && row.tiebreakPointsB !== null ? ` (${row.tiebreakPointsA}–${row.tiebreakPointsB})` : ''}`
    : `MTB ${row.pointsA ?? '—'}–${row.pointsB ?? '—'}`).join(', ');
}
