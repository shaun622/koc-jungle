import {
  createDrawProposal,
  createScheduleProposal,
  defaultGroups,
  generateKnockoutFixtures,
  generateRoundRobinFixtures,
  previewResultCorrection,
  stagePlanningDefaults,
  TOURNAMENT_CONTRACT_VERSION,
  type TournamentDrawProposal,
  type TournamentGroup,
  type TournamentResult,
  type TournamentScheduleProposal,
  type TournamentStage,
  type TournamentV1,
  type CorrectionPreview,
} from '@/logic/tournament';

export type TournamentPlanningRequest =
  | { requestId:string; contractVersion:typeof TOURNAMENT_CONTRACT_VERSION; baseRevision:string; kind:'schedule'; state:TournamentV1; startsAt:string }
  | { requestId:string; contractVersion:typeof TOURNAMENT_CONTRACT_VERSION; baseRevision:string; kind:'correction'; state:TournamentV1; fixtureId:string; result:TournamentResult }
  | { requestId:string; contractVersion:typeof TOURNAMENT_CONTRACT_VERSION; baseRevision:string; kind:'group-draw'; state:TournamentV1; divisionId:string; stageId:string; entryIds:string[]; groupCount:number; order:number; seedMode:'entered'|'seeded'|'shuffle'; seedOrder:string[]; shuffleSeed:string|null }
  | { requestId:string; contractVersion:typeof TOURNAMENT_CONTRACT_VERSION; baseRevision:string; kind:'knockout-draw'; state:TournamentV1; divisionId:string; stageId:string; entryIds:string[]; order:number; seedMode:'entered'|'seeded'|'shuffle'; seedOrder:string[]; shuffleSeed:string|null };

export type TournamentPlanningResult =
  | { kind:'schedule'; proposal:TournamentScheduleProposal }
  | { kind:'correction'; preview:CorrectionPreview }
  | { kind:'draw'; proposal:TournamentDrawProposal };

const id=(prefix:string)=>`${prefix}-${crypto.randomUUID()}`;
function seededOrder(entryIds:string[],mode:'entered'|'seeded'|'shuffle',seedOrder:string[],seed:string|null):string[] {
  if(mode==='entered')return [...entryIds];
  if(mode==='seeded') {
    if(seedOrder.length!==entryIds.length||new Set(seedOrder).size!==entryIds.length||!seedOrder.every((id)=>entryIds.includes(id)))throw new Error('Seed order must contain every selected entry exactly once.');
    return [...seedOrder];
  }
  if(!seed)throw new Error('A stable shuffle seed is required.');
  let value=2166136261;for(const char of seed)value=Math.imul(value^char.charCodeAt(0),16777619)>>>0;
  const random=()=>{value+=0x6D2B79F5;let next=value;next=Math.imul(next^(next>>>15),next|1);next^=next+Math.imul(next^(next>>>7),next|61);return((next^(next>>>14))>>>0)/4294967296;};
  const result=[...entryIds];for(let index=result.length-1;index>0;index-=1){const target=Math.floor(random()*(index+1));[result[index],result[target]]=[result[target],result[index]];}return result;
}

export function executeTournamentPlanning(request:TournamentPlanningRequest):TournamentPlanningResult {
  if(request.contractVersion!==TOURNAMENT_CONTRACT_VERSION)throw new Error('Tournament planning contract is unsupported.');
  if(request.state.revision!==request.baseRevision)throw new Error('Tournament changed before planning began.');
  if(request.kind==='schedule')return {kind:'schedule',proposal:createScheduleProposal(request.state,request.startsAt)};
  if(request.kind==='correction')return {kind:'correction',preview:previewResultCorrection(request.state,request.fixtureId,request.result)};
  if(request.kind==='group-draw') {
    const orderedEntries=seededOrder(request.entryIds,request.seedMode,request.seedOrder,request.shuffleSeed);
    const partitions=defaultGroups(orderedEntries,request.groupCount);
    const groups:TournamentGroup[]=partitions.map((entryIds,index)=>({id:id('group'),stageId:request.stageId,name:`Group ${String.fromCharCode(65+index)}`,entryIds,fixtureIds:[],qualifierOrder:null}));
    const fixtures=generateRoundRobinFixtures({divisionId:request.divisionId,stageId:request.stageId,groups,ruleProfileId:'first-to-five',id:()=>id('fixture')});
    groups.forEach((group)=>{group.fixtureIds=fixtures.filter((fixture)=>fixture.groupId===group.id).map((fixture)=>fixture.id);});
    const stage:TournamentStage={id:request.stageId,divisionId:request.divisionId,name:'Group stage',kind:'group',order:request.order,entryIds:orderedEntries,groupIds:groups.map((group)=>group.id),defaultRuleProfileId:'first-to-five',qualificationConfirmedAt:null,qualificationFingerprint:null,amended:false,closedAt:null,...stagePlanningDefaults(),seedMode:request.seedMode,seedOrder:orderedEntries,shuffleSeed:request.shuffleSeed};
    return {kind:'draw',proposal:createDrawProposal({baseRevision:request.baseRevision,stage,groups,fixtures})};
  }
  const orderedEntries=seededOrder(request.entryIds,request.seedMode,request.seedOrder,request.shuffleSeed);
  const stage:TournamentStage={id:request.stageId,divisionId:request.divisionId,name:'Main draw',kind:'knockout',order:request.order,entryIds:orderedEntries,groupIds:[],defaultRuleProfileId:'standard-set',qualificationConfirmedAt:null,qualificationFingerprint:null,amended:false,closedAt:null,...stagePlanningDefaults(),seedMode:request.seedMode,seedOrder:orderedEntries,shuffleSeed:request.shuffleSeed};
  const fixtures=generateKnockoutFixtures({divisionId:request.divisionId,stageId:request.stageId,sources:orderedEntries.map((entryId)=>({kind:'entry' as const,entryId})),ruleProfileId:'standard-set',finalRuleProfileId:'best-of-three',id:()=>id('fixture')});
  return {kind:'draw',proposal:createDrawProposal({baseRevision:request.baseRevision,stage,groups:[],fixtures})};
}
