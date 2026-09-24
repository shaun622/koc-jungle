import { cloneTournament, entryLabel, sourceFingerprint, validateTournament, type FixtureSource, type TournamentPrivateContacts, type TournamentV1 } from '@/logic/tournament';
import type { TournamentDrafts, TournamentLocalRecord } from '@/store/tournamentRepository';

const uuid = () => crypto.randomUUID();
const csvCell = (value: unknown) => {
  let text = String(value ?? '');
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return `"${text.replaceAll('"','""')}"`;
};

export function tournamentCsv(record: TournamentLocalRecord, includeContacts = false): string {
  const state = record.projected;
  const headers = ['Division','Status','Team','Player one','Player two',...(includeContacts?['Private contact']:[])];
  const rows = state.entries.filter((entry) => entry.admission !== 'cancelled').map((entry) => {
    const division=state.divisions.find((item)=>item.id===entry.divisionId)?.name ?? '';
    const players=entry.playerIds.map((id)=>state.players.find((player)=>player.id===id)?.name ?? '');
    return [division,entry.admission,entryLabel(state,entry.id),players[0],players[1],...(includeContacts?[record.contacts[entry.id]??'']:[])];
  });
  return [headers,...rows].map((row)=>row.map(csvCell).join(',')).join('\r\n');
}

export interface TournamentBackup {
  schema: 'tournament-v1-backup';
  version: 1;
  exportedAt: number;
  acknowledged: TournamentV1;
  projected?: TournamentV1;
  outbox?: TournamentLocalRecord['outbox'];
  contacts?: TournamentPrivateContacts;
  drafts?: TournamentDrafts;
  sourceAudit?: TournamentV1['audit'];
}

export function tournamentBackup(record: TournamentLocalRecord, includeRecovery = false, includeContacts = false): TournamentBackup {
  return { schema:'tournament-v1-backup',version:1,exportedAt:Date.now(),acknowledged:cloneTournament(record.acknowledged),sourceAudit:cloneTournament(record.projected.audit),...(record.outbox.length?{projected:cloneTournament(record.projected)}:{}),...(includeRecovery?{drafts:cloneTournament(record.drafts)}:{}),...(includeContacts?{contacts:cloneTournament(record.contacts)}:{}) };
}

export function restoreTournamentBackup(backup: TournamentBackup, useProjected = Boolean(backup.projected)): { state: TournamentV1; contacts: TournamentPrivateContacts; drafts?: TournamentDrafts } {
  if (backup.schema !== 'tournament-v1-backup' || backup.version !== 1) throw new Error('Unsupported tournament backup.');
  const source=cloneTournament(useProjected && backup.projected ? backup.projected : backup.acknowledged);
  const maps = {
    division:new Map(source.divisions.map((item)=>[item.id,`division-${uuid()}`])), player:new Map(source.players.map((item)=>[item.id,`player-${uuid()}`])),
    entry:new Map(source.entries.map((item)=>[item.id,`entry-${uuid()}`])), lineup:new Map(source.lineupRevisions.map((item)=>[item.id,`lineup-${uuid()}`])),
    court:new Map(source.courts.map((item)=>[item.id,`court-${uuid()}`])), profile:new Map(source.ruleProfiles.map((item)=>[item.id,`rule-${uuid()}`])),
    stage:new Map(source.stages.map((item)=>[item.id,`stage-${uuid()}`])), group:new Map(source.groups.map((item)=>[item.id,`group-${uuid()}`])),
    fixture:new Map(source.fixtures.map((item)=>[item.id,`fixture-${uuid()}`])), decision:new Map(source.qualificationDecisions.map((item)=>[item.id,`decision-${uuid()}`])),
  };
  const mapSource=(source:FixtureSource):FixtureSource=>source.kind==='entry'?{kind:'entry',entryId:maps.entry.get(source.entryId)!}:source.kind==='group-position'?{kind:'group-position',groupId:maps.group.get(source.groupId)!,position:source.position}:source.kind==='winner-of-match'||source.kind==='loser-of-match'?{kind:source.kind,fixtureId:maps.fixture.get(source.fixtureId)!}:{kind:'bye'};
  const allIds = new Map<string,string>(Object.values(maps).flatMap((map)=>[...map.entries()]));
  const deepRemap = (value: unknown): unknown => {
    if (typeof value === 'string') return allIds.get(value) ?? value;
    if (Array.isArray(value)) return value.map(deepRemap);
    if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value as Record<string,unknown>).map(([key,item])=>[remapDraftKey(key,allIds),deepRemap(item)]));
    return value;
  };
  const now=Date.now(); const oldId=source.id; source.id=uuid(); source.revision='0'; source.createdAt=now; source.updatedAt=now; source.lifecycle='setup'; source.archivedAt=null; source.meta={...source.meta,publicSlug:null,signupOpen:false}; source.controller={deviceId:null,epoch:'0',nextSequence:0}; source.audit=[];
  source.divisions=source.divisions.map((item)=>({...item,id:maps.division.get(item.id)!,drawPublishedAt:null,automaticPromotion:false}));
  source.players=source.players.map((item)=>({...item,id:maps.player.get(item.id)!}));
  source.entries=source.entries.map((item)=>({...item,id:maps.entry.get(item.id)!,divisionId:maps.division.get(item.divisionId)!,playerIds:item.playerIds.map((id)=>maps.player.get(id)!) as [string,string],activeLineupRevisionId:maps.lineup.get(item.activeLineupRevisionId)!}));
  source.lineupRevisions=source.lineupRevisions.map((item)=>({...item,id:maps.lineup.get(item.id)!,entryId:maps.entry.get(item.entryId)!,playerIds:item.playerIds.map((id)=>maps.player.get(id)!) as [string,string],effectiveFixtureIds:item.effectiveFixtureIds.map((id)=>maps.fixture.get(id)!)}));
  source.courts=source.courts.map((item)=>({...item,id:maps.court.get(item.id)!})); source.ruleProfiles=source.ruleProfiles.map((item)=>({...item,id:maps.profile.get(item.id)!}));
  source.stages=source.stages.map((item)=>({...item,id:maps.stage.get(item.id)!,divisionId:maps.division.get(item.divisionId)!,entryIds:item.entryIds.map((id)=>maps.entry.get(id)!),groupIds:item.groupIds.map((id)=>maps.group.get(id)!),defaultRuleProfileId:maps.profile.get(item.defaultRuleProfileId)!,seedOrder:item.seedOrder.map((id)=>maps.entry.get(id)!),qualificationDestinations:item.qualificationDestinations.map((destination)=>({...destination,groupId:maps.group.get(destination.groupId)!,destinationStageId:maps.stage.get(destination.destinationStageId)!})),plateSourceStageId:item.plateSourceStageId?maps.stage.get(item.plateSourceStageId)!:null,plateRulings:item.plateRulings.map((ruling)=>({...ruling,entryId:maps.entry.get(ruling.entryId)!})),qualificationConfirmedAt:null,qualificationFingerprint:null}));
  source.groups=source.groups.map((item)=>({...item,id:maps.group.get(item.id)!,stageId:maps.stage.get(item.stageId)!,entryIds:item.entryIds.map((id)=>maps.entry.get(id)!),fixtureIds:item.fixtureIds.map((id)=>maps.fixture.get(id)!),qualifierOrder:item.qualifierOrder?.map((id)=>maps.entry.get(id)! )??null}));
  source.fixtures=source.fixtures.map((item)=>{ const sideA=mapSource(item.sideA),sideB=mapSource(item.sideB); const interrupted=item.status==='playing'||item.status==='suspended'; return {...item,id:maps.fixture.get(item.id)!,divisionId:maps.division.get(item.divisionId)!,stageId:maps.stage.get(item.stageId)!,groupId:item.groupId?maps.group.get(item.groupId)!:null,sideA,sideB,resolvedEntryAId:item.resolvedEntryAId?maps.entry.get(item.resolvedEntryAId)!:null,resolvedEntryBId:item.resolvedEntryBId?maps.entry.get(item.resolvedEntryBId)!:null,ruleProfileId:maps.profile.get(item.ruleProfileId)!,courtId:null,status:interrupted?'suspended':item.status,actualEntryIds:item.actualEntryIds?item.actualEntryIds.map((id)=>maps.entry.get(id)!) as [string,string]:null,actualPlayerIds:item.actualPlayerIds?item.actualPlayerIds.map((side)=>side.map((id)=>maps.player.get(id)!) as [string,string]) as [[string,string],[string,string]]:null,actualRuleProfile:item.actualRuleProfile?{...item.actualRuleProfile,id:maps.profile.get(item.actualRuleProfile.id)??item.actualRuleProfile.id}:null,result:item.result?{...item.result,winnerEntryId:maps.entry.get(item.result.winnerEntryId)!}:null,sourceFingerprint:sourceFingerprint(sideA,sideB),importedInterruption:interrupted}; });
  source.qualificationDecisions=source.qualificationDecisions.map((item)=>({...item,id:maps.decision.get(item.id)!,stageId:maps.stage.get(item.stageId)!,orderedEntryIds:item.orderedEntryIds.map((id)=>maps.entry.get(id)!),destinationRanks:item.destinationRanks.map((destination)=>({...destination,groupId:maps.group.get(destination.groupId)!,destinationStageId:maps.stage.get(destination.destinationStageId)!})),plateRulings:item.plateRulings.map((ruling)=>({...ruling,entryId:maps.entry.get(ruling.entryId)!}))}));
  validateTournament(source);
  const contacts=Object.fromEntries(Object.entries(backup.contacts??{}).flatMap(([id,value])=>maps.entry.has(id)?[[maps.entry.get(id)!,value]]:[]));
  const drafts=backup.drafts?deepRemap(backup.drafts) as TournamentDrafts:undefined;
  void oldId;
  return {state:source,contacts,drafts};
}

function remapDraftKey(key:string, ids:Map<string,string>):string {
  if(ids.has(key))return ids.get(key)!;
  for(const [oldId,newId] of ids)if(key.endsWith(`:${oldId}`))return `${key.slice(0,-oldId.length)}${newId}`;
  return key;
}
