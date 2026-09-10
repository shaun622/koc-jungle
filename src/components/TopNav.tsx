import { useNavigate, useLocation } from 'react-router-dom';
import { BrandLogo } from './BrandLogo';
import { AppMenu } from './AppMenu';
import { useClubBrandingStore } from '@/store/clubBranding';
import { eventRoute, type EventRouteName } from '@/lib/eventRoutes';
import type { EventState, EventStatus } from '@/types/domain';

interface TabDef {
  route: EventRouteName;
  label: string;
  showFor?: EventStatus[];
}

const TABS: TabDef[] = [
  { route: 'setup', label: 'Setup', showFor: ['setup'] },
  { route: 'qualifier', label: 'Qualifier', showFor: ['qualifier'] },
  { route: 'seeding', label: 'Seeding', showFor: ['seeding'] },
  { route: 'display', label: 'Live', showFor: ['round-in-progress', 'between-rounds'] },
  { route: 'display', label: 'Podium', showFor: ['complete'] },
  { route: 'leaderboard', label: 'Standings' },
];

interface Props {
  event: EventState;
}

export function TopNav({ event }: Props) {
  const navigate = useNavigate();
  const location = useLocation();
  const clubName = useClubBrandingStore((s) => s.name);
  const clubLogo = useClubBrandingStore((s) => s.logoDataUrl);

  const currentRound = event.rounds[event.rounds.length - 1];
  const roundIndex =
    event.status === 'round-in-progress' || event.status === 'between-rounds'
      ? (currentRound?.index ?? 0)
      : 0;

  const visibleTabs = TABS.filter((t) => !t.showFor || t.showFor.includes(event.status));

  const isTabActive = (tab: TabDef) => {
    if (location.pathname === eventRoute(event.id, tab.route)) return true;
    if (location.pathname === '/' && tab.route === 'setup' && event.status === 'setup') return true;
    return false;
  };

  return (
    <div className="op-top">
      <div className="op-top-left">
        <button
          className="chrome-brand"
          onClick={() => navigate('/home')}
          title="Home"
          aria-label="Home"
        >
          <div className="brand-mark">
            {clubLogo ? <img src={clubLogo} alt={clubName || 'Club logo'} /> : <BrandLogo />}
          </div>
          <span className="chrome-brand-name">
            {clubName ? clubName : 'PADEL TOURNAMENT MAKER'}
          </span>
        </button>
        <span className="op-top-meta">
          {event.name}
          {roundIndex > 0 && ` • R${roundIndex}/${event.settings.roundsTotal}`}
        </span>
      </div>
      <div className="op-top-center">
        {visibleTabs.map((tab) => (
          <button
            key={tab.route}
            className={'op-tab ' + (isTabActive(tab) ? 'active' : '')}
            onClick={() => navigate(eventRoute(event.id, tab.route))}
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
