import { useState } from 'react';
import { TournamentScoreEditor } from '@/components/tournament/TournamentScoreEditor';
import { entryLabel, humanScore, type TournamentFixture, type TournamentV1 } from '@/logic/tournament';
import { useTournamentStore } from '@/store/tournamentStore';

export function TournamentDesk() {
  const record = useTournamentStore((store) => store.active)!;
  const apply = useTournamentStore((store) => store.applyCommand);
  const requestAuthority = useTournamentStore((store) => store.requestAuthority);
  const releaseAuthority = useTournamentStore((store) => store.releaseAuthority);
  const state = record.projected;
  const [message, setMessage] = useState('');
  const [selected, setSelected] = useState<TournamentFixture | null>(null);
  const [lifecycleReason, setLifecycleReason] = useState('');
  const [takeoverAcknowledged, setTakeoverAcknowledged] = useState(false);
  const sorted = [...state.fixtures].sort((a,b) => a.queueOrder - b.queueOrder);
  const incomplete = state.fixtures.filter((fixture) => !['completed','resolved-bye','voided'].includes(fixture.status));
  const unconfirmedQualification = state.stages.filter((stage) => stage.groupIds.length && !stage.qualificationConfirmedAt);
  const beginProblems = [!state.fixtures.length && 'Create at least one match.', state.divisions.some((division) => state.fixtures.some((fixture) => fixture.divisionId === division.id) && !division.drawPublishedAt) && 'Publish every draw.', state.fixtures.some((fixture) => fixture.status === 'planned' && (!fixture.resolvedEntryAId || !fixture.resolvedEntryBId)) && 'Resolve every match source.'].filter(Boolean) as string[];
  const completeProblems = [incomplete.length && `${incomplete.length} match(es) are not terminal.`, unconfirmedQualification.length && `${unconfirmedQualification.length} qualification stage(s) are not confirmed.`].filter(Boolean) as string[];

  async function authority(action: 'begin'|'claim'|'takeover'|'reopen') {
    try {
      if ((action === 'takeover' || action === 'reopen') && !lifecycleReason.trim()) throw new Error('Enter the required reason first.');
      if (action === 'takeover' && !takeoverAcknowledged) throw new Error('Acknowledge that the other device may have inaccessible work.');
      await requestAuthority(action, lifecycleReason, takeoverAcknowledged);
      setLifecycleReason(''); setTakeoverAcknowledged(false);
      setMessage(action === 'begin' ? 'Tournament is live and this device holds control.' : action === 'claim' ? 'This device now holds match-day control.' : action === 'takeover' ? 'Forced takeover completed. The old device can no longer write.' : 'Tournament reopened with signup closed and fresh control.');
    } catch (error) { setMessage(error instanceof Error ? error.message : 'Could not change controller authority.'); }
  }

  async function start(fixture: TournamentFixture) {
    const courtId = fixture.courtId ?? state.courts.find((court) => court.available && !state.fixtures.some((other) => other.status === 'playing' && other.courtId === court.id))?.id;
    try {
      if (!courtId) throw new Error('Assign an available court before starting this match.');
      await apply('start-match', { fixtureId: fixture.id, courtId }); setMessage(`${fixture.label} is playing.`);
    } catch (error) { setMessage(error instanceof Error ? error.message : 'Could not start match.'); }
  }

  async function lifecycle(kind: 'complete-event'|'cancel-event'|'archive-event') {
    try {
      if (kind === 'cancel-event' && !lifecycleReason.trim()) throw new Error('Enter a reason before cancelling.');
      await apply(kind, kind === 'archive-event' ? { archived: !state.archivedAt } : {}, lifecycleReason || undefined);
      setLifecycleReason('');
      setMessage(kind === 'complete-event' ? 'Tournament completed.' : kind === 'cancel-event' ? 'Tournament cancelled with its history preserved.' : state.archivedAt ? 'Tournament restored from archive.' : 'Tournament archived.');
    } catch (error) { setMessage(error instanceof Error ? error.message : 'Could not change tournament status.'); }
  }

  return <main className="tv1-main tv1-desk-page">
    <div className="tv1-page-head"><div><p className="eyebrow">LIVE CONTROL</p><h1>Tournament desk</h1><p>Every match moves independently. Drafts stay private; progress never advances the draw.</p></div><div className="tv1-template-actions">
      {state.lifecycle === 'setup' && <button className="btn primary" disabled={beginProblems.length > 0} onClick={() => void authority('begin')}>Begin tournament</button>}
      {state.lifecycle === 'live' && state.controller.deviceId === null && <button className="btn primary" onClick={() => void authority('claim')}>Claim control</button>}
      {state.lifecycle === 'live' && state.controller.deviceId !== null && record.mode === 'connected' && <><button className="btn" onClick={() => void releaseAuthority().then(() => setMessage('Control released after all changes were synced.')).catch((error) => setMessage(error.message))}>Release control</button><button className="btn danger" disabled={!lifecycleReason.trim() || !takeoverAcknowledged} onClick={() => void authority('takeover')}>Force takeover</button></>}
      {state.lifecycle === 'live' && <button className="btn primary" disabled={completeProblems.length > 0} onClick={() => void lifecycle('complete-event')}>Complete tournament</button>}
      {(state.lifecycle === 'complete' || state.lifecycle === 'cancelled') && <button className="btn" disabled={!lifecycleReason.trim()} onClick={() => void authority('reopen')}>Reopen for corrections</button>}
      {(state.lifecycle === 'setup' || state.lifecycle === 'live') && <button className="btn danger" disabled={!lifecycleReason.trim()} onClick={() => void lifecycle('cancel-event')}>Cancel tournament</button>}
      <button className="btn" onClick={() => void lifecycle('archive-event')}>{state.archivedAt ? 'Restore archive' : 'Archive'}</button>
    </div></div>
    <section className="tv1-lifecycle-note"><label>Lifecycle reason<input value={lifecycleReason} maxLength={500} placeholder="Required for cancel, reopen or forced takeover" onChange={(event) => setLifecycleReason(event.target.value)}/></label>{state.lifecycle === 'live' && state.controller.deviceId !== null && record.mode === 'connected' && <label className="tv1-private-check"><input type="checkbox" checked={takeoverAcknowledged} onChange={(event) => setTakeoverAcknowledged(event.target.checked)}/>I understand the other device may have inaccessible work.</label>}{state.lifecycle === 'setup' && beginProblems.length > 0 && <div><strong>Before Begin:</strong><ul>{beginProblems.map((problem) => <li key={problem}>{problem}</li>)}</ul></div>}{state.lifecycle === 'live' && completeProblems.length > 0 && <div><strong>Before Complete:</strong><ul>{completeProblems.map((problem) => <li key={problem}>{problem}</li>)}</ul></div>}</section>
    {message && <div className="tv1-alert" role="status">{message}</div>}
    {!state.fixtures.length ? <section className="tv1-empty"><h2>No matches yet</h2><p>Add entries and generate a reviewed draw from Setup.</p></section> : <section className="tv1-desk" aria-label="Tournament match desk"><div className="tv1-desk-head"><span>Stage / match</span><span>Sides</span><span>Court</span><span>Plan</span><span>Status</span><span>Score</span><span>Actions</span></div>{sorted.map((fixture) => <DeskRow key={fixture.id} fixture={fixture} onStart={start} onScore={setSelected}/>)}</section>}
    {selected && <TournamentScoreEditor key={`${selected.id}:${selected.result?.revision ?? 0}`} fixture={state.fixtures.find((fixture) => fixture.id === selected.id) ?? selected} onClose={() => setSelected(null)}/>} 
  </main>;
}

function sideLabel(state: TournamentV1, id: string | null) { return id ? entryLabel(state,id) : 'To be decided'; }

function DeskRow({ fixture, onStart, onScore }: { fixture: TournamentFixture; onStart: (fixture: TournamentFixture) => Promise<void>; onScore: (fixture: TournamentFixture) => void }) {
  const state = useTournamentStore((store) => store.active!.projected);
  const apply = useTournamentStore((store) => store.applyCommand);
  const [resumeCourt, setResumeCourt] = useState(fixture.courtId ?? '');
  const stage = state.stages.find((item) => item.id === fixture.stageId);
  const profile = state.ruleProfiles.find((item) => item.id === fixture.ruleProfileId);
  const canStart = state.lifecycle === 'live' && fixture.status === 'planned' && Boolean(fixture.resolvedEntryAId && fixture.resolvedEntryBId);
  return <article className={`tv1-desk-row ${fixture.status}`}><div><small>{stage?.name ?? 'Manual'}</small><strong>{fixture.label}</strong></div><div><strong>{sideLabel(state,fixture.resolvedEntryAId)}</strong><span>vs {sideLabel(state,fixture.resolvedEntryBId)}</span></div><select aria-label={`Court for ${fixture.label}`} disabled={fixture.status !== 'planned'} value={fixture.courtId ?? ''} onChange={(event) => void apply('assign-fixture',{fixtureId:fixture.id,courtId:event.target.value||null})}><option value="">Unassigned</option>{state.courts.map((court)=><option key={court.id} value={court.id}>{court.name}{court.available?'':' (closed)'}</option>)}</select><div className="tv1-plan-fields"><input aria-label={`Planned start for ${fixture.label}`} disabled={fixture.status !== 'planned'} type="datetime-local" value={fixture.plannedStartAt?.slice(0,16) ?? ''} onChange={(event)=>void apply('assign-fixture',{fixtureId:fixture.id,plannedStartAt:event.target.value||null})}/><label>Est. minutes<input aria-label={`Estimated duration for ${fixture.label}`} disabled={fixture.status !== 'planned'} type="number" min={1} max={480} value={fixture.durationOverrideMinutes ?? ''} onChange={(event)=>void apply('assign-fixture',{fixtureId:fixture.id,durationOverrideMinutes:event.target.value?Number(event.target.value):null})}/></label><button className="btn" disabled={fixture.status !== 'planned'} onClick={()=>void apply('assign-fixture',{fixtureId:fixture.id,pinned:!fixture.pinned})}>{fixture.pinned?'Unpin':'Pin'}</button></div><span className={`tv1-match-status ${fixture.status}`}>{fixture.status.replace('-',' ')}</span><div><strong>{fixture.result ? humanScore(fixture.result.score ?? fixture.result.reportedScore ?? null) || fixture.result.kind : fixture.liveScore ? humanScore(fixture.liveScore) : 'Blank'}</strong><small>{profile?.name}</small></div><div className="tv1-row-actions">{canStart&&<button className="btn primary" onClick={()=>void onStart(fixture)}>Start</button>}{fixture.status==='playing'&&<button className="btn" onClick={()=>void apply('suspend-match',{fixtureId:fixture.id})}>Suspend</button>}{fixture.status==='suspended'&&<><select aria-label={`Resume ${fixture.label} on court`} value={resumeCourt} onChange={(event)=>setResumeCourt(event.target.value)}><option value="">Choose court</option>{state.courts.filter((court)=>court.available).map((court)=><option key={court.id} value={court.id}>{court.name}</option>)}</select><button className="btn" disabled={!fixture.courtId} onClick={()=>void apply('release-court',{fixtureId:fixture.id})}>Release</button><button className="btn primary" disabled={!resumeCourt} onClick={()=>void apply('resume-match',{fixtureId:fixture.id,courtId:resumeCourt})}>Move / resume</button></>}{['planned','playing','suspended','completed'].includes(fixture.status)&&fixture.resolvedEntryAId&&fixture.resolvedEntryBId&&<button className="btn" onClick={()=>onScore(fixture)}>{fixture.status==='completed'?'Correct':'Score'}</button>}</div></article>;
}
