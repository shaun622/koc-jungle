import { useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { BrandLogo } from '@/components/BrandLogo';
import { ThemeSwitch } from '@/components/ThemeSwitch';
import { recoverySupabase } from '@/lib/supabase';

export function PasswordRecoveryScreen() {
  const location = useLocation();
  const navigate = useNavigate();
  const params = useMemo(() => new URLSearchParams(location.search), [location.search]);
  const tokenHash = params.get('token_hash');
  const verification = useRef<{ token: string; promise: Promise<{ error: unknown }> } | null>(null);
  const [verified, setVerified] = useState(false);
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(Boolean(tokenHash));
  const [message, setMessage] = useState<string | null>(tokenHash ? null : 'This reset link is incomplete or has expired.');

  useEffect(() => {
    if (!tokenHash) return;
    if (!recoverySupabase) {
      setBusy(false);
      setMessage('Password recovery is unavailable in this build.');
      return;
    }
    let cancelled = false;
    // React may replay this effect. A one-use token must be verified only once.
    if (verification.current?.token !== tokenHash) {
      verification.current = {
        token: tokenHash,
        promise: recoverySupabase.auth.verifyOtp({ token_hash: tokenHash, type: 'recovery' })
          .catch((error: unknown) => ({ error })),
      };
    }
    void verification.current.promise.then(({ error }) => {
      window.history.replaceState(null, '', '/#/auth/recovery');
      if (cancelled) return;
      setBusy(false);
      setVerified(!error);
      setMessage(error ? 'This reset link is invalid, expired, or has already been used.' : null);
    });
    return () => { cancelled = true; };
  }, [tokenHash]);

  async function updatePassword() {
    if (!recoverySupabase) return;
    if (password.length < 8) { setMessage('Use at least 8 characters.'); return; }
    if (password !== confirm) { setMessage('The passwords do not match.'); return; }
    setBusy(true);
    setMessage(null);
    try {
      const { error } = await recoverySupabase.auth.updateUser({ password });
      if (error) {
        setMessage(error.message);
        return;
      }
      await recoverySupabase.auth.signOut({ scope: 'local' });
      setVerified(false);
      setMessage('Password updated. You can now sign in with your new password.');
    } catch {
      setMessage('Could not update your password. Check your connection and try again.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="signup-public">
      <ThemeSwitch className="recovery-theme" />
      <section className="signup-public-card signup-public-error auth-modal">
        <BrandLogo />
        <h1>Reset organiser password</h1>
        {busy && <p>{verified ? 'Updating your password…' : 'Checking your secure reset link…'}</p>}
        {verified && !busy && (
          <div className="auth-form">
            <label className="setup-field"><span>New password</span><input className="setup-input" type="password" autoComplete="new-password" value={password} onChange={(event) => setPassword(event.target.value)} /></label>
            <label className="setup-field"><span>Confirm password</span><input className="setup-input" type="password" autoComplete="new-password" value={confirm} onChange={(event) => setConfirm(event.target.value)} /></label>
            <button className="btn primary full" type="button" onClick={updatePassword}>Update password</button>
          </div>
        )}
        {message && <p role="status">{message}</p>}
        {!verified && !busy && <button className="btn" type="button" onClick={() => navigate('/home')}>Return to the app</button>}
      </section>
    </main>
  );
}
