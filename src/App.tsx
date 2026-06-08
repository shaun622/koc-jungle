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
import { LeaderboardScreen } from '@/routes/LeaderboardScreen';
import { DisplayScreen } from '@/routes/DisplayScreen';
import { HelpScreen } from '@/routes/HelpScreen';
import { HomeScreen } from '@/routes/HomeScreen';
import { NotFound } from '@/routes/NotFound';
import { TopNav } from '@/components/TopNav';
import { MobileTabBar } from '@/components/MobileTabBar';
import { ErrorBanner } from '@/components/ErrorBanner';
import { UpdatePrompt } from '@/components/UpdatePrompt';
import { useStorageBroadcast } from '@/hooks/useStorageBroadcast';
import { useAuth } from '@/hooks/useAuth';
import { useApplyTheme } from '@/hooks/useApplyTheme';
import { startCloudSync, stopCloudSync } from '@/store/cloudSync';
import { logInIAP, logOutIAP } from '@/lib/iap';
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
      return '/display';
    case 'complete':
      // The TV-mode complete canvas on /display is the podium.
      return '/display';
    case 'setup':
    default:
      return '/setup';
  }
}

const FREE_PATHS = new Set(['/leaderboard', '/display', '/setup', '/complete', '/help', '/home']);

function RouteGate() {
  const event = useEventStore((s) => s.event);
  const location = useLocation();
  const navigate = useNavigate();

  useEffect(() => {
    if (!event) {
      // No event: the home screen is the launch pad.
      if (location.pathname !== '/home' && location.pathname !== '/display') {
        navigate('/home', { replace: true });
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
      {event && <MobileTabBar event={event} />}
    </div>
  );
}

function CloudSyncGate() {
  const auth = useAuth();

  // Identify the RevenueCat customer with the signed-in account so Pro
  // follows the user across devices and can be comped by user id from the
  // dashboard. Independent of cloud sync; no-op on web.
  useEffect(() => {
    if (auth.loading) return;
    if (auth.user) logInIAP(auth.user.id);
    else logOutIAP();
  }, [auth.loading, auth.user]);

  useEffect(() => {
    if (!auth.cloudEnabled || auth.loading) return;
    if (auth.user) {
      const stop = startCloudSync(auth.user.id);
      return stop;
    }
    stopCloudSync();
  }, [auth.cloudEnabled, auth.loading, auth.user]);
  return null;
}

export function App() {
  const hydrated = useEventStore((s) => s.hydrated);
  useStorageBroadcast();
  useApplyTheme();

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
      <UpdatePrompt />
      <CloudSyncGate />
      <RouteGate />
      <Routes>
        <Route path="/display" element={<DisplayScreen />} />
        <Route path="/home" element={<HomeScreen />} />
        <Route element={<OperatorShell />}>
          <Route index element={<Navigate to="/home" replace />} />
          <Route path="/setup" element={<SetupScreen />} />
          <Route path="/qualifier" element={<QualifierScreen />} />
          <Route path="/seeding" element={<SeedingScreen />} />
          {/* Legacy route — the podium now lives on the /display complete
              canvas. Redirect any stale /complete link there. */}
          <Route path="/complete" element={<Navigate to="/display" replace />} />
          <Route path="/leaderboard" element={<LeaderboardScreen />} />
          <Route path="/help" element={<HelpScreen />} />
          <Route path="*" element={<NotFound />} />
        </Route>
      </Routes>
    </HashRouter>
  );
}
