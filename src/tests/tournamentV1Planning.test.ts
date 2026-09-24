import { describe,expect,it } from 'vitest';
import { createTournamentV1 } from '@/logic/tournament';
import { executeTournamentPlanning } from '@/logic/tournament/planningTasks';

describe('tournament planning worker contract',()=>{
  it('builds an exact 16-entry reviewed group draw without mutating the input',()=>{
    const state=createTournamentV1({id:'t',title:'Planner',now:1,divisionId:'d',courtIds:['c1','c2','c3','c4']});
    for(let index=0;index<16;index+=1){state.players.push({id:`p${index}a`,name:`A${index}`},{id:`p${index}b`,name:`B${index}`});state.entries.push({id:`e${index}`,divisionId:'d',teamName:`Team ${index}`,playerIds:[`p${index}a`,`p${index}b`],admission:'confirmed',readiness:'ready',acceptedAt:1,waitRank:null,activeLineupRevisionId:`l${index}`});state.lineupRevisions.push({id:`l${index}`,entryId:`e${index}`,playerIds:[`p${index}a`,`p${index}b`],effectiveFixtureIds:[],createdAt:1,reason:'Initial'});}
    const before=JSON.stringify(state);const result=executeTournamentPlanning({requestId:'r',contractVersion:2,baseRevision:state.revision,kind:'group-draw',state,divisionId:'d',stageId:'s',entryIds:state.entries.map((entry)=>entry.id),groupCount:4,order:1,seedMode:'shuffle',seedOrder:[],shuffleSeed:'stable-seed'});
    expect(result.kind).toBe('draw');if(result.kind==='draw'){expect(result.proposal.groups).toHaveLength(4);expect(result.proposal.fixtures).toHaveLength(24);}
    expect(JSON.stringify(state)).toBe(before);
  });
  it('rejects a stale job before producing a proposal',()=>{const state=createTournamentV1({id:'t',title:'Planner',now:1,divisionId:'d',courtIds:['c']});expect(()=>executeTournamentPlanning({requestId:'r',contractVersion:2,baseRevision:'99',kind:'schedule',state,startsAt:new Date().toISOString()})).toThrow(/changed/i);});
});
