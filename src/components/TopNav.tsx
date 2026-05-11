import { NavLink } from 'react-router-dom';
import { Crown, ListOrdered, Monitor, Settings as SettingsIcon, Timer as TimerIcon, Trophy } from 'lucide-react';
import { cn } from '@/utils/classNames';
import type { EventState } from '@/types/domain';

interface Props {
  event: EventState;
}

const navItems: { to: string; label: string; icon: typeof Crown; statuses?: EventState['status'][] }[] = [
  { to: '/setup', label: 'Setup', icon: SettingsIcon },
  { to: '/qualifier', label: 'Qualifier', icon: ListOrdered, statuses: ['qualifier', 'seeding'] },
  { to: '/round', label: 'Round', icon: TimerIcon, statuses: ['round-in-progress'] },
  { to: '/between', label: 'Between', icon: ListOrdered, statuses: ['between-rounds'] },
  { to: '/leaderboard', label: 'Leaderboard', icon: Trophy },
  { to: '/display', label: 'TV mode', icon: Monitor },
];

export function TopNav({ event }: Props) {
  const visible = navItems.filter((item) => !item.statuses || item.statuses.includes(event.status));
  return (
    <header className="sticky top-0 z-30 border-b border-slate-800 bg-slate-950/90 backdrop-blur">
      <div className="mx-auto max-w-7xl px-4 py-2.5 flex items-center gap-4">
        <div className="flex items-center gap-2 mr-2">
          <Crown className="h-5 w-5 text-amber-300" />
          <div className="leading-tight">
            <div className="text-xs uppercase tracking-wider text-slate-400">King of the Court</div>
            <div className="font-semibold text-slate-100 truncate max-w-[14rem]">{event.name}</div>
          </div>
        </div>
        <nav className="flex flex-wrap items-center gap-1">
          {visible.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              className={({ isActive }) =>
                cn(
                  'inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium',
                  isActive ? 'bg-emerald-500 text-emerald-950' : 'text-slate-300 hover:bg-slate-800',
                )
              }
            >
              <item.icon className="h-4 w-4" />
              {item.label}
            </NavLink>
          ))}
        </nav>
      </div>
    </header>
  );
}
