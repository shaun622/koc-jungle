// Dev-only browser fixture. Not imported by the application entry point.
import ReactDOM from 'react-dom/client';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { HomeScreen } from '@/routes/HomeScreen';
import { PublicSignupScreen } from '@/routes/PublicSignupScreen';
import { useEventCatalogStore } from '@/store/eventCatalog';
import { metadataForRecord } from '@/store/eventRepository';
import { buildDemoEvent } from '@/logic/demoData';
import '@/index.css';
import '@/styles/event-design.css';

const event=buildDemoEvent();
event.name='Silver King of the Court';event.venue='Jungle Padel Sanur';event.status='setup';
event.settings.publishedStartsAt='2099-09-14T10:00:00Z';event.settings.publishedSignupOpen=true;event.settings.publishedSignupId='fixture-signup';
const record=metadataForRecord({id:event.id,state:event,createdAt:1,updatedAt:1,archivedAt:null});
useEventCatalogStore.setState({hydrated:true,events:[record,{...record,id:'friday',name:'Friday Social',teamCount:6,teamCapacity:12},{...record,id:'draft',name:'Sunday Club Session',startsAt:null,signupState:'unpublished'}]});
const route=new URLSearchParams(location.search).get('page')==='signup'?'/signup/test/event':'/home';
ReactDOM.createRoot(document.getElementById('root')!).render(<MemoryRouter initialEntries={[route]}><Routes><Route path="/home" element={<HomeScreen/>}/><Route path="/signup/:accountSlug/:slug" element={<PublicSignupScreen/>}/></Routes></MemoryRouter>);
