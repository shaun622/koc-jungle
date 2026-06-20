/**
 * AppMenu: the single, consistent menu used across the app.
 *
 * One gear button (always top-right) opens a slide-over panel containing
 * every action + setting in one place, so the operator chrome stops
 * shuffling buttons around per screen:
 *   - Account / cloud sync
 *   - Appearance (dark / light)
 *   - Event settings (opens SettingsModal)
 *   - Format guide
 *   - New event / Import / Export
 *   - Finish event now (contextual)
 *
 * Rendered by TopNav (operator routes) and DisplayScreen (live canvas).
 */

import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useEventStore } from '@/store/eventStore';
import { useAuth } from '@/hooks/useAuth';
import { useThemeStore } from '@/store/theme';
import { Icons } from './Icons';
import { AuthModal } from './AuthModal';
import { SettingsModal } from './SettingsModal';
import { ClubBrandingModal } from './ClubBrandingModal';
import { ConfirmDialog } from './ConfirmDialog';
import { Portal } from './Portal';
import type { EventState } from '@/types/domain';

export function AppMenu({ event }: { event: EventState | null }) {
  const [open, setOpen] = useState(false);
  const [confirmNew, setConfirmNew] = useState(false);
  const [confirmFinish, setConfirmFinish] = useState(false);
  const [authOpen, setAuthOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [clubOpen, setClubOpen] = useState(false);

  const navigate = useNavigate();
  const resetEvent = useEventStore((s) => s.resetEvent);
  const finishEventNow = useEventStore((s) => s.finishEventNow);

  const auth = useAuth();
  const themePref = useThemeStore((s) => s.preference);
  const cycleTheme = useThemeStore((s) => s.cyclePreference);

  const close = () => setOpen(false);

  const canFinish =
    event &&
    (event.status === 'round-in-progress' || event.status === 'between-rounds');

  return (
    <>
      <button
        className="app-menu-toggle"
        onClick={() => setOpen(true)}
        aria-label="Menu"
        title="Menu"
      >
        <Icons.Gear className="icon" />
      </button>

      {open && (
        <Portal>
        <div className="app-menu-backdrop" onClick={(e) => e.target === e.currentTarget && close()}>
          <div className="app-menu-panel" role="dialog" aria-label="Menu">
            <div className="app-menu-head">
              <span className="app-menu-title">MENU</span>
              <button className="op-score-btn" onClick={close} aria-label="Close" style={{ background: 'transparent', border: 0 }}>
                <Icons.Close className="icon" />
              </button>
            </div>

            {/* Home / dashboard */}
            <button
              className="app-menu-item"
              onClick={() => {
                close();
                navigate('/home');
              }}
            >
              <Icons.Home className="icon" />
              <span className="app-menu-item-label">Home / dashboard</span>
            </button>

            {/* Club branding */}
            <button
              className="app-menu-item"
              onClick={() => {
                close();
                setClubOpen(true);
              }}
            >
              <Icons.Crown className="icon" />
              <span className="app-menu-item-label">Club branding</span>
            </button>

            {/* Format guide */}
            <button
              className="app-menu-item"
              onClick={() => {
                close();
                navigate('/help');
              }}
            >
              <Icons.Book className="icon" />
              <span className="app-menu-item-label">Format guide</span>
            </button>

            {/* Event settings (only mid-event) */}
            {event && (
              <button
                className="app-menu-item"
                onClick={() => {
                  close();
                  setSettingsOpen(true);
                }}
              >
                <Icons.Gear className="icon" />
                <span className="app-menu-item-label">Event settings</span>
              </button>
            )}

            {/* Appearance */}
            <button className="app-menu-item" onClick={cycleTheme}>
              {themePref === 'dark' ? <Icons.Moon className="icon" /> : <Icons.Sun className="icon" />}
              <span className="app-menu-item-label">Appearance</span>
              <span className="app-menu-item-meta" style={{ textTransform: 'capitalize' }}>{themePref}</span>
            </button>

            {/* Account / sync */}
            {auth.cloudEnabled && (
              <button
                className="app-menu-item"
                onClick={() => {
                  close();
                  setAuthOpen(true);
                }}
              >
                <Icons.Account className="icon" />
                <span className="app-menu-item-label">
                  {auth.user ? 'Account settings' : 'Sign in to sync'}
                </span>
                <span className={'app-menu-item-meta ' + (auth.user ? 'sync-on' : '')}>
                  {auth.user ? '☁ Synced' : ''}
                </span>
              </button>
            )}

            <div className="app-menu-divider" />

            {/* Event actions */}
            {canFinish && (
              <button
                className="app-menu-item"
                onClick={() => {
                  close();
                  setConfirmFinish(true);
                }}
              >
                <Icons.Trophy className="icon" />
                <span className="app-menu-item-label">Finish event now</span>
              </button>
            )}

            <button
              className="app-menu-item"
              onClick={() => {
                close();
                setConfirmNew(true);
              }}
            >
              <Icons.Plus className="icon" />
              <span className="app-menu-item-label">New event</span>
            </button>

            {auth.cloudEnabled && auth.user && (
              <button
                className="app-menu-item"
                onClick={async () => {
                  close();
                  await auth.signOut();
                }}
              >
                <Icons.Account className="icon" />
                <span className="app-menu-item-label">Sign out</span>
              </button>
            )}

            <div className="app-menu-divider" />
            <div className="app-menu-foot">
              <a href="/privacy/" target="_blank" rel="noopener noreferrer">Privacy</a>
              <span aria-hidden>·</span>
              <a href="/terms/" target="_blank" rel="noopener noreferrer">Terms</a>
              <span aria-hidden>·</span>
              <a href="mailto:info@padelkoc.com">Contact</a>
            </div>
          </div>
        </div>
        </Portal>
      )}

      <ConfirmDialog
        open={confirmNew}
        title="Start a new event?"
        message="This clears the current event: teams, scores, rounds, podium. Export first if you want to keep them."
        confirmLabel="Yes, start fresh"
        destructive
        onConfirm={() => {
          resetEvent();
          setConfirmNew(false);
          // Land on the dashboard (the launch pad with the format picker).
          // SetupScreen renders nothing without an event, so navigating
          // there directly would show a blank screen.
          setTimeout(() => navigate('/home'), 0);
        }}
        onCancel={() => setConfirmNew(false)}
      />

      <ConfirmDialog
        open={confirmFinish}
        title="Finish the event now?"
        message="The podium is revealed with the scores entered so far. A round in progress that hasn't been scored is dropped."
        confirmLabel="Finish event"
        onConfirm={() => {
          finishEventNow();
          setConfirmFinish(false);
          setTimeout(() => navigate('/display'), 0);
        }}
        onCancel={() => setConfirmFinish(false)}
      />

      {authOpen && <AuthModal onClose={() => setAuthOpen(false)} />}
      {clubOpen && <ClubBrandingModal onClose={() => setClubOpen(false)} />}
      <SettingsModal open={settingsOpen} onClose={() => setSettingsOpen(false)} />
    </>
  );
}
