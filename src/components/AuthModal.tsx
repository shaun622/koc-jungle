/**
 * AuthModal: sign in / sign up with email + password, plus account
 * deletion for the signed-in state.
 *
 * Surfaces only when `cloudEnabled` (env vars present at build time).
 * Auth is email/password only and happens entirely in-app (no external
 * browser) to satisfy App Review Guideline 4.
 */

import { useState } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { stopCloudSync } from '@/store/cloudSync';
import { useEntitlementsStore, trialDaysRemaining } from '@/store/entitlements';
import { isIAPAvailable, restorePurchases } from '@/lib/iap';
import { openUrl } from '@/lib/browser';
import { Portal } from './Portal';
import { ConfirmDialog } from './ConfirmDialog';

const MANAGE_SUBS_URL = 'https://apps.apple.com/account/subscriptions';

function subscriptionLabel(pro: boolean, trialDays: number, nativeBilling: boolean): string {
  if (pro) {
    if (!nativeBilling) return 'Pro included on PWA';
    return trialDays > 0
      ? `Free trial, ${trialDays} day${trialDays === 1 ? '' : 's'} left`
      : 'Pro subscription active';
  }
  return 'No active subscription';
}

export function AuthModal({ onClose, initialError }: { onClose: () => void; initialError?: string | null }) {
  const auth = useAuth();
  const pro = useEntitlementsStore((s) => s.pro);
  const [mode, setMode] = useState<'sign-in' | 'sign-up' | 'forgot'>('sign-in');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(initialError ?? null);
  const [notice, setNotice] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);

  if (!auth.cloudEnabled) {
    return (
      <Portal>
      <div
        className="modal-backdrop"
        onClick={(e) => e.target === e.currentTarget && onClose()}
      >
        <div className="modal auth-modal">
          <h2 className="auth-title">SYNC ACROSS DEVICES</h2>
          <p style={{ color: 'var(--text-2)', fontSize: 16, lineHeight: 1.55 }}>
            Cloud sync isn't configured for this build. Your events are
            saved locally on this device and stay safe, but they won't
            sync to your phone or tablet.
          </p>
          <div className="modal-actions">
            <button className="btn" onClick={onClose}>
              Close
            </button>
          </div>
        </div>
      </div>
      </Portal>
    );
  }

  if (auth.user) {
    return (
      <Portal>
      <div
        className="modal-backdrop"
        onClick={(e) => e.target === e.currentTarget && onClose()}
      >
        <div className="modal auth-modal">
          <h2 className="auth-title">ACCOUNT</h2>

          <div className="account-rows">
            <div className="account-row">
              <span className="account-row-label">Email</span>
              <span className="account-row-value">{auth.user.email ?? auth.user.id}</span>
            </div>
            <div className="account-row">
              <span className="account-row-label">Subscription</span>
              <span className="account-row-value">
                {subscriptionLabel(pro, trialDaysRemaining(), isIAPAvailable())}
              </span>
            </div>
          </div>

          <p style={{ color: 'var(--text-2)', fontSize: 16, lineHeight: 1.55, marginTop: 8 }}>
            Your events sync automatically across every device you sign in on.
          </p>

          {err && (
            <div style={{ color: 'var(--red)', fontSize: 16, marginTop: 8 }}>{err}</div>
          )}

          {isIAPAvailable() && (
            <div className="account-actions">
              <button className="btn full" onClick={() => openUrl(MANAGE_SUBS_URL)} disabled={busy}>
                Manage subscription
              </button>
              <button
                className="btn full"
                disabled={busy}
                onClick={async () => {
                  setErr(null);
                  setBusy(true);
                  const r = await restorePurchases();
                  setBusy(false);
                  setErr(r.ok ? 'Purchases restored.' : (r.error ?? 'Nothing to restore.'));
                }}
              >
                {busy ? 'Working…' : 'Restore purchases'}
              </button>
            </div>
          )}

          <div className="modal-actions">
            <button
              className="btn danger"
              onClick={() => setConfirmDelete(true)}
              disabled={busy}
            >
              Delete account
            </button>
            <button
              className="btn"
              onClick={async () => {
                setErr(null);
                setBusy(true);
                const result = await auth.signOut();
                setBusy(false);
                if (result.error) setErr(`Could not sign out safely: ${result.error} Retry when you are online.`);
                else onClose();
              }}
              disabled={busy}
            >
              {busy ? 'Working…' : 'Sign out'}
            </button>
            <button className="btn primary" onClick={onClose} disabled={busy}>
              Done
            </button>
          </div>
        </div>
        <ConfirmDialog
          open={confirmDelete}
          title="Delete your account?"
          message="This permanently deletes your account and every event synced to the cloud. It cannot be undone. Events saved only on this device stay on the device."
          confirmLabel="Delete account"
          destructive
          onConfirm={async () => {
            setErr(null);
            setBusy(true);
            // Stop sync first so a late upload can't recreate a row after
            // the account is gone.
            stopCloudSync();
            const res = await auth.deleteAccount();
            setBusy(false);
            setConfirmDelete(false);
            if (res.error) setErr(res.error);
            else onClose();
          }}
          onCancel={() => setConfirmDelete(false)}
        />
      </div>
      </Portal>
    );
  }

  async function submitEmail() {
    setErr(null);
    setNotice(null);
    setBusy(true);
    const fn = mode === 'sign-in' ? auth.signInWithEmail : auth.signUpWithEmail;
    const res = await fn(email.trim(), password);
    setBusy(false);
    if (res.error) {
      setErr(res.error);
    } else if (
      mode === 'sign-up' &&
      (res as { needsConfirmation?: boolean }).needsConfirmation
    ) {
      setErr('Check your inbox for a confirmation link, then sign in.');
    } else {
      // Signed in (or signed up with confirmation off, which creates a
      // session immediately) — the signed-in view takes over.
      onClose();
    }
  }

  async function requestReset() {
    setErr(null);
    setNotice(null);
    setBusy(true);
    const res = await auth.requestPasswordReset(email.trim());
    setBusy(false);
    if (res.error) setErr(res.error);
    else setNotice('If an account exists for that email, a reset link is on its way.');
  }

  return (
    <Portal>
    <div
      className="modal-backdrop"
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="modal auth-modal">
        <h2 className="auth-title">
          {mode === 'sign-in' ? 'SIGN IN' : mode === 'sign-up' ? 'CREATE ACCOUNT' : 'RESET PASSWORD'}
        </h2>
        <p className="auth-sub">
          {mode === 'forgot'
            ? 'Enter your organiser email. We will send a secure password-reset link.'
            : 'Sync events across every device you sign in on. Local-only stays the default. No account needed.'}
        </p>

        <div className="auth-form">
          <div className="setup-field">
            <label htmlFor="auth-email">Email</label>
            <input
              id="auth-email"
              className="setup-input auth-input"
              type="email"
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
            />
          </div>
          {mode !== 'forgot' && <div className="setup-field">
            <label htmlFor="auth-password">Password</label>
            <input
              id="auth-password"
              className="setup-input auth-input"
              type="password"
              autoComplete={mode === 'sign-in' ? 'current-password' : 'new-password'}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder={mode === 'sign-up' ? 'At least 6 characters' : ''}
            />
          </div>}
        </div>

        {err && <div style={{ color: 'var(--red)', fontSize: 16, marginTop: 8 }}>{err}</div>}
        {notice && <div className="signup-message" role="status">{notice}</div>}

        <div className="modal-actions">
          <button className="btn" onClick={onClose}>
            Cancel
          </button>
          <button
            className="btn primary"
            onClick={mode === 'forgot' ? requestReset : submitEmail}
            disabled={busy || !email || (mode !== 'forgot' && !password)}
          >
            {busy
              ? mode === 'forgot'
                ? 'Sending…'
                : mode === 'sign-in'
                ? 'Signing in…'
                : 'Creating account…'
              : mode === 'forgot'
                ? 'Send reset link'
                : mode === 'sign-in'
                ? 'Sign in'
                : 'Create account'}
          </button>
        </div>

        <div style={{ textAlign: 'center', marginTop: 8, display: 'grid', gap: 6 }}>
          {mode === 'sign-in' && (
            <button className="btn ghost sm" onClick={() => { setMode('forgot'); setErr(null); setNotice(null); }}>
              Forgot password?
            </button>
          )}
          <button
            className="btn ghost sm"
            onClick={() => {
              setMode(mode === 'sign-in' ? 'sign-up' : 'sign-in');
              setErr(null);
              setNotice(null);
            }}
          >
            {mode === 'forgot'
              ? 'Back to sign in'
              : mode === 'sign-in'
              ? 'Don\'t have an account? Create one'
              : 'Already have an account? Sign in'}
          </button>
        </div>
      </div>
    </div>
    </Portal>
  );
}
