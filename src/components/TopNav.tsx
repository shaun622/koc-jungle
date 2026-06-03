import { useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useEventStore } from '@/store/eventStore';
import { downloadJsonFile, parseImportJson, toExportJson } from '@/utils/exportImport';
import { useAuth } from '@/hooks/useAuth';
import { useThemeStore } from '@/store/theme';
import { Icons } from './Icons';
import { AuthModal } from './AuthModal';
import { ConfirmDialog } from './ConfirmDialog';
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
  const resetEvent = useEventStore((s) => s.resetEvent);
  const loadEvent = useEventStore((s) => s.loadEvent);

  const [confirmNew, setConfirmNew] = useState(false);
  const [importError, setImportError] = useState<string | null>(null);
  const [authOpen, setAuthOpen] = useState(false);
  const auth = useAuth();
  const themePref = useThemeStore((s) => s.preference);
  const cycleTheme = useThemeStore((s) => s.cyclePreference);
  const ThemeIcon =
    themePref === 'dark' ? Icons.Moon : themePref === 'light' ? Icons.Sun : Icons.Auto;
  const themeTitle =
    themePref === 'dark' ? 'Dark theme — tap for light' :
    themePref === 'light' ? 'Light theme — tap for auto' :
    'Auto theme (system) — tap for dark';

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
    <>
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
          <button
            className="btn ghost sm theme-toggle"
            onClick={cycleTheme}
            title={themeTitle}
            aria-label={themeTitle}
          >
            <ThemeIcon className="icon" />
          </button>
          {auth.cloudEnabled && (
            <button
              className={'btn ghost sm ' + (auth.user ? 'sync-on' : '')}
              onClick={() => setAuthOpen(true)}
              title={auth.user ? `Synced as ${auth.user.email ?? 'cloud user'}` : 'Sign in to sync'}
            >
              {auth.user ? '☁ Synced' : 'Sign in'}
            </button>
          )}
          <button
            className="btn ghost sm"
            onClick={() => setConfirmNew(true)}
            title="Start a new event (clears current)"
          >
            + New
          </button>
          <ImportEventButton onLoad={loadEvent} onError={setImportError} />
          <button
            className="btn ghost sm"
            onClick={() => {
              const filename = `koc-${event.name.replace(/[^a-z0-9-_]+/gi, '-')}-${new Date()
                .toISOString()
                .slice(0, 10)}.json`;
              downloadJsonFile(filename, toExportJson(event));
            }}
            title="Export current event as JSON"
          >
            Export
          </button>
        </div>
      </div>

      <ConfirmDialog
        open={confirmNew}
        title="Start a new event?"
        message="This clears the current event — teams, scores, rounds, podium. Export first if you want to keep them."
        confirmLabel="Yes, start fresh"
        destructive
        onConfirm={() => {
          resetEvent();
          setConfirmNew(false);
          setTimeout(() => navigate('/setup'), 0);
        }}
        onCancel={() => setConfirmNew(false)}
      />

      {importError && (
        <ConfirmDialog
          open
          title="Couldn't import that file"
          message={importError}
          confirmLabel="OK"
          cancelLabel="Dismiss"
          onConfirm={() => setImportError(null)}
          onCancel={() => setImportError(null)}
        />
      )}

      {authOpen && <AuthModal onClose={() => setAuthOpen(false)} />}
    </>
  );
}

function ImportEventButton({
  onLoad,
  onError,
}: {
  onLoad: (event: EventState) => void;
  onError: (message: string | null) => void;
}) {
  return (
    <label
      className="btn ghost sm"
      style={{ cursor: 'pointer' }}
      title="Import an event from JSON"
    >
      Import
      <input
        type="file"
        accept="application/json,.json"
        style={{ display: 'none' }}
        onChange={async (e) => {
          const file = e.target.files?.[0];
          if (!file) return;
          try {
            const text = await file.text();
            const parsed = parseImportJson(text);
            onLoad(parsed);
            onError(null);
          } catch (err) {
            onError(err instanceof Error ? err.message : 'Could not parse file.');
          }
          e.target.value = '';
        }}
      />
    </label>
  );
}
