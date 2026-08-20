import { useCallback, useEffect, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { BrandLogo } from '@/components/BrandLogo';
import {
  cancelPublicRegistration,
  getPublicSignup,
  registerPublicTeam,
  type PublicSignup,
  type SignupRegistration,
} from '@/lib/signups';

function formatDateTime(iso: string | null): string {
  if (!iso) return 'Time to be confirmed';
  return new Date(iso).toLocaleString(undefined, {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    hour: 'numeric',
    minute: '2-digit',
  });
}

function teamLabel(registration: SignupRegistration): string {
  return registration.teamName || `${registration.playerOne} & ${registration.playerTwo}`;
}

function storageKey(slug: string): string {
  return `koc-signup-registration-${slug}`;
}

export function PublicSignupScreen() {
  const { accountSlug = '', slug = '' } = useParams();
  const navigate = useNavigate();
  const signupKey = accountSlug ? `${accountSlug}/${slug}` : slug;
  const [searchParams] = useSearchParams();
  const [data, setData] = useState<PublicSignup | null>(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ status: 'confirmed' | 'waitlisted'; position: number } | null>(null);
  const [cancelToken, setCancelToken] = useState<string | null>(() => {
    const fromUrl = searchParams.get('manage');
    if (fromUrl) return fromUrl;
    try {
      return localStorage.getItem(storageKey(signupKey));
    } catch {
      return null;
    }
  });
  const [confirmCancel, setConfirmCancel] = useState(false);

  const [teamName, setTeamName] = useState('');
  const [playerOne, setPlayerOne] = useState('');
  const [playerTwo, setPlayerTwo] = useState('');
  const [contact, setContact] = useState('');
  const [website, setWebsite] = useState('');

  const refresh = useCallback(async () => {
    if (!slug) return;
    try {
      const next = await getPublicSignup(slug, accountSlug || undefined);
      setData(next);
      setError(null);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, [accountSlug, slug]);

  useEffect(() => {
    void refresh();
    const timer = window.setInterval(() => void refresh(), 8_000);
    const onVisible = () => !document.hidden && void refresh();
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [refresh]);

  useEffect(() => {
    if (accountSlug || !data?.event.accountSlug || !data.event.eventSlug) return;
    navigate(`/signup/${data.event.accountSlug}/${data.event.eventSlug}`, { replace: true });
  }, [accountSlug, data, navigate]);

  async function register() {
    if (!data || website) return;
    if (!playerOne.trim() || !playerTwo.trim() || !contact.trim()) {
      setError('Enter both player names and a WhatsApp number or email.');
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const registered = await registerPublicTeam({
        accountSlug: accountSlug || undefined,
        publicSlug: slug,
        teamName,
        playerOne,
        playerTwo,
        contact,
      });
      try {
        localStorage.setItem(storageKey(signupKey), registered.cancelToken);
      } catch {
        // The private cancellation token is also kept in component state.
      }
      setCancelToken(registered.cancelToken);
      setResult({ status: registered.status, position: registered.position });
      setTeamName('');
      setPlayerOne('');
      setPlayerTwo('');
      setContact('');
      await refresh();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSubmitting(false);
    }
  }

  async function cancelRegistration() {
    if (!cancelToken) return;
    setSubmitting(true);
    setError(null);
    try {
      await cancelPublicRegistration(slug, cancelToken, accountSlug || undefined);
      try {
        localStorage.removeItem(storageKey(signupKey));
      } catch {
        // Ignore unavailable storage; cancellation already succeeded.
      }
      setCancelToken(null);
      setResult(null);
      setConfirmCancel(false);
      await refresh();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSubmitting(false);
    }
  }

  if (loading) return <div className="signup-public-loading">Loading event…</div>;
  if (!data) {
    return (
      <main className="signup-public">
        <div className="signup-public-card signup-public-error">
          <BrandLogo />
          <h1>Sign-up unavailable</h1>
          <p>{error ?? 'This link could not be found.'}</p>
        </div>
      </main>
    );
  }

  const confirmed = data.registrations.filter((registration) => registration.status === 'confirmed');
  const waitlisted = data.registrations.filter((registration) => registration.status === 'waitlisted');
  const spaces = Math.max(0, data.event.capacityTeams - confirmed.length);

  return (
    <main className="signup-public">
      <header className="signup-public-header">
        <span className="signup-public-logo"><BrandLogo /></span>
        <span>PADEL TOURNAMENT MAKER</span>
      </header>

      <section className="signup-public-hero">
        <div className="signup-public-eyebrow">LIVE EVENT SIGN-UP</div>
        <h1>{data.event.title}</h1>
        <div className="signup-public-meta">
          <span>{formatDateTime(data.event.startsAt)}</span>
          {data.event.venue && <span>{data.event.venue}</span>}
        </div>
        <div className={'signup-public-availability ' + (spaces > 0 ? 'open' : 'waiting')}>
          <strong>{spaces > 0 ? `${spaces} team space${spaces === 1 ? '' : 's'} left` : 'Event full'}</strong>
          <span>{spaces > 0 ? 'Register now for a confirmed place.' : 'New registrations join the waiting list automatically.'}</span>
        </div>
        {data.event.details && <p className="signup-public-copy">{data.event.details}</p>}
        {data.event.prizes && (
          <div className="signup-public-prizes">
            <span>PRIZES & EXTRAS</span>
            <p>{data.event.prizes}</p>
          </div>
        )}
      </section>

      <div className="signup-public-grid">
        <section className="signup-public-card">
          <div className="signup-public-section-head">
            <div>
              <span>LIVE LIST</span>
              <h2>Teams</h2>
            </div>
            <strong>{confirmed.length}/{data.event.capacityTeams}</strong>
          </div>

          <div className="signup-public-list">
            {confirmed.map((registration) => (
              <div className="signup-public-team" key={registration.id}>
                <span className="signup-public-position">{registration.position}</span>
                <span>
                  <strong>{teamLabel(registration)}</strong>
                  {registration.teamName && <small>{registration.playerOne} & {registration.playerTwo}</small>}
                </span>
                <span className="signup-public-status confirmed">CONFIRMED</span>
              </div>
            ))}
            {confirmed.length === 0 && <div className="signup-public-empty">No confirmed teams yet.</div>}
          </div>

          <div className="signup-public-waiting-head">
            <span>WAITING LIST</span>
            <strong>{waitlisted.length}</strong>
          </div>
          <div className="signup-public-list waiting">
            {waitlisted.map((registration) => (
              <div className="signup-public-team" key={registration.id}>
                <span className="signup-public-position waiting">{registration.position}</span>
                <span><strong>{teamLabel(registration)}</strong></span>
                <span className="signup-public-status waiting">WAITING</span>
              </div>
            ))}
            {waitlisted.length === 0 && <div className="signup-public-empty">Nobody waiting.</div>}
          </div>
        </section>

        <section className="signup-public-card signup-public-form-card">
          {result ? (
            <div className={'signup-public-result ' + result.status}>
              <span>{result.status === 'confirmed' ? '✓' : result.position}</span>
              <h2>{result.status === 'confirmed' ? 'You’re confirmed!' : 'You’re on the waiting list'}</h2>
              <p>
                {result.status === 'confirmed'
                  ? 'Your team is now on the live confirmed list.'
                  : `You are waiting-list position ${result.position}. If a team cancels, the list promotes automatically.`}
              </p>
              <button className="btn full" type="button" onClick={() => setResult(null)}>Register another team</button>
            </div>
          ) : (
            <>
              <div className="signup-public-section-head">
                <div>
                  <span>NO ACCOUNT NEEDED</span>
                  <h2>{spaces > 0 ? 'Register your team' : 'Join the waiting list'}</h2>
                </div>
              </div>
              {!data.event.isOpen ? (
                <div className="signup-public-closed">Registrations are currently closed by the organiser.</div>
              ) : (
                <div className="signup-public-form">
                  <label>
                    <span>Team name <small>optional</small></span>
                    <input value={teamName} onChange={(e) => setTeamName(e.target.value)} placeholder="The Smashers" />
                  </label>
                  <label>
                    <span>Player one</span>
                    <input value={playerOne} onChange={(e) => setPlayerOne(e.target.value)} autoComplete="name" />
                  </label>
                  <label>
                    <span>Player two</span>
                    <input value={playerTwo} onChange={(e) => setPlayerTwo(e.target.value)} autoComplete="name" />
                  </label>
                  <label>
                    <span>WhatsApp number or email</span>
                    <input value={contact} onChange={(e) => setContact(e.target.value)} autoComplete="email" placeholder="Kept private" />
                  </label>
                  <label className="signup-honeypot" aria-hidden>
                    Website
                    <input value={website} onChange={(e) => setWebsite(e.target.value)} tabIndex={-1} autoComplete="off" />
                  </label>
                  <button className="btn primary full lg" type="button" disabled={submitting} onClick={register}>
                    {submitting ? 'Registering…' : spaces > 0 ? 'Confirm my team' : 'Join waiting list'}
                  </button>
                  <p className="signup-public-private">Your contact is visible only to the organiser and is never shown on this page.</p>
                </div>
              )}
            </>
          )}

          {cancelToken && (
            <div className="signup-public-cancel">
              {!confirmCancel ? (
                <button type="button" className="signup-public-text-button" onClick={() => setConfirmCancel(true)}>
                  Cancel my registration
                </button>
              ) : (
                <div>
                  <p>Remove your team? The first waiting team may be promoted.</p>
                  <button className="btn danger" type="button" disabled={submitting} onClick={cancelRegistration}>Yes, cancel</button>
                  <button className="btn ghost" type="button" onClick={() => setConfirmCancel(false)}>Keep my place</button>
                </div>
              )}
            </div>
          )}
          {error && <div className="signup-message error">{error}</div>}
        </section>
      </div>

      <footer className="signup-public-footer">
        Lists refresh automatically · Powered by Padel Tournament Maker
      </footer>
    </main>
  );
}
