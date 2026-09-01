import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { BrandLogo } from '@/components/BrandLogo';
import {
  getPublicSignup,
  joinPublicSingle,
  registerPublicTeam,
  type PublicSignup,
  type SignupRegistration,
} from '@/lib/signups';
import { buildSignupRosterView } from '@/utils/signupRosterView';

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
  if (!registration.playerTwo.trim()) return registration.playerOne;
  return registration.teamName || `${registration.playerOne} & ${registration.playerTwo}`;
}

function publicLoadError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  if (/abort|timeout|timed out/i.test(message)) {
    return 'The event took too long to load. Check your connection and try again.';
  }
  return message;
}

interface CountdownParts {
  started: boolean;
  days: number;
  hours: number;
  minutes: number;
  seconds: number;
}

export function getCountdownParts(startsAt: string | null, now: number): CountdownParts | null {
  if (!startsAt) return null;
  const target = Date.parse(startsAt);
  if (!Number.isFinite(target)) return null;

  const remaining = Math.max(0, target - now);
  return {
    started: target <= now,
    days: Math.floor(remaining / 86_400_000),
    hours: Math.floor((remaining % 86_400_000) / 3_600_000),
    minutes: Math.floor((remaining % 3_600_000) / 60_000),
    seconds: Math.floor((remaining % 60_000) / 1_000),
  };
}

function countdownValue(value: number): string {
  return String(value).padStart(2, '0');
}

export function PublicSignupScreen() {
  const { accountSlug = '', slug = '' } = useParams();
  const navigate = useNavigate();
  const [data, setData] = useState<PublicSignup | null>(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{
    status: 'confirmed' | 'waitlisted' | 'looking';
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
  const [clockNow, setClockNow] = useState(() => Date.now());

  const routeKey = `${accountSlug}/${slug}`;
  const currentRouteKey = useRef(routeKey);
  currentRouteKey.current = routeKey;
  const refreshInFlight = useRef<{ key: string; promise: Promise<void> } | null>(null);

  const refresh = useCallback((): Promise<void> => {
    const requestKey = `${accountSlug}/${slug}`;
    if (!slug) {
      setError('This sign-up link is incomplete.');
      setLoading(false);
      return Promise.resolve();
    }

    const existing = refreshInFlight.current;
    if (existing?.key === requestKey) return existing.promise;

    const request = (async () => {
      try {
        const next = await getPublicSignup(slug, accountSlug || undefined);
        if (currentRouteKey.current !== requestKey) return;
        setData(next);
        setError(null);
      } catch (err) {
        if (currentRouteKey.current !== requestKey) return;
        setError(publicLoadError(err));
      } finally {
        if (currentRouteKey.current === requestKey) setLoading(false);
      }
    })();

    refreshInFlight.current = { key: requestKey, promise: request };
    void request.finally(() => {
      if (refreshInFlight.current?.promise === request) refreshInFlight.current = null;
    });
    return request;
  }, [accountSlug, slug]);

  const refreshAfterMutation = useCallback(async (): Promise<void> => {
    const existing = refreshInFlight.current;
    if (existing?.key === routeKey) await existing.promise;
    await refresh();
  }, [refresh, routeKey]);

  useEffect(() => {
    let cancelled = false;
    let timer: number | null = null;
    setData(null);
    setError(null);
    setLoading(true);

    const poll = async () => {
      await refresh();
      if (!cancelled) timer = window.setTimeout(() => void poll(), 8_000);
    };

    void poll();
    const onVisible = () => !document.hidden && void refresh();
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      cancelled = true;
      if (timer !== null) window.clearTimeout(timer);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [refresh]);

  useEffect(() => {
    if (accountSlug || !data?.event.accountSlug || !data.event.eventSlug) return;
    navigate(`/signup/${data.event.accountSlug}/${data.event.eventSlug}`, { replace: true });
  }, [accountSlug, data, navigate]);

  useEffect(() => {
    const startsAt = data?.event.startsAt;
    if (!startsAt || !Number.isFinite(Date.parse(startsAt))) return;

    setClockNow(Date.now());
    const timer = window.setInterval(() => setClockNow(Date.now()), 1_000);
    return () => window.clearInterval(timer);
  }, [data?.event.startsAt]);

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
      await refreshAfterMutation();
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
      await refreshAfterMutation();
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
          <button
            className="btn primary"
            type="button"
            onClick={() => {
              setError(null);
              setLoading(true);
              void refresh();
            }}
          >
            Try again
          </button>
        </div>
      </main>
    );
  }

  const {
    confirmedPairs,
    waitlistedPairs,
    lookingForPartner,
    confirmedPairCount,
    pairSpacesLeft: spaces,
  } = buildSignupRosterView(data.registrations, data.event.capacityTeams);
  const countdown = getCountdownParts(data.event.startsAt, clockNow);
  const registrationsOpen = data.event.isOpen && !countdown?.started;

  function rosterRow(
    registration: SignupRegistration,
    displayPosition: number,
    kind: 'confirmed' | 'waiting' | 'solo',
  ) {
    const isPair = Boolean(registration.playerTwo.trim());
    const waiting = kind === 'waiting';
    return (
      <div className="signup-public-team" key={registration.id}>
        <span className={'signup-public-position ' + (kind === 'confirmed' ? '' : 'waiting')}>{displayPosition}</span>
        <span>
          <strong>{registrationLabel(registration)}</strong>
          {isPair && registration.teamName && <small>{registration.playerOne} & {registration.playerTwo}</small>}
          {!isPair && <small>Solo player looking for a partner</small>}
        </span>
        <span className="signup-public-row-actions">
          <span className={'signup-public-status ' + (kind === 'confirmed' ? 'confirmed' : 'waiting')}>
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
        {countdown && (
          <div
            className={'signup-public-countdown ' + (countdown.started ? 'started' : '')}
            aria-label={countdown.started ? 'Event started' : 'Countdown to event start'}
          >
            <span className="signup-public-countdown-label">
              {countdown.started ? 'EVENT STARTED' : 'EVENT STARTS IN'}
            </span>
            <div className="signup-public-countdown-units" aria-live="polite">
              {([
                ['Days', countdown.days],
                ['Hours', countdown.hours],
                ['Minutes', countdown.minutes],
                ['Seconds', countdown.seconds],
              ] as const).map(([label, value]) => (
                <span className="signup-public-countdown-unit" key={label}>
                  <strong>{countdownValue(value)}</strong>
                  <small>{label}</small>
                </span>
              ))}
            </div>
          </div>
        )}
        <div className={'signup-public-availability ' + (!registrationsOpen ? 'closed' : spaces > 0 ? 'open' : 'waiting')}>
          <strong>{!registrationsOpen
            ? 'Registration closed'
            : spaces > 0
              ? `${spaces} team space${spaces === 1 ? '' : 's'} left`
              : 'Confirmed teams full'}</strong>
          <span>{!registrationsOpen
            ? countdown?.started
              ? 'This event has already started.'
              : 'Registrations have been closed by the organiser.'
            : spaces > 0
              ? 'Register a pair, or join the partner list solo.'
              : 'New pairs join the waiting list. Solo players can still look for a partner.'}</span>
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
            <strong>{confirmedPairCount}/{data.event.capacityTeams}</strong>
          </div>
          <p className="signup-public-priority-note">Pairs have priority. Solo players can be joined by another player here.</p>

          <div className="signup-public-list">
            {confirmedPairs.map((registration, index) => rosterRow(registration, index + 1, 'confirmed'))}
            {confirmedPairs.length === 0 && <div className="signup-public-empty">No confirmed teams yet.</div>}
          </div>

          <div className="signup-public-waiting-head">
            <span>LOOKING FOR A PARTNER</span>
            <strong>{lookingForPartner.length}</strong>
          </div>
          <div className="signup-public-list waiting">
            {lookingForPartner.map((registration, index) => rosterRow(registration, index + 1, 'solo'))}
            {lookingForPartner.length === 0 && <div className="signup-public-empty">Nobody is looking for a partner.</div>}
          </div>

          <div className="signup-public-waiting-head">
            <span>WAITING LIST</span>
            <strong>{waitlistedPairs.length}</strong>
          </div>
          <div className="signup-public-list waiting">
            {waitlistedPairs.map((registration, index) => rosterRow(registration, index + 1, 'waiting'))}
            {waitlistedPairs.length === 0 && <div className="signup-public-empty">Nobody waiting.</div>}
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
              <span>{result.kind === 'solo' || result.status === 'confirmed' ? '✓' : result.position}</span>
              <h2>{result.kind === 'solo'
                ? 'You’re looking for a partner!'
                : result.status === 'confirmed'
                  ? 'You’re confirmed!'
                  : 'You’re on the waiting list'}</h2>
              <p>
                {result.kind === 'solo'
                  ? 'Another player can join you from the live partner list. A team place is counted only after you form a pair.'
                  : result.status === 'confirmed'
                    ? 'Your pair is now on the live confirmed list.'
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
                  <h2>{signupMode === 'solo'
                    ? 'Find a partner'
                    : spaces > 0
                      ? 'Register to play'
                      : 'Join the waiting list'}</h2>
                </div>
              </div>
              {!registrationsOpen ? (
                <div className="signup-public-closed">
                  {countdown?.started
                    ? 'This event has started, so registrations are closed.'
                    : 'Registrations are currently closed by the organiser.'}
                </div>
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
