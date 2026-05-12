import { useEffect } from 'react';
import {
  HashRouter,
  Navigate,
  Outlet,
  Route,
  Routes,
  useLocation,
  useNavigate,
} from 'react-router-dom';
import { useEventStore } from '@/store/eventStore';
import { SetupScreen } from '@/routes/SetupScreen';
import { QualifierScreen } from '@/routes/QualifierScreen';
import { SeedingScreen } from '@/routes/SeedingScreen';
import { RoundScreen } from '@/routes/RoundScreen';
import { BetweenRoundsScreen } from '@/routes/BetweenRoundsScreen';
import { LeaderboardScreen } from '@/routes/LeaderboardScreen';
import { PodiumScreen } from '@/routes/PodiumScreen';
import { DisplayScreen } from '@/routes/DisplayScreen';
import { NotFound } from '@/routes/NotFound';
import { TopNav } from '@/components/TopNav';
import { ErrorBanner } from '@/components/ErrorBanner';
import { PresentationToggle } from '@/components/PresentationToggle';
import { useStorageBroadcast } from '@/hooks/useStorageBroadcast';
import { usePresentationMode } from '@/hooks/usePresentationMode';
import type { EventStatus } from '@/types/domain';

function routeForStatus(status: EventStatus): string {
  switch (status) {
    case 'qualifier':
      return '/qualifier';
    case 'seeding':
      return '/seeding';
    case 'round-in-progress':
      return '/round';
    case 'between-rounds':
      return '/between';
    case 'complete':
      return '/complete';
    case 'setup':
    default:
      return '/setup';
  }
}

const FREE_PATHS = new Set(['/leaderboard', '/display', '/setup', '/complete']);
const PRESENTATION_PATHS = new Set(['/round', '/between']);

function RouteGate() {
  const event = useEventStore((s) => s.event);
  const location = useLocation();
  const navigate = useNavigate();

  useEffect(() => {
    if (!event) {
      if (location.pathname !== '/setup' && location.pathname !== '/display') {
        navigate('/setup', { replace: true });
      }
      return;
    }
    if (FREE_PATHS.has(location.pathname)) return;
    const expected = routeForStatus(event.status);
    if (location.pathname !== expected) {
      navigate(expected, { replace: true });
    }
  }, [event, location.pathname, navigate]);

  return null;
}

function OperatorShell() {
  const event = useEventStore((s) => s.event);
  const location = useLocation();
  const [presentation] = usePresentationMode();
  const showPresentationToggle = PRESENTATION_PATHS.has(location.pathname);
  const applyPresentation = presentation && PRESENTATION_PATHS.has(location.pathname);

  return (
    <div className={'op ' + (applyPresentation ? 'presentation' : '')}>
      {event && <TopNav event={event} />}
      <Outlet />
      {showPresentationToggle && <PresentationToggle />}
    </div>
  );
}

function PresentationKeyboard() {
  const location = useLocation();
  const [, toggle] = usePresentationMode();
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'p' && e.key !== 'P') return;
      if (!PRESENTATION_PATHS.has(location.pathname)) return;
      const target = e.target as HTMLElement | null;
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) {
        return;
      }
      e.preventDefault();
      toggle();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [location.pathname, toggle]);
  return null;
}

export function App() {
  const hydrated = useEventStore((s) => s.hydrated);
  useStorageBroadcast();

  useEffect(() => {
    if (useEventStore.persist) {
      if (useEventStore.persist.hasHydrated()) {
        useEventStore.setState({ hydrated: true });
      }
      const unsub = useEventStore.persist.onFinishHydration(() => {
        useEventStore.setState({ hydrated: true });
      });
      return unsub;
    }
  }, []);

  if (!hydrated) {
    return <div className="splash">Loading…</div>;
  }

  return (
    <HashRouter>
      <ErrorBanner />
      <RouteGate />
      <PresentationKeyboard />
      <Routes>
        <Route path="/display" element={<DisplayScreen />} />
        <Route element={<OperatorShell />}>
          <Route index element={<Navigate to="/setup" replace />} />
          <Route path="/setup" element={<SetupScreen />} />
          <Route path="/qualifier" element={<QualifierScreen />} />
          <Route path="/seeding" element={<SeedingScreen />} />
          <Route path="/round" element={<RoundScreen />} />
          <Route path="/between" element={<BetweenRoundsScreen />} />
          <Route path="/complete" element={<PodiumScreen />} />
          <Route path="/leaderboard" element={<LeaderboardScreen />} />
          <Route path="*" element={<NotFound />} />
        </Route>
      </Routes>
    </HashRouter>
  );
}
