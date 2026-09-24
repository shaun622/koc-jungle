import { useEffect, useMemo, useRef, useState } from 'react';
import {
  cloneTournament,
  computeGroupStandings,
  entryLabel,
  humanScore,
  type CorrectionPreview,
  type QualificationReconfirmation,
  type StartedResolution,
  type TournamentFixture,
  type TournamentResult,
  type TournamentScore,
} from '@/logic/tournament';
import { tournamentIds, useTournamentStore } from '@/store/tournamentStore';
import { startTournamentPlanning, type TournamentPlanningJob } from '@/logic/tournament/planningClient';

export function parseTournamentScore(value: string, decidingTiebreak: number | null): TournamentScore {
  const parts = value.split(',').map((part) => part.trim()).filter(Boolean);
  if (!parts.length) throw new Error('Enter a score such as 5-3 or 6-4, 4-6, 10-8. Blank scores are never treated as zero.');
  return { sets: parts.map((part, index) => {
    const match = /^(\d+)\s*[-:]\s*(\d+)(?:\s*\((\d+)\s*[-:]\s*(\d+)\))?$/.exec(part);
    if (!match) throw new Error(`“${part}” is not a valid score row.`);
    return {
      gamesA: Number(match[1]), gamesB: Number(match[2]),
      ...(match[3] ? { tiebreakPointsA: Number(match[3]), tiebreakPointsB: Number(match[4]) } : {}),
      ...(decidingTiebreak && index === 2 ? { decidingMatchTiebreak: true } : {}),
    };
  }) };
}

type ResultKind = 'played' | 'walkover' | 'retirement' | 'administrative';
type ResultDraft = { scoreText: string; resultKind: ResultKind; winner: string; reason: string };

export function TournamentScoreEditor({ fixture, onClose }: { fixture: TournamentFixture; onClose: () => void }) {
  const record = useTournamentStore((store) => store.active)!;
  const apply = useTournamentStore((store) => store.applyCommand);
  const saveScoreDraft = useTournamentStore((store) => store.saveScoreDraft);
  const saveFormDraft = useTournamentStore((store) => store.saveFormDraft);
  const state = record.projected;
  const profile = state.ruleProfiles.find((item) => item.id === fixture.ruleProfileId)!;
  const draftKey = `score-editor:${fixture.id}`;
  const saved = record.drafts.formByKey[draftKey] as Partial<ResultDraft> | undefined;
  const [scoreText, setScoreText] = useState(saved?.scoreText ?? humanScore(fixture.result?.score ?? fixture.result?.reportedScore ?? fixture.liveScore));
  const [resultKind, setResultKind] = useState<ResultKind>(saved?.resultKind ?? fixture.result?.kind ?? 'played');
  const [winner, setWinner] = useState(saved?.winner ?? fixture.result?.winnerEntryId ?? fixture.resolvedEntryAId ?? '');
  const [reason, setReason] = useState(saved?.reason ?? fixture.result?.reason ?? '');
  const [message, setMessage] = useState('');
  const [reviewedResult, setReviewedResult] = useState<Omit<TournamentResult, 'revision' | 'confirmedAt'> | null>(null);
  const [correctionPreview, setCorrectionPreview] = useState<CorrectionPreview | null>(null);
  const [resolutions, setResolutions] = useState<Record<string, StartedResolution | undefined>>({});
  const [qualificationReason, setQualificationReason] = useState('');
  const [planningStatus,setPlanningStatus]=useState('');
  const planningJob=useRef<TournamentPlanningJob|null>(null);
  const sideA = fixture.resolvedEntryAId ? entryLabel(state, fixture.resolvedEntryAId) : 'To be decided';
  const sideB = fixture.resolvedEntryBId ? entryLabel(state, fixture.resolvedEntryBId) : 'To be decided';
  const requiredImpacts = correctionPreview?.impacts.filter((impact) => impact.resolutionRequired) ?? [];
  const qualificationRequired = Boolean(correctionPreview?.invalidatedStageIds.length);
  const canApplyCorrection = Boolean(correctionPreview)
    && requiredImpacts.every((impact) => Boolean(resolutions[impact.fixtureId]?.action && resolutions[impact.fixtureId]?.reason.trim()))
    && (!qualificationRequired || Boolean(qualificationReason.trim()));

  const correctedState = useMemo(() => {
    if (!reviewedResult || fixture.status !== 'completed') return null;
    const clone = cloneTournament(state);
    const target = clone.fixtures.find((item) => item.id === fixture.id);
    if (!target?.result) return null;
    target.result = { ...reviewedResult, revision: target.result.revision + 1, confirmedAt: Date.now() };
    return clone;
  }, [fixture.id, fixture.status, reviewedResult, state]);
  useEffect(()=>()=>planningJob.current?.cancel(),[]);

  async function persistDraft(next: Partial<ResultDraft>) {
    await saveFormDraft(draftKey, { scoreText, resultKind, winner, reason, ...next });
  }

  function buildResult(): Omit<TournamentResult, 'revision' | 'confirmedAt'> {
    if (!winner) throw new Error('Choose the winner.');
    const parsed = scoreText.trim() ? parseTournamentScore(scoreText, profile.decidingMatchTiebreak) : null;
    if (resultKind === 'played' && !parsed) throw new Error('A played result needs a final score. Blank is not 0-0.');
    if (resultKind !== 'played' && !reason.trim()) throw new Error('Enter the reason for a non-played result.');
    return {
      kind: resultKind,
      winnerEntryId: winner,
      score: resultKind === 'played' ? parsed : null,
      ...(resultKind !== 'played' ? { reportedScore: parsed } : {}),
      reason: reason.trim(),
      retrospective: fixture.status === 'planned',
    };
  }

  async function publishProgress() {
    try {
      if (fixture.status !== 'playing' && fixture.status !== 'suspended') throw new Error('Start the match before publishing progress.');
      const parsed = parseTournamentScore(scoreText, profile.decidingMatchTiebreak);
      await saveScoreDraft(fixture.id, parsed);
      await apply('publish-progress', { fixtureId: fixture.id, score: parsed });
      setMessage('Progress published. The match has not advanced and still needs result confirmation.');
    } catch (error) { setMessage(error instanceof Error ? error.message : 'Could not publish progress.'); }
  }

  async function review() {
    try {
      const result = buildResult();
      setReviewedResult(result);
      setResolutions({});
      setQualificationReason('');
      if (fixture.status === 'completed') {
        const nextResult: TournamentResult = { ...result, revision: (fixture.result?.revision ?? 0) + 1, confirmedAt: Date.now(), retrospective: fixture.result?.retrospective ?? false };
        planningJob.current?.cancel();const job=startTournamentPlanning({kind:'correction',baseRevision:state.revision,state,fixtureId:fixture.id,result:nextResult},{onProgress:(_progress,status)=>setPlanningStatus(status)});planningJob.current=job;
        const planned=await job.promise;if(planned.kind!=='correction')throw new Error('Planner returned the wrong correction result.');
        if(useTournamentStore.getState().active?.projected.revision!==planned.preview.baseRevision)throw new Error('Tournament changed while reviewing this correction. Preview it again.');
        setCorrectionPreview(planned.preview);setPlanningStatus('');planningJob.current=null;
        setMessage('Review the complete correction impact, even when no later match changes.');
      } else {
        setCorrectionPreview(null);
        setMessage('Review this result, then confirm it. Nothing advances until confirmation.');
      }
    } catch (error) { setMessage(error instanceof Error ? error.message : 'Could not review result.'); }
  }

  async function applyReviewed() {
    if (!reviewedResult) return;
    try {
      if (fixture.status === 'completed') {
        if (!correctionPreview || !canApplyCorrection) throw new Error('Complete every required correction decision first.');
        const nextResult: TournamentResult = { ...reviewedResult, revision: (fixture.result?.revision ?? 0) + 1, confirmedAt: Date.now(), retrospective: fixture.result?.retrospective ?? false };
        const reconfirmations: QualificationReconfirmation[] = correctionPreview.invalidatedStageIds.map((stageId) => {
          const stage = correctedState?.stages.find((item) => item.id === stageId);
          if (!stage) throw new Error('Qualification stage no longer exists. Review the correction again.');
          return {
            stageId,
            orderedByGroup: Object.fromEntries(stage.groupIds.map((groupId) => [groupId, computeGroupStandings(correctedState!, groupId).rows.map((row) => row.entryId)])),
            policy: stage.standingsPolicy,
            reason: qualificationReason.trim(),
          };
        });
        await apply('correct-result', { fixtureId: fixture.id, result: nextResult, preview: correctionPreview, resolutions: requiredImpacts.map((impact) => resolutions[impact.fixtureId]!), reconfirmations });
      } else {
        await apply(fixture.status === 'planned' ? 'record-result' : 'confirm-result', { fixtureId: fixture.id, result: reviewedResult });
      }
      await saveFormDraft(draftKey, null);
      await saveScoreDraft(fixture.id, null);
      onClose();
    } catch (error) { setMessage(error instanceof Error ? error.message : 'Could not confirm result. Your edit remains visible.'); }
  }

  function invalidateReview() { planningJob.current?.cancel(); planningJob.current=null; setPlanningStatus(''); setReviewedResult(null); setCorrectionPreview(null); setResolutions({}); }

  return <div className="tv1-dialog-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <section className="tv1-dialog" role="dialog" aria-modal="true" aria-labelledby="result-title" onKeyDown={(event) => { if (event.key === 'Escape') onClose(); }}>
      <h2 id="result-title">{fixture.status === 'completed' ? 'Correct result' : 'Score & result'} · {fixture.label}</h2>
      <p><strong>{sideA}</strong> vs <strong>{sideB}</strong></p>
      <div className="tv1-workflow-steps" aria-label="Result workflow"><span>1 Draft</span><span>2 Progress</span><span>3 Review</span><span>4 Confirm</span></div>
      <label>Outcome<select value={resultKind} onChange={(event) => { const value = event.target.value as ResultKind; setResultKind(value); invalidateReview(); void persistDraft({ resultKind: value }); }}><option value="played">Played</option><option value="walkover">Walkover</option><option value="retirement">Retirement</option><option value="administrative">Administrative ruling</option></select></label>
      <label>Winner<select value={winner} onChange={(event) => { setWinner(event.target.value); invalidateReview(); void persistDraft({ winner: event.target.value }); }}><option value="">Choose winner</option><option value={fixture.resolvedEntryAId ?? ''}>{sideA}</option><option value={fixture.resolvedEntryBId ?? ''}>{sideB}</option></select></label>
      {resultKind !== 'walkover' && <label>{resultKind === 'played' ? 'Score' : 'Reported score (optional)'}<input value={scoreText} inputMode="numeric" placeholder="Blank — enter 5-3 or 6-4, 4-6, 10-8" onChange={(event) => { setScoreText(event.target.value); invalidateReview(); void persistDraft({ scoreText: event.target.value }); }}/><small>Blank stays blank; it never becomes 0. Set tiebreak: 7-6 (8-6). Separate sets with commas.</small></label>}
      {resultKind !== 'played' && <label>Required reason<textarea value={reason} maxLength={500} onChange={(event) => { setReason(event.target.value); invalidateReview(); void persistDraft({ reason: event.target.value }); }}/></label>}
      {message && <div className="tv1-alert" role="status">{message}</div>}{planningStatus&&<div className="tv1-alert" role="status">{planningStatus}<button className="btn" onClick={invalidateReview}>Cancel</button></div>}
      {reviewedResult && fixture.status !== 'completed' && <section className="tv1-result-review"><h3>Result review</h3><p>{sideA} vs {sideB} · winner {winner === fixture.resolvedEntryAId ? sideA : sideB} · {reviewedResult.score ? humanScore(reviewedResult.score) : reviewedResult.reportedScore ? `reported ${humanScore(reviewedResult.reportedScore)}` : reviewedResult.kind}</p><p>Standings and dependent fixtures update only after Confirm.</p></section>}
      {correctionPreview && <section className="tv1-correction-preview" aria-label="Correction impact review"><h3>Downstream impact</h3>{correctionPreview.impacts.length === 0 ? <p>No later fixtures change. This correction still requires confirmation.</p> : correctionPreview.impacts.map((impact) => {
        const affected = state.fixtures.find((item) => item.id === impact.fixtureId);
        const resolution = resolutions[impact.fixtureId];
        return <article key={impact.fixtureId}><strong>{affected?.label ?? impact.fixtureId}</strong><span>{impact.oldEntryIds.map((id) => id ? entryLabel(state,id) : 'TBD').join(' / ')} → {impact.newEntryIds.map((id) => id ? entryLabel(state,id) : 'TBD').join(' / ')}</span>{impact.resolutionRequired ? <><label>Required decision<select value={resolution?.action ?? ''} onChange={(event) => { const action = event.target.value as StartedResolution['action']; setResolutions((current) => ({ ...current, [impact.fixtureId]: action ? { fixtureId: impact.fixtureId, action, reason: current[impact.fixtureId]?.reason ?? '', ...(action === 'void-and-replay' ? { replacementFixtureId: tournamentIds.fixture() } : {}) } : undefined })); }}><option value="">Choose…</option><option value="keep-as-played">Keep match as played</option><option value="void-and-replay">Void and create replay</option></select></label><label>Required reason<input value={resolution?.reason ?? ''} maxLength={500} onChange={(event) => setResolutions((current) => ({ ...current, [impact.fixtureId]: current[impact.fixtureId] ? { ...current[impact.fixtureId]!, reason: event.target.value } : undefined }))}/></label></> : <small>Planned fixture will update automatically.</small>}</article>;
      })}{qualificationRequired && <label>Qualification reconfirmation reason<textarea value={qualificationReason} maxLength={500} onChange={(event) => setQualificationReason(event.target.value)}/><small>The corrected group standings will be reconfirmed explicitly for {correctionPreview.invalidatedStageIds.length} stage(s).</small></label>}</section>}
      <div className="tv1-dialog-actions">{(fixture.status === 'playing' || fixture.status === 'suspended') && <button className="btn" onClick={() => void publishProgress()}>Publish progress only</button>}{!reviewedResult && <button className="btn primary" onClick={()=>void review()}>{fixture.status === 'completed' ? 'Preview correction' : 'Review result'}</button>}{reviewedResult && <button className="btn primary" disabled={fixture.status === 'completed' && !canApplyCorrection} onClick={() => void applyReviewed()}>{fixture.status === 'completed' ? 'Apply correction' : 'Confirm result'}</button>}<button className="btn" onClick={onClose}>Close</button></div>
    </section>
  </div>;
}
