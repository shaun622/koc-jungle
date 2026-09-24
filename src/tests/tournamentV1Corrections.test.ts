import { describe,expect,it } from 'vitest';
import { createTournamentV1,generateKnockoutFixtures,nextOwnerCommand,previewResultCorrection,reduceTournament,resolveFixtureSources,stagePlanningDefaults,type TournamentCommandKind,type TournamentResult,type TournamentStage,type TournamentV1 } from '@/logic/tournament';

let n=0;const id=(p:string)=>`${p}-${++n}`;
function apply(state:TournamentV1,kind:TournamentCommandKind,payload:Record<string,unknown>={},reason?:string){const command=nextOwnerCommand(state,{commandId:id('cmd'),deviceId:'device',kind,payload,reason,issuedAt:10});return reduceTournament(state,command,{actorId:'owner',now:10+n});}
function prepared(){n=0;let state=createTournamentV1({id:'t',title:'Test',now:1,divisionId:'d',courtIds:['c1','c2']});for(let i=0;i<4;i++){state=apply(state,'add-entry',{divisionId:'d',teamName:`T${i}`,playerNames:[`A${i}`,`B${i}`],ids:{entryId:`e${i}`,playerIds:[`p${i}a`,`p${i}b`],lineupRevisionId:`l${i}`}});}const stage:TournamentStage={id:'s',divisionId:'d',name:'KO',kind:'knockout',order:1,entryIds:['e0','e1','e2','e3'],groupIds:[],defaultRuleProfileId:'first-to-five',qualificationConfirmedAt:null,qualificationFingerprint:null,amended:false,closedAt:null,...stagePlanningDefaults()};state=apply(state,'add-stage',{stage});const fixtures=generateKnockoutFixtures({divisionId:'d',stageId:'s',sources:['e0','e1','e2','e3'].map(entryId=>({kind:'entry' as const,entryId})),ruleProfileId:'first-to-five',id:()=>id('f')});state=apply(state,'replace-stage-draw',{stageId:'s',groups:[],fixtures,entryIds:stage.entryIds});return resolveFixtureSources(state);}

describe('tournament v1 correction workflow',()=>{
  it('requires a decision when an upstream correction changes a started successor',()=>{
    let state=prepared();const semis=state.fixtures.filter(f=>f.label.startsWith('Semifinal'));for(const semi of semis){state=apply(state,'record-result',{fixtureId:semi.id,result:{kind:'played',winnerEntryId:semi.resolvedEntryAId,score:{sets:[{gamesA:5,gamesB:3}]},reason:'',retrospective:true}});}state=apply(state,'begin-event');const final=state.fixtures.find(f=>f.label==='Final')!;state=apply(state,'start-match',{fixtureId:final.id,courtId:'c1',acknowledgeRest:true},'Compressed test schedule');const startedActuals=state.fixtures.find(f=>f.id===final.id)!.actualEntryIds;const first=state.fixtures.find(f=>f.id===semis[0].id)!;const replacement:TournamentResult={...first.result!,revision:first.result!.revision+1,winnerEntryId:first.actualEntryIds![1],score:{sets:[{gamesA:3,gamesB:5}]},confirmedAt:99};const preview=previewResultCorrection(state,first.id,replacement);expect(preview.impacts).toContainEqual(expect.objectContaining({fixtureId:final.id,resolutionRequired:true,newEntryIds:expect.arrayContaining([first.actualEntryIds![1]])}));
    const before=JSON.stringify(state);
    expect(()=>apply(state,'correct-result',{fixtureId:first.id,result:replacement,preview,resolutions:[]})).toThrow();
    expect(JSON.stringify(state)).toBe(before);
    const corrected=apply(state,'correct-result',{fixtureId:first.id,result:replacement,preview,resolutions:[{fixtureId:final.id,action:'keep-as-played',reason:'Final already started'}],reconfirmations:[]});
    expect(corrected.fixtures.find(f=>f.id===first.id)?.result?.revision).toBe((first.result?.revision??0)+1);
    expect(corrected.fixtures.find(f=>f.id===final.id)?.actualEntryIds).toEqual(startedActuals);
  });
});
