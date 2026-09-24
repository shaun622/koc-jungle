import { useEffect, useState } from 'react';
import {
  computeGroupStandings,
  createDrawProposal,
  createGroupAmendmentProposal,
  entryLabel,
  firstPlayedLossEligibility,
  generateKnockoutFixtures,
  goldSilverSources,
  humanScore,
  makeFixture,
  stagePlanningDefaults,
  type TournamentStage,
  type TournamentDrawProposal,
  type TournamentGroupAmendmentProposal,
} from '@/logic/tournament';
import { tournamentIds, useTournamentStore } from '@/store/tournamentStore';

export function TournamentDraw() {
  const state = useTournamentStore((store) => store.active!.projected);
  return <main className="tv1-main"><div className="tv1-page-head"><div><p className="eyebrow">STRUCTURE & QUALIFICATION</p><h1>Draw</h1><p>Sources stay separate from resolved entrants. Missing results never become byes.</p></div></div>
    <ManualFixtureBuilder/>
    {!state.stages.length ? <section className="tv1-empty"><h2>No draw generated</h2><p>Create a manual match here, or choose groups or knockout in Setup.</p></section> : state.stages.map((stage) => <StageCard key={stage.id} stageId={stage.id}/>) }
  </main>;
}

function ManualFixtureBuilder() {
  const state = useTournamentStore((store) => store.active!.projected);
  const apply = useTournamentStore((store) => store.applyCommand);
  const entries = state.entries.filter((entry) => entry.admission === 'confirmed');
  const [entryA, setEntryA] = useState(entries[0]?.id ?? '');
  const [entryB, setEntryB] = useState(entries[1]?.id ?? '');
  const [message, setMessage] = useState('');
  const [proposal, setProposal] = useState<TournamentDrawProposal | null>(null);
  async function add() {
    try {
      if (!entryA || !entryB || entryA === entryB) throw new Error('Choose two different entries.');
      const divisionId = state.entries.find((entry) => entry.id === entryA)!.divisionId;
      if (state.entries.find((entry) => entry.id === entryB)!.divisionId !== divisionId) throw new Error('A match cannot cross divisions.');
      let stage = state.stages.find((item) => item.kind === 'manual' && item.divisionId === divisionId && state.fixtures.filter((fixture)=>fixture.stageId===item.id).every((fixture)=>fixture.status==='planned'||fixture.status==='resolved-bye'));
      if (!stage) {
        stage = { id: tournamentIds.stage(), divisionId, name: 'Manual matches', kind: 'manual', order: state.stages.length + 1, entryIds: [], groupIds: [], defaultRuleProfileId: 'first-to-five', qualificationConfirmedAt: null, qualificationFingerprint: null, amended: false, closedAt: null, ...stagePlanningDefaults() };
      }
      const selectedStage = stage;
      const fixture = makeFixture({ id: tournamentIds.fixture(), divisionId, stageId: selectedStage.id, label: `Manual ${state.fixtures.filter((item) => item.stageId === selectedStage.id).length + 1}`, sideA: { kind: 'entry', entryId: entryA }, sideB: { kind: 'entry', entryId: entryB }, ruleProfileId: selectedStage.defaultRuleProfileId, queueOrder: state.fixtures.length + 1 });
      const fixtures=[...state.fixtures.filter((item)=>item.stageId===selectedStage.id),fixture];
      const nextStage={...selectedStage,entryIds:[...new Set([...selectedStage.entryIds,entryA,entryB])]};
      setProposal(createDrawProposal({baseRevision:state.revision,stage:nextStage,groups:[],fixtures})); setMessage('Review the manual match before applying it.');
    } catch (error) { setMessage(error instanceof Error ? error.message : 'Could not add match.'); }
  }
  return <section className="tv1-panel tv1-manual-builder"><div><h2>Add a manual match</h2><p>Useful when teams arrive late or the day stops matching the original plan.</p></div><select aria-label="Side A" value={entryA} onChange={(event) => setEntryA(event.target.value)}><option value="">Side A</option>{entries.map((entry) => <option key={entry.id} value={entry.id}>{entryLabel(state,entry.id)}</option>)}</select><select aria-label="Side B" value={entryB} onChange={(event) => setEntryB(event.target.value)}><option value="">Side B</option>{entries.map((entry) => <option key={entry.id} value={entry.id}>{entryLabel(state,entry.id)}</option>)}</select><button className="btn" onClick={() => void add()}>Preview match</button>{proposal && <div className="tv1-alert"><strong>{proposal.fixtures.at(-1)?.label}</strong><span>{entryLabel(state,entryA)} vs {entryLabel(state,entryB)}</span><button className="btn primary" disabled={proposal.baseRevision!==state.revision} onClick={()=>void apply('apply-draw-proposal',{proposal}).then(()=>{setProposal(null);setMessage('Manual match applied.');}).catch((error)=>setMessage(error.message))}>Apply match</button><button className="btn" onClick={()=>setProposal(null)}>Cancel</button></div>}{message && <span>{message}</span>}</section>;
}

function StageCard({ stageId }: { stageId: string }) {
  const state = useTournamentStore((store) => store.active!.projected);
  const apply = useTournamentStore((store) => store.applyCommand);
  const stage = state.stages.find((item) => item.id === stageId)!;
  const fixtures = state.fixtures.filter((fixture) => fixture.stageId === stage.id);
  const [message, setMessage] = useState('');
  const [manualReason, setManualReason] = useState('');
  const [manualOrders, setManualOrders] = useState<Record<string, string[]>>(() => Object.fromEntries(stage.groupIds.map((groupId) => [groupId, computeGroupStandings(state, groupId).rows.map((row) => row.entryId)])));
  const [qualificationPreview, setQualificationPreview] = useState(false);
  const [drawProposals, setDrawProposals] = useState<TournamentDrawProposal[] | null>(null);
  const eligibleAmendmentEntries = state.entries.filter((entry) => entry.divisionId === stage.divisionId && entry.admission === 'confirmed' && !stage.entryIds.includes(entry.id));
  const [amendmentEntryId, setAmendmentEntryId] = useState('');
  const [amendmentGroupId, setAmendmentGroupId] = useState(stage.groupIds[0] ?? '');
  const [amendmentReason, setAmendmentReason] = useState('');
  const [amendmentProposal, setAmendmentProposal] = useState<TournamentGroupAmendmentProposal | null>(null);
  useEffect(() => {
    setManualOrders(Object.fromEntries(stage.groupIds.map((groupId) => [groupId, computeGroupStandings(state, groupId).rows.map((row) => row.entryId)])));
  }, [state.revision, stage.id]);
  async function confirmQualifiers() {
    try {
      const orderedByGroup = Object.fromEntries(stage.groupIds.map((groupId) => [groupId, computeGroupStandings(state,groupId).rows.map((row) => row.entryId)]));
      await apply('confirm-qualifiers', { stageId: stage.id, policy: { winPoints: 2, lossPoints: 0, includeSetDifference: false }, manual: false, orderedByGroup, decisionId: tournamentIds.decision() });
      setMessage('Qualifiers confirmed from the reviewed standings.');
    } catch (error) { setMessage(error instanceof Error ? error.message : 'Could not confirm qualifiers.'); }
  }
  async function confirmManualQualifiers() {
    try {
      await apply('confirm-qualifiers', { stageId: stage.id, policy: { winPoints: 2, lossPoints: 0, includeSetDifference: false }, manual: true, reason: manualReason, orderedByGroup: manualOrders, decisionId: tournamentIds.decision() });
      setMessage('Manual qualifier order confirmed with an audited reason.');
    } catch (error) { setMessage(error instanceof Error ? error.message : 'Could not confirm manual order.'); }
  }
  async function makeGoldSilver() {
    try {
      if (!stage.qualificationConfirmedAt) throw new Error('Confirm group qualifiers first.');
      const sources = goldSilverSources(stage.groupIds);
      const proposals:TournamentDrawProposal[]=[];
      for (const [name, band] of [['Gold',sources.gold],['Silver',sources.silver]] as const) {
        const stageId = tournamentIds.stage();
        const nextStage: TournamentStage = { id: stageId, divisionId: stage.divisionId, name: `${name} knockout`, kind: 'knockout', order: state.stages.length + (name === 'Gold' ? 1 : 2), entryIds: [], groupIds: [], defaultRuleProfileId: 'standard-set', qualificationConfirmedAt: null, qualificationFingerprint: null, amended: false, closedAt: null, ...stagePlanningDefaults() };
        const generated = generateKnockoutFixtures({ divisionId: stage.divisionId, stageId, sources: band, ruleProfileId: 'standard-set', finalRuleProfileId: 'best-of-three', id: () => tournamentIds.fixture() });
        proposals.push(createDrawProposal({baseRevision:state.revision,stage:nextStage,groups:[],fixtures:generated}));
      }
      setDrawProposals(proposals); setMessage('Review the Gold and Silver knockout bundle before applying it.');
    } catch (error) { setMessage(error instanceof Error ? error.message : 'Could not create Gold/Silver draws.'); }
  }
  async function makePlate() {
    try {
      if (state.stages.some((item) => item.kind === 'plate' && item.name === `${stage.name} plate`)) throw new Error('This plate has already been created.');
      const eligibility = firstPlayedLossEligibility(state, stage.id);
      if (eligibility.unresolved.length) throw new Error(`${eligibility.unresolved.length} entries still need a first played result or an explicit eligibility ruling.`);
      const plateStageId = tournamentIds.stage();
      const plateStage: TournamentStage = { id: plateStageId, divisionId: stage.divisionId, name: `${stage.name} plate`, kind: 'plate', order: state.stages.length + 1, entryIds: eligibility.eligible, groupIds: [], defaultRuleProfileId: 'standard-set', qualificationConfirmedAt: null, qualificationFingerprint: null, amended: false, closedAt: eligibility.eligible.length <= 1 ? Date.now() : null, ...stagePlanningDefaults(), plateSourceStageId: stage.id };
      let generated=[] as ReturnType<typeof generateKnockoutFixtures>;
      if (eligibility.eligible.length > 1) {
        generated = generateKnockoutFixtures({ divisionId: stage.divisionId, stageId: plateStageId, sources: eligibility.eligible.map((entryId) => ({ kind: 'entry' as const, entryId })), ruleProfileId: 'standard-set', id: () => tournamentIds.fixture() });
      }
      setDrawProposals([createDrawProposal({baseRevision:state.revision,stage:plateStage,groups:[],fixtures:generated})]);
      setMessage(eligibility.eligible.length > 1 ? `Review the plate for ${eligibility.eligible.length} eligible entries.` : eligibility.eligible.length === 1 ? 'Review the one-entry structural plate; no fake match will be created.' : 'Review the empty closed plate.');
    } catch (error) { setMessage(error instanceof Error ? error.message : 'Could not create plate.'); }
  }
  function previewAmendment() {
    try {
      if (!amendmentEntryId || !amendmentGroupId) throw new Error('Choose a confirmed entry and destination group.');
      if (!amendmentReason.trim()) throw new Error('Enter the audited reason for changing the started group.');
      setAmendmentProposal(createGroupAmendmentProposal(state, stage.id, amendmentGroupId, amendmentEntryId, () => tournamentIds.fixture()));
      setMessage('Review the group amendment. Existing results and fixtures will not be changed.');
    } catch (error) { setMessage(error instanceof Error ? error.message : 'Could not prepare the group amendment.'); }
  }
  async function applyAmendment() {
    if (!amendmentProposal) return;
    try {
      await apply('apply-group-amendment', { proposal: amendmentProposal }, amendmentReason);
      setAmendmentProposal(null); setAmendmentEntryId(''); setAmendmentReason('');
      setMessage('Group amended. Existing history was preserved; review and manually reconfirm qualification after the new matches finish.');
    } catch (error) { setMessage(error instanceof Error ? error.message : 'Could not apply the group amendment.'); }
  }
  function moveManual(groupId: string, index: number, direction: -1 | 1) {
    setManualOrders((current) => {
      const order = [...(current[groupId] ?? [])]; const target = index + direction;
      if (target < 0 || target >= order.length) return current;
      [order[index], order[target]] = [order[target], order[index]];
      return { ...current, [groupId]: order };
    });
  }
  return <section className="tv1-panel"><div className="tv1-panel-head"><div><h2>{stage.name}</h2><p>{stage.kind} · {fixtures.length} matches{stage.amended ? ' · amended' : ''}</p></div><div className="tv1-template-actions">{stage.groupIds.length > 0 && !stage.qualificationConfirmedAt && <button className="btn" onClick={() => setQualificationPreview(true)}>Review qualifiers</button>}{stage.groupIds.length > 0 && <button className="btn" disabled={!stage.qualificationConfirmedAt} onClick={() => void makeGoldSilver()}>Preview Gold & Silver</button>}{stage.kind === 'knockout' && <button className="btn" onClick={() => void makePlate()}>Preview first-loss plate</button>}{stage.qualificationConfirmedAt && <span className="tv1-chip">Qualifiers confirmed</span>}</div></div>{message && <div className="tv1-alert">{message}</div>}{qualificationPreview && <div className="tv1-alert"><strong>Review destination order</strong>{stage.groupIds.map((groupId)=><p key={groupId}>{state.groups.find((group)=>group.id===groupId)?.name}: {computeGroupStandings(state,groupId).rows.map((row)=>entryLabel(state,row.entryId)).join(', ')}</p>)}<button className="btn primary" onClick={()=>void confirmQualifiers().then(()=>setQualificationPreview(false))}>Apply qualification</button><button className="btn" onClick={()=>setQualificationPreview(false)}>Cancel</button></div>}{drawProposals && <div className="tv1-alert"><strong>Review draw bundle</strong>{drawProposals.map((proposal)=><p key={proposal.stage.id}>{proposal.stage.name}: {proposal.fixtures.length} fixtures</p>)}<button className="btn primary" disabled={drawProposals.some((proposal)=>proposal.baseRevision!==state.revision)} onClick={()=>void apply('apply-draw-bundle',{proposals:drawProposals}).then(()=>{setDrawProposals(null);setMessage('Reviewed draw bundle applied atomically.');}).catch((error)=>setMessage(error.message))}>Apply bundle</button><button className="btn" onClick={()=>setDrawProposals(null)}>Cancel</button></div>}{stage.groupIds.length > 0 && <details className="tv1-manual-qualifiers"><summary>Add a late confirmed entry to a group</summary><p>This adds one future match against every existing group entry. Played history is never regenerated.</p>{eligibleAmendmentEntries.length ? <><div className="tv1-template-actions"><select aria-label="Late entry" value={amendmentEntryId} onChange={(event)=>{setAmendmentEntryId(event.target.value);setAmendmentProposal(null);}}><option value="">Choose entry</option>{eligibleAmendmentEntries.map((entry)=><option key={entry.id} value={entry.id}>{entryLabel(state,entry.id)}</option>)}</select><select aria-label="Destination group" value={amendmentGroupId} onChange={(event)=>{setAmendmentGroupId(event.target.value);setAmendmentProposal(null);}}>{stage.groupIds.map((groupId)=><option key={groupId} value={groupId}>{state.groups.find((group)=>group.id===groupId)?.name}</option>)}</select></div><label>Required reason<textarea value={amendmentReason} maxLength={500} onChange={(event)=>{setAmendmentReason(event.target.value);setAmendmentProposal(null);}}/></label><button className="btn" onClick={previewAmendment}>Preview amendment</button></> : <p>No confirmed entry is currently outside this stage.</p>}{amendmentProposal && <div className="tv1-alert"><strong>Review group amendment</strong><p>{entryLabel(state,amendmentProposal.entryId)} will join {state.groups.find((group)=>group.id===amendmentProposal.groupId)?.name} with {amendmentProposal.fixtures.length} new future matches.</p><p>Existing fixtures and results remain unchanged. Qualification will be cleared and must be manually reconfirmed with a reason.</p><button className="btn primary" disabled={amendmentProposal.baseRevision!==state.revision} onClick={()=>void applyAmendment()}>Apply amendment</button><button className="btn" onClick={()=>setAmendmentProposal(null)}>Cancel</button></div>}</details>}{stage.groupIds.length > 0 && !stage.qualificationConfirmedAt && <details className="tv1-manual-qualifiers"><summary>Set an explicit qualifier order</summary><p>Use this only for unresolved ties or an organiser ruling. Every change is audited.</p>{stage.groupIds.map((groupId) => <div key={groupId}><strong>{state.groups.find((group)=>group.id===groupId)?.name}</strong>{(manualOrders[groupId] ?? []).map((entryId, index) => <div className="tv1-qualifier-row" key={entryId}><span>{index + 1}. {entryLabel(state, entryId)}</span><button className="btn" disabled={index === 0} onClick={() => moveManual(groupId, index, -1)}>↑</button><button className="btn" disabled={index === (manualOrders[groupId]?.length ?? 0) - 1} onClick={() => moveManual(groupId, index, 1)}>↓</button></div>)}</div>)}<label>Required reason<textarea value={manualReason} maxLength={500} onChange={(event) => setManualReason(event.target.value)}/></label><button className="btn" disabled={!manualReason.trim()} onClick={() => void confirmManualQualifiers()}>Confirm manual order</button></details>}{stage.groupIds.length ? <div className="tv1-groups">{stage.groupIds.map((groupId) => <GroupCard key={groupId} groupId={groupId}/>)}</div> : <div className="tv1-bracket">{fixtures.map((fixture) => <article key={fixture.id}><small>{fixture.label}</small><strong>{fixture.resolvedEntryAId ? entryLabel(state,fixture.resolvedEntryAId) : sourceText(fixture.sideA)}</strong><span>{fixture.result ? humanScore(fixture.result.score) || fixture.result.kind : 'vs'}</span><strong>{fixture.resolvedEntryBId ? entryLabel(state,fixture.resolvedEntryBId) : sourceText(fixture.sideB)}</strong><FixturePlanControls fixtureId={fixture.id}/><button className="btn" disabled={fixture.status !== 'planned'} onClick={() => void apply('swap-fixture-sides',{fixtureId:fixture.id})}>Swap sides</button></article>)}</div>}</section>;
}

function GroupCard({ groupId }: { groupId: string }) {
  const state = useTournamentStore((store) => store.active!.projected);
  const group = state.groups.find((item) => item.id === groupId)!;
  const standings = computeGroupStandings(state,groupId);
  return <article className="tv1-group-card"><h3>{group.name}</h3><div className="tv1-standing-head"><span>#</span><span>Team</span><span>P</span><span>W</span><span>Pts</span></div>{standings.rows.map((row) => <div className="tv1-standing-row" key={row.entryId}><span>{row.position}{row.tied?'*':''}</span><strong>{entryLabel(state,row.entryId)}</strong><span>{row.played}</span><span>{row.wins}</span><span>{row.matchPoints}</span></div>)}{standings.unresolvedCohorts.length > 0 && <p className="tv1-warning">Tie unresolved — organiser decision required.</p>}{standings.differentialDisabled && <p className="tv1-warning">Game/set differential is disabled because this group used non-equivalent rules.</p>}<details><summary>Matches</summary>{group.fixtureIds.map((id) => { const fixture=state.fixtures.find((item)=>item.id===id)!; return <div className="tv1-group-match" key={id}><span>{entryLabel(state,fixture.resolvedEntryAId!)} vs {entryLabel(state,fixture.resolvedEntryBId!)} · {fixture.result?humanScore(fixture.result.score)||fixture.result.kind:fixture.status}</span><FixturePlanControls fixtureId={id}/></div>;})}</details></article>;
}

function FixturePlanControls({ fixtureId }: { fixtureId: string }) {
  const state = useTournamentStore((store) => store.active!.projected);
  const apply = useTournamentStore((store) => store.applyCommand);
  const fixture = state.fixtures.find((item) => item.id === fixtureId)!;
  return <div className="tv1-fixture-plan"><select aria-label={`Rule for ${fixture.label}`} disabled={fixture.status !== 'planned'} value={fixture.ruleProfileId} onChange={(event) => void apply('assign-rule-profile', { fixtureIds: [fixture.id], ruleProfileId: event.target.value })}>{state.ruleProfiles.map((profile) => <option key={profile.id} value={profile.id}>{profile.name}</option>)}</select><button className="btn" disabled={fixture.status !== 'planned'} onClick={() => void apply('assign-fixture', { fixtureId: fixture.id, pinned: !fixture.pinned })}>{fixture.pinned ? 'Unpin' : 'Pin'}</button></div>;
}

function sourceText(source: {kind:string;fixtureId?:string;groupId?:string;position?:number}) { if(source.kind==='bye')return 'Bye'; if(source.kind==='winner-of-match')return `Winner of ${source.fixtureId?.slice(-6)}`; if(source.kind==='loser-of-match')return `Loser of ${source.fixtureId?.slice(-6)}`; if(source.kind==='group-position')return `${source.groupId?.slice(-4)} · position ${source.position}`; return 'To be decided'; }
