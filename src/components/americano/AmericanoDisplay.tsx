import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { RosterShareModal } from '@/components/RosterShareModal';
import { ThemeSwitch } from '@/components/ThemeSwitch';
import {
  confirmAmericanoResult,
  correctAmericanoResult,
  endAmericanoRound,
  finishAmericanoEarly,
  freshAmericanoCopy,
  setAmericanoResultSide,
  startNextAmericanoRound,
  updateAmericanoClock,
} from '@/logic/americanoV2/runtime';
import {
  americanoEntrantView,
  americanoMatchHistory,
  americanoPodium,
  americanoSideView,
  computeAmericanoStandings,
} from '@/logic/americanoV2/standings';
import type { AmericanoEventStateV2, AmericanoMatchV2 } from '@/logic/americanoV2/types';
import { validateAmericanoResult } from '@/logic/americanoV2/validation';
import { useEventStore } from '@/store/eventStore';
import { loadVoices } from '@/utils/voices';
import { speakPhrase } from '@/hooks/useAnnouncements';
import { buildRosterShareText } from '@/utils/rosterShare';
import { eventRoute } from '@/lib/eventRoutes';

function currentRound(event: AmericanoEventStateV2) {
  return event.rounds.at(-1) ?? null;
}

function remainingMs(event: AmericanoEventStateV2, now: number): number {
  const round = currentRound(event);
  if (!round || !event.formatConfig.paceClockEnabled) return round?.durationMs ?? 0;
  if (!round.startedAt) return round.durationMs;
  const effectiveNow = round.pausedAt ?? now;
  return Math.max(0, round.durationMs - (effectiveNow - round.startedAt - round.totalPausedMs));
}

function clockLabel(ms: number): string {
  const seconds = Math.ceil(ms / 1000);
  return `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
}

export function AmericanoDisplay({ event }: { event: AmericanoEventStateV2 }) {
  const loadEvent = useEventStore((state) => state.loadEvent);
  const navigate = useNavigate();
  const [message, setMessage] = useState('');
  const [confirmFinish, setConfirmFinish] = useState(false);
  const [now, setNow] = useState(Date.now());
  const [historyFor, setHistoryFor] = useState<string | null>(null);
  const [shareOpen, setShareOpen] = useState(false);
  const lastSpokenRound = useRef<string | null>(null);
  const readOnly = typeof window !== 'undefined' && (
    new URLSearchParams(window.location.search).get('tv') === '1'
    || new URLSearchParams(window.location.hash.split('?')[1] ?? '').get('tv') === '1'
  );
  const round = currentRound(event);
  const standings = useMemo(() => computeAmericanoStandings(event), [event]);
  const completedRounds = event.rounds.filter((candidate) => candidate.completedAt && !candidate.excludedReason).length;

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1_000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    if (!event.settings.announceRoundStart || !round || round.completedAt || lastSpokenRound.current === round.id) return;
    if (typeof window === 'undefined' || !('speechSynthesis' in window)) return;
    lastSpokenRound.current = round.id;
    const first = round.matches[0];
    const phrase = first
      ? `Round ${round.index}. ${event.courts.find((court) => court.id === first.courtId)?.name ?? 'Court one'}: ${americanoSideView(event, first.sideA).primaryLabel} versus ${americanoSideView(event, first.sideB).primaryLabel}.`
      : `Round ${round.index}.`;
    void loadVoices().then((voices) => speakPhrase(phrase, voices, event.settings.announcementVoiceURI));
  }, [event, round]);

  function commit(next: AmericanoEventStateV2) {
    loadEvent(next);
    setMessage('');
  }

  function action(fn: () => AmericanoEventStateV2) {
    try { commit(fn()); } catch (error) { setMessage((error as Error).message); }
  }

  if (event.status === 'complete') {
    const podium = americanoPodium(event);
    return (
      <main className="americano-night americano-complete">
        <header className="americano-night-header"><div><span>{event.completionReason === 'early' ? 'ENDED EARLY' : 'AMERICANO COMPLETE'}</span><h1>{event.name}</h1></div><div className="americano-night-tools"><strong>{event.formatConfig.pairingMode === 'rotating' ? 'Individual standings' : 'Team standings'}</strong><ThemeSwitch /><button className="btn" onClick={() => setShareOpen(true)}>Share results</button>{!readOnly && <button className="btn" onClick={() => { const copy = freshAmericanoCopy(event); loadEvent(copy); navigate(eventRoute(copy.id, 'setup')); }}>Create fresh event</button>}</div></header>
        <section className="americano-podium"><h2>{podium.length ? 'Podium' : 'No completed rounds'}</h2>{podium.map((row) => { const entrant = americanoEntrantView(event, row.entrantId); return <button key={row.entrantId} onClick={() => setHistoryFor(row.entrantId)}><span>#{row.rank}</span><strong>{entrant.primaryLabel}</strong>{entrant.secondaryLabel && <small>{entrant.secondaryLabel}</small>}<b>{row.total} pts</b></button>; })}</section>
        {event.completionReason === 'early' && <div className="americano-ended-note">The event ended early. Only fully completed rounds count in these standings.</div>}
        <AmericanoStandings event={event} rows={standings} onOpen={setHistoryFor} />
        {historyFor && <AmericanoHistory readOnly={readOnly} event={event} entrantId={historyFor} onClose={() => setHistoryFor(null)} onCorrect={(roundId, matchId, a, b) => action(() => correctAmericanoResult(event, roundId, matchId, a, b))} />}
        {shareOpen && <RosterShareModal title={event.name} text={buildRosterShareText({ event })} onClose={() => setShareOpen(false)} />}
      </main>
    );
  }

  if (event.status === 'between-rounds') {
    const next = event.americanoSchedule?.rounds[event.rounds.length];
    return (
      <main className="americano-night">
        <header className="americano-night-header"><div><span>ROUND {completedRounds} COMPLETE</span><h1>{event.name}</h1></div><div className="americano-night-tools"><strong>{event.formatConfig.pointsPerMatch} points per match</strong><ThemeSwitch /></div></header>
        <div className="americano-night-grid between">
          <AmericanoStandings event={event} rows={standings} onOpen={setHistoryFor} />
          <section className="americano-next"><span>NEXT UP</span><h2>Round {completedRounds + 1}</h2><div>{next?.matches.map((match) => <article key={match.id}><strong>{event.courts.find((court) => court.id === match.courtId)?.name}</strong><p>{americanoSideView(event, match.sideA).primaryLabel}</p><span>vs</span><p>{americanoSideView(event, match.sideB).primaryLabel}</p></article>)}</div>{!readOnly && <button className="btn primary lg full" onClick={() => action(() => startNextAmericanoRound(event))}>Start round {completedRounds + 1}</button>}</section>
        </div>
      </main>
    );
  }

  if (!round) return <div className="splash">Preview and start this Americano from setup.</div>;
  const allConfirmed = round.matches.length > 0 && round.matches.every((match) => match.resultConfirmed);
  const clock = remainingMs(event, now);
  return (
    <main className="americano-night">
      <header className="americano-night-header"><div><span>AMERICANO · {event.formatConfig.pairingMode === 'rotating' ? 'ROTATING PAIRS' : 'FIXED PAIRS'}</span><h1>{event.name}</h1></div><div className="americano-night-tools"><strong>Round {round.index} of {event.americanoSchedule?.rounds.length ?? event.settings.roundsTotal}</strong><ThemeSwitch />{!readOnly && <button className="btn" onClick={() => (() => { const url = new URL(window.location.href); url.searchParams.set('tv', '1'); window.open(url.toString(), '_blank', 'noopener,noreferrer'); })()}>Open read-only TV</button>}</div></header>
      <div className="americano-night-grid">
        <AmericanoStandings event={event} rows={standings} onOpen={setHistoryFor} />
        <section className="americano-courts-live">
          {round.matches.map((match) => <AmericanoMatchCard readOnly={readOnly} key={match.id} event={event} match={match} onChange={(side, value) => action(() => setAmericanoResultSide(event, match.id, side, value))} onConfirm={() => action(() => confirmAmericanoResult(event, match.id))} />)}
          {(event.americanoSchedule?.rounds[round.index - 1]?.unusedCourtIds.length ?? 0) > 0 && <div className="americano-unused">Unused this round: {event.americanoSchedule!.rounds[round.index - 1].unusedCourtIds.map((id) => event.courts.find((court) => court.id === id)?.name ?? id).join(', ')}</div>}
        </section>
        <aside className="americano-round-panel"><span>ROUND PROGRESS</span><strong>{round.matches.filter((match) => match.resultConfirmed).length}/{round.matches.length}</strong><p>{event.formatConfig.pointsPerMatch} points per match</p>{event.formatConfig.paceClockEnabled && <div className="americano-pace"><small>Advisory pace clock</small><b>{clockLabel(clock)}</b>{!readOnly && <div><button className="btn" onClick={() => action(() => updateAmericanoClock(event, 'start'))}>{round.startedAt && round.pausedAt === undefined ? 'Running' : round.pausedAt ? 'Resume' : 'Start clock'}</button><button className="btn" onClick={() => action(() => updateAmericanoClock(event, 'pause'))}>Pause</button><button className="btn" onClick={() => action(() => updateAmericanoClock(event, 'reset'))}>Reset</button></div>}</div>}{!readOnly && <><button className="btn primary lg full" disabled={!allConfirmed} onClick={() => action(() => endAmericanoRound(event))}>{round.index === event.americanoSchedule?.rounds.length ? 'End final round' : 'End round'}</button><button className="btn full" onClick={() => setConfirmFinish(true)}>Finish early</button></>}{message && <div className="signup-message error" role="alert">{message}</div>}</aside>
      </div>
      {historyFor && <AmericanoHistory readOnly={readOnly} event={event} entrantId={historyFor} onClose={() => setHistoryFor(null)} onCorrect={(roundId, matchId, a, b) => action(() => correctAmericanoResult(event, roundId, matchId, a, b))} />}
      {confirmFinish && <ConfirmDialog open title="Finish this Americano early?" message="Completed rounds stay official. This entire unfinished round will be retained as excluded history and will not count." confirmLabel="Finish early" destructive onCancel={() => setConfirmFinish(false)} onConfirm={() => { action(() => finishAmericanoEarly(event)); setConfirmFinish(false); }} />}
    </main>
  );
}

function AmericanoMatchCard({ event, match, onChange, onConfirm, readOnly = false }: { event: AmericanoEventStateV2; match: AmericanoMatchV2; onChange: (side: 'A' | 'B', value: number | null) => void; onConfirm: () => void; readOnly?: boolean }) {
  const a = americanoSideView(event, match.sideA);
  const b = americanoSideView(event, match.sideB);
  const court = event.courts.find((candidate) => candidate.id === match.courtId);
  const [attempted, setAttempted] = useState(false);
  const inputA = useRef<HTMLInputElement>(null);
  const inputB = useRef<HTMLInputElement>(null);
  const errors = validateAmericanoResult(match.scoreA, match.scoreB, event.formatConfig.pointsPerMatch);
  const errorAId = `${match.id}-score-a-error`;
  const errorBId = `${match.id}-score-b-error`;

  function confirm() {
    setAttempted(true);
    if (errors.scoreA) { inputA.current?.focus(); return; }
    if (errors.scoreB) { inputB.current?.focus(); return; }
    onConfirm();
  }

  return <article className={'americano-match-card ' + (match.resultConfirmed ? 'confirmed' : '')}>
    <header><strong>{court?.name ?? 'Court'}</strong><span>{match.resultConfirmed ? 'RESULT CONFIRMED' : readOnly ? 'RESULT PENDING' : 'ENTER FINAL RESULT'}</span></header>
    <div className="americano-result-row">
      <div><strong>{a.primaryLabel}</strong>{a.secondaryLabel !== a.primaryLabel && <small>{a.secondaryLabel}</small>}</div>
      <input ref={inputA} disabled={readOnly} aria-label={`${a.primaryLabel} score`} aria-invalid={attempted && Boolean(errors.scoreA)} aria-describedby={attempted && errors.scoreA ? errorAId : undefined} inputMode="numeric" value={Number.isFinite(match.scoreA) ? match.scoreA! : ''} onChange={(e) => { setAttempted(false); onChange('A', e.target.value === '' ? null : Number(e.target.value)); }} />
      <span>–</span>
      <input ref={inputB} disabled={readOnly} aria-label={`${b.primaryLabel} score`} aria-invalid={attempted && Boolean(errors.scoreB)} aria-describedby={attempted && errors.scoreB ? errorBId : undefined} inputMode="numeric" value={Number.isFinite(match.scoreB) ? match.scoreB! : ''} onChange={(e) => { setAttempted(false); onChange('B', e.target.value === '' ? null : Number(e.target.value)); }} />
      <div><strong>{b.primaryLabel}</strong>{b.secondaryLabel !== b.primaryLabel && <small>{b.secondaryLabel}</small>}</div>
    </div>
    {attempted && (errors.scoreA || errors.scoreB) && <div className="americano-score-errors">
      {errors.scoreA && <small id={errorAId} role="alert"><strong>{a.primaryLabel}:</strong> {errors.scoreA}</small>}
      {errors.scoreB && <small id={errorBId} role="alert"><strong>{b.primaryLabel}:</strong> {errors.scoreB}</small>}
    </div>}
    {!readOnly && <button className="btn full" onClick={confirm}>{match.resultConfirmed ? 'Confirmed' : 'Confirm result'}</button>}
  </article>;
}

function AmericanoStandings({ event, rows, onOpen }: { event: AmericanoEventStateV2; rows: ReturnType<typeof computeAmericanoStandings>; onOpen: (id: string) => void }) {
  const through = event.rounds.filter((round) => round.completedAt && !round.excludedReason).length;
  return <aside className="americano-standings"><header><span>STANDINGS</span><strong>{through ? `Through round ${through}` : 'Pre-round'}</strong></header><div>{rows.map((row) => { const entrant = americanoEntrantView(event, row.entrantId); return <button key={row.entrantId} onClick={() => onOpen(row.entrantId)}><b>{row.rank}</b><span><strong>{entrant.primaryLabel}</strong>{entrant.secondaryLabel && <small>{entrant.secondaryLabel}</small>}<small>{row.matchesPlayed} matches · {row.wins}W {row.draws}D {row.losses}L</small></span><em>{row.total}</em></button>; })}</div></aside>;
}

function AmericanoHistory({ event, entrantId, onClose, onCorrect, readOnly = false }: { event: AmericanoEventStateV2; entrantId: string; onClose: () => void; onCorrect: (roundId: string, matchId: string, a: number, b: number) => void; readOnly?: boolean }) {
  const entrant = americanoEntrantView(event, entrantId);
  const history = americanoMatchHistory(event, entrantId);
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState<[string, string]>(['', '']);
  return <div className="modal-backdrop" onClick={onClose}><section className="modal americano-history" onClick={(e) => e.stopPropagation()}><header><div><span>MATCH HISTORY</span><h2>{entrant.primaryLabel}</h2></div><button className="icon-button" onClick={onClose}>×</button></header>{history.length === 0 ? <p>No completed rounds yet.</p> : history.map((row) => { const round = event.rounds.find((candidate) => candidate.index === row.roundIndex)!; return <div className={'americano-history-row ' + (row.excluded ? 'excluded' : '')} key={row.fixtureId}><span>R{row.roundIndex}</span><p>{row.side.primaryLabel} vs {row.opponents.primaryLabel}</p>{editing === row.fixtureId ? <><input value={draft[0]} inputMode="numeric" onChange={(e) => setDraft([e.target.value, draft[1]])} /><span>–</span><input value={draft[1]} inputMode="numeric" onChange={(e) => setDraft([draft[0], e.target.value])} /><button className="btn" onClick={() => { onCorrect(round.id, row.fixtureId, Number(draft[0]), Number(draft[1])); setEditing(null); }}>Save correction</button><button className="btn" onClick={() => setEditing(null)}>Cancel</button></> : <><strong>{row.ownScore}–{row.opponentScore}</strong>{!readOnly && !row.excluded && <button className="btn" onClick={() => { const match = round.matches.find((candidate) => candidate.id === row.fixtureId)!; setDraft([String(match.scoreA), String(match.scoreB)]); setEditing(row.fixtureId); }}>Edit</button>}</>}</div>; })}</section></div>;
}
