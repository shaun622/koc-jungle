// Dev-only browser fixture. Not imported by the application entry point.
import ReactDOM from 'react-dom/client';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { HomeScreen } from '@/routes/HomeScreen';
import { PublicSignupScreen } from '@/routes/PublicSignupScreen';
import { useEventCatalogStore } from '@/store/eventCatalog';
import { metadataForRecord } from '@/store/eventRepository';
import { buildDemoEvent } from '@/logic/demoData';
import { DisplayScreen } from '@/routes/DisplayScreen';
import { SetupScreen } from '@/routes/SetupScreen';
import { LeaderboardScreen } from '@/routes/LeaderboardScreen';
import { QualifierScreen } from '@/routes/QualifierScreen';
import { SeedingScreen } from '@/routes/SeedingScreen';
import { HelpScreen } from '@/routes/HelpScreen';
import { TopNav } from '@/components/TopNav';
import { useApplyTheme } from '@/hooks/useApplyTheme';
import { useEventStore } from '@/store/eventStore';
import { useThemeStore } from '@/store/theme';
import type { MainRound } from '@/types/domain';
import '@/index.css';
import '@/styles/event-design.css';
import '@/styles/app-design.css';
import '@/styles/scoreboard.css';

const event=buildDemoEvent();
event.name='Silver King of the Court';event.venue='Jungle Padel Sanur';event.status='setup';
event.settings.publishedStartsAt='2099-09-14T10:00:00Z';event.settings.publishedSignupOpen=true;event.settings.publishedSignupId='fixture-signup';
const record=metadataForRecord({id:event.id,state:event,createdAt:1,updatedAt:1,archivedAt:null});
useEventCatalogStore.setState({hydrated:true,events:[record,{...record,id:'friday',name:'Friday Social',teamCount:6,teamCapacity:12},{...record,id:'draft',name:'Sunday Club Session',startsAt:null,signupState:'unpublished'}]});
const params=new URLSearchParams(location.search);
const page=params.get('page')||'home';
if(params.has('theme'))useThemeStore.getState().setPreference(params.get('theme')==='dark'?'dark':'light');
if(['display','between','complete','setup','leaderboard','qualifier','seeding'].includes(page)){
  const requestedCount=Number(params.get('teams'));
  const count=Number.isInteger(requestedCount)&&requestedCount>=2&&requestedCount<=32&&requestedCount%2===0?requestedCount:6;
  event.format='koc';event.settings.publishedSignupId=undefined;event.settings.publishedSignupOpen=false;event.settings.announceRoundStart=false;event.settings.soundOnTimerEnd=false;
  event.courts=Array.from({length:count/2},(_,i)=>({id:`court-${i}`,name:i===count/2-1?'Centre Court':`Court ${i+1}`,position:i+1,pointValue:i+3}));
  event.teams=Array.from({length:count},(_,i)=>({...event.teams[i%14],id:`pair-${i}`,name:['The Smashers','Espanas','Ruloz','Team Germany','The Woowhoos','Net Positive'][i]||`Pair ${i+1}`}));
  const round:MainRound={id:'round-3',index:3,durationMs:1200000,totalPausedMs:0,startedAt:Date.now()-378000,pausedAt:Date.now(),matches:event.courts.map((c,i)=>({id:`match-${i}`,courtId:c.id,teamAId:event.teams[i*2].id,teamBId:event.teams[i*2+1].id,scoreA:7,scoreB:5,status:'in-progress',pointValueAtTime:c.pointValue}))};
  event.rounds=[{...round,id:'round-1',index:1,completedAt:Date.now()-2000000},{...round,id:'round-2',index:2,completedAt:Date.now()-1000000},round];
  event.status=page==='between'?'between-rounds':page==='complete'?'complete':page==='setup'?'setup':page==='qualifier'?'qualifier':page==='seeding'?'seeding':'round-in-progress';
  event.qualifier={...round,shuffleSeed:1};
  if(page==='setup')event.rounds=[];
  if(page==='between'||page==='complete')round.completedAt=Date.now();
  if(page==='between')event.pendingAssignments=round.matches.map(m=>({courtId:m.courtId,teamAId:m.teamAId,teamBId:m.teamBId}));
  useEventStore.setState({event,hydrated:true});
}
const route=page==='signup'?'/signup/test/event':page==='home'?'/home':`/events/${event.id}/${page==='between'||page==='complete'?'display':page}`;
function Fixture(){useApplyTheme();return <MemoryRouter initialEntries={[route]}><Routes><Route path="/home" element={<HomeScreen/>}/><Route path="/signup/:accountSlug/:slug" element={<PublicSignupScreen/>}/><Route path="/events/:eventId/display" element={<DisplayScreen/>}/><Route path="/events/:eventId/help" element={<HelpScreen/>}/>{[['setup',<SetupScreen/>],['leaderboard',<LeaderboardScreen/>],['qualifier',<QualifierScreen/>],['seeding',<SeedingScreen/>]].map(([name,screen])=><Route key={String(name)} path={`/events/:eventId/${name}`} element={<div className="op"><TopNav event={event}/>{screen}</div>}/>)}</Routes></MemoryRouter>}
ReactDOM.createRoot(document.getElementById('root')!).render(<Fixture/>);
