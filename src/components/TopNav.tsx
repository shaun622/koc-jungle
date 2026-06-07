import { useNavigate, useLocation } from 'react-router-dom';
import { BrandLogo } from './BrandLogo';
import { AppMenu } from './AppMenu';
import type { EventState, EventStatus } from '@/types/domain';

interface TabDef {
  path: string;
  label: string;
  showFor?: EventStatus[];
}

const TABS: TabDef[] = [
  { path: '/setup', label: 'Setup', showFor: ['setup'] },
  { path: '/qualifier', label: 'Qualifier', showFor: ['qualifier'] },
  { path: '/seeding', label: 'Seeding', showFor: ['seeding'] },
  { path: '/display', label: 'Live', showFor: ['round-in-progress', 'between-rounds'] },
  { path: '/display', label: 'Podium', showFor: ['complete'] },
  { path: '/leaderboard', label: 'Standings' },
];

interface Props {
  event: EventState;
}

export function TopNav({ event }: Props) {
  const navigate = useNavigate();
  const location = useLocation();

  const currentRound = event.rounds[event.rounds.length - 1];
  const roundIndex =
    event.status === 'round-in-progress' || event.status === 'between-rounds'
      ? (currentRound?.index ?? 0)
      : 0;

  const visibleTabs = TABS.filter((t) => !t.showFor || t.showFor.includes(event.status));

  const isTabActive = (tab: TabDef) => {
    if (location.pathname === tab.path) return true;
    if (location.pathname === '/' && tab.path === '/setup' && event.status === 'setup') return true;
    return false;
  };

  return (
    <div className="op-top">
      <div className="op-top-left">
        <div className="chrome-brand">
          <div className="brand-mark"><BrandLogo /></div>
          <span className="chrome-brand-name">PADEL TOURNAMENT MAKER</span>
        </div>
        <span className="op-top-meta">
          {event.name}
          {roundIndex > 0 && ` • R${roundIndex}/${event.settings.roundsTotal}`}
        </span>
      </div>
      <div className="op-top-center">
        {visibleTabs.map((tab) => (
          <button
            key={tab.path}
            className={'op-tab ' + (isTabActive(tab) ? 'active' : '')}
            onClick={() => navigate(tab.path)}
          >
            {tab.label}
          </button>
        ))}
      </div>
      <div className="op-top-right">
        <AppMenu event={event} />
      </div>
    </div>
  );
}
