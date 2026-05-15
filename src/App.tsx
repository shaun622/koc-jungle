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
import { BetweenRoundsScreen } from '@/routes/BetweenRoundsScreen';
import { LeaderboardScreen } from '@/routes/LeaderboardScreen';
import { PodiumScreen } from '@/routes/PodiumScreen';
import { DisplayScreen } from '@/routes/DisplayScreen';
import { NotFound } from '@/routes/NotFound';
import { TopNav } from '@/components/TopNav';
import { ErrorBanner } from '@/components/ErrorBanner';
import { useStorageBroadcast } from '@/hooks/useStorageBroadcast';
import type { EventStatus } from '@/types/domain';

function routeForStatus(status: EventStatus): string {
  switch (status) {
    case 'qualifier':
      return '/qualifier';
    case 'seeding':
      return '/seeding';
    case 'round-in-progress':
      return '/display';
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
  return (
    <div className="op">
      {event && <TopNav event={event} />}
      <Outlet />
    </div>
  );
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
      <Routes>
        <Route path="/display" element={<DisplayScreen />} />
        <Route element={<OperatorShell />}>
          <Route index element={<Navigate to="/setup" replace />} />
          <Route path="/setup" element={<SetupScreen />} />
          <Route path="/qualifier" element={<QualifierScreen />} />
          <Route path="/seeding" element={<SeedingScreen />} />
          <Route path="/between" element={<BetweenRoundsScreen />} />
          <Route path="/complete" element={<PodiumScreen />} />
          <Route path="/leaderboard" element={<LeaderboardScreen />} />
          <Route path="*" element={<NotFound />} />
        </Route>
      </Routes>
    </HashRouter>
  );
}
