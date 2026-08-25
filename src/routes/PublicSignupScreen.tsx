import { useCallback, useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { BrandLogo } from '@/components/BrandLogo';
import {
  getPublicSignup,
  joinPublicSingle,
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

function registrationLabel(registration: SignupRegistration): string {
  if (!registration.playerTwo) return registration.playerOne;
  return registration.teamName || `${registration.playerOne} & ${registration.playerTwo}`;
}

export function PublicSignupScreen() {
  const { accountSlug = '', slug = '' } = useParams();
  const navigate = useNavigate();
  const [data, setData] = useState<PublicSignup | null>(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{
    status: 'confirmed' | 'waitlisted';
    position: number;
    kind: 'solo' | 'pair' | 'joined';
  } | null>(null);
  const [signupMode, setSignupMode] = useState<'pair' | 'solo'>('pair');
  const [teamName, setTeamName] = useState('');
  const [playerOne, setPlayerOne] = useState('');
  const [playerTwo, setPlayerTwo] = useState('');
  const [contact, setContact] = useState('');
  const [website, setWebsite] = useState('');
  const [joinTarget, setJoinTarget] = useState<SignupRegistration | null>(null);
  const [joinName, setJoinName] = useState('');
  const [joinContact, setJoinContact] = useState('');

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
    if (!playerOne.trim() || !contact.trim() || (signupMode === 'pair' && !playerTwo.trim())) {
      setError(signupMode === 'pair'
        ? 'Enter both player names and a WhatsApp number or email.'
        : 'Enter your name and a WhatsApp number or email.');
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const registered = await registerPublicTeam({
        accountSlug: accountSlug || undefined,
        publicSlug: slug,
        teamName: signupMode === 'pair' ? teamName : '',
        playerOne,
        playerTwo: signupMode === 'pair' ? playerTwo : '',
        contact,
      });
      setResult({ status: registered.status, position: registered.position, kind: signupMode });
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

  function startJoin(registration: SignupRegistration) {
    setJoinTarget(registration);
    setJoinName('');
    setJoinContact('');
    setResult(null);
    setError(null);
    window.setTimeout(() => {
      document.querySelector('.signup-public-form-card')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, 0);
  }

  async function joinPlayer() {
    if (!joinTarget || !joinName.trim() || !joinContact.trim()) {
      setError('Enter your name and a WhatsApp number or email.');
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const joined = await joinPublicSingle({
        accountSlug: accountSlug || undefined,
        publicSlug: slug,
        registrationId: joinTarget.id,
        playerName: joinName,
        contact: joinContact,
      });
      setJoinTarget(null);
      setJoinName('');
      setJoinContact('');
      setResult({ status: joined.status, position: joined.position, kind: 'joined' });
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
  const registrationsOpen = data.event.isOpen;

  function rosterRow(registration: SignupRegistration, waiting = false) {
    const isPair = Boolean(registration.playerTwo);
    return (
      <div className="signup-public-team" key={registration.id}>
        <span className={'signup-public-position ' + (waiting ? 'waiting' : '')}>{registration.position}</span>
        <span>
          <strong>{registrationLabel(registration)}</strong>
          {isPair && registration.teamName && <small>{registration.playerOne} & {registration.playerTwo}</small>}
          {!isPair && <small>Solo player looking for a partner</small>}
        </span>
        <span className="signup-public-row-actions">
          <span className={'signup-public-status ' + (waiting ? 'waiting' : 'confirmed')}>
            {isPair ? (waiting ? 'PAIR · WAITING' : 'PAIR · CONFIRMED') : 'NEEDS PARTNER'}
          </span>
          {!isPair && registrationsOpen && (
            <button className="btn signup-public-join" type="button" onClick={() => startJoin(registration)}>
              Join
            </button>
          )}
        </span>
      </div>
    );
  }

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
          <strong>{spaces > 0 ? `${spaces} team space${spaces === 1 ? '' : 's'} left` : 'Confirmed teams full'}</strong>
          <span>{spaces > 0 ? 'Register as a pair or solo player.' : 'New registrations join the waiting list automatically.'}</span>
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
          <p className="signup-public-priority-note">Pairs have priority. Solo players can be joined by another player here.</p>

          <div className="signup-public-list">
            {confirmed.map((registration) => rosterRow(registration))}
            {confirmed.length === 0 && <div className="signup-public-empty">No confirmed teams yet.</div>}
          </div>

          <div className="signup-public-waiting-head">
            <span>WAITING LIST</span>
            <strong>{waitlisted.length}</strong>
          </div>
          <div className="signup-public-list waiting">
            {waitlisted.map((registration) => rosterRow(registration, true))}
            {waitlisted.length === 0 && <div className="signup-public-empty">Nobody waiting.</div>}
          </div>
        </section>

        <section className="signup-public-card signup-public-form-card">
          {joinTarget ? (
            <>
              <div className="signup-public-section-head">
                <div>
                  <span>MAKE A PAIR</span>
                  <h2>Join {joinTarget.playerOne}</h2>
                </div>
              </div>
              <div className="signup-public-form">
                <label>
                  <span>Your name</span>
                  <input value={joinName} onChange={(e) => setJoinName(e.target.value)} autoComplete="name" />
                </label>
                <label>
                  <span>Your WhatsApp number or email</span>
                  <input value={joinContact} onChange={(e) => setJoinContact(e.target.value)} autoComplete="email" placeholder="Kept private" />
                </label>
                <button className="btn primary full lg" type="button" disabled={submitting} onClick={joinPlayer}>
                  {submitting ? 'Joining…' : `Join ${joinTarget.playerOne}`}
                </button>
                <button className="btn ghost full" type="button" disabled={submitting} onClick={() => setJoinTarget(null)}>Back</button>
                <p className="signup-public-private">You will become a pair. Your contact is visible only to the organiser.</p>
              </div>
            </>
          ) : result ? (
            <div className={'signup-public-result ' + result.status}>
              <span>{result.status === 'confirmed' ? '✓' : result.position}</span>
              <h2>{result.status === 'confirmed' ? 'You’re confirmed!' : 'You’re on the waiting list'}</h2>
              <p>
                {result.status === 'confirmed'
                  ? result.kind === 'solo'
                    ? 'You are confirmed as a solo player. Another player can join you from the live list.'
                    : 'Your pair is now on the live confirmed list.'
                  : `You are waiting-list position ${result.position}. The list updates automatically when places change.`}
              </p>
              <p className="signup-public-private">Need to change or cancel it? Message the organiser. Only the organiser can edit the live list.</p>
              <button className="btn full" type="button" onClick={() => setResult(null)}>Add another sign-up</button>
            </div>
          ) : (
            <>
              <div className="signup-public-section-head">
                <div>
                  <span>NO ACCOUNT NEEDED</span>
                  <h2>{spaces > 0 ? 'Register to play' : 'Join the waiting list'}</h2>
                </div>
              </div>
              {!data.event.isOpen ? (
                <div className="signup-public-closed">Registrations are currently closed by the organiser.</div>
              ) : (
                <div className="signup-public-form">
                  <div className="signup-public-mode" role="group" aria-label="Sign-up type">
                    <button className={signupMode === 'pair' ? 'active' : ''} type="button" onClick={() => setSignupMode('pair')}>
                      Sign up as a pair
                    </button>
                    <button className={signupMode === 'solo' ? 'active' : ''} type="button" onClick={() => setSignupMode('solo')}>
                      Sign up solo
                    </button>
                  </div>
                  {signupMode === 'pair' && (
                    <label>
                      <span>Pair name <small>optional</small></span>
                      <input value={teamName} onChange={(e) => setTeamName(e.target.value)} placeholder="The Smashers" />
                    </label>
                  )}
                  <label>
                    <span>{signupMode === 'pair' ? 'Player one' : 'Your name'}</span>
                    <input value={playerOne} onChange={(e) => setPlayerOne(e.target.value)} autoComplete="name" />
                  </label>
                  {signupMode === 'pair' && (
                    <label>
                      <span>Player two</span>
                      <input value={playerTwo} onChange={(e) => setPlayerTwo(e.target.value)} autoComplete="name" />
                    </label>
                  )}
                  <label>
                    <span>WhatsApp number or email</span>
                    <input value={contact} onChange={(e) => setContact(e.target.value)} autoComplete="email" placeholder="Kept private" />
                  </label>
                  <label className="signup-honeypot" aria-hidden>
                    Website
                    <input value={website} onChange={(e) => setWebsite(e.target.value)} tabIndex={-1} autoComplete="off" />
                  </label>
                  <button className="btn primary full lg" type="button" disabled={submitting} onClick={register}>
                    {submitting ? 'Registering…' : signupMode === 'pair' ? 'Register our pair' : 'Register me'}
                  </button>
                  <p className="signup-public-private">
                    Pairs have priority over solo players. Contact details are visible only to the organiser. To change or cancel a registration, message the organiser.
                  </p>
                </div>
              )}
            </>
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
