/**
 * AuthModal: sign in / sign up / sign in with Apple.
 *
 * Surfaces only when `cloudEnabled` (env vars present at build time).
 * Sign-in with Apple is required by Apple's App Review whenever any
 * third-party auth is offered; the email flow stays for users who don't
 * want an Apple ID tied to the app.
 */

import { useState } from 'react';
import { useAuth } from '@/hooks/useAuth';

export function AuthModal({ onClose }: { onClose: () => void }) {
  const auth = useAuth();
  const [mode, setMode] = useState<'sign-in' | 'sign-up'>('sign-in');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  if (!auth.cloudEnabled) {
    return (
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
    );
  }

  if (auth.user) {
    return (
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
          <div className="modal-actions">
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
              {busy ? 'Signing out…' : 'Sign out'}
            </button>
            <button className="btn primary" onClick={onClose}>
              Done
            </button>
          </div>
        </div>
      </div>
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

  async function clickApple() {
    setErr(null);
    setBusy(true);
    const res = await auth.signInWithApple();
    setBusy(false);
    if (res.error) setErr(res.error);
    // OAuth flow redirects; success doesn't reach here directly.
  }

  return (
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

        <button
          className="btn full lg auth-apple"
          onClick={clickApple}
          disabled={busy}
        >
          Continue with Apple
        </button>

        <div className="auth-divider">
          <span>or with email</span>
        </div>

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
  );
}
