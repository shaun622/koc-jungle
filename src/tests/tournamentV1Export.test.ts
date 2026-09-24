import { describe, expect, it } from 'vitest';
import { createTournamentV1, makeFixture, stagePlanningDefaults } from '@/logic/tournament';
import { createTournamentRecord } from '@/store/tournamentRepository';
import { restoreTournamentBackup, tournamentBackup, tournamentCsv } from '@/utils/tournamentExport';

function record() {
  const state=createTournamentV1({id:'00000000-0000-4000-a000-000000000001',title:'Test',now:1,divisionId:'d',courtIds:['c']});
  state.players.push({id:'p1',name:'=HYPERLINK("bad")'},{id:'p2',name:'Sam'});
  state.players.push({id:'p3',name:'Alex'},{id:'p4',name:'Rae'});
  state.entries.push({id:'e',divisionId:'d',teamName:'+Formula',playerIds:['p1','p2'],admission:'confirmed',readiness:'ready',acceptedAt:1,waitRank:null,activeLineupRevisionId:'l'});
  state.entries.push({id:'e2',divisionId:'d',teamName:'Second',playerIds:['p3','p4'],admission:'confirmed',readiness:'ready',acceptedAt:1,waitRank:null,activeLineupRevisionId:'l2'});
  state.lineupRevisions.push({id:'l',entryId:'e',playerIds:['p1','p2'],effectiveFixtureIds:[],createdAt:1,reason:'Initial'});
  state.lineupRevisions.push({id:'l2',entryId:'e2',playerIds:['p3','p4'],effectiveFixtureIds:[],createdAt:1,reason:'Initial'});
  state.stages.push({id:'s',divisionId:'d',name:'Manual',kind:'manual',order:1,entryIds:['e','e2'],groupIds:[],defaultRuleProfileId:'first-to-five',qualificationConfirmedAt:null,qualificationFingerprint:null,amended:false,closedAt:null,...stagePlanningDefaults()});
  state.fixtures.push(makeFixture({id:'f',divisionId:'d',stageId:'s',label:'Planned match',sideA:{kind:'entry',entryId:'e'},sideB:{kind:'entry',entryId:'e2'},ruleProfileId:'first-to-five',queueOrder:1}));
  const result=createTournamentRecord('owner',state); result.contacts.e='+62000'; return result;
}

describe('tournament v1 export and recovery',()=>{
  it('escapes formulas and excludes contacts by default',()=>{
    const csv=tournamentCsv(record());
    expect(csv).toContain("'=HYPERLINK");
    expect(csv).toContain("'+Formula");
    expect(csv).not.toContain('+62000');
    expect(tournamentCsv(record(),true)).toContain("'+62000");
  });
  it('restores as a new unpublished setup without controller authority',()=>{
    const original=record();
    const restored=restoreTournamentBackup(tournamentBackup(original,true,true));
    expect(restored.state.id).not.toBe(original.tournamentId);
    expect(restored.state).toMatchObject({lifecycle:'setup',controller:{deviceId:null,epoch:'0',nextSequence:0},meta:{publicSlug:null,signupOpen:false}});
    expect(Object.values(restored.contacts)).toEqual(['+62000']);
    expect(restored.state.fixtures[0].actualEntryIds).toBeNull();
    expect(restored.state.fixtures[0].actualPlayerIds).toBeNull();
  });
});
