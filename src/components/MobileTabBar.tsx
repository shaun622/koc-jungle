/**
 * MobileTabBar: thumb-friendly bottom navigation shown only on phone
 * viewports (hidden on iPad / desktop via CSS). Mirrors the status-aware
 * tabs from TopNav but as big bottom targets for one-handed use courtside.
 *
 * Rendered by OperatorShell so it appears on every operator route. The
 * /display canvas hides it (it has its own bottom toolbar).
 */

import { useNavigate, useLocation } from 'react-router-dom';
import { Icons } from './Icons';
import type { EventState, EventStatus } from '@/types/domain';

interface TabDef {
  path: string;
  label: string;
  icon: keyof typeof Icons;
  showFor?: EventStatus[];
}

const TABS: TabDef[] = [
  { path: '/setup', label: 'Setup', icon: 'Home', showFor: ['setup'] },
  { path: '/qualifier', label: 'Qualifier', icon: 'Timer', showFor: ['qualifier'] },
  { path: '/seeding', label: 'Seeding', icon: 'List', showFor: ['seeding'] },
  { path: '/display', label: 'Live', icon: 'Play', showFor: ['round-in-progress', 'between-rounds'] },
  { path: '/display', label: 'Podium', icon: 'Trophy', showFor: ['complete'] },
  { path: '/leaderboard', label: 'Standings', icon: 'List' },
];

export function MobileTabBar({ event }: { event: EventState }) {
  const navigate = useNavigate();
  const location = useLocation();
  const tabs = TABS.filter((t) => !t.showFor || t.showFor.includes(event.status));

  const isActive = (tab: TabDef) =>
    location.pathname === tab.path ||
    (location.pathname === '/' && tab.path === '/setup' && event.status === 'setup');

  return (
    <nav className="mobile-tabbar" aria-label="Primary">
      {tabs.map((tab) => {
        const Icon = Icons[tab.icon];
        return (
          <button
            key={tab.label}
            className={'mobile-tab ' + (isActive(tab) ? 'active' : '')}
            onClick={() => navigate(tab.path)}
          >
            <Icon className="icon" />
            <span>{tab.label}</span>
          </button>
        );
      })}
    </nav>
  );
}
