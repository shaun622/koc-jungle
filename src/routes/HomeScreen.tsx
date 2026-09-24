import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { useEventStore } from '@/store/eventStore';
import { useEventCatalogStore } from '@/store/eventCatalog';
import type { EventCatalogMetadata } from '@/store/eventRepository';
import { deleteCloudEvent } from '@/store/cloudSync';
import { buildDemoEvent } from '@/logic/demoData';
import {
  deleteTemplate,
  listTemplates,
  templateToEventState,
  type Template,
} from '@/store/templates';
import { isFeatureLocked, isFormatLocked, useEntitlementsStore } from '@/store/entitlements';
import { useAuth } from '@/hooks/useAuth';
import { isIAPAvailable } from '@/lib/iap';
import { eventRouteForStatus } from '@/lib/eventRoutes';
import { BrandLogo } from '@/components/BrandLogo';
import { AppMenu } from '@/components/AppMenu';
import { AuthModal } from '@/components/AuthModal';
import { PaywallModal } from '@/components/PaywallModal';
import { FormatRulesModal } from '@/components/FormatRulesModal';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { Icons } from '@/components/Icons';
import type { EventStatus, TournamentFormatId } from '@/types/domain';
import type { VersionedEventState } from '@/logic/americanoV2/types';
import { isAmericanoEventV2 } from '@/logic/americanoV2/types';

import { ArrowRight, CalendarDays, MapPin, Users, Search, MoreHorizontal, Link as LinkIcon } from 'lucide-react';
import { getOwnedSignup, copySignupLink } from '@/lib/signups';
import { DesignDialog } from '@/components/DesignDialog';
import { ENABLE_AMERICANO_V2, ENABLE_TOURNAMENT_V1 } from '@/config/features';
import type { PairingMode } from '@/logic/americanoV2/types';
import { LOCAL_TOURNAMENT_OWNER, useTournamentStore } from '@/store/tournamentStore';


const RUNNING_STATUSES = new Set<EventStatus>(['qualifier', 'seeding', 'round-in-progress', 'between-rounds']);

export type LibraryFilter = 'upcoming' | 'drafts' | 'past' | 'hidden';
export function libraryFilterFor(event: EventCatalogMetadata): LibraryFilter {
  if (event.archivedAt !== null) return 'hidden';
  if (event.status === 'complete' || event.signupState === 'cancelled') return 'past';
  // A dated setup remains available until the organiser actually finishes it.
  return RUNNING_STATUSES.has(event.status) || event.startsAt ? 'upcoming' : 'drafts';
}
export function featuredLibraryEvent(events: EventCatalogMetadata[]): EventCatalogMetadata | undefined {
  const available = events.filter(e => libraryFilterFor(e) === 'upcoming');
  return available.find(e => RUNNING_STATUSES.has(e.status))
    ?? available.filter(e => e.startsAt && Date.parse(e.startsAt) > Date.now())
      .sort((a,b) => Date.parse(a.startsAt!) - Date.parse(b.startsAt!))[0]
    ?? available[0];
}
function formatName(event: EventCatalogMetadata): string {
  if (event.format === 'americano' && event.americanoMode) {
    return event.americanoMode === 'rotating' ? 'Americano · Rotating pairs' : 'Americano · Fixed pairs';
  }
  return ({koc:'King of the Court', americano:'Team Americano', 'round-robin':'Round Robin', bracket:'Tournament', mexicano:'Mexicano'})[event.format];
}
function statusSummary(event: EventCatalogMetadata): string {
  if (event.signupState === 'cancelled') return 'Sign-up cancelled';
  if (RUNNING_STATUSES.has(event.status)) return 'In progress';
  if (event.status === 'complete') return 'Completed';
  if (event.signupState === 'open' && (!event.startsAt || Date.parse(event.startsAt) > Date.now())) return 'Sign-ups open';
  if (event.signupState === 'unpublished') return 'Unpublished';
  return 'Sign-ups closed';
}
function cardActionLabel(status: EventStatus, archived = false): string {
  if (archived) return 'Restore & open';
  return status === 'complete' ? 'View results' : RUNNING_STATUSES.has(status) ? 'Resume event' : 'Open event';
}
function dateLabel(event: EventCatalogMetadata): string {
  if (!event.startsAt || !Number.isFinite(Date.parse(event.startsAt))) return 'Date not set';
  return new Intl.DateTimeFormat(undefined,{weekday:'short',day:'numeric',month:'short',hour:'numeric',minute:'2-digit'}).format(new Date(event.startsAt));
}

export function HomeScreen() {
  const createEvent = useEventStore(s => s.createEvent);
  const createAmericanoEvent = useEventStore(s => s.createAmericanoEvent);
  const loadEvent = useEventStore(s => s.loadEvent);
  const selectEvent = useEventStore(s => s.selectEventById);
  const archiveEvent = useEventStore(s => s.archiveLocalEvent);
  const deleteLocalEvent = useEventStore(s => s.deleteLocalEvent);
  const events = useEventCatalogStore(s => s.events);
  const tournamentRecords = useTournamentStore(s => s.records);
  const tournaments = ENABLE_TOURNAMENT_V1 ? tournamentRecords : [];
  const catalogError = useEventCatalogStore(s => s.lastError);
  const hydrated = useEventCatalogStore(s => s.hydrated);
  const navigate = useNavigate();
  const auth = useAuth();
  const pro = useEntitlementsStore(s => s.pro);
  const nativeBilling = isIAPAvailable();
  const [templates,setTemplates] = useState<Template[]>(() => listTemplates());
  const [authOpen,setAuthOpen] = useState(false);
  const [paywall,setPaywall] = useState<{
    reason: string;
    pendingEvent?: { name: string; format: TournamentFormatId; pairingMode?: PairingMode };
    pendingTournament?: boolean;
  }|null>(null);
  const [rulesForFormat,setRulesForFormat] = useState<TournamentFormatId|null>(null);
  const [deleteTarget,setDeleteTarget] = useState<EventCatalogMetadata|null>(null);
  const [deletingId,setDeletingId] = useState<string|null>(null);
  const [createOpen,setCreateOpen] = useState(false);
  const [americanoChoice,setAmericanoChoice] = useState(false);
  const [templatesOpen,setTemplatesOpen] = useState(false);
  const [filter,setFilter] = useState<LibraryFilter>('upcoming');
  const [query,setQuery] = useState('');
  const [copying,setCopying] = useState<string|null>(null);
  const [message,setMessage] = useState('');
  const libraryRef = useRef<HTMLElement>(null);
  // Refresh presentation labels when a scheduled event crosses its start time.
  const [,setMinute] = useState(0);
  useEffect(() => { const timer = window.setInterval(() => setMinute(n => n + 1),60_000); return () => clearInterval(timer); },[]);
  useEffect(() => {
    if (!ENABLE_TOURNAMENT_V1 || auth.loading) return;
    const store = useTournamentStore.getState();
    if (auth.cloudEnabled && auth.user) {
      if (!store.hydrated || store.ownerId !== auth.user.id) void store.hydrateConnected(auth.user.id);
    } else if (!store.hydrated || store.ownerId !== LOCAL_TOURNAMENT_OWNER) void store.hydrate(LOCAL_TOURNAMENT_OWNER);
  }, [auth.cloudEnabled, auth.loading, auth.user?.id]);
  const counts = useMemo(() => events.reduce((result,event) => {
    result[libraryFilterFor(event)]++; return result;
  },{upcoming:0,drafts:0,past:0,hidden:0}),[events]);
  const shown = events.filter(e => libraryFilterFor(e) === filter && (e.name + ' ' + e.venue).toLowerCase().includes(query.toLowerCase()));
  const featured = featuredLibraryEvent(events);
  const fullName = typeof auth.user?.user_metadata?.full_name === 'string' ? auth.user.user_metadata.full_name : auth.user?.email?.split('@')[0];
  const firstName = fullName?.split(' ')[0];
  const initials = (firstName || 'Menu').slice(0,2).toUpperCase();

  function openSelected(next: VersionedEventState | null) {
    if (next) navigate(eventRouteForStatus(next));
  }

  async function openEvent(id: string) {
    try {
      if (events.find((event) => event.id === id)?.archivedAt != null) {
        await archiveEvent(id, false);
      }
      openSelected(await selectEvent(id));
    } catch {
      // The catalog store exposes the useful error above the library.
    }
  }

  async function setArchived(id: string, archived = true) {
    try {
      await archiveEvent(id, archived);
    } catch {
      // The catalog store exposes the useful error above the library.
    }
  }

  function tryCreate(name: string, format: TournamentFormatId, displayName: string) {
    // Native dialogs occupy the browser's top layer: unmount the chooser
    // before opening the paywall so it cannot cover the subscription flow.
    setCreateOpen(false);
    if (isFormatLocked(format)) {
      setPaywall({
        reason: `Pro includes ${displayName}. Activate access to continue creating your event.`,
        pendingEvent: { name, format },
      });
      return;
    }
    createEvent(name, format);
    openSelected(useEventStore.getState().event);
  }

  function tryCreateAmericano(pairingMode: PairingMode) {
    if (!ENABLE_AMERICANO_V2) return;
    const displayName = pairingMode === 'rotating' ? 'Americano · Rotating pairs' : 'Americano · Fixed pairs';
    setCreateOpen(false);
    setAmericanoChoice(false);
    if (isFormatLocked('americano')) {
      setPaywall({
        reason: `Pro includes ${displayName}. Activate access to continue creating your event.`,
        pendingEvent: { name: 'Americano', format: 'americano', pairingMode },
      });
      return;
    }
    createAmericanoEvent('Americano', pairingMode);
    openSelected(useEventStore.getState().event as VersionedEventState | null);
  }

  async function createFlexibleTournament() {
    if (!ENABLE_TOURNAMENT_V1) return;
    setCreateOpen(false);
    if (isFeatureLocked()) { setPaywall({ reason: 'Pro includes the flexible tournament control desk.', pendingTournament: true }); return; }
    if (!auth.cloudEnabled || !auth.user) { setAuthOpen(true); return; }
    const record = await useTournamentStore.getState().createConnectedTournament({ title: 'Padel Tournament', courtCount: 4, timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC' });
    navigate(`/tournaments/${record.tournamentId}/setup`);
  }

  async function createTournamentDemo() {
    if (!ENABLE_TOURNAMENT_V1) return;
    setCreateOpen(false);
    const store = useTournamentStore.getState();
    if (store.ownerId !== LOCAL_TOURNAMENT_OWNER) await store.hydrate(LOCAL_TOURNAMENT_OWNER);
    const record = await useTournamentStore.getState().createTournament('Tournament demo');
    navigate(`/tournament-demo/${record.tournamentId}/setup`);
  }

  function closePaywall() {
    const pendingTournament = paywall?.pendingTournament;
    const pending = paywall?.pendingEvent;
    setPaywall(null);
    if (pendingTournament) {
      if (isFeatureLocked()) { setCreateOpen(true); return; }
      void createFlexibleTournament();
      return;
    }
    if (!pending) return;
    // Read the current entitlement: purchasing/restoring applies it before
    // closing the paywall. Cancelling must never create a locked event.
    if (isFormatLocked(pending.format)) {
      setCreateOpen(true);
      return;
    }
    if (pending.format === 'americano' && pending.pairingMode) {
      createAmericanoEvent(pending.name, pending.pairingMode);
    } else {
      createEvent(pending.name, pending.format);
    }
    openSelected(useEventStore.getState().event);
  }

  function loadAsNew(next: VersionedEventState) {
    if (next.format === 'americano' && !ENABLE_AMERICANO_V2) {
      setMessage('Americano is coming soon. You can still open existing events.');
      return;
    }
    if (isAmericanoEventV2(next)) {
      setMessage('This Americano template needs the new event flow, which is not enabled in this build.');
      return;
    }
    loadEvent(next);
    openSelected(useEventStore.getState().event);
  }


  async function copyLink(event: EventCatalogMetadata) {
    if (!auth.user) { setAuthOpen(true); return; }
    setCopying(event.id); setMessage('');
    try {
      const signup = await getOwnedSignup(auth.user.id,event.id);
      if (!signup) { setMessage('Publish a sign-up page from this event’s setup first.'); return; }
      await copySignupLink(signup);
      setMessage('Sign-up link copied.');
    } catch { setMessage('Could not copy the sign-up link. Check your connection and try again.'); }
    finally { setCopying(null); }
  }

  return (
    <div className="home event-design event-home">
      <header className="ed-header">
        <button className="ed-brand" onClick={() => navigate('/home')} aria-label="Padel Tournament Maker home"><BrandLogo /><span>PADEL<small>TOURNAMENT MAKER</small></span></button>
        <nav className="ed-nav" aria-label="Main navigation">
          <button className="active" onClick={() => libraryRef.current?.scrollIntoView({behavior:'smooth'})}>Events</button>
          <button onClick={() => { setTemplates(listTemplates()); setTemplatesOpen(true); }}>Templates</button>
          <button onClick={() => navigate('/help')}>Help & guides</button>
        </nav>
        <AppMenu event={null} onCreate={() => setCreateOpen(true)} trigger={<><span className="ed-avatar">{initials}</span><span className="ed-account-name">{firstName || 'Menu'}</span><span aria-hidden>⌄</span></>} />
      </header>
      <div className="ed-body">
        <div className="ed-heading"><div><p>{firstName ? `Good to see you, ${firstName}.` : 'Your club. Your court.'}</p><h1>Events</h1><p>Organise padel. Build your community.</p></div><button className="btn primary" onClick={() => setCreateOpen(true)}><Icons.Plus className="icon" />Create event</button></div>
        {catalogError && <div className="signup-message error" role="alert">{catalogError}</div>}
        {message && <p className="ed-notice" role="status">{message}</p>}
        {featured && <article className="ed-feature">
          <div className="ed-feature-main"><p className="ed-feature-label">{RUNNING_STATUSES.has(featured.status) ? 'Event in progress' : 'Next event'}</p>
            <div className="ed-feature-grid"><div className="ed-date-tile" aria-hidden>{featured.startsAt && Number.isFinite(Date.parse(featured.startsAt)) ? <><span>{new Date(featured.startsAt).toLocaleDateString(undefined,{weekday:'short'})}</span><strong>{new Date(featured.startsAt).getDate()}</strong><span>{new Date(featured.startsAt).toLocaleDateString(undefined,{month:'short'})}</span></> : <CalendarDays size={40}/>}</div>
              <div className="ed-feature-details"><h2>{featured.name}</h2><div className="ed-feature-meta"><span><CalendarDays />{dateLabel(featured)}</span>{featured.venue && <span><MapPin />{featured.venue}</span>}<span><Users />{featured.teamCount ?? 0} / {featured.teamCapacity ?? 0} {featured.rosterUnit ?? 'teams'}</span></div><Capacity event={featured}/></div>
              <div className="ed-feature-actions"><button className="btn primary" onClick={() => void openEvent(featured.id)}><ArrowRight />{cardActionLabel(featured.status)}</button>{featured.signupState !== 'unpublished' && <button className="btn" disabled={copying !== null} onClick={() => void copyLink(featured)}><LinkIcon />{copying === featured.id ? 'Copying…' : 'Copy sign-up link'}</button>}</div>
            </div>
          </div><div className="ed-court-photo" role="img" aria-label="Padel court" />
        </article>}
        <section ref={libraryRef} className="ed-library" aria-label="Event library">
          <div className="ed-toolbar"><div className="ed-tabs" role="tablist" aria-label="Event status">{([['upcoming','Upcoming'],['drafts','Drafts'],['past','Past'],['hidden','Hidden']] as const).map(([id,label]) => <button key={id} type="button" role="tab" aria-selected={filter === id} onClick={() => setFilter(id)}>{label}<span>{counts[id]}</span></button>)}</div><label className="ed-search"><Search /><input aria-label="Search events" placeholder="Search events…" value={query} onChange={e => setQuery(e.target.value)}/></label></div>
          <div className="ed-table-head" aria-hidden><span>Event</span><span>Date & time</span><span>Venue</span><span>Teams</span><span>Status</span><span>Actions</span></div>
          <div className="ed-event-list">{shown.map(event => <article className="ed-event-row" key={event.id}>
            <div className="ed-event-name"><div className="ed-event-icon" aria-hidden><Icons.Crown className="icon"/></div><div><h2>{event.name}</h2><span>{formatName(event)}</span></div></div>
            <div className="ed-event-date">{dateLabel(event)}</div><div className="ed-event-venue"><MapPin/>{event.venue || 'Venue not set'}</div><div className="ed-event-capacity"><span>{event.teamCount ?? 0} / {event.teamCapacity ?? 0}</span><Capacity event={event}/></div><span className={'ed-status ' + (RUNNING_STATUSES.has(event.status) ? 'live' : libraryFilterFor(event))}>{statusSummary(event)}</span>
            <div className="ed-row-actions"><button className="btn" onClick={() => void openEvent(event.id)}>{filter === 'hidden' ? 'Restore & open' : event.status === 'complete' ? 'Results' : 'View'}</button><details className="ed-row-menu" onKeyDown={e => { if (e.key === 'Escape') e.currentTarget.open = false; }}><summary aria-label={`Options for ${event.name}`}><MoreHorizontal /></summary><div><button onClick={() => void openEvent(event.id)}>{cardActionLabel(event.status,filter === 'hidden')}</button>{event.signupState !== 'unpublished' && <button disabled={copying !== null} onClick={() => void copyLink(event)}>Copy sign-up link</button>}<button onClick={() => void setArchived(event.id,filter !== 'hidden')}>{filter === 'hidden' ? 'Restore' : 'Hide on this device'}</button><button className="ed-danger" onClick={() => setDeleteTarget(event)}>Delete competition</button></div></details></div>
          </article>)}</div>
          {shown.length === 0 && <div className="ed-empty"><h2>{!hydrated ? 'Loading your events…' : query ? 'No matching events' : events.length === 0 ? 'Your next great game starts here.' : `No ${filter} events`}</h2><p>{query ? 'Try a different name or venue.' : events.length === 0 ? 'Create a competition, share your sign-up link, and run it from your iPad.' : 'Choose another tab to see your other competitions.'}</p>{events.length === 0 && hydrated && <button className="btn primary" onClick={() => setCreateOpen(true)}>Create your first event</button>}</div>}
        </section>
        {tournaments.length > 0 && <section className="ed-library tv1-home-library" aria-label="Flexible tournaments"><div className="ed-toolbar"><div><p className="eyebrow">FLEXIBLE TOURNAMENT DESK</p><h2>Tournaments</h2></div></div><div className="ed-event-list">{tournaments.map((record) => { const tournament = record.projected; const division = tournament.divisions[0]; const confirmed = tournament.entries.filter((entry) => entry.admission === 'confirmed').length; const base = record.mode === 'demo' ? '/tournament-demo' : '/tournaments'; return <article className="ed-event-row" key={record.tournamentId}><div className="ed-event-name"><div className="ed-event-icon"><Icons.Trophy className="icon"/></div><div><h2>{tournament.meta.title}</h2><span>{record.mode === 'demo' ? 'Local demo' : 'Flexible tournament'} · {tournament.lifecycle}</span></div></div><div className="ed-event-date">{tournament.meta.startsAt ? new Date(tournament.meta.startsAt).toLocaleString() : 'Date not set'}</div><div className="ed-event-venue"><MapPin/>{tournament.meta.venue || 'Venue not set'}</div><div className="ed-event-capacity"><span>{confirmed} / {division?.capacity ?? 0}</span></div><span className={`ed-status ${tournament.lifecycle === 'live' ? 'live' : 'drafts'}`}>{record.remoteStatus === 'conflict' ? 'Recovery needed' : tournament.lifecycle}</span><div className="ed-row-actions"><button className="btn" onClick={() => navigate(`${base}/${record.tournamentId}/${tournament.lifecycle === 'live' ? 'desk' : 'setup'}`)}>Open desk</button></div></article>; })}</div></section>}
        <footer className="ed-footer"><button onClick={() => navigate('/help')}>Help & guides</button><a href="/privacy/" target="_blank" rel="noreferrer">Privacy</a><a href="/terms/" target="_blank" rel="noreferrer">Terms</a><span>Score on iPad. Follow on TV.</span></footer>
      </div>
      {createOpen && <DesignDialog title={americanoChoice ? 'Choose Americano format' : 'Create an event'} onClose={() => { setCreateOpen(false); setAmericanoChoice(false); }}>
        <div className="ed-create">
          <p className="ed-create-intro">{americanoChoice ? 'Choose how partnerships and standings should work.' : 'Choose how you want to play.'}</p>
          {!pro && <div className="ed-create-trial">
            <strong>{nativeBilling ? 'Get started with Pro.' : 'Try Pro free for 30 days.'}</strong>
            <p>{nativeBilling ? 'Choose a plan next to see current prices and any free trial available to you.' : 'A one-time 30-day trial. No payment is taken in this web preview.'}</p>
          </div>}
          <div className="ed-create-formats">
            {americanoChoice ? <>
              <ModeCard name="Rotating pairs" blurb="Change partners each round. Points belong to each player." icon={<Icons.Rotate className="icon"/>} onPick={() => tryCreateAmericano('rotating')} onShowRules={() => {setCreateOpen(false);setAmericanoChoice(false);setRulesForFormat('americano');}}/>
              <ModeCard name="Fixed pairs" blurb="Keep your partner. Points belong to your team." icon={<Users className="icon"/>} onPick={() => tryCreateAmericano('fixed')} onShowRules={() => {setCreateOpen(false);setAmericanoChoice(false);setRulesForFormat('americano');}}/>
            </> : <>
              <ModeCard name="King of the Court" blurb="Fixed pairs. Win your court and work your way to the top." icon={<Icons.Crown className="icon"/>} onPick={() => tryCreate('Padel Night','koc','King of the Court')} onShowRules={() => {setCreateOpen(false);setRulesForFormat('koc');}}/>
              {ENABLE_AMERICANO_V2
                ? <ModeCard name="Americano" blurb="Rotating or fixed pairs. Every rally point counts." icon={<Icons.Rotate className="icon"/>} onPick={() => setAmericanoChoice(true)} onShowRules={() => {setCreateOpen(false);setRulesForFormat('americano');}}/>
                : <ModeCard name="Americano" blurb="Rotating or fixed pairs. Every rally point counts." icon={<Icons.Rotate className="icon"/>} disabled/>}
              <ModeCard
                disabled={!ENABLE_TOURNAMENT_V1}
                name="Tournament"
                blurb="Excel-like match control for groups, knockouts, changing courts and corrections."
                icon={<Icons.Trophy className="icon"/>}
                onPick={() => void createFlexibleTournament()}
                onShowRules={() => { setCreateOpen(false); setRulesForFormat('bracket'); }}
              />
            </>}
          </div>
          <div className="ed-create-footer">
            <button className="btn" onClick={() => {setCreateOpen(false);loadAsNew(buildDemoEvent());}}>Try a KoC demo</button>
            {ENABLE_TOURNAMENT_V1 && <button className="btn" onClick={() => void createTournamentDemo()}>Try a Tournament demo</button>}
            <button className="btn" onClick={() => {setCreateOpen(false);setPaywall({reason:pro ? '' : 'Unlock the full toolkit.'});}}>{!nativeBilling ? 'Pro included' : pro ? 'Manage Pro' : 'View Pro plans'}</button>
          </div>
        </div>
      </DesignDialog>}
      {templatesOpen && <DesignDialog title="Saved templates" onClose={() => setTemplatesOpen(false)}><p>Reuse your court settings and event details.</p>{templates.length === 0 && <p>No templates yet. Save one from an event’s setup to use it here.</p>}{templates.map(template => <div className="ed-template" key={template.id}><button className="btn" onClick={() => {setTemplatesOpen(false);loadAsNew(templateToEventState(template));}}><strong>{template.name}</strong><span>{template.teams.length} teams · {template.courts.length} courts</span></button><button className="btn" aria-label={`Delete ${template.name} template`} onClick={() => {deleteTemplate(template.id);setTemplates(listTemplates());}}><Icons.Trash className="icon"/></button></div>)}</DesignDialog>}
      {authOpen && <AuthModal onClose={() => setAuthOpen(false)} />}
      {paywall && <PaywallModal reason={paywall.reason} onClose={closePaywall} />}
      {rulesForFormat && <FormatRulesModal formatId={rulesForFormat} onClose={() => setRulesForFormat(null)} />}
      <ConfirmDialog
        open={!!deleteTarget}
        title="Delete this competition?"
        message={deleteTarget
          ? `“${deleteTarget.name}” will be permanently deleted from this device${auth.user ? ' and your synced devices' : ''}. This cannot be undone. ${auth.user ? 'When deletion syncs, its public sign-up will be cancelled. The link and registration history will remain available.' : 'Sign in first if you also need to cancel its public sign-up.'}`
          : ''}
        confirmLabel="Delete competition"
        destructive
        busy={deletingId !== null}
        onConfirm={() => {
          const id = deleteTarget?.id;
          if (id) {
            // The cloud helper records the exact-id tombstone synchronously,
            // then retries its RPC in the background. Remove the local card
            // immediately so an offline connection cannot freeze the UI.
            setDeletingId(id);
            void deleteCloudEvent(id);
            void deleteLocalEvent(id)
              .then(() => setDeleteTarget(null))
              .catch(() => undefined)
              .finally(() => setDeletingId(null));
          }
        }}
        onCancel={() => setDeleteTarget(null)}
      />
    </div>
  );
}
function Capacity({event}:{event:EventCatalogMetadata}) {
  const count=event.teamCount ?? 0, capacity=event.teamCapacity ?? 0;
  return <div className="ed-fill" aria-label={`${count} of ${capacity} team places filled`}><div><span style={{width:`${capacity > 0 ? Math.min(100,count/capacity*100) : 0}%`}}/></div><span>{capacity > 0 ? `${Math.round(count/capacity*100)}% full` : 'Courts not set'}</span></div>;
}
function ModeCard({
  name,
  blurb,
  icon,
  onPick,
  onShowRules,
  disabled = false,
}: {
  name: string;
  blurb: string;
  icon: ReactNode;
  onPick?: () => void;
  onShowRules?: () => void;
  disabled?: boolean;
}) {
  return (
    <article className={`ed-format-card${disabled ? ' ed-format-card--unavailable' : ''}`}>
      <div className="ed-format-heading">
        <span className="ed-format-icon" aria-hidden>{icon}</span>
        <h3>{name}</h3>
      </div>
      <p>{blurb}</p>
      <div className="ed-format-actions">
        <button type="button" className="btn primary" disabled={disabled} onClick={onPick} aria-label={disabled ? `${name}: coming soon` : `Choose format: ${name}`}>
          {disabled ? 'Coming soon' : <>Choose format <ArrowRight size={18} aria-hidden /></>}
        </button>
        {!disabled && <button type="button" className="ed-format-rules" onClick={onShowRules} aria-label={`View rules for ${name}`}>View rules</button>}
      </div>
    </article>
  );
}
