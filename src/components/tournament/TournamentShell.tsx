import { useEffect } from 'react';
import { NavLink, Outlet, useNavigate, useParams } from 'react-router-dom';
import { BrandLogo } from '@/components/BrandLogo';
import { ThemeSwitch } from '@/components/ThemeSwitch';
import { LOCAL_TOURNAMENT_OWNER, useTournamentStore } from '@/store/tournamentStore';
import { getAuthSessionGeneration, isAuthSessionGenerationCurrent, useAuth } from '@/hooks/useAuth';

export function TournamentShell({ mode }: { mode: 'connected' | 'demo' }) {
  const { tournamentId = '' } = useParams();
  const navigate = useNavigate();
  const active = useTournamentStore((state) => state.active);
  const hydrated = useTournamentStore((state) => state.hydrated);
  const busy = useTournamentStore((state) => state.busy);
  const error = useTournamentStore((state) => state.error);
  const readOnly = useTournamentStore((state) => state.readOnly);
  const auth = useAuth();
  const connectedOwnerId = auth.user?.id ?? '';

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      if (mode === 'connected') {
        if (!connectedOwnerId) return;
        if (!useTournamentStore.getState().hydrated || useTournamentStore.getState().ownerId !== connectedOwnerId) await useTournamentStore.getState().hydrateConnected(connectedOwnerId);
      } else if (!useTournamentStore.getState().hydrated || useTournamentStore.getState().ownerId !== LOCAL_TOURNAMENT_OWNER) await useTournamentStore.getState().hydrate(LOCAL_TOURNAMENT_OWNER);
      if (!cancelled && useTournamentStore.getState().active?.tournamentId !== tournamentId) {
        await useTournamentStore.getState().openTournament(tournamentId);
      }
      const opened = useTournamentStore.getState().active;
      if (!cancelled && mode === 'connected' && opened?.tournamentId === tournamentId && opened.outbox.length) {
        const generation = getAuthSessionGeneration();
        await useTournamentStore.getState().syncActive(generation, isAuthSessionGenerationCurrent);
      }
    };
    void load();
    return () => { cancelled = true; };
  }, [connectedOwnerId, mode, tournamentId]);

  useEffect(() => {
    if (mode !== 'connected' || !auth.user || !active || active.tournamentId !== tournamentId || !active.outbox.length || readOnly) return;
    const generation = getAuthSessionGeneration();
    void useTournamentStore.getState().syncActive(generation, isAuthSessionGenerationCurrent);
  }, [active?.outbox.length, active?.tournamentId, auth.user?.id, mode, readOnly, tournamentId]);

  if (mode === 'connected' && auth.loading) return <div className="splash">Checking your account…</div>;
  if (mode === 'connected' && !auth.cloudEnabled) return <div className="splash tv1-missing"><p>Connected Tournament storage is not configured in this build.</p><button className="btn primary" onClick={() => navigate('/home')}>Back to events</button></div>;
  if (mode === 'connected' && !auth.user) return <div className="splash tv1-missing"><p>Sign in from the event library to open this Tournament.</p><button className="btn primary" onClick={() => navigate('/home')}>Go to sign in</button></div>;

  if (!hydrated || busy) return <div className="splash">Loading tournament…</div>;
  if (!active || active.tournamentId !== tournamentId) return <div className="splash tv1-missing"><p>{error || 'Tournament not found on this device.'}</p><button className="btn primary" onClick={() => navigate('/home')}>Back to events</button></div>;
  const state = active.projected;

  return <div className="tv1">
    <header className="tv1-header">
      <button className="tv1-brand" onClick={() => navigate('/home')}><BrandLogo/><span>PADEL<small>TOURNAMENT DESK</small></span></button>
      <div className="tv1-event-title"><strong>{state.meta.title}</strong><span className={`tv1-status ${state.lifecycle}`}>{state.lifecycle}</span></div>
      <ThemeSwitch />
    </header>
    <nav className="tv1-nav" aria-label="Tournament sections">
      {(['setup','entries','draw','desk','courts','history'] as const).map((route) => <NavLink key={route} to={`/${mode === 'demo' ? 'tournament-demo' : 'tournaments'}/${tournamentId}/${route}`}>{route}</NavLink>)}
      {state.meta.publicSlug && <NavLink to={`/t/${state.meta.publicSlug}/display`}>TV display</NavLink>}
    </nav>
    <div className="tv1-syncbar">
      <span>{active.mode === 'demo' ? 'Local demo · never synced' : active.outbox.length ? `Saved on this device · ${active.outbox.length} unsynced change${active.outbox.length === 1 ? '' : 's'}` : active.remoteStatus === 'synced' ? 'Synced to your account' : `Saved on this device · ${active.remoteStatus}`}</span>
      <span>{readOnly ? <><strong>Read-only:</strong> another tab controls this tournament. <button className="tv1-link-button" onClick={() => void useTournamentStore.getState().takeOverLocalTab()}>Take over this tab</button></> : `Revision ${state.revision}`}</span>
    </div>
    {error && <div className="tv1-alert error" role="alert">{error}</div>}
    <Outlet />
  </div>;
}
