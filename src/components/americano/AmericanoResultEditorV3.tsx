import { useEffect, useState } from 'react';
import type { AmericanoEventStateV3, AmericanoMatchV3, AmericanoResultDraftV3, TraditionalRowDraftV3 } from '@/logic/americanoV3/types';
import { validateAmericanoResultDraftV3 } from '@/logic/americanoV3/scoring';

function labelForSide(event: AmericanoEventStateV3, side: AmericanoMatchV3['sideA']): string {
  if (side.kind === 'fixed-team') {
    const team = event.teams.find((candidate) => candidate.id === side.teamId);
    return `${team?.name?.trim() || team?.players.map((player) => player.name).join(' & ') || side.teamId} · ${team?.players.map((player) => player.name).join(' & ') ?? ''}`;
  }
  return side.playerIds.map((id) => event.participants.find((player) => player.id === id)?.name ?? id).join(' & ');
}

function nullableNumber(value: string): number | null {
  if (!value.trim()) return null;
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : null;
}

export function AmericanoResultEditorV3({ event, match, readOnly, correcting, onSave }: {
  event: AmericanoEventStateV3; match: AmericanoMatchV3; readOnly: boolean; correcting: boolean;
  onSave: (result: AmericanoResultDraftV3, confirm: boolean) => void;
}) {
  const [draft, setDraft] = useState<AmericanoResultDraftV3>(match.result);
  const [error, setError] = useState('');
  const savedResultJson = JSON.stringify(match.result);
  useEffect(() => {
    setDraft(JSON.parse(savedResultJson) as AmericanoResultDraftV3);
    setError('');
  }, [match.id, savedResultJson]);
  const sideA = labelForSide(event, match.sideA);
  const sideB = labelForSide(event, match.sideB);
  const locked = readOnly && !correcting;
  const validation = validateAmericanoResultDraftV3(draft, event.formatConfig.scoring, true, event.formatConfig.paceMinutes);

  function adjustRallyScore(side: 'A' | 'B', change: -1 | 1) {
    if (draft.kind !== 'rally' || locked) return;
    const scoreA = draft.scoreA ?? 0;
    const scoreB = draft.scoreB ?? 0;
    const current = side === 'A' ? scoreA : scoreB;
    const target = event.formatConfig.scoring.kind === 'rally' ? event.formatConfig.scoring.pointsPerMatch : 0;
    if (current + change < 0 || (change > 0 && scoreA + scoreB >= target)) return;
    setDraft({ ...draft, scoreA: side === 'A' ? current + change : scoreA, scoreB: side === 'B' ? current + change : scoreB });
    setError('');
  }

  function updateRow(index: number, patch: Partial<TraditionalRowDraftV3>) {
    if (draft.kind !== 'traditional') return;
    setDraft({ ...draft, sets: draft.sets.map((row, rowIndex) => rowIndex === index ? { ...row, ...patch } as TraditionalRowDraftV3 : row) });
    setError('');
  }
  function save(confirm: boolean) {
    const checked = validateAmericanoResultDraftV3(draft, event.formatConfig.scoring, confirm, event.formatConfig.paceMinutes);
    if (!checked.valid) { setError(checked.error?.message ?? 'Enter a valid result.'); return; }
    setError(''); onSave(draft, confirm);
  }

  return <article className="amv3-match">
    <header><span>{event.courts.find((court) => court.id === match.courtId)?.name ?? match.courtId}</span><span>{correcting ? 'CORRECTION' : match.resultConfirmed ? 'CONFIRMED' : 'RESULT NEEDED'}</span></header>
    <div className="amv3-match-side"><strong>A</strong><span>{sideA}</span></div><div className="amv3-match-side"><strong>B</strong><span>{sideB}</span></div>
    {event.formatConfig.scoring.kind === 'rally' && draft.kind === 'rally' ? <div className="amv3-score-fields">
      <label><span>Side A</span><span className="amv3-rally-stepper"><button type="button" aria-label={`Decrease ${sideA} score`} disabled={locked || (draft.scoreA ?? 0) === 0} onClick={() => adjustRallyScore('A', -1)}>−</button><input aria-label={`${sideA} rally score`} type="number" inputMode="numeric" min={0} value={draft.scoreA ?? ''} disabled={locked} onChange={(e) => setDraft({ ...draft, scoreA: nullableNumber(e.target.value) })} /><button type="button" aria-label={`Increase ${sideA} score`} disabled={locked || (draft.scoreA ?? 0) + (draft.scoreB ?? 0) >= event.formatConfig.scoring.pointsPerMatch} onClick={() => adjustRallyScore('A', 1)}>+</button></span></label><b>–</b>
      <label><span>Side B</span><span className="amv3-rally-stepper"><button type="button" aria-label={`Decrease ${sideB} score`} disabled={locked || (draft.scoreB ?? 0) === 0} onClick={() => adjustRallyScore('B', -1)}>−</button><input aria-label={`${sideB} rally score`} type="number" inputMode="numeric" min={0} value={draft.scoreB ?? ''} disabled={locked} onChange={(e) => setDraft({ ...draft, scoreB: nullableNumber(e.target.value) })} /><button type="button" aria-label={`Increase ${sideB} score`} disabled={locked || (draft.scoreA ?? 0) + (draft.scoreB ?? 0) >= event.formatConfig.scoring.pointsPerMatch} onClick={() => adjustRallyScore('B', 1)}>+</button></span></label>
    </div> : draft.kind === 'traditional' ? <div className="amv3-sets">
      {draft.sets.map((row, index) => row.kind === 'set' ? <div className="amv3-set-row" key={`set-${index}`}>
        <span>Set {index + 1}</span><input aria-label={`Set ${index + 1} games A`} type="number" min={0} value={row.gamesA ?? ''} disabled={locked} onChange={(e) => updateRow(index, { gamesA: nullableNumber(e.target.value) })} /><b>–</b>
        <input aria-label={`Set ${index + 1} games B`} type="number" min={0} value={row.gamesB ?? ''} disabled={locked} onChange={(e) => updateRow(index, { gamesB: nullableNumber(e.target.value) })} />
        <input aria-label={`Set ${index + 1} tiebreak points A`} className="amv3-tb-input" type="number" min={0} placeholder="TB A" value={row.tiebreakPointsA ?? ''} disabled={locked} onChange={(e) => updateRow(index, { tiebreakPointsA: nullableNumber(e.target.value) })} />
        <input aria-label={`Set ${index + 1} tiebreak points B`} className="amv3-tb-input" type="number" min={0} placeholder="TB B" value={row.tiebreakPointsB ?? ''} disabled={locked} onChange={(e) => updateRow(index, { tiebreakPointsB: nullableNumber(e.target.value) })} />
      </div> : <div className="amv3-set-row" key={`tb-${index}`}><span>Match TB</span><input aria-label="Match tiebreak points A" type="number" min={0} value={row.pointsA ?? ''} disabled={locked} onChange={(e) => updateRow(index, { pointsA: nullableNumber(e.target.value) })} /><b>–</b><input aria-label="Match tiebreak points B" type="number" min={0} value={row.pointsB ?? ''} disabled={locked} onChange={(e) => updateRow(index, { pointsB: nullableNumber(e.target.value) })} /></div>)}
      {!locked && event.formatConfig.scoring.kind === 'traditional' && <div className="amv3-editor-actions"><button type="button" className="btn" disabled={draft.sets.length >= event.formatConfig.scoring.rule.bestOfSets} onClick={() => setDraft({ ...draft, sets: [...draft.sets, event.formatConfig.scoring.kind === 'traditional' && event.formatConfig.scoring.rule.decidingMatchTiebreak && draft.sets.length === 2 ? { kind: 'match-tiebreak', pointsA: null, pointsB: null } : { kind: 'set', gamesA: null, gamesB: null, tiebreakPointsA: null, tiebreakPointsB: null }] })}>+ Add set</button><button type="button" className="btn" disabled={draft.sets.length <= 1} onClick={() => setDraft({ ...draft, sets: draft.sets.slice(0, -1) })}>Remove last set</button></div>}
    </div> : null}
    <label className="amv3-finish-played"><input type="checkbox" checked={draft.endedEarly === true} disabled={locked} onChange={(e) => { setDraft({ ...draft, endedEarly: e.target.checked }); setError(''); }} /><span>Time ran out — use score played<small>Only tick this if play stopped early. Enter the actual score; level scores are a draw.</small></span></label>
    {draft.endedEarly && event.formatConfig.scoring.kind === 'traditional' && <p className="amv3-help">Sets won first, then the current set score decide the leader. A level score is a draw. The configured win bonus applies only to the leader.</p>}
    {(error || (!locked && !validation.valid && draft.endedEarly)) && <p className="amv3-inline-error" role="alert">{error || validation.error?.message}</p>}
    {!locked && <div className="amv3-editor-actions">{(!match.resultConfirmed || correcting) && <button type="button" className="btn" onClick={() => save(false)}>Save draft</button>}<button type="button" className="btn primary" disabled={!validation.valid} onClick={() => save(true)}>{correcting ? 'Save correction' : 'Confirm result'}</button></div>}
  </article>;
}
