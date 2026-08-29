import { useEffect, useState } from 'react';
import {
  HashRouter,
  Navigate,
  Outlet,
  Route,
  Routes,
  useLocation,
  useNavigate,
  useParams,
} from 'react-router-dom';
import { useEventStore } from '@/store/eventStore';
import { useEventCatalogStore } from '@/store/eventCatalog';
import { SetupScreen } from '@/routes/SetupScreen';
import { QualifierScreen } from '@/routes/QualifierScreen';
import { SeedingScreen } from '@/routes/SeedingScreen';
import { LeaderboardScreen } from '@/routes/LeaderboardScreen';
import { DisplayScreen } from '@/routes/DisplayScreen';
import { HelpScreen } from '@/routes/HelpScreen';
import { HomeScreen } from '@/routes/HomeScreen';
import { PublicSignupScreen } from '@/routes/PublicSignupScreen';
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
import { isPublicSignupPath } from '@/lib/signups';
import { useEntitlementsStore } from '@/store/entitlements';
import { eventIdFromPath, eventRoute, eventRouteForStatus, routeNameForStatus } from '@/lib/eventRoutes';

const FREE_EVENT_ROUTES = new Set(['leaderboard', 'display', 'setup']);

function EventRouteGate() {
  const event = useEventStore((s) => s.event);
  const location = useLocation();
  const navigate = useNavigate();

  useEffect(() => {
    if (!event) return;
    const routeName = location.pathname.split('/').filter(Boolean).at(-1) ?? '';
    if (FREE_EVENT_ROUTES.has(routeName)) return;
    const expectedName = routeNameForStatus(event.status);
    if (routeName !== expectedName) navigate(eventRoute(event.id, expectedName), { replace: true });
  }, [event, location.pathname, navigate]);

  return <Outlet />;
}

function EventSelectionGate() {
  const { eventId = '' } = useParams();
  const event = useEventStore((s) => s.event);
  const selectEvent = useEventStore((s) => s.selectEventById);
  const loadPinnedEvent = useEventStore((s) => s.loadPinnedEventById);
  const activeEventId = useEventCatalogStore((s) => s.activeEventId);
  const catalogRevision = useEventCatalogStore((s) =>
    s.events.map((item) => `${item.id}:${item.updatedAt}`).join('|'),
  );
  const location = useLocation();
  const navigate = useNavigate();
  const [missing, setMissing] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setMissing(false);
    const displayIsPinned = location.pathname.endsWith('/display');
    if (!eventId) return;
    if (event?.id === eventId && (displayIsPinned || activeEventId === eventId)) return;
    const load = displayIsPinned ? loadPinnedEvent : selectEvent;
    void load(eventId)
      .then((selected) => {
        if (!cancelled && !selected) setMissing(true);
      })
      .catch(() => {
        if (!cancelled) setMissing(true);
      });
    return () => { cancelled = true; };
  }, [activeEventId, catalogRevision, event?.id, eventId, loadPinnedEvent, location.pathname, selectEvent]);

  if (missing) {
    return (
      <div className="splash" style={{ flexDirection: 'column', gap: 16 }}>
        <span>This event is not available yet. It may still be syncing.</span>
        <button className="btn primary" onClick={() => navigate('/home')}>Open event library</button>
      </div>
    );
  }
  if (!eventId || event?.id !== eventId) return <div className="splash">Loading event…</div>;
  return <Outlet />;
}

function EventStatusRedirect() {
  const event = useEventStore((s) => s.event);
  return event ? <Navigate to={eventRouteForStatus(event)} replace /> : <Navigate to="/home" replace />;
}

function LegacyEventRedirect({ route }: { route?: 'setup' | 'qualifier' | 'seeding' | 'display' | 'leaderboard' }) {
  const event = useEventStore((s) => s.event);
  if (!event) return <Navigate to="/home" replace />;
  return <Navigate to={route ? eventRoute(event.id, route) : eventRouteForStatus(event)} replace />;
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

function OperatorCloudSyncGate() {
  const auth = useAuth();
  const userId = auth.user?.id ?? null;

  // Identify the RevenueCat customer with the signed-in account so Pro
  // follows the user across devices and can be comped by user id from the
  // dashboard. Independent of cloud sync; no-op on web.
  useEffect(() => {
    if (auth.loading) return;
    if (userId) logInIAP(userId);
    else logOutIAP();
  }, [auth.loading, userId]);

  useEffect(() => {
    if (!auth.cloudEnabled || auth.loading) return;
    if (userId) {
      const stop = startCloudSync(userId);
      return stop;
    }
    stopCloudSync();
  }, [auth.cloudEnabled, auth.loading, userId]);
  return null;
}

function CloudSyncGate() {
  const location = useLocation();
  if (isPublicSignupPath(location.pathname)) return null;
  return <OperatorCloudSyncGate />;
}

function StorageBroadcastGate() {
  const location = useLocation();
  // Every event-scoped route is pinned to the UUID in its URL. A second tab
  // may open or display another competition without replacing the event this
  // operator tab is editing.
  const pinnedEventId = eventIdFromPath(location.pathname);
  useStorageBroadcast(!isPublicSignupPath(location.pathname), pinnedEventId);
  return null;
}

export function App() {
  const hydrated = useEventStore((s) => s.hydrated);
  const catalogHydrated = useEventCatalogStore((s) => s.hydrated);
  useApplyTheme();

  // Keep the local seven-day trial honest. Check at launch, once a minute
  // while the app is open, and whenever it returns to the foreground.
  useEffect(() => {
    const tickTrial = () => useEntitlementsStore.getState().tickTrial();
    const onVisibilityChange = () => {
      if (!document.hidden) tickTrial();
    };

    tickTrial();
    const intervalId = window.setInterval(tickTrial, 60_000);
    document.addEventListener('visibilitychange', onVisibilityChange);

    return () => {
      window.clearInterval(intervalId);
      document.removeEventListener('visibilitychange', onVisibilityChange);
    };
  }, []);

  useEffect(() => {
    void useEventStore.getState().initializeCatalog();
  }, []);

  if (!hydrated || !catalogHydrated) {
    return <div className="splash">Loading…</div>;
  }

  return (
    <HashRouter>
      <ErrorBanner />
      <UpdatePrompt />
      <StorageBroadcastGate />
      <CloudSyncGate />
      <Routes>
        <Route path="/signup/:accountSlug/:slug" element={<PublicSignupScreen />} />
        <Route path="/signup/:slug" element={<PublicSignupScreen />} />
        <Route path="/home" element={<HomeScreen />} />
        <Route path="/help" element={<HelpScreen />} />
        <Route path="/events/:eventId" element={<EventSelectionGate />}>
          <Route element={<EventRouteGate />}>
            <Route index element={<EventStatusRedirect />} />
            <Route path="display" element={<DisplayScreen />} />
            <Route element={<OperatorShell />}>
              <Route path="setup" element={<SetupScreen />} />
              <Route path="qualifier" element={<QualifierScreen />} />
              <Route path="seeding" element={<SeedingScreen />} />
              <Route path="complete" element={<EventStatusRedirect />} />
              <Route path="leaderboard" element={<LeaderboardScreen />} />
            </Route>
          </Route>
        </Route>
        <Route path="/setup" element={<LegacyEventRedirect route="setup" />} />
        <Route path="/qualifier" element={<LegacyEventRedirect route="qualifier" />} />
        <Route path="/seeding" element={<LegacyEventRedirect route="seeding" />} />
        <Route path="/display" element={<LegacyEventRedirect route="display" />} />
        <Route path="/complete" element={<LegacyEventRedirect route="display" />} />
        <Route path="/leaderboard" element={<LegacyEventRedirect route="leaderboard" />} />
        <Route index element={<Navigate to="/home" replace />} />
        <Route path="*" element={<NotFound />} />
      </Routes>
    </HashRouter>
  );
}
