import { useNavigate, useLocation } from 'react-router-dom';
import { useEventStore } from '@/store/eventStore';
import { downloadJsonFile, toExportJson } from '@/utils/exportImport';
import type { EventState, EventStatus } from '@/types/domain';

interface TabDef {
  path: string;
  label: string;
  statuses: EventStatus[];
}

const TABS: TabDef[] = [
  { path: '/setup', label: 'Setup', statuses: ['setup'] },
  { path: '/qualifier', label: 'Qualifier', statuses: ['qualifier'] },
  { path: '/seeding', label: 'Seeding', statuses: ['seeding'] },
  { path: '/round', label: 'Round', statuses: ['round-in-progress'] },
  { path: '/between', label: 'Rotation', statuses: ['between-rounds'] },
  { path: '/leaderboard', label: 'Standings', statuses: ['complete'] },
];

interface Props {
  event: EventState;
}

export function TopNav({ event }: Props) {
  const navigate = useNavigate();
  const location = useLocation();
  const setQualifierStatus = useEventStore((s) => s);

  const currentRound = event.rounds[event.rounds.length - 1];
  const roundIndex = event.status === 'round-in-progress'
    ? currentRound?.index ?? 0
    : event.status === 'between-rounds'
      ? currentRound?.index ?? 0
      : 0;

  const goTo = (path: string) => {
    navigate(path);
  };

  // Highlight current tab by either route or by event status
  const isTabActive = (tab: TabDef) => {
    if (location.pathname === tab.path) return true;
    if (location.pathname === '/' && tab.path === '/setup' && event.status === 'setup') return true;
    return false;
  };

  return (
    <div className="op-top">
      <div className="op-top-left">
        <div className="chrome-brand">
          <div className="brand-mark">K</div>
          <span>KING OF THE COURT</span>
        </div>
        <span className="op-top-meta">
          {event.name}
          {roundIndex > 0 && ` • R${roundIndex}/${event.settings.roundsTotal}`}
        </span>
      </div>
      <div className="op-top-center">
        {TABS.map((tab) => (
          <button
            key={tab.path}
            className={'op-tab ' + (isTabActive(tab) ? 'active' : '')}
            onClick={() => goTo(tab.path)}
          >
            {tab.label}
          </button>
        ))}
      </div>
      <div className="op-top-right">
        <button
          className="btn ghost sm"
          onClick={() => {
            const filename = `koc-${event.name.replace(/[^a-z0-9-_]+/gi, '-')}-${new Date()
              .toISOString()
              .slice(0, 10)}.json`;
            downloadJsonFile(filename, toExportJson(event));
          }}
        >
          Export
        </button>
        <button
          className="btn ghost sm"
          onClick={() => goTo('/display')}
        >
          TV
        </button>
      </div>
    </div>
  );

  // satisfy unused warning if router actions are not consumed
  void setQualifierStatus;
}
