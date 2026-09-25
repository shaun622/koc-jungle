import { useEffect, useMemo, useState } from 'react';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { championshipStatusV3, confirmChampionshipFinalV3, prepareChampionshipFinalV3, resetChampionshipFinalV3 } from '@/logic/americanoV3/championship';
import type { ChampionshipStatusV3 } from '@/logic/americanoV3/championship';
import type { AmericanoEventStateV3, ChampionshipOutcomeV3 } from '@/logic/americanoV3/types';

function nameFor(event: AmericanoEventStateV3, id: string): string {
  if (event.formatConfig.pairingMode === 'fixed') {
    const team = event.teams.find((item) => item.id === id);
    return team?.name?.trim() || team?.players.map((player) => player.name).join(' & ') || id;
  }
  return event.participants.find((item) => item.id === id)?.name ?? id;
}

export function AmericanoChampionshipFinal({ event, readOnly, onChange }: {
  event: AmericanoEventStateV3;
  readOnly: boolean;
  onChange: (next: AmericanoEventStateV3) => void;
}) {
  const [status, setStatus] = useState<ChampionshipStatusV3>({ kind: 'no-results' });
  const [courtId, setCourtId] = useState(event.courts[0]?.id ?? '');
  const [supportA, setSupportA] = useState('');
  const [supportB, setSupportB] = useState('');
  const [acknowledged, setAcknowledged] = useState(false);
  const [goldenWinner, setGoldenWinner] = useState<'A' | 'B' | ''>('');
  const [pointsA, setPointsA] = useState('');
  const [pointsB, setPointsB] = useState('');
  const [resetOpen, setResetOpen] = useState(false);
  const [message, setMessage] = useState('');
  const policy = event.formatConfig.ranking.championship;
  const supportOptions = useMemo(() => {
    if (event.formatConfig.pairingMode !== 'rotating') return [];
    const contenders = new Set(event.championshipFinal?.contenderIds ?? (status.kind === 'available' || status.kind === 'not-configured' ? status.leaders.map((leader) => leader.entrantId) : []));
    return event.participants.filter((player) => player.active && !contenders.has(player.id));
  }, [event, status]);

  useEffect(() => {
    let live = true;
    void championshipStatusV3(event).then((next) => { if (live) setStatus(next); });
    return () => { live = false; };
  }, [event]);

  useEffect(() => {
    if (event.championshipFinal) {
      setCourtId(event.championshipFinal.courtId);
      setSupportA(event.championshipFinal.supportPlayerIds?.[0] ?? '');
      setSupportB(event.championshipFinal.supportPlayerIds?.[1] ?? '');
      const outcome = event.championshipFinal.outcome;
      setGoldenWinner(outcome?.kind === 'golden-point' ? outcome.winner : '');
      setPointsA(outcome?.kind === 'tiebreak' ? String(outcome.pointsA) : '');
      setPointsB(outcome?.kind === 'tiebreak' ? String(outcome.pointsB) : '');
    }
  }, [event.championshipFinal]);

  async function prepare() {
    try {
      const next = await prepareChampionshipFinalV3(event, {
        courtId,
        ...(event.formatConfig.pairingMode === 'rotating' ? {
          supportPlayerIds: [supportA, supportB],
          acknowledgeSupportPlayersNoPoints: acknowledged,
        } : {}),
      });
      setMessage('Final prepared. Regular results remain the source of standings points.');
      onChange(next);
    } catch (error) { setMessage(error instanceof Error ? error.message : 'The final could not be prepared.'); }
  }

  async function saveOutcome(outcome: ChampionshipOutcomeV3) {
    try { onChange(await confirmChampionshipFinalV3(event, outcome)); setMessage('Championship final saved.'); }
    catch (error) { setMessage(error instanceof Error ? error.message : 'The final result could not be saved.'); }
  }

  function reset() {
    try { onChange(resetChampionshipFinalV3(event, true)); setResetOpen(false); setMessage('Final reset. Regular standings remain unchanged.'); }
    catch (error) { setMessage(error instanceof Error ? error.message : 'The final could not be reset.'); }
  }

  let title = 'Championship final';
  let explanation = '';
  if (status.kind === 'no-results') explanation = 'No completed rounds yet. There are no standings or final to decide.';
  else if (status.kind === 'incomplete') explanation = 'Finish ordinary play before preparing a championship final.';
  else if (status.kind === 'shared-leaders') explanation = `${status.leaders.length} ${event.formatConfig.pairingMode === 'fixed' ? 'teams' : 'players'} share first. A two-entrant final cannot resolve this tie.`;
  else if (status.kind === 'champion') explanation = `Current leader: ${nameFor(event, status.leader.entrantId)}.`;
  else if (status.kind === 'not-configured') explanation = 'Two entrants are tied for first, but championship finals are turned off.';
  else if (status.kind === 'available') explanation = `Two entrants are tied for first: ${nameFor(event, status.leaders[0].entrantId)} and ${nameFor(event, status.leaders[1].entrantId)}.`;
  else if (status.kind === 'stale') explanation = 'Final needs review — regular results changed. It does not affect standings.';
  else if (status.kind === 'pending') explanation = `Final ready: ${nameFor(event, status.final.contenderIds[0])} vs ${nameFor(event, status.final.contenderIds[1])}.`;
  else if (status.kind === 'current') {
    const outcome = status.final.outcome;
    const championIndex = outcome?.kind === 'golden-point' ? outcome.winner === 'A' ? 0 : 1
      : outcome?.kind === 'tiebreak' ? outcome.pointsA > outcome.pointsB ? 0 : 1 : 0;
    explanation = `Champion: ${nameFor(event, status.final.contenderIds[championIndex])}. Regular totals were not changed.`;
  }

  const final = event.championshipFinal;
  const leaders = status.kind === 'available' || status.kind === 'not-configured' ? status.leaders : undefined;
  const canPrepare = !readOnly && status.kind === 'available' && policy !== 'none' && !final;
  const canEnter = !readOnly && Boolean(final) && status.kind === 'pending' && !final?.outcome;
  const canCorrect = !readOnly && Boolean(final?.outcome) && status.kind === 'current';

  return <section className="amv3-panel amv3-final" aria-labelledby="amv3-final-title">
    <header><div><p className="amv3-eyebrow">SEPARATE DECIDER · NO STANDINGS POINTS</p><h2 id="amv3-final-title">{title}</h2></div>{final && !readOnly && <button type="button" className="btn" onClick={() => setResetOpen(true)}>Reset final</button>}</header>
    <p>{explanation}</p>
    {(canPrepare || final) && <p className="amv3-final-sides">{leaders ? `${nameFor(event, leaders[0].entrantId)}  —  ${nameFor(event, leaders[1].entrantId)}` : final ? `${nameFor(event, final.contenderIds[0])}  —  ${nameFor(event, final.contenderIds[1])}` : ''}</p>}
    {canPrepare && <div className="amv3-final-controls">
      <label><span>Final court</span><select value={courtId} onChange={(e) => setCourtId(e.target.value)}>{event.courts.map((court) => <option key={court.id} value={court.id}>{court.name}</option>)}</select></label>
      {event.formatConfig.pairingMode === 'rotating' && <>
        <label><span>Support for side A · {leaders && nameFor(event, leaders[0].entrantId)}</span><select value={supportA} onChange={(e) => setSupportA(e.target.value)}><option value="">Choose player</option>{supportOptions.map((player) => <option key={player.id} value={player.id} disabled={player.id === supportB}>{player.name}</option>)}</select></label>
        <label><span>Support for side B · {leaders && nameFor(event, leaders[1].entrantId)}</span><select value={supportB} onChange={(e) => setSupportB(e.target.value)}><option value="">Choose player</option>{supportOptions.map((player) => <option key={player.id} value={player.id} disabled={player.id === supportA}>{player.name}</option>)}</select></label>
        <label className="amv3-check"><input type="checkbox" checked={acknowledged} onChange={(e) => setAcknowledged(e.target.checked)} /><span>Support partners do not earn points or places from this final.</span></label>
      </>}
      <button type="button" className="btn primary" disabled={event.formatConfig.pairingMode === 'rotating' && (!supportA || !supportB || !acknowledged)} onClick={() => void prepare()}>Prepare final</button>
    </div>}
    {final && <div className="amv3-final-detail"><p><strong>{event.courts.find((court) => court.id === final.courtId)?.name ?? 'Final court'}</strong>{final.supportPlayerIds && <> · {nameFor(event, final.supportPlayerIds[0])} and {nameFor(event, final.supportPlayerIds[1])} supporting</>}</p>
      {(canEnter || canCorrect) && <div className="amv3-final-controls">
        {policy === 'golden-point' ? <fieldset><legend>Who won the golden point?</legend><button type="button" className={`btn ${goldenWinner === 'A' ? 'primary' : ''}`} onClick={() => setGoldenWinner('A')}>Side A · {nameFor(event, final.contenderIds[0])}</button><button type="button" className={`btn ${goldenWinner === 'B' ? 'primary' : ''}`} onClick={() => setGoldenWinner('B')}>Side B · {nameFor(event, final.contenderIds[1])}</button><button type="button" className="btn primary" disabled={!goldenWinner} onClick={() => void saveOutcome({ kind: 'golden-point', winner: goldenWinner as 'A' | 'B', confirmedAt: Date.now() })}>{canCorrect ? 'Save correction' : 'Confirm final'}</button></fieldset>
          : <><label><span>{nameFor(event, final.contenderIds[0])} tiebreak score</span><input inputMode="numeric" type="number" min={0} value={pointsA} onChange={(e) => setPointsA(e.target.value)} /></label><label><span>{nameFor(event, final.contenderIds[1])} tiebreak score</span><input inputMode="numeric" type="number" min={0} value={pointsB} onChange={(e) => setPointsB(e.target.value)} /></label><button type="button" className="btn primary" disabled={!Number.isInteger(Number(pointsA)) || !Number.isInteger(Number(pointsB)) || pointsA === '' || pointsB === ''} onClick={() => void saveOutcome({ kind: 'tiebreak', pointsA: Number(pointsA), pointsB: Number(pointsB), confirmedAt: Date.now() })}>{canCorrect ? 'Save correction' : 'Confirm final'}</button></>}
      </div>}
      {final.outcome && <div className="amv3-final-result" aria-live="polite">{final.outcome.kind === 'golden-point' ? `${final.outcome.winner === 'A' ? nameFor(event, final.contenderIds[0]) : nameFor(event, final.contenderIds[1])} won the championship final on a golden point.` : `Final tiebreak: ${final.outcome.pointsA}–${final.outcome.pointsB}.`}</div>}
    </div>}
    {message && <p className="amv3-message" role="status">{message}</p>}
    <ConfirmDialog open={resetOpen} title="Reset championship final?" message="This discards the prepared final and any saved final result. Regular match results and standings points will remain unchanged. Export the event first if you want a record of this final." confirmLabel="Reset final" destructive onCancel={() => setResetOpen(false)} onConfirm={reset} />
  </section>;
}
