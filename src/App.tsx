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
import { RoundScreen } from '@/routes/RoundScreen';
import { BetweenRoundsScreen } from '@/routes/BetweenRoundsScreen';
import { LeaderboardScreen } from '@/routes/LeaderboardScreen';
import { DisplayScreen } from '@/routes/DisplayScreen';
import { NotFound } from '@/routes/NotFound';
import { TopNav } from '@/components/TopNav';
import { ErrorBanner } from '@/components/ErrorBanner';
import { useStorageBroadcast } from '@/hooks/useStorageBroadcast';

function routeForStatus(status: string): string {
  switch (status) {
    case 'qualifier':
    case 'seeding':
      return '/qualifier';
    case 'round-in-progress':
      return '/round';
    case 'between-rounds':
      return '/between';
    case 'complete':
      return '/leaderboard';
    case 'setup':
    default:
      return '/setup';
  }
}

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
    // Allow leaderboard, display, and setup at any time.
    const free = ['/leaderboard', '/display', '/setup'];
    if (free.includes(location.pathname)) return;
    const expected = routeForStatus(event.status);
    if (location.pathname !== expected) {
      navigate(expected, { replace: true });
    }
  }, [event, location.pathname, navigate]);

  return null;
}

function Shell() {
  const event = useEventStore((s) => s.event);
  return (
    <>
      {event && <TopNav event={event} />}
      <Outlet />
    </>
  );
}

export function App() {
  const hydrated = useEventStore((s) => s.hydrated);
  useStorageBroadcast();

  useEffect(() => {
    if (useEventStore.persist) {
      // If the store rehydrates before subscribe-time we still want hydrated=true.
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
    return (
      <div className="min-h-screen grid place-items-center text-slate-500">
        Loading…
      </div>
    );
  }

  return (
    <HashRouter>
      <ErrorBanner />
      <RouteGate />
      <Routes>
        <Route path="/display" element={<DisplayScreen />} />
        <Route element={<Shell />}>
          <Route index element={<Navigate to="/setup" replace />} />
          <Route path="/setup" element={<SetupScreen />} />
          <Route path="/qualifier" element={<QualifierScreen />} />
          <Route path="/round" element={<RoundScreen />} />
          <Route path="/between" element={<BetweenRoundsScreen />} />
          <Route path="/leaderboard" element={<LeaderboardScreen />} />
          <Route path="*" element={<NotFound />} />
        </Route>
      </Routes>
    </HashRouter>
  );
}
