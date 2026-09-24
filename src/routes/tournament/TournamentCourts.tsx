import { useMemo, useState } from 'react';
import {
  createCourtClosureProposal,
  createReviewedScheduleProposal,
  entryLabel,
  humanScore,
  type CourtClosureAction,
  type CourtClosureProposal,
  type TournamentFixture,
  type TournamentScheduleProposal,
} from '@/logic/tournament';
import { useTournamentStore } from '@/store/tournamentStore';

type ClosureChoice = { action: CourtClosureAction['action']; targetCourtId?: string };

export function TournamentCourts() {
  const state = useTournamentStore((store) => store.active!.projected);
  const apply = useTournamentStore((store) => store.applyCommand);
  const [selected, setSelected] = useState<string[]>([]);
  const [destinationCourt, setDestinationCourt] = useState('');
  const [moveProposal, setMoveProposal] = useState<TournamentScheduleProposal | null>(null);
  const [orderProposal, setOrderProposal] = useState<string[] | null>(null);
  const [draggedId, setDraggedId] = useState('');
  const [closureCourtId, setClosureCourtId] = useState('');
  const [closureChoices, setClosureChoices] = useState<Record<string, ClosureChoice>>({});
  const [closureReason, setClosureReason] = useState('');
  const [closureProposal, setClosureProposal] = useState<CourtClosureProposal | null>(null);
  const [message, setMessage] = useState('');
  const planned = useMemo(() => state.fixtures.filter((fixture) => fixture.status === 'planned').sort((a,b) => a.queueOrder-b.queueOrder), [state.fixtures]);
  const closureCourt = state.courts.find((court) => court.id === closureCourtId);
  const closureFixtures = state.fixtures.filter((fixture) => fixture.courtId === closureCourtId && ['planned','playing','suspended'].includes(fixture.status));

  function toggleSelected(id: string) { setSelected((current) => current.includes(id) ? current.filter((item) => item !== id) : [...current,id]); }

  function previewMove() {
    try {
      if (!destinationCourt || !selected.length) throw new Error('Select at least one queued match and a destination court.');
      const suggestions = selected.map((fixtureId) => {
        const fixture = state.fixtures.find((item) => item.id === fixtureId);
        if (!fixture || fixture.status !== 'planned') throw new Error('Only planned matches can be moved in bulk.');
        return { fixtureId, courtId: destinationCourt, plannedStartAt: fixture.plannedStartAt, plannedEndAt: null, reason: 'Reviewed operator court move.', provisional: !fixture.resolvedEntryAId || !fixture.resolvedEntryBId };
      });
      setMoveProposal(createReviewedScheduleProposal(state,suggestions)); setMessage('Review the bulk court move before applying it.');
    } catch (error) { setMessage(error instanceof Error ? error.message : 'Could not preview move.'); }
  }

  function previewOrder(sourceId: string, targetId: string) {
    if (!sourceId || sourceId === targetId) return;
    const order = planned.map((fixture) => fixture.id);
    const source = order.indexOf(sourceId); const target = order.indexOf(targetId);
    if (source < 0 || target < 0) return;
    const [moved] = order.splice(source,1); order.splice(target,0,moved);
    setOrderProposal(order); setMessage('Review the new queue order before applying it.');
  }

  function openClosure(courtId: string) {
    const affected = state.fixtures.filter((fixture) => fixture.courtId === courtId && ['planned','playing','suspended'].includes(fixture.status));
    setClosureCourtId(courtId); setClosureReason(''); setClosureProposal(null);
    setClosureChoices(Object.fromEntries(affected.map((fixture) => [fixture.id, { action: fixture.status === 'playing' ? 'suspend-release' : fixture.status === 'suspended' ? 'release' : 'unassign' }])));
  }

  function reviewClosure() {
    try {
      if (!closureCourtId) throw new Error('Choose a court.');
      const actions: CourtClosureAction[] = closureFixtures.map((fixture) => {
        const choice = closureChoices[fixture.id];
        if (!choice) throw new Error(`Choose what happens to ${fixture.label}.`);
        if ((choice.action === 'reassign' || choice.action === 'move-resume') && !choice.targetCourtId) throw new Error(`Choose a destination for ${fixture.label}.`);
        return { fixtureId: fixture.id, action: choice.action, targetCourtId: choice.targetCourtId, reason: closureReason.trim() };
      });
      if (actions.some((action) => ['suspend-release','terminate'].includes(action.action)) && !closureReason.trim()) throw new Error('Enter the reason for interrupting the active match.');
      setClosureProposal(createCourtClosureProposal(state,closureCourtId,actions)); setMessage('Review every affected match, then apply the closure once.');
    } catch (error) { setMessage(error instanceof Error ? error.message : 'Could not review court closure.'); }
  }

  async function applyClosure() {
    if (!closureProposal) return;
    try { await apply('apply-court-closure',{proposal:closureProposal}); setClosureCourtId(''); setClosureProposal(null); setMessage('Reviewed court closure applied. Team capacity did not change.'); }
    catch (error) { setMessage(error instanceof Error ? error.message : 'Could not apply court closure.'); }
  }

  return <main className="tv1-main"><div className="tv1-page-head"><div><p className="eyebrow">COURT BOARD</p><h1>Playing, next and queued</h1><p>Drag or use Move for queue planning. Closing a court is always reviewed and never removes teams.</p></div></div>
    <section className="tv1-court-toolbar"><strong>{selected.length} selected</strong><select aria-label="Bulk move destination" value={destinationCourt} onChange={(event)=>setDestinationCourt(event.target.value)}><option value="">Move to court…</option>{state.courts.filter((court)=>court.available).map((court)=><option key={court.id} value={court.id}>{court.name}</option>)}</select><button className="btn" disabled={!selected.length||!destinationCourt} onClick={previewMove}>Review move</button>{selected.length>0&&<button className="btn" onClick={()=>setSelected([])}>Clear</button>}</section>
    {message&&<div className="tv1-alert" role="status">{message}</div>}
    {moveProposal&&<section className="tv1-proposal-review"><h2>Bulk move review</h2><p>{moveProposal.suggestions.length} match(es) move to {state.courts.find((court)=>court.id===destinationCourt)?.name}. Pinned assignments are included only because this is an explicit operator move.</p>{moveProposal.baseRevision!==state.revision&&<p className="tv1-warning">The tournament changed. Cancel and review again.</p>}<div className="tv1-dialog-actions"><button className="btn primary" disabled={moveProposal.baseRevision!==state.revision} onClick={()=>void apply('apply-schedule',{proposal:moveProposal,includePinned:true}).then(()=>{setMoveProposal(null);setSelected([]);setMessage('Bulk move applied as one command.');}).catch((error)=>setMessage(error.message))}>Apply move</button><button className="btn" onClick={()=>setMoveProposal(null)}>Cancel</button></div></section>}
    {orderProposal&&<section className="tv1-proposal-review"><h2>Queue order review</h2><ol>{orderProposal.map((id)=><li key={id}>{state.fixtures.find((fixture)=>fixture.id===id)?.label}</li>)}</ol><div className="tv1-dialog-actions"><button className="btn primary" onClick={()=>void apply('reorder-fixtures',{fixtureIds:orderProposal}).then(()=>{setOrderProposal(null);setMessage('Reviewed queue order applied.');}).catch((error)=>setMessage(error.message))}>Apply order</button><button className="btn" onClick={()=>setOrderProposal(null)}>Cancel</button></div></section>}
    <div className="tv1-court-board">{[...state.courts].sort((a,b)=>a.displayOrder-b.displayOrder).map((court)=>{
      const playing=state.fixtures.find((fixture)=>fixture.courtId===court.id&&(fixture.status==='playing'||fixture.status==='suspended'));
      const queue=planned.filter((fixture)=>fixture.courtId===court.id);
      return <section className={`tv1-court-card ${court.available?'':'closed'}`} key={court.id}><header><div><small>COURT</small><h2>{court.name}</h2>{court.availabilityWindows?.length ? <small>{court.availabilityWindows.map((window)=>`${window.startsAt.slice(11,16)}–${window.endsAt.slice(11,16)}`).join(', ')}</small>:<small>No availability window limit</small>}</div>{court.available?<button className="tv1-toggle on" onClick={()=>openClosure(court.id)}>Review closure</button>:<button className="tv1-toggle" onClick={()=>void apply('set-court-availability',{courtId:court.id,available:true})}>Reopen</button>}</header><ActiveMatch fixture={playing}/><div className="tv1-queue"><h3>Next</h3>{queue.length?queue.map((fixture,index)=><QueueRow key={fixture.id} fixture={fixture} index={index} selected={selected.includes(fixture.id)} onSelect={()=>toggleSelected(fixture.id)} onDragStart={()=>setDraggedId(fixture.id)} onDrop={()=>{previewOrder(draggedId,fixture.id);setDraggedId('');}}/>):<p>Nothing queued.</p>}</div></section>;
    })}</div>
    {closureCourtId&&<div className="tv1-dialog-backdrop"><section className="tv1-dialog" role="dialog" aria-modal="true" aria-labelledby="closure-title"><h2 id="closure-title">Close {closureCourt?.name}</h2><p>Capacity and registrations stay unchanged. Choose an explicit action for every assigned match.</p>{closureFixtures.length===0?<p>No matches are assigned; review and close the empty court.</p>:closureFixtures.map((fixture)=><article className="tv1-closure-row" key={fixture.id}><strong>{fixture.label} · {fixture.status}</strong><select aria-label={`Action for ${fixture.label}`} value={closureChoices[fixture.id]?.action??''} onChange={(event)=>setClosureChoices((current)=>({...current,[fixture.id]:{action:event.target.value as CourtClosureAction['action']}}))}>{fixture.status==='playing'?<><option value="suspend-release">Suspend and release</option><option value="terminate">Terminate match</option></>:fixture.status==='suspended'?<><option value="release">Release court</option><option value="keep-reserved">Keep reserved with warning</option><option value="move-resume">Move and resume</option></>:<><option value="unassign">Unassign from court</option><option value="keep-warning">Keep assignment with warning</option><option value="reassign">Reassign</option></>}</select>{['reassign','move-resume'].includes(closureChoices[fixture.id]?.action)&&<select aria-label={`Destination for ${fixture.label}`} value={closureChoices[fixture.id]?.targetCourtId??''} onChange={(event)=>setClosureChoices((current)=>({...current,[fixture.id]:{...current[fixture.id],targetCourtId:event.target.value}}))}><option value="">Destination…</option>{state.courts.filter((item)=>item.id!==closureCourtId&&item.available).map((item)=><option key={item.id} value={item.id}>{item.name}</option>)}</select>}</article>)}<label>Closure / interruption reason<textarea value={closureReason} maxLength={500} onChange={(event)=>{setClosureReason(event.target.value);setClosureProposal(null);}}/></label>{closureProposal&&<div className="tv1-correction-preview"><strong>Reviewed closure</strong><p>{closureProposal.actions.length} assigned match decision(s) · based on revision {closureProposal.baseRevision}</p>{closureProposal.baseRevision!==state.revision&&<p className="tv1-warning">Assignments changed. Cancel and review again.</p>}</div>}<div className="tv1-dialog-actions">{!closureProposal?<button className="btn primary" onClick={reviewClosure}>Review closure</button>:<button className="btn primary" disabled={closureProposal.baseRevision!==state.revision} onClick={()=>void applyClosure()}>Apply closure</button>}<button className="btn" onClick={()=>{setClosureCourtId('');setClosureProposal(null);}}>Cancel</button></div></section></div>}
  </main>;
}

function ActiveMatch({fixture}:{fixture:TournamentFixture|undefined}) {
  const state=useTournamentStore((store)=>store.active!.projected); const apply=useTournamentStore((store)=>store.applyCommand); const [resumeCourt,setResumeCourt]=useState(fixture?.courtId??'');
  if(!fixture)return <div className="tv1-playing"><small>AVAILABLE</small><p>No match is using this court.</p></div>;
  return <div className="tv1-playing"><small>{fixture.status.toUpperCase()}</small><strong>{entryLabel(state,fixture.actualEntryIds?.[0]??fixture.resolvedEntryAId!)}</strong><span>{fixture.liveScore?humanScore(fixture.liveScore):'Score blank'} vs</span><strong>{entryLabel(state,fixture.actualEntryIds?.[1]??fixture.resolvedEntryBId!)}</strong><label>Estimated release<input type="datetime-local" value={fixture.estimatedReleaseAt?.slice(0,16)??''} onChange={(event)=>void apply('set-match-estimate',{fixtureId:fixture.id,estimatedReleaseAt:event.target.value||null})}/></label><div className="tv1-court-actions">{fixture.status==='playing'?<button className="btn" onClick={()=>void apply('suspend-match',{fixtureId:fixture.id})}>Suspend</button>:<><select aria-label={`Move ${fixture.label}`} value={resumeCourt} onChange={(event)=>setResumeCourt(event.target.value)}><option value="">Choose court</option>{state.courts.filter((court)=>court.available).map((court)=><option key={court.id} value={court.id}>{court.name}</option>)}</select><button className="btn" disabled={!fixture.courtId} onClick={()=>void apply('release-court',{fixtureId:fixture.id})}>Release</button><button className="btn primary" disabled={!resumeCourt} onClick={()=>void apply('resume-match',{fixtureId:fixture.id,courtId:resumeCourt})}>Move / resume</button></>}</div></div>;
}

function QueueRow({fixture,index,selected,onSelect,onDragStart,onDrop}:{fixture:TournamentFixture;index:number;selected:boolean;onSelect:()=>void;onDragStart:()=>void;onDrop:()=>void}) {
  const state=useTournamentStore((store)=>store.active!.projected); const apply=useTournamentStore((store)=>store.applyCommand);
  return <article draggable onDragStart={onDragStart} onDragOver={(event)=>event.preventDefault()} onDrop={onDrop}><input aria-label={`Select ${fixture.label}`} type="checkbox" checked={selected} onChange={onSelect}/><span>{index+1}</span><div><strong>{fixture.resolvedEntryAId?entryLabel(state,fixture.resolvedEntryAId):'TBD'} vs {fixture.resolvedEntryBId?entryLabel(state,fixture.resolvedEntryBId):'TBD'}</strong><small>{fixture.label} · {fixture.plannedStartAt?new Date(fixture.plannedStartAt).toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'}):'time unscheduled'} · {fixture.durationOverrideMinutes??'default'} min {fixture.pinned?'· pinned':''}</small></div><button className="btn" onClick={()=>void apply('assign-fixture',{fixtureId:fixture.id,pinned:!fixture.pinned})}>{fixture.pinned?'Unpin':'Pin'}</button>{index===0&&state.lifecycle==='live'&&<button className="btn primary" disabled={!fixture.resolvedEntryAId||!fixture.resolvedEntryBId} onClick={()=>void apply('start-match',{fixtureId:fixture.id,courtId:fixture.courtId})}>Start</button>}</article>;
}
