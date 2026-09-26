// Dev-only fixture: real setup component, isolated local event, no cloud sync.
import ReactDOM from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { AmericanoSetupV3 } from '@/components/americano/AmericanoSetupV3';
import { AmericanoDisplayV3 } from '@/components/americano/AmericanoDisplayV3';
import { TopNav } from '@/components/TopNav';
import { MobileTabBar } from '@/components/MobileTabBar';
import { addAmericanoFixedTeamV3, addAmericanoParticipantV3, createAmericanoEventV3, previewAmericanoScheduleV3, startAmericanoEventV3, updateAmericanoConfigV3 } from '@/logic/americanoV3/runtime';
import { AMERICANO_V3_TRADITIONAL_PRESETS } from '@/logic/americanoV3/scoring';
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
const mode = params.get('mode') === 'fixed' ? 'fixed' : 'rotating';
const demoCourts = Math.max(1, Math.min(8, Number(params.get('courts')) || 4));
let event = createAmericanoEventV3(params.get('demo') === 'live' ? 'Americano scoring demo' : 'Americano', mode, params.get('demo') === 'live' ? demoCourts : 2);
if (params.get('demo') === 'live') {
  event.formatConfig = { ...event.formatConfig, paceClockEnabled: true };
  if (params.get('format') === 'traditional') event = updateAmericanoConfigV3(event, { scoring: { kind: 'traditional', preset: 'first-to-five', rule: AMERICANO_V3_TRADITIONAL_PRESETS['first-to-five'].rule, standings: { pointsPerGameWon: 1, matchWinBonus: 0 } } });
  const names = ['Alex', 'Ben', 'Chris', 'Dan', 'Ellie', 'Fran', 'Gabe', 'Hana', 'Ian', 'Jo', 'Kim', 'Leo', 'Maya', 'Niko', 'Oli', 'Priya', 'Quinn', 'Rory', 'Sana', 'Tara', 'Uma', 'Vik', 'Will', 'Xena', 'Yara', 'Zane', 'Ava', 'Bea', 'Cleo', 'Drew', 'Eli', 'Finn'].slice(0, demoCourts * 4);
  if (mode === 'fixed') {
    for (let i = 0; i < names.length; i += 2) event = addAmericanoFixedTeamV3(event, { teamName: `Pair ${i / 2 + 1}`, playerOne: names[i], playerTwo: names[i + 1] });
  } else {
    for (const name of names) event = addAmericanoParticipantV3(event, name);
  }
}
useEventStore.getState().loadEvent(event);
useEventStore.setState({ hydrated: true });
if (params.get('demo') === 'live') {
  void previewAmericanoScheduleV3(event, { seed: 82 }).then((preview) => {
    useEventStore.getState().loadEvent(startAmericanoEventV3(preview));
  }).catch((error) => console.error('Could not start the isolated Americano demo:', error));
}
useThemeStore.getState().setPreference(params.get('theme') === 'light' ? 'light' : 'dark');
function Fixture() {
  useApplyTheme();
  const current = useEventStore((state) => state.event) as VersionedEventState | null;
  if (!current || !isAmericanoEventV3(current)) return null;
  return <MemoryRouter initialEntries={[`/events/${current.id}/setup`]}>
    {current.status === 'setup' ? <div className="op"><TopNav event={current as unknown as EventState}/><AmericanoSetupV3 event={current}/><MobileTabBar event={current as unknown as EventState}/></div> : <AmericanoDisplayV3 event={current}/>}
  </MemoryRouter>;
}
ReactDOM.createRoot(document.getElementById('root')!).render(<Fixture/>);
