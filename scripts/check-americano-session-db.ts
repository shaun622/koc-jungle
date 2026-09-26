// Run through vite-node. Only the explicitly named loopback test DB is accepted.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { AMERICANO_V3_TRADITIONAL_PRESETS, defaultAmericanoConfigV3, validateAmericanoResultDraftV3 } from '../src/logic/americanoV3/scoring';
import { addAmericanoFixedTeamV3, addAmericanoParticipantV3, createAmericanoEventV3, previewAmericanoScheduleV3, startAmericanoEventV3, setAmericanoResultDraftV3, confirmAmericanoResultV3, endAmericanoRoundV3 } from '../src/logic/americanoV3/runtime';
import { applySessionPlan } from '../src/logic/americanoV3/sessionPlan';
import type { AmericanoConfigV3, AmericanoResultDraftV3, TraditionalPresetKey } from '../src/logic/americanoV3/types';
const url = process.env.KOC_TEST_DATABASE_URL;
assert(url, 'KOC_TEST_DATABASE_URL required');
const parsed = new URL(url);
assert(['127.0.0.1','localhost'].includes(parsed.hostname) && parsed.pathname.startsWith('/koc_americano_test_'), 'Only disposable loopback databases');
const vectors: { config: AmericanoConfigV3; result: AmericanoResultDraftV3; expected: unknown }[] = [];
const set = (gamesA: number, gamesB: number) => ({ kind: 'set' as const, gamesA, gamesB, tiebreakPointsA: null, tiebreakPointsB: null });
function add(config: AmericanoConfigV3, result: AmericanoResultDraftV3) {
  const checked = validateAmericanoResultDraftV3(result,config.scoring,true,config.paceMinutes);
  vectors.push({config,result,expected: checked.valid ? { winner: checked.summary!.winner, setsA: checked.summary!.setsA, setsB: checked.summary!.setsB, gamesA: checked.summary!.gamesA, gamesB: checked.summary!.gamesB } : null});
}
for (const preset of Object.keys(AMERICANO_V3_TRADITIONAL_PRESETS) as Exclude<TraditionalPresetKey,'custom'>[]) {
  const config: AmericanoConfigV3 = { ...defaultAmericanoConfigV3('fixed'), paceMinutes:7, scoring:{kind:'traditional',preset,rule:AMERICANO_V3_TRADITIONAL_PRESETS[preset].rule,standings:{pointsPerGameWon:2,matchWinBonus:3},allowUnfinished:true} };
  if (config.scoring.kind==='traditional' && config.scoring.rule.bestOfSets===3) add(config,{kind:'traditional',endedEarly:true,sets:[set(6,4),set(4,6)]});
  for (let a=0;a<=9;a++) for(let b=0;b<=9;b++) {
    add(config,{kind:'traditional',endedEarly:true,sets:[set(a,b)]});
    if (config.scoring.kind==='traditional' && config.scoring.rule.bestOfSets===3) add(config,{kind:'traditional',endedEarly:true,sets:[set(6,4),set(4,6), config.scoring.rule.decidingMatchTiebreak ? {kind:'match-tiebreak',pointsA:a,pointsB:b}:set(a,b)]});
  }
  if (config.scoring.kind==='traditional' && config.scoring.rule.tiebreakTrigger!==null) {
    const n=config.scoring.rule.tiebreakTrigger;
    for (const [a,b] of [[0,0],[3,2],[7,5],[10,8],[8,2]]) for (const [ga,gb] of [[n,n],[n+1,n]]) add(config,{kind:'traditional',endedEarly:true,sets:[{...set(ga,gb),tiebreakPointsA:a,tiebreakPointsB:b}]});
  }
}
const rally={...defaultAmericanoConfigV3('rotating'),scoring:{kind:'rally' as const,pointsPerMatch:24,allowUnfinished:true}};
for(let a=0;a<=25;a++) for(let b=0;b<=25;b++) add(rally,{kind:'rally',scoreA:a,scoreB:b,endedEarly:true});
const quote=(data:unknown)=>`'${JSON.stringify(data).replaceAll("'","''")}'::jsonb`;
let sql=`select jsonb_agg(public.americano_v3_score_summary(v->'result',v->'config',true)-'complete') from jsonb_array_elements(${quote(vectors.map(({config,result})=>({config,result})))}) v;`;
const states=[];
for (const mode of ['fixed','rotating'] as const) {
  let event=createAmericanoEventV3('DB session check',mode,1);
  if(mode==='fixed')for(const name of ['A','B'])event=addAmericanoFixedTeamV3(event,{playerOne:name+'1',playerTwo:name+'2'});
  else for(const name of ['A','B','C','D'])event=addAmericanoParticipantV3(event,name);
  event.formatConfig=applySessionPlan({...event.formatConfig,scoring:{kind:'rally',pointsPerMatch:24,allowUnfinished:true},sessionPlan:{totalMinutes:7,preference:'round-length',roundMinutes:7,changeoverMinutes:2}},mode==='fixed'?2:4,1);
  event=await previewAmericanoScheduleV3(event); states.push(event);
  event=startAmericanoEventV3(event);states.push(event);
  event=setAmericanoResultDraftV3(event,event.rounds[0].matches[0].id,{kind:'rally',scoreA:10,scoreB:8,endedEarly:true});
  event=confirmAmericanoResultV3(event,event.rounds[0].matches[0].id);states.push(event);
  event=endAmericanoRoundV3(event);states.push(event);
}
sql+=`\nselect jsonb_agg(public.americano_v3_state_error(v)) from jsonb_array_elements(${quote(states)}) v;`;
const processResult=spawnSync(resolve('.local-postgres/runtime/pgsql/bin/psql.exe'),[url,'-X','-At','-v','ON_ERROR_STOP=1'],{input:sql,encoding:'utf8',maxBuffer:8*1024*1024});
assert.equal(processResult.status,0,processResult.stderr);
const [scores,errors]=processResult.stdout.trim().split(/\r?\n/).map(line=>JSON.parse(line));
scores.forEach((score:unknown,index:number)=>assert.deepEqual(score,vectors[index].expected,JSON.stringify(vectors[index])));
assert.deepEqual(errors,states.map(()=>null),'Generated states must pass full SQL fixture and lifecycle checks');
console.log(`PASS ${vectors.length} SQL/TypeScript score parity vectors and ${states.length} planned lifecycle states`);
