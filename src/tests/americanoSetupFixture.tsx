// Dev-only fixture: real setup component, isolated local event, no cloud sync.
import ReactDOM from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { AmericanoSetupV3 } from '@/components/americano/AmericanoSetupV3';
import { TopNav } from '@/components/TopNav';
import { MobileTabBar } from '@/components/MobileTabBar';
import { createAmericanoEventV3 } from '@/logic/americanoV3/runtime';
import { isAmericanoEventV3, type VersionedEventState } from '@/logic/eventVersions';
import type { EventState } from '@/types/domain';
import { useEventStore } from '@/store/eventStore';
import { useThemeStore } from '@/store/theme';
import { useApplyTheme } from '@/hooks/useApplyTheme';
import '@/index.css';
import '@/styles/event-design.css';
import '@/styles/app-design.css';
import '@/styles/tournament-v1.css';
import '@/styles/americano-v3.css';
import '@/styles/scoreboard.css';

const params = new URLSearchParams(location.search);
const event = createAmericanoEventV3('Americano', params.get('mode') === 'fixed' ? 'fixed' : 'rotating');
useEventStore.getState().loadEvent(event);
useEventStore.setState({ hydrated: true });
useThemeStore.getState().setPreference(params.get('theme') === 'light' ? 'light' : 'dark');
function Fixture() {
  useApplyTheme();
  const current = useEventStore((state) => state.event) as VersionedEventState | null;
  if (!current || !isAmericanoEventV3(current)) return null;
  return <MemoryRouter initialEntries={[`/events/${current.id}/setup`]}>
    <div className="op"><TopNav event={current as unknown as EventState}/><AmericanoSetupV3 event={current}/><MobileTabBar event={current as unknown as EventState}/></div>
  </MemoryRouter>;
}
ReactDOM.createRoot(document.getElementById('root')!).render(<Fixture/>);
