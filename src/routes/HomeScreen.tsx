import { useMemo, useState, type ReactNode } from 'react';
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
import { useThemeStore } from '@/store/theme';
import { BrandLogo } from '@/components/BrandLogo';
import { AppMenu } from '@/components/AppMenu';
import { AuthModal } from '@/components/AuthModal';
import { PaywallModal } from '@/components/PaywallModal';
import { FormatRulesModal } from '@/components/FormatRulesModal';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { IpadHint } from '@/components/IpadHint';
import { Icons } from '@/components/Icons';
import type { EventState, EventStatus, TournamentFormatId } from '@/types/domain';

const RUNNING_STATUSES = new Set<EventStatus>([
  'qualifier',
  'seeding',
  'round-in-progress',
  'between-rounds',
]);
const DRAFT_STATUSES = new Set<EventStatus>(['setup']);

function statusSummary(status: EventStatus): string {
  switch (status) {
    case 'setup': return 'Setup in progress';
    case 'qualifier': return 'Qualifier round';
    case 'seeding': return 'Seeding teams';
    case 'round-in-progress': return 'Live now';
    case 'between-rounds': return 'Between rounds';
    case 'complete': return 'Complete · podium ready';
  }
}

function formatName(format: TournamentFormatId): string {
  switch (format) {
    case 'americano': return 'Americano';
    case 'round-robin': return 'Round Robin';
    case 'bracket': return 'Tournament';
    case 'mexicano': return 'Mexicano';
    case 'koc':
    default: return 'King of the Court';
  }
}

function lastUpdated(timestamp: number): string {
  const elapsed = Math.max(0, Date.now() - timestamp);
  const minutes = Math.floor(elapsed / 60_000);
  if (minutes < 1) return 'Updated just now';
  if (minutes < 60) return `Updated ${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `Updated ${hours}h ago`;
  return `Updated ${new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'short' }).format(timestamp)}`;
}

function cardActionLabel(status: EventStatus, archived: boolean): string {
  if (archived) return 'Restore & open';
  switch (status) {
    case 'setup': return 'Continue setup';
    case 'qualifier': return 'Open qualifier';
    case 'seeding': return 'Open seeding';
    case 'round-in-progress': return 'Resume scoring';
    case 'between-rounds': return 'Continue event';
    case 'complete': return 'View results';
  }
}

export function HomeScreen() {
  const activeEvent = useEventStore((s) => s.event);
  const createEvent = useEventStore((s) => s.createEvent);
  const loadEvent = useEventStore((s) => s.loadEvent);
  const selectEvent = useEventStore((s) => s.selectEventById);
  const archiveEvent = useEventStore((s) => s.archiveLocalEvent);
  const deleteLocalEvent = useEventStore((s) => s.deleteLocalEvent);
  const events = useEventCatalogStore((s) => s.events);
  const activeEventId = useEventCatalogStore((s) => s.activeEventId);
  const catalogError = useEventCatalogStore((s) => s.lastError);
  const navigate = useNavigate();

  const auth = useAuth();
  const pro = useEntitlementsStore((s) => s.pro);
  const nativeBilling = isIAPAvailable();
  const themePref = useThemeStore((s) => s.preference);
  const cycleTheme = useThemeStore((s) => s.cyclePreference);

  const [templates, setTemplates] = useState<Template[]>(() => listTemplates());
  const refreshTemplates = () => setTemplates(listTemplates());
  const [authOpen, setAuthOpen] = useState(false);
  const [paywall, setPaywall] = useState<{ reason: string } | null>(null);
  const [rulesForFormat, setRulesForFormat] = useState<TournamentFormatId | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<EventCatalogMetadata | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [showArchived, setShowArchived] = useState(false);

  const grouped = useMemo(() => {
    const current = events.filter((item) => item.archivedAt === null);
    return {
      live: current.filter((item) => RUNNING_STATUSES.has(item.status)),
      drafts: current.filter((item) => DRAFT_STATUSES.has(item.status)),
      completed: current.filter((item) => item.status === 'complete'),
      archived: events.filter((item) => item.archivedAt !== null),
    };
  }, [events]);

  function openSelected(next: EventState | null) {
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
    if (isFormatLocked(format)) {
      setPaywall({ reason: `${displayName} needs Pro.` });
      return;
    }
    createEvent(name, format);
    openSelected(useEventStore.getState().event);
  }

  function loadAsNew(next: EventState) {
    loadEvent(next);
    openSelected(useEventStore.getState().event);
  }

  const hasEvents = events.length > 0;

  return (
    <div className="home">
      <header className="home-top">
        <button className="home-top-brand home-brand-button" onClick={() => navigate('/home')}>
          <div className="brand-mark"><BrandLogo /></div>
          <span>PADEL TOURNAMENT MAKER</span>
        </button>
        <div className="home-top-actions">
          <button
            className="btn ghost sm theme-toggle"
            onClick={cycleTheme}
            title={themePref === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}
            aria-label="Toggle theme"
          >
            {themePref === 'dark' ? <Icons.Sun className="icon" /> : <Icons.Moon className="icon" />}
          </button>
          <AppMenu event={activeEvent} />
        </div>
      </header>

      <div className={'home-body ' + (hasEvents ? 'home-body--library' : '')}>
        <IpadHint />
        <div className="home-hero home-hero--compact">
          <div className="brand-mark home-hero-logo"><BrandLogo /></div>
          <h1>{hasEvents ? 'Your events' : 'Padel Tournament Maker'}</h1>
          <p className="home-hero-sub">
            {hasEvents
              ? 'Create several competitions, then open the one you want to run.'
              : 'Run every court from one iPad, then mirror the live scoreboard to the TV.'}
          </p>
        </div>

        {catalogError && <div className="signup-message error" role="alert">{catalogError}</div>}

        {hasEvents && (
          <section className="event-library" aria-label="Event library">
            {grouped.live.length > 0 && (
              <EventGroup title="In progress" events={grouped.live} activeEventId={activeEventId} onOpen={openEvent} onArchive={setArchived} onDelete={setDeleteTarget} />
            )}
            {grouped.drafts.length > 0 && (
              <EventGroup title="Setup" events={grouped.drafts} activeEventId={activeEventId} onOpen={openEvent} onArchive={setArchived} onDelete={setDeleteTarget} />
            )}
            {grouped.completed.length > 0 && (
              <EventGroup title="Completed" events={grouped.completed} activeEventId={activeEventId} onOpen={openEvent} onArchive={setArchived} onDelete={setDeleteTarget} />
            )}
            {grouped.archived.length > 0 && (
              <div className="event-library-archived">
                <button className="btn ghost sm" onClick={() => setShowArchived((value) => !value)}>
                  {showArchived ? 'Hide' : 'Show'} hidden on this device ({grouped.archived.length})
                </button>
                {showArchived && (
                  <EventGroup title="Hidden on this device" events={grouped.archived} activeEventId={activeEventId} onOpen={openEvent} onArchive={(id) => setArchived(id, false)} onDelete={setDeleteTarget} archived />
                )}
              </div>
            )}
          </section>
        )}

        <section className="home-section new-event-section">
          <div className="home-section-title">
            <span>{hasEvents ? 'Create another event' : 'Choose a format'}</span>
            <span className="pro-chip">
              {!nativeBilling ? 'PRO INCLUDED' : pro ? 'PRO ACTIVE' : '7-DAY FREE TRIAL'}
            </span>
          </div>
          <div className="home-modes">
            <ModeCard
              name="King of the Court"
              blurb="Winners climb, losers drop, and the King defends Centre Court."
              icon={<Icons.Crown className="icon" />}
              locked={isFormatLocked('koc')}
              onPick={() => tryCreate('Padel Night', 'koc', 'King of the Court')}
              onShowRules={() => setRulesForFormat('koc')}
            />
            <ModeCard
              name="Americano"
              blurb="Automatic rotations, balanced court time and a live points table."
              icon={<Icons.Rotate className="icon" />}
              locked={isFormatLocked('americano')}
              onPick={() => tryCreate('Americano', 'americano', 'Americano')}
              onShowRules={() => setRulesForFormat('americano')}
            />
            <ModeCard
              name="Tournament"
              blurb="Build a complete draw and finish on a TV-ready podium."
              icon={<Icons.Trophy className="icon" />}
              locked={false}
              disabled
              status="COMING SOON"
            />
          </div>
        </section>

        <div className="home-actions">
          <button className="btn" onClick={() => loadAsNew(buildDemoEvent())}>Load KoC demo</button>
          <button className={'btn ' + (pro ? '' : 'paywall-cta')} onClick={() => setPaywall({ reason: pro ? '' : 'Unlock the full toolkit.' })}>
            {!nativeBilling ? '👑 Pro included' : pro ? '👑 Manage Pro' : '👑 Get Pro'}
          </button>
          {auth.cloudEnabled && (
            <button
              className="btn"
              onClick={() => {
                if (!auth.user && isFeatureLocked()) {
                  setPaywall({ reason: 'Cloud sync needs Pro.' });
                  return;
                }
                setAuthOpen(true);
              }}
            >
              {auth.user ? `Signed in: ${(auth.user.email ?? '').split('@')[0]}` : 'Sign in / Sync'}
            </button>
          )}
        </div>

        {templates.length > 0 && (
          <section className="home-section">
            <div className="home-section-title">Saved templates</div>
            <div className="landing-templates-list">
              {templates.map((template) => (
                <div key={template.id} className="landing-template-row">
                  <button className="btn ghost" style={{ flex: 1, justifyContent: 'flex-start' }} onClick={() => loadAsNew(templateToEventState(template))}>
                    <span style={{ fontWeight: 700 }}>{template.name}</span>
                    <span style={{ color: 'var(--text-2)', marginLeft: 8, fontSize: 14 }}>
                      {template.teams.length} teams · {template.courts.length} courts
                    </span>
                  </button>
                  <button className="op-score-btn" onClick={() => { deleteTemplate(template.id); refreshTemplates(); }} aria-label={`Delete ${template.name} template`}>
                    <Icons.Trash className="icon" />
                  </button>
                </div>
              ))}
            </div>
          </section>
        )}

        <div className="landing-legal">
          <button type="button" className="landing-legal-link" onClick={() => navigate('/help')}>Format guide</button>
          <span aria-hidden>·</span><a href="/privacy/" target="_blank" rel="noopener noreferrer">Privacy</a>
          <span aria-hidden>·</span><a href="/terms/" target="_blank" rel="noopener noreferrer">Terms</a>
          <span aria-hidden>·</span><a href="mailto:info@padelkoc.com">Contact</a>
        </div>
      </div>

      {authOpen && <AuthModal onClose={() => setAuthOpen(false)} />}
      {paywall && <PaywallModal reason={paywall.reason} onClose={() => setPaywall(null)} />}
      {rulesForFormat && <FormatRulesModal formatId={rulesForFormat} onClose={() => setRulesForFormat(null)} />}
      <ConfirmDialog
        open={!!deleteTarget}
        title="Delete this competition?"
        message={deleteTarget
          ? `“${deleteTarget.name}” will be permanently deleted from this device${auth.user ? ' and your synced devices' : ''}. This cannot be undone. Its public sign-up page and registrations stay open separately.`
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

function EventGroup({
  title,
  events,
  activeEventId,
  onOpen,
  onArchive,
  onDelete,
  archived = false,
}: {
  title: string;
  events: EventCatalogMetadata[];
  activeEventId: string | null;
  onOpen: (id: string) => void | Promise<void>;
  onArchive: (id: string) => void | Promise<void>;
  onDelete: (event: EventCatalogMetadata) => void;
  archived?: boolean;
}) {
  return (
    <div className="event-group">
      <div className="event-group-title">{title}<span>{events.length}</span></div>
      <div className="event-card-grid">
        {events.map((event) => (
          <article className={'event-card ' + (RUNNING_STATUSES.has(event.status) ? 'event-card--live' : '')} key={event.id}>
            <button className="event-card-main" onClick={() => void onOpen(event.id)}>
              <span className="event-card-format">
                {formatName(event.format)}
                {activeEventId === event.id && <span className="event-card-current">Current</span>}
              </span>
              <strong>{event.name}</strong>
              <span className="event-card-status">{statusSummary(event.status)}</span>
              <span className="event-card-meta">
                {event.venue ? `${event.venue} · ` : ''}{lastUpdated(event.updatedAt)}
              </span>
            </button>
            <div className="event-card-actions">
              <button className="btn primary sm" onClick={() => void onOpen(event.id)}>
                {cardActionLabel(event.status, archived)}
              </button>
              <button className="btn ghost sm" onClick={() => void onArchive(event.id)}>
                {archived ? 'Restore' : 'Hide'}
              </button>
              <button className="btn ghost sm event-delete" onClick={() => onDelete(event)} aria-label={`Delete ${event.name}`} title="Delete competition">
                <Icons.Trash className="icon" />
              </button>
            </div>
          </article>
        ))}
      </div>
    </div>
  );
}

function ModeCard({
  name,
  blurb,
  icon,
  locked,
  onPick,
  onShowRules,
  disabled = false,
  status,
}: {
  name: string;
  blurb: string;
  icon: ReactNode;
  locked: boolean;
  onPick?: () => void;
  onShowRules?: () => void;
  disabled?: boolean;
  status?: string;
}) {
  return (
    <div className={'landing-mode-wrap ' + (locked ? 'locked ' : '') + (disabled ? 'disabled' : '')}>
      <button className="landing-mode" onClick={onPick} disabled={disabled}>
        <span className="landing-mode-icon" aria-hidden>{icon}</span>
        <span className="landing-mode-name">
          {name}
          {status && <span className="coming-soon-chip">{status}</span>}
          {locked && <span className="lock-chip">Trial / Pro</span>}
        </span>
        <span className="landing-mode-blurb">{blurb}</span>
      </button>
      {onShowRules && (
        <button
          type="button"
          className="landing-mode-info"
          onClick={(event) => { event.stopPropagation(); onShowRules(); }}
          aria-label={`Show rules for ${name}`}
        >
          Rules
        </button>
      )}
    </div>
  );
}
