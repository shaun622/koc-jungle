import { describe,expect,it } from 'vitest';
import { createTournamentV1,makeFixture,publicProjection,stagePlanningDefaults,type TournamentStage } from '@/logic/tournament';

describe('tournament public projection',()=>{
  it('contains direct historical labels and allowlisted results without private reasons',()=>{
    const state=createTournamentV1({id:'t',title:'Public',now:1,divisionId:'d',courtIds:['c']});state.meta.publicSlug='public';
    state.players.push({id:'p1',name:'Alice'},{id:'p2',name:'Bea'},{id:'p3',name:'Cara'},{id:'p4',name:'Dina'});
    state.entries.push({id:'a',divisionId:'d',teamName:'Aces',playerIds:['p1','p2'],admission:'confirmed',readiness:'ready',acceptedAt:1,waitRank:null,activeLineupRevisionId:'la'},{id:'b',divisionId:'d',teamName:'Bells',playerIds:['p3','p4'],admission:'confirmed',readiness:'ready',acceptedAt:1,waitRank:null,activeLineupRevisionId:'lb'});
    state.lineupRevisions.push({id:'la',entryId:'a',playerIds:['p1','p2'],effectiveFixtureIds:[],createdAt:1,reason:'Private lineup reason'},{id:'lb',entryId:'b',playerIds:['p3','p4'],effectiveFixtureIds:[],createdAt:1,reason:'Private lineup reason'});
    const stage:TournamentStage={id:'s',divisionId:'d',name:'Final',kind:'knockout',order:1,entryIds:['a','b'],groupIds:[],defaultRuleProfileId:'first-to-five',qualificationConfirmedAt:null,qualificationFingerprint:null,amended:false,closedAt:null,...stagePlanningDefaults()};state.stages.push(stage);
    const fixture=makeFixture({id:'f',divisionId:'d',stageId:'s',label:'Final',sideA:{kind:'entry',entryId:'a'},sideB:{kind:'entry',entryId:'b'},ruleProfileId:'first-to-five',queueOrder:7});fixture.status='completed';fixture.resolvedEntryAId='a';fixture.resolvedEntryBId='b';fixture.actualEntryIds=['a','b'];fixture.actualPlayerIds=[['p1','p2'],['p3','p4']];fixture.result={revision:1,kind:'administrative',winnerEntryId:'a',score:null,reportedScore:{sets:[{gamesA:5,gamesB:3}]},reason:'PRIVATE-SENTINEL-REASON',confirmedAt:3,retrospective:false};state.fixtures.push(fixture);
    const projection=publicProjection(state);const serialized=JSON.stringify(projection);
    expect(projection.fixtures[0]).toMatchObject({entryA:'Aces',entryB:'Bells',playersA:['Alice','Bea'],playersB:['Cara','Dina'],queueOrder:7,result:{winnerLabel:'Aces',kind:'administrative'}});
    expect(serialized).not.toContain('PRIVATE-SENTINEL-REASON');expect(serialized).not.toContain('Private lineup reason');
  });
});
