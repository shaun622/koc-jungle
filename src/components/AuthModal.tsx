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
import { Portal } from './Portal';
import { ConfirmDialog } from './ConfirmDialog';

export function AuthModal({ onClose }: { onClose: () => void }) {
  const auth = useAuth();
  const [mode, setMode] = useState<'sign-in' | 'sign-up'>('sign-in');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
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
          <p style={{ color: 'var(--text-2)', fontSize: 14 }}>
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
          <h2 className="auth-title">SIGNED IN</h2>
          <p style={{ color: 'var(--text-2)', fontSize: 14 }}>
            {auth.user.email ?? auth.user.id}
          </p>
          <p style={{ color: 'var(--text-2)', fontSize: 13, lineHeight: 1.5 }}>
            Your events sync automatically across every device you sign in
            on. Sign out to switch accounts or go local-only on this device.
          </p>
          {err && (
            <div style={{ color: 'var(--red)', fontSize: 13, marginTop: 8 }}>{err}</div>
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
                setBusy(true);
                await auth.signOut();
                setBusy(false);
                onClose();
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
    setBusy(true);
    const fn = mode === 'sign-in' ? auth.signInWithEmail : auth.signUpWithEmail;
    const res = await fn(email.trim(), password);
    setBusy(false);
    if (res.error) {
      setErr(res.error);
    } else if (mode === 'sign-up') {
      setErr(
        'Check your inbox for a confirmation link, then sign in.',
      );
    } else {
      onClose();
    }
  }

  return (
    <Portal>
    <div
      className="modal-backdrop"
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="modal auth-modal">
        <h2 className="auth-title">
          {mode === 'sign-in' ? 'SIGN IN' : 'CREATE ACCOUNT'}
        </h2>
        <p className="auth-sub">
          Sync events across every device you sign in on. Local-only stays the
          default. No account needed.
        </p>

        <div className="auth-form">
          <div className="setup-field">
            <label>Email</label>
            <input
              className="setup-input auth-input"
              type="email"
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
            />
          </div>
          <div className="setup-field">
            <label>Password</label>
            <input
              className="setup-input auth-input"
              type="password"
              autoComplete={mode === 'sign-in' ? 'current-password' : 'new-password'}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder={mode === 'sign-up' ? 'At least 6 characters' : ''}
            />
          </div>
        </div>

        {err && <div style={{ color: 'var(--red)', fontSize: 13, marginTop: 8 }}>{err}</div>}

        <div className="modal-actions">
          <button className="btn" onClick={onClose}>
            Cancel
          </button>
          <button
            className="btn primary"
            onClick={submitEmail}
            disabled={busy || !email || !password}
          >
            {busy
              ? mode === 'sign-in'
                ? 'Signing in…'
                : 'Creating account…'
              : mode === 'sign-in'
                ? 'Sign in'
                : 'Create account'}
          </button>
        </div>

        <div style={{ textAlign: 'center', marginTop: 8 }}>
          <button
            className="btn ghost sm"
            onClick={() => {
              setMode(mode === 'sign-in' ? 'sign-up' : 'sign-in');
              setErr(null);
            }}
          >
            {mode === 'sign-in'
              ? 'Don\'t have an account? Create one'
              : 'Already have an account? Sign in'}
          </button>
        </div>
      </div>
    </div>
    </Portal>
  );
}
