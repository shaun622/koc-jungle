import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  entryLabel,
  type RuleProfile,
  type TournamentDrawProposal,
  type TournamentScheduleProposal,
} from '@/logic/tournament';
import { startTournamentPlanning, type TournamentPlanningJob } from '@/logic/tournament/planningClient';
import { tournamentIds, useTournamentStore } from '@/store/tournamentStore';
import { isoToZonedLocalInput, supportedTimeZones, zonedLocalCandidates, zonedLocalToIso, type ZonedTimeOccurrence } from '@/lib/eventTime';

export function TournamentSetup() {
  const record = useTournamentStore((state) => state.active)!;
  const apply = useTournamentStore((state) => state.applyCommand);
  const saveFormDraft = useTournamentStore((state) => state.saveFormDraft);
  const state = record.projected;
  const routeBase = record.mode === 'demo' ? '/tournament-demo' : '/tournaments';
  const detailsDraft = record.drafts.formByKey['setup-details'] as { title?: string; venue?: string; startsAt?: string; endsAt?: string; timeZone?: string } | undefined;
  const [divisionId, setDivisionId] = useState(state.divisions[0].id);
  const division = state.divisions.find((item) => item.id === divisionId) ?? state.divisions[0];
  const navigate = useNavigate();
  const [message, setMessage] = useState('');
  const [title, setTitle] = useState(detailsDraft?.title ?? state.meta.title);
  const [venue, setVenue] = useState(detailsDraft?.venue ?? state.meta.venue);
  const [startsAt, setStartsAt] = useState(detailsDraft?.startsAt ?? isoToZonedLocalInput(state.meta.startsAt, state.meta.timeZone));
  const [endsAt, setEndsAt] = useState(detailsDraft?.endsAt ?? isoToZonedLocalInput(state.meta.endsAt, state.meta.timeZone));
  const [timeZone, setTimeZone] = useState(detailsDraft?.timeZone ?? state.meta.timeZone);
  const timeZoneOptions = useMemo(() => Array.from(new Set([detailsDraft?.timeZone ?? state.meta.timeZone, ...supportedTimeZones()].filter(Boolean))).sort((a, b) => a === 'UTC' ? -1 : b === 'UTC' ? 1 : a.localeCompare(b)), [detailsDraft?.timeZone, state.meta.timeZone]);
  const [startOccurrence, setStartOccurrence] = useState<ZonedTimeOccurrence>('earlier');
  const [endOccurrence, setEndOccurrence] = useState<ZonedTimeOccurrence>('earlier');
  const [publishReview, setPublishReview] = useState(false);
  const [drawProposal, setDrawProposal] = useState<TournamentDrawProposal | null>(() => record.drafts.proposalByKey['setup-draw'] as TournamentDrawProposal | null ?? null);
  const [scheduleProposal, setScheduleProposal] = useState<TournamentScheduleProposal | null>(() => record.drafts.proposalByKey['setup-schedule'] as TournamentScheduleProposal | null ?? null);
  const [planningStatus,setPlanningStatus]=useState('');
  const planningJob=useRef<TournamentPlanningJob|null>(null);
  const [groupCount, setGroupCount] = useState('');
  const savedSeeding=record.drafts.formByKey['draw-seeding'] as {mode?:'entered'|'seeded'|'shuffle';order?:string[];seed?:string}|undefined;
  const [seedMode,setSeedMode]=useState<'entered'|'seeded'|'shuffle'>(savedSeeding?.mode??'entered');
  const [seedOrder,setSeedOrder]=useState<string[]>(savedSeeding?.order??[]);
  const [shuffleSeed,setShuffleSeed]=useState(savedSeeding?.seed??tournamentIds.stage());
  const [ruleName, setRuleName] = useState('Custom match');
  const [ruleFamily, setRuleFamily] = useState<RuleProfile['family']>('games');
  const [gamesToWin, setGamesToWin] = useState(5);
  const [gameMargin, setGameMargin] = useState<1 | 2>(1);
  const [useTiebreak, setUseTiebreak] = useState(false);
  const [tiebreakTarget, setTiebreakTarget] = useState(7);
  const [bestOfSets, setBestOfSets] = useState<1 | 3>(1);
  const [decidingTiebreak, setDecidingTiebreak] = useState<null | 7 | 10>(null);
  const [gameEnding, setGameEnding] = useState<RuleProfile['gameEnding']>('golden-point');
  const [estimatedMinutes, setEstimatedMinutes] = useState(20);
  const [restMinutes, setRestMinutes] = useState(10);
  const confirmed = state.entries.filter((entry) => entry.divisionId === division.id && entry.admission === 'confirmed');
  const effectiveSeedOrder=seedOrder.length===confirmed.length&&seedOrder.every((id)=>confirmed.some((entry)=>entry.id===id))?seedOrder:confirmed.map((entry)=>entry.id);
  const canGenerate = confirmed.length >= 2 && state.lifecycle === 'setup';
  const hasStarted = state.fixtures.some((fixture) => fixture.status !== 'planned' && fixture.status !== 'resolved-bye');
  const originalStartLocal = useMemo(() => isoToZonedLocalInput(state.meta.startsAt, state.meta.timeZone), [state.meta.startsAt, state.meta.timeZone]);
  const originalEndLocal = useMemo(() => isoToZonedLocalInput(state.meta.endsAt, state.meta.timeZone), [state.meta.endsAt, state.meta.timeZone]);
  const startRepeats = useMemo(() => {
    try { return Boolean(startsAt && timeZone.trim() && zonedLocalCandidates(startsAt, timeZone.trim()).length > 1); }
    catch { return false; }
  }, [startsAt, timeZone]);
  const endRepeats = useMemo(() => {
    try { return Boolean(endsAt && timeZone.trim() && zonedLocalCandidates(endsAt, timeZone.trim()).length > 1); }
    catch { return false; }
  }, [endsAt, timeZone]);
  const convertedTimes = () => {
    const start = timeZone === state.meta.timeZone && startsAt === originalStartLocal ? state.meta.startsAt : zonedLocalToIso(startsAt, timeZone.trim(), startOccurrence);
    const end = timeZone === state.meta.timeZone && endsAt === originalEndLocal ? state.meta.endsAt : zonedLocalToIso(endsAt, timeZone.trim(), endOccurrence);
    if (start && end && Date.parse(end) <= Date.parse(start)) throw new Error('End time must be after the start time.');
    return { start, end };
  };
  const persistDetails = (patch: Partial<{title:string;venue:string;startsAt:string;endsAt:string;timeZone:string}>) => void saveFormDraft('setup-details', { title, venue, startsAt, endsAt, timeZone, ...patch });
  useEffect(()=>()=>planningJob.current?.cancel(),[]);

  async function saveDetails() {
    try {
      const times = convertedTimes(); await apply('update-metadata', { patch: { title, venue, startsAt: times.start, endsAt: times.end, timeZone: timeZone.trim() } }); await saveFormDraft('setup-details', null); setMessage(record.mode === 'connected' ? 'Event details saved on this device and queued for sync.' : 'Event details saved in this local demo.');
    } catch (error) { setMessage(error instanceof Error ? error.message : 'Could not save details.'); }
  }
  async function addCourt() {
    await apply('add-court', { court: { id: tournamentIds.court(), name: `Court ${state.courts.length + 1}`, displayOrder: state.courts.length + 1, available: true, availabilityWindows: null } });
  }
  async function addDivision() {
    const division = { id: tournamentIds.stage().replace('stage-','division-'), name: `Division ${state.divisions.length + 1}`, capacity: 16, drawPublishedAt: null, automaticPromotion: true };
    await apply('add-division', { division });
    setDivisionId(division.id);
  }
  async function planSchedule() {
    try {
      planningJob.current?.cancel();
      const job=startTournamentPlanning({kind:'schedule',baseRevision:state.revision,state,startsAt:state.meta.startsAt??new Date().toISOString()},{onProgress:(_progress,status)=>setPlanningStatus(status)}); planningJob.current=job;
      const result=await job.promise; if(result.kind!=='schedule')throw new Error('Planner returned the wrong result.'); const proposal=result.proposal;
      if(useTournamentStore.getState().active?.projected.revision!==proposal.baseRevision)throw new Error('Tournament changed while planning. Generate a fresh schedule for review.');
      setScheduleProposal(proposal); await useTournamentStore.getState().saveProposalDraft('setup-schedule',proposal);
      setPlanningStatus(''); planningJob.current=null;
      setMessage(`Review ${proposal.suggestions.length} schedule suggestions before applying.`);
    } catch (error) { setMessage(error instanceof Error ? error.message : 'Could not estimate the schedule.'); }
  }
  async function generateGroups() {
    try {
      const stageId = tournamentIds.stage();
      const requestedGroups = groupCount ? Number(groupCount) : Math.ceil(confirmed.length / 4);
      planningJob.current?.cancel(); const job=startTournamentPlanning({kind:'group-draw',baseRevision:state.revision,state,divisionId:division.id,stageId,entryIds:confirmed.map((entry)=>entry.id),groupCount:requestedGroups,order:state.stages.length+1,seedMode,seedOrder:effectiveSeedOrder,shuffleSeed:seedMode==='shuffle'?shuffleSeed:null},{onProgress:(_progress,status)=>setPlanningStatus(status)}); planningJob.current=job;
      const result=await job.promise;if(result.kind!=='draw')throw new Error('Planner returned the wrong result.');const proposal=result.proposal;
      if(useTournamentStore.getState().active?.projected.revision!==proposal.baseRevision)throw new Error('Tournament changed while planning. Generate a fresh draw for review.');
      setDrawProposal(proposal);await useTournamentStore.getState().saveProposalDraft('setup-draw',proposal);setPlanningStatus('');planningJob.current=null;
      setMessage(`Review ${proposal.fixtures.length} proposed group matches before applying.`);
    } catch (error) { setMessage(error instanceof Error ? error.message : 'Could not generate groups.'); }
  }
  async function addCustomRule() {
    try {
      const profile: RuleProfile = {
        id: tournamentIds.rule(), version: 1, name: ruleName.trim(), family: ruleFamily,
        bestOfSets: ruleFamily === 'games' ? 1 : bestOfSets, gamesToWin, gameMargin,
        tiebreakTrigger: useTiebreak ? (gameMargin === 1 ? gamesToWin - 1 : gamesToWin) : null,
        tiebreakTarget: useTiebreak ? tiebreakTarget : null,
        decidingMatchTiebreak: ruleFamily === 'sets' && bestOfSets === 3 ? decidingTiebreak : null,
        gameEnding, estimatedMinutes, restMinutes,
      };
      await apply('add-rule-profile', { profile });
      setMessage(`${profile.name} added as a versioned rule. Assign it to unstarted matches from Draw.`);
    } catch (error) { setMessage(error instanceof Error ? error.message : 'Could not add rule.'); }
  }
  async function generateKnockout() {
    try {
      const stageId = tournamentIds.stage();
      planningJob.current?.cancel();const job=startTournamentPlanning({kind:'knockout-draw',baseRevision:state.revision,state,divisionId:division.id,stageId,entryIds:confirmed.map((entry)=>entry.id),order:state.stages.length+1,seedMode,seedOrder:effectiveSeedOrder,shuffleSeed:seedMode==='shuffle'?shuffleSeed:null},{onProgress:(_progress,status)=>setPlanningStatus(status)});planningJob.current=job;
      const result=await job.promise;if(result.kind!=='draw')throw new Error('Planner returned the wrong result.');const proposal=result.proposal;
      if(useTournamentStore.getState().active?.projected.revision!==proposal.baseRevision)throw new Error('Tournament changed while planning. Generate a fresh draw for review.');
      setDrawProposal(proposal);await useTournamentStore.getState().saveProposalDraft('setup-draw',proposal);setPlanningStatus('');planningJob.current=null;
      setMessage(`Review the ${proposal.fixtures.length}-match knockout proposal and structural byes before applying.`);
    } catch (error) { setMessage(error instanceof Error ? error.message : 'Could not generate knockout.'); }
  }
  async function publishLocal() {
    try {
      const slug = `${title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'tournament'}-${state.id.slice(-6)}`;
      const times = convertedTimes(); await apply('update-metadata', { patch: { publicSlug: slug, signupOpen: true, title, venue, startsAt: times.start, endsAt: times.end, timeZone: timeZone.trim() } });
      setPublishReview(false); setMessage(record.mode === 'connected' ? 'Sign-up publication queued for server confirmation.' : 'Local demo sign-up preview published.');
    } catch (error) { setMessage(error instanceof Error ? error.message : 'Could not publish preview.'); }
  }

  return <main className="tv1-main">
    <section className="tv1-hero"><div><p className="eyebrow">TOURNAMENT SETUP</p><h1>Build the plan. Keep every match editable.</h1><p>Capacity is independent of courts. Nothing here changes KoC or Americano events.</p></div><button className="btn primary" onClick={() => navigate(`${routeBase}/${state.id}/desk`)}>Open control desk →</button></section>
    {message && <div className="tv1-alert" role="status">{message}</div>}{planningStatus&&<div className="tv1-alert" role="status">{planningStatus}<button className="btn" onClick={()=>{planningJob.current?.cancel();planningJob.current=null;setPlanningStatus('');}}>Cancel planning</button></div>}
    <div className="tv1-setup-grid">
      <section className="tv1-panel"><h2>Event details</h2><label>Title<input value={title} maxLength={80} onChange={(event) => {setTitle(event.target.value);persistDetails({title:event.target.value});}}/></label><label>Venue<input value={venue} maxLength={80} onChange={(event) => {setVenue(event.target.value);persistDetails({venue:event.target.value});}}/></label><label>Starts<input type="datetime-local" value={startsAt} onChange={(event) => {setStartsAt(event.target.value);persistDetails({startsAt:event.target.value});}}/></label>{startRepeats&&<label>When the clocks repeat<select value={startOccurrence} onChange={(event)=>setStartOccurrence(event.target.value as ZonedTimeOccurrence)}><option value="earlier">Use the first occurrence</option><option value="later">Use the second occurrence</option></select><small>This time happens twice because daylight-saving clocks move backward.</small></label>}<label>Ends<input type="datetime-local" value={endsAt} onChange={(event) => {setEndsAt(event.target.value);persistDetails({endsAt:event.target.value});}}/></label>{endRepeats&&<label>When the clocks repeat<select value={endOccurrence} onChange={(event)=>setEndOccurrence(event.target.value as ZonedTimeOccurrence)}><option value="earlier">Use the first occurrence</option><option value="later">Use the second occurrence</option></select><small>This time happens twice because daylight-saving clocks move backward.</small></label>}<label>Event time zone<select value={timeZone} required onChange={(event) => {setTimeZone(event.target.value);persistDetails({timeZone:event.target.value});}}>{timeZoneOptions.map((zone)=><option key={zone} value={zone}>{zone.replaceAll('_',' ')}</option>)}</select><small>Used for schedules, public pages and exports.</small></label><button className="btn primary" disabled={!title.trim() || !timeZone.trim()} onClick={() => void saveDetails()}>Save details</button></section>
      <section className="tv1-panel"><div className="tv1-panel-head"><div><h2>Division & capacity</h2><p>{confirmed.length} confirmed · {state.entries.filter((entry) => entry.admission === 'waiting').length} waiting</p></div></div><label>Division name<input value={division.name} readOnly/></label><label>Entry places<input type="number" min={confirmed.length} max={64} value={division.capacity} onChange={(event) => void apply('update-capacity', { divisionId: division.id, capacity: Number(event.target.value) }).catch((error)=>setMessage(error.message))}/></label><p className="tv1-note">Closing a court never changes this limit.</p><button className="btn" onClick={() => navigate(`${routeBase}/${state.id}/entries`)}>Manage entries →</button></section>
      <section className="tv1-panel"><div className="tv1-panel-head"><div><h2>Courts</h2><p>{state.courts.filter((court) => court.available).length} available of {state.courts.length}</p></div><button className="btn" disabled={state.courts.length >= 16} onClick={() => void addCourt()}>+ Add court</button></div>{state.courts.map((court) => <div className="tv1-court-row" key={court.id}><input aria-label={`${court.name} name`} value={court.name} onChange={(event) => void apply('update-court', { courtId: court.id, name: event.target.value }).catch(() => undefined)}/><button className={`tv1-toggle ${court.available ? 'on' : ''}`} onClick={() => court.available ? navigate(`${routeBase}/${state.id}/courts`) : void apply('set-court-availability', { courtId: court.id, available: true }).catch((error) => setMessage(error.message))}>{court.available ? 'Close court…' : 'Closed · reopen'}</button></div>)}</section>
      <section className="tv1-panel"><h2>Draw builder</h2><p>Generate a reviewable starting point, then move matches, teams and courts from the desk.</p><label>Entry order<select value={seedMode} onChange={(event)=>{const mode=event.target.value as typeof seedMode;setSeedMode(mode);setSeedOrder(confirmed.map((entry)=>entry.id));void saveFormDraft('draw-seeding',{mode,order:confirmed.map((entry)=>entry.id),seed:shuffleSeed});}}><option value="entered">Entered order</option><option value="seeded">Manual seeded order</option><option value="shuffle">Stable shuffled order</option></select></label>{seedMode==='seeded'&&<div className="tv1-seed-order">{effectiveSeedOrder.map((entryId,index)=><div key={entryId}><span>{index+1}. {entryLabel(state,entryId)}</span><button className="btn" disabled={index===0} onClick={()=>{const order=[...effectiveSeedOrder];[order[index-1],order[index]]=[order[index],order[index-1]];setSeedOrder(order);void saveFormDraft('draw-seeding',{mode:seedMode,order,seed:shuffleSeed});}}>↑</button><button className="btn" disabled={index===effectiveSeedOrder.length-1} onClick={()=>{const order=[...effectiveSeedOrder];[order[index+1],order[index]]=[order[index],order[index+1]];setSeedOrder(order);void saveFormDraft('draw-seeding',{mode:seedMode,order,seed:shuffleSeed});}}>↓</button></div>)}</div>}{seedMode==='shuffle'&&<label>Stable shuffle seed<input value={shuffleSeed} maxLength={160} onChange={(event)=>{setShuffleSeed(event.target.value);void saveFormDraft('draw-seeding',{mode:seedMode,order:effectiveSeedOrder,seed:event.target.value});}}/><small>The same seed produces the same entry order after reload.</small></label>}<label>Round-robin group count<input type="number" min={1} max={Math.max(1, Math.floor(confirmed.length / 2))} value={groupCount} placeholder={`Auto (${Math.max(1, Math.ceil(confirmed.length / 4))})`} onChange={(event) => setGroupCount(event.target.value)}/></label><div className="tv1-template-actions"><button className="btn primary" disabled={!canGenerate || hasStarted} onClick={() => void generateGroups()}>Preview round-robin groups</button><button className="btn" disabled={!canGenerate || hasStarted} onClick={() => void generateKnockout()}>Preview knockout</button></div>{drawProposal && <div className="tv1-alert"><strong>{drawProposal.stage.name}</strong><p>{drawProposal.groups.length} groups · {drawProposal.fixtures.length} fixtures · {drawProposal.stage.seedMode} order · based on revision {drawProposal.baseRevision}</p>{drawProposal.baseRevision!==state.revision && <p className="tv1-warning">Tournament changed. Cancel and generate a fresh preview.</p>}<div className="tv1-template-actions"><button className="btn primary" disabled={drawProposal.baseRevision!==state.revision} onClick={() => void apply('apply-draw-proposal',{proposal:drawProposal}).then(async()=>{setDrawProposal(null);await useTournamentStore.getState().saveProposalDraft('setup-draw',null);setMessage('Reviewed draw applied atomically.');}).catch((error)=>setMessage(error.message))}>Apply reviewed draw</button><button className="btn" onClick={() => {setDrawProposal(null);void useTournamentStore.getState().saveProposalDraft('setup-draw',null);}}>Cancel</button></div></div>}<p className="tv1-note">Manual fixtures, Gold/Silver and plate links remain available from Draw.</p><div className="tv1-template-actions"><button className="btn" onClick={() => navigate(`${routeBase}/${state.id}/draw`)}>Review draw →</button>{state.fixtures.some((fixture) => fixture.divisionId === division.id) && !division.drawPublishedAt && <button className="btn" onClick={() => void apply('publish-draw', { divisionId: division.id }).then(() => setMessage('Draw published. Future open places now require explicit promotion and placement.')).catch((error) => setMessage(error.message))}>Publish draw</button>}{division.drawPublishedAt && <span className="tv1-chip">Draw published</span>}</div></section>
      <section className="tv1-panel"><div className="tv1-panel-head"><div><h2>Divisions</h2><p>Up to four independent capacities share this court pool.</p></div><button className="btn" disabled={state.divisions.length >= 4} onClick={() => void addDivision()}>+ Add division</button></div><label>Working division<select value={division.id} onChange={(event) => setDivisionId(event.target.value)}>{state.divisions.map((item) => <option value={item.id} key={item.id}>{item.name}</option>)}</select></label>{state.divisions.map((item) => <div className="tv1-court-row" key={item.id}><input aria-label={`${item.name} name`} value={item.name} onChange={(event) => void apply('update-division',{divisionId:item.id,name:event.target.value}).catch(() => undefined)}/><input aria-label={`${item.name} capacity`} type="number" min={state.entries.filter((entry) => entry.divisionId === item.id && entry.admission === 'confirmed').length} max={64} value={item.capacity} onChange={(event) => void apply('update-capacity',{divisionId:item.id,capacity:Number(event.target.value)}).catch(() => undefined)}/></div>)}</section>
      <section className="tv1-panel"><h2>Schedule estimate</h2><p>Uses court availability, match duration and player rest. It is a suggestion, never a locked global round.</p><button className="btn" disabled={!state.fixtures.length} onClick={() => void planSchedule()}>Preview courts & times</button>{scheduleProposal && <div className="tv1-alert"><p>{scheduleProposal.suggestions.filter((item)=>item.courtId).length} assigned · {scheduleProposal.suggestions.filter((item)=>!item.courtId).length} unscheduled · revision {scheduleProposal.baseRevision}</p><div className="tv1-template-actions"><button className="btn primary" disabled={scheduleProposal.baseRevision!==state.revision} onClick={()=>void apply('apply-schedule',{proposal:scheduleProposal}).then(async()=>{setScheduleProposal(null);await useTournamentStore.getState().saveProposalDraft('setup-schedule',null);setMessage('Reviewed schedule applied.');}).catch((error)=>setMessage(error.message))}>Apply schedule</button><button className="btn" onClick={()=>{setScheduleProposal(null);void useTournamentStore.getState().saveProposalDraft('setup-schedule',null);}}>Cancel</button></div></div>}</section>
      <section className="tv1-panel"><h2>Custom match rule</h2><p>Create an explicit versioned rule. Existing or started matches are never reinterpreted.</p><label>Rule name<input value={ruleName} maxLength={80} onChange={(event) => setRuleName(event.target.value)}/></label><div className="tv1-inline-edit"><label>Format<select value={ruleFamily} onChange={(event) => setRuleFamily(event.target.value as RuleProfile['family'])}><option value="games">Game-score match</option><option value="sets">Set match</option></select></label><label>Games to win<input type="number" min={1} max={99} value={gamesToWin} onChange={(event) => setGamesToWin(Number(event.target.value))}/></label><label>Required margin<select value={gameMargin} onChange={(event) => setGameMargin(Number(event.target.value) as 1 | 2)}><option value={1}>One game</option><option value={2}>Two games</option></select></label></div>{ruleFamily === 'sets' && <div className="tv1-inline-edit"><label>Best of<select value={bestOfSets} onChange={(event) => setBestOfSets(Number(event.target.value) as 1 | 3)}><option value={1}>One set</option><option value={3}>Three sets</option></select></label><label>Deciding match tiebreak<select disabled={bestOfSets === 1} value={decidingTiebreak ?? ''} onChange={(event) => setDecidingTiebreak(event.target.value ? Number(event.target.value) as 7 | 10 : null)}><option value="">Full deciding set</option><option value={7}>To 7</option><option value={10}>To 10</option></select></label></div>}<label className="tv1-private-check"><input type="checkbox" checked={useTiebreak} onChange={(event) => setUseTiebreak(event.target.checked)}/> Use tiebreak at {gameMargin === 1 ? gamesToWin - 1 : gamesToWin}–{gameMargin === 1 ? gamesToWin - 1 : gamesToWin}</label>{useTiebreak && <label>Tiebreak target<input type="number" min={1} max={99} value={tiebreakTarget} onChange={(event) => setTiebreakTarget(Number(event.target.value))}/></label>}<div className="tv1-inline-edit"><label>Game ending<select value={gameEnding} onChange={(event) => setGameEnding(event.target.value as RuleProfile['gameEnding'])}><option value="advantage">Advantage</option><option value="golden-point">Golden point</option><option value="star-point">Star Point</option></select></label><label>Estimated minutes<input type="number" min={1} max={240} value={estimatedMinutes} onChange={(event) => setEstimatedMinutes(Number(event.target.value))}/></label><label>Rest minutes<input type="number" min={0} max={240} value={restMinutes} onChange={(event) => setRestMinutes(Number(event.target.value))}/></label></div><button className="btn" disabled={!ruleName.trim()} onClick={() => void addCustomRule()}>Add versioned rule</button></section>
    </div>
    <section className="tv1-panel tv1-publish"><div><h2>Public sign-up</h2><p>Anonymous pairs enter two player names, an optional team name and a private contact.</p></div><button className="btn primary" disabled={!startsAt || !title.trim()} onClick={() => setPublishReview(true)}>{state.meta.publicSlug ? 'Review sign-up update' : 'Review and publish sign-up'}</button>{state.meta.publicSlug && <a className="btn" href={`#/t/${state.meta.publicSlug}/signup`}>Open sign-up</a>}{publishReview && <div className="tv1-alert"><strong>Review capacity before publishing</strong>{state.divisions.map((item)=><p key={item.id}>{item.name}: {state.entries.filter((entry)=>entry.divisionId===item.id&&entry.admission==='confirmed').length}/{item.capacity} confirmed · {state.entries.filter((entry)=>entry.divisionId===item.id&&entry.admission==='waiting').length} waiting</p>)}<div className="tv1-template-actions"><button className="btn primary" onClick={() => void publishLocal()}>Apply publication</button><button className="btn" onClick={()=>setPublishReview(false)}>Cancel</button></div></div>}</section>
  </main>;
}
