/**
 * HomeScreen — the dedicated dashboard / launch screen.
 *
 *  - When an event is in progress: a prominent "Resume" card (jump back
 *    to wherever the event is), plus Start new (replaces) and Cancel.
 *  - Always: pick a format to start a new event, load the demo, import,
 *    manage Pro, sign in, and saved templates.
 *
 * The gear menu (top-right) is always available here too. The app logo
 * elsewhere navigates back to this screen.
 */

import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useEventStore } from '@/store/eventStore';
import { buildDemoEvent } from '@/logic/demoData';
import {
  deleteTemplate,
  listTemplates,
  templateToEventState,
  type Template,
} from '@/store/templates';
import { isFeatureLocked, isFormatLocked, useEntitlementsStore } from '@/store/entitlements';
import { useAuth } from '@/hooks/useAuth';
import { useThemeStore } from '@/store/theme';
import { BrandLogo } from '@/components/BrandLogo';
import { AppMenu } from '@/components/AppMenu';
import { AuthModal } from '@/components/AuthModal';
import { PaywallModal } from '@/components/PaywallModal';
import { FormatRulesModal } from '@/components/FormatRulesModal';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { Icons } from '@/components/Icons';
import type { EventState, EventStatus, TournamentFormatId } from '@/types/domain';

function resumeRoute(status: EventStatus): string {
  switch (status) {
    case 'qualifier':
      return '/qualifier';
    case 'seeding':
      return '/seeding';
    case 'round-in-progress':
    case 'between-rounds':
    case 'complete':
      return '/display';
    case 'setup':
    default:
      return '/setup';
  }
}

function statusSummary(event: EventState): string {
  switch (event.status) {
    case 'setup':
      return 'Setup in progress';
    case 'qualifier':
      return 'Qualifier round';
    case 'seeding':
      return 'Seeding teams';
    case 'round-in-progress':
    case 'between-rounds': {
      const idx = event.rounds[event.rounds.length - 1]?.index ?? 0;
      return `Round ${idx} of ${event.settings.roundsTotal}`;
    }
    case 'complete':
      return 'Complete · podium ready';
    default:
      return '';
  }
}

export function HomeScreen() {
  const event = useEventStore((s) => s.event);
  const createEvent = useEventStore((s) => s.createEvent);
  const loadEvent = useEventStore((s) => s.loadEvent);
  const resetEvent = useEventStore((s) => s.resetEvent);
  const navigate = useNavigate();

  const auth = useAuth();
  const pro = useEntitlementsStore((s) => s.pro);
  const themePref = useThemeStore((s) => s.preference);
  const cycleTheme = useThemeStore((s) => s.cyclePreference);

  const [templates, setTemplates] = useState<Template[]>(() => listTemplates());
  const refreshTemplates = () => setTemplates(listTemplates());
  const [authOpen, setAuthOpen] = useState(false);
  const [paywall, setPaywall] = useState<{ reason: string } | null>(null);
  const [rulesForFormat, setRulesForFormat] = useState<TournamentFormatId | null>(null);
  const [confirmReplace, setConfirmReplace] = useState<null | (() => void)>(null);
  const [confirmCancel, setConfirmCancel] = useState(false);

  // Start a new event, paywalling locked formats and confirming if an
  // event is already in progress (creating replaces it).
  function tryCreate(name: string, format: TournamentFormatId, displayName: string) {
    if (isFormatLocked(format)) {
      setPaywall({ reason: `${displayName} needs Pro.` });
      return;
    }
    const go = () => {
      createEvent(name, format);
      setTimeout(() => navigate('/setup'), 0);
    };
    if (event) setConfirmReplace(() => go);
    else go();
  }

  function tryLoad(next: EventState) {
    const go = () => loadEvent(next);
    if (event) setConfirmReplace(() => go);
    else go();
  }

  return (
    <div className="home">
      <header className="home-top">
        <div className="home-top-brand">
          <div className="brand-mark"><BrandLogo /></div>
          <span>PADEL TOURNAMENT MAKER</span>
        </div>
        <div className="home-top-actions">
          <button
            className="btn ghost sm theme-toggle"
            onClick={cycleTheme}
            title={themePref === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}
            aria-label="Toggle theme"
          >
            {themePref === 'dark' ? <Icons.Sun className="icon" /> : <Icons.Moon className="icon" />}
          </button>
          <AppMenu event={event} />
        </div>
      </header>

      <div className="home-body">
        <div className="home-hero">
          <div className="brand-mark home-hero-logo"><BrandLogo /></div>
          <h1>Padel Tournament Maker</h1>
          <p className="home-hero-sub">
            Run your padel night: timer, courts, scoring, auto-rotation, live
            leaderboard. Five formats, one operator app.
          </p>
        </div>

        {event && (
          <div className="home-resume">
            <div className="home-resume-info">
              <div className="home-resume-label">Event in progress</div>
              <div className="home-resume-name">{event.name}</div>
              <div className="home-resume-status">{statusSummary(event)}</div>
            </div>
            <div className="home-resume-actions">
              <button
                className="btn primary lg"
                onClick={() => navigate(resumeRoute(event.status))}
              >
                Resume →
              </button>
              <button className="btn" onClick={() => setConfirmCancel(true)}>
                Cancel event
              </button>
            </div>
          </div>
        )}

        <div className="home-section">
          <div className="home-section-title">
            {event ? 'Start a new event' : 'Pick a format'}
            {pro && <span className="pro-chip">PRO</span>}
          </div>
          <div className="home-modes">
            <ModeCard
              name="King of the Court"
              blurb="Qualifier seeds teams onto courts. Winners climb, losers drop, King defends Centre Court."
              locked={isFormatLocked('koc')}
              onPick={() => tryCreate('Padel Night', 'koc', 'King of the Court')}
              onShowRules={() => setRulesForFormat('koc')}
            />
            <ModeCard
              name="Americano"
              blurb="Every team in one pool. Schedule rotates so you face as many different opponents as fit in the rounds you set."
              locked={isFormatLocked('americano')}
              onPick={() => tryCreate('Americano', 'americano', 'Americano')}
              onShowRules={() => setRulesForFormat('americano')}
            />
            <ModeCard
              name="Mexicano"
              blurb="Re-pairs every round from the live standings: top vs second, third vs fourth. Tight games every round."
              locked={isFormatLocked('mexicano')}
              onPick={() => tryCreate('Mexicano', 'mexicano', 'Mexicano')}
              onShowRules={() => setRulesForFormat('mexicano')}
            />
            <ModeCard
              name="Round Robin"
              blurb="Each team plays every other team in their group. Fair, complete, top of the table wins."
              locked={isFormatLocked('round-robin')}
              onPick={() => tryCreate('Round Robin', 'round-robin', 'Round Robin')}
              onShowRules={() => setRulesForFormat('round-robin')}
            />
            <ModeCard
              name="Bracket"
              blurb="Single elimination. Win to advance, lose to go home. Top seeds bye if the field isn't a power of 2."
              locked={isFormatLocked('bracket')}
              onPick={() => tryCreate('Bracket', 'bracket', 'Bracket')}
              onShowRules={() => setRulesForFormat('bracket')}
            />
          </div>
        </div>

        <div className="home-actions">
          <button className="btn" onClick={() => tryLoad(buildDemoEvent())}>
            Load KoC demo
          </button>
          <button
            className={'btn ' + (pro ? '' : 'paywall-cta')}
            onClick={() => setPaywall({ reason: pro ? '' : 'Unlock the full toolkit.' })}
          >
            {pro ? '👑 Manage Pro' : '👑 Get Pro'}
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
          <div className="home-section">
            <div className="home-section-title">Saved templates</div>
            <div className="landing-templates-list">
              {templates.map((t) => (
                <div key={t.id} className="landing-template-row">
                  <button
                    className="btn ghost"
                    style={{ flex: 1, justifyContent: 'flex-start' }}
                    onClick={() => tryLoad(templateToEventState(t))}
                  >
                    <span style={{ fontWeight: 700 }}>{t.name}</span>
                    <span style={{ color: 'var(--text-2)', marginLeft: 8, fontSize: 12 }}>
                      {t.teams.length} teams · {t.courts.length} courts
                    </span>
                  </button>
                  <button
                    className="op-score-btn"
                    onClick={() => {
                      deleteTemplate(t.id);
                      refreshTemplates();
                    }}
                    aria-label="Delete template"
                  >
                    <Icons.Minus className="icon" />
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}

        <div className="landing-legal">
          <button type="button" className="landing-legal-link" onClick={() => navigate('/help')}>
            Format guide
          </button>
          <span aria-hidden>·</span>
          <a href="/privacy/" target="_blank" rel="noopener noreferrer">Privacy</a>
          <span aria-hidden>·</span>
          <a href="/terms/" target="_blank" rel="noopener noreferrer">Terms</a>
          <span aria-hidden>·</span>
          <a href="mailto:info@padelkoc.com">Contact</a>
        </div>
      </div>

      {authOpen && <AuthModal onClose={() => setAuthOpen(false)} />}
      {paywall && <PaywallModal reason={paywall.reason} onClose={() => setPaywall(null)} />}
      {rulesForFormat && (
        <FormatRulesModal formatId={rulesForFormat} onClose={() => setRulesForFormat(null)} />
      )}
      <ConfirmDialog
        open={!!confirmReplace}
        title="Replace the current event?"
        message="You have an event in progress. Starting a new one clears its teams, scores, and rounds. Resume or export it first if you want to keep it."
        confirmLabel="Replace it"
        destructive
        onConfirm={() => {
          confirmReplace?.();
          setConfirmReplace(null);
        }}
        onCancel={() => setConfirmReplace(null)}
      />
      <ConfirmDialog
        open={confirmCancel}
        title="Cancel this event?"
        message="This permanently clears the current event: teams, scores, and rounds. Export it first if you need a backup."
        confirmLabel="Cancel event"
        destructive
        onConfirm={() => {
          resetEvent();
          setConfirmCancel(false);
        }}
        onCancel={() => setConfirmCancel(false)}
      />
    </div>
  );
}

function ModeCard({
  name,
  blurb,
  locked,
  onPick,
  onShowRules,
}: {
  name: string;
  blurb: string;
  locked: boolean;
  onPick: () => void;
  onShowRules: () => void;
}) {
  return (
    <div className={'landing-mode-wrap ' + (locked ? 'locked' : '')}>
      <button className="landing-mode" onClick={onPick}>
        <span className="landing-mode-name">
          {name}
          {locked && <span className="lock-chip">🔒 Pro</span>}
        </span>
        <span className="landing-mode-blurb">{blurb}</span>
      </button>
      <button
        type="button"
        className="landing-mode-info"
        onClick={(e) => {
          e.stopPropagation();
          onShowRules();
        }}
        aria-label={`Show rules for ${name}`}
      >
        Rules
      </button>
    </div>
  );
}

