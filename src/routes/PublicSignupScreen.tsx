import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from 'react';
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
import { formatEventDateTime } from '@/lib/eventTime';

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
  const [loadError, setLoadError] = useState<string | null>(null);
  const [refreshError, setRefreshError] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [refreshVersion, setRefreshVersion] = useState(0);
  const [result, setResult] = useState<{
    registrationId: string;
    status: 'confirmed' | 'waitlisted' | 'looking';
    position: number;
    kind: 'solo' | 'pair' | 'joined';
    refreshVersionAtSubmit: number;
    missing?: boolean;
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
  const playerOneRef = useRef<HTMLInputElement>(null);
  const playerTwoRef = useRef<HTMLInputElement>(null);
  const contactRef = useRef<HTMLInputElement>(null);
  const joinNameRef = useRef<HTMLInputElement>(null);
  const joinContactRef = useRef<HTMLInputElement>(null);
  const registerRequestId = useRef<string | null>(null);
  const joinRequestId = useRef<string | null>(null);

  const routeKey = `${accountSlug}/${slug}`;
  const currentRouteKey = useRef(routeKey);
  const hasData = useRef(false);
  currentRouteKey.current = routeKey;
  const refreshInFlight = useRef<{ key: string; promise: Promise<void> } | null>(null);

  const refresh = useCallback((): Promise<void> => {
    const requestKey = `${accountSlug}/${slug}`;
    if (!slug) {
      setLoadError('This sign-up link is incomplete.');
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
        hasData.current = true;
        setLoadError(null);
        setRefreshError(null);
        setRefreshVersion((version) => version + 1);
      } catch (err) {
        if (currentRouteKey.current !== requestKey) return;
        const message = publicLoadError(err);
        if (hasData.current) setRefreshError(message);
        else setLoadError(message);
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
    hasData.current = false;
    setLoadError(null);
    setRefreshError(null);
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

  useEffect(() => {
    if (!result || refreshVersion <= result.refreshVersionAtSubmit) return;
    const current = data?.registrations.find((registration) => registration.id === result.registrationId);
    if (current) {
      if (current.status !== result.status || current.position !== result.position || result.missing) {
        setResult({ ...result, status: current.status as typeof result.status, position: current.position, missing: false });
      }
    } else if (!result.missing) {
      setResult({ ...result, missing: true });
    }
  }, [data?.registrations, refreshVersion, result]);

  const contactHref = useMemo(() => {
    if (!data?.event.publicContactMethod || !data.event.publicContactValue) return null;
    return data.event.publicContactMethod === 'email'
      ? `mailto:${data.event.publicContactValue}`
      : `https://wa.me/${data.event.publicContactValue.replace(/\D/g, '')}`;
  }, [data?.event.publicContactMethod, data?.event.publicContactValue]);

  function showValidation(errors: Record<string, string>, refs: Record<string, RefObject<HTMLInputElement>>) {
    setFieldErrors(errors);
    const first = Object.keys(errors)[0];
    setFormError(errors[first] ?? null);
    refs[first]?.current?.focus();
  }

  async function register() {
    if (!data || website) return;
    const errors: Record<string, string> = {};
    if (!playerOne.trim()) errors.playerOne = signupMode === 'pair' ? 'Enter player one.' : 'Enter your name.';
    if (signupMode === 'pair' && !playerTwo.trim()) errors.playerTwo = 'Enter player two.';
    if (!contact.trim()) errors.contact = 'Enter a WhatsApp number or email.';
    if (Object.keys(errors).length) {
      showValidation(errors, { playerOne: playerOneRef, playerTwo: playerTwoRef, contact: contactRef });
      return;
    }
    setSubmitting(true);
    setFormError(null);
    setFieldErrors({});
    registerRequestId.current ??= crypto.randomUUID();
    try {
      const registered = await registerPublicTeam({
        accountSlug: accountSlug || undefined,
        publicSlug: slug,
        teamName: signupMode === 'pair' ? teamName : '',
        playerOne,
        playerTwo: signupMode === 'pair' ? playerTwo : '',
        contact,
        requestId: registerRequestId.current,
      });
      setResult({ ...registered, kind: signupMode, refreshVersionAtSubmit: refreshVersion });
      registerRequestId.current = null;
      setTeamName('');
      setPlayerOne('');
      setPlayerTwo('');
      setContact('');
      await refreshAfterMutation();
    } catch (err) {
      setFormError((err as Error).message);
    } finally {
      setSubmitting(false);
    }
  }

  function startJoin(registration: SignupRegistration) {
    setJoinTarget(registration);
    setJoinName('');
    setJoinContact('');
    setResult(null);
    setFormError(null);
    setFieldErrors({});
    joinRequestId.current = null;
    window.setTimeout(() => {
      document.querySelector('.signup-public-form-card')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, 0);
  }

  async function joinPlayer() {
    if (!joinTarget) return;
    const errors: Record<string, string> = {};
    if (!joinName.trim()) errors.joinName = 'Enter your name.';
    if (!joinContact.trim()) errors.joinContact = 'Enter a WhatsApp number or email.';
    if (Object.keys(errors).length) {
      showValidation(errors, { joinName: joinNameRef, joinContact: joinContactRef });
      return;
    }
    setSubmitting(true);
    setFormError(null);
    setFieldErrors({});
    joinRequestId.current ??= crypto.randomUUID();
    try {
      const joined = await joinPublicSingle({
        accountSlug: accountSlug || undefined,
        publicSlug: slug,
        registrationId: joinTarget.id,
        playerName: joinName,
        contact: joinContact,
        requestId: joinRequestId.current,
      });
      setJoinTarget(null);
      setJoinName('');
      setJoinContact('');
      setResult({ ...joined, kind: 'joined', refreshVersionAtSubmit: refreshVersion });
      joinRequestId.current = null;
      await refreshAfterMutation();
    } catch (err) {
      setFormError((err as Error).message);
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
          <p>{loadError ?? 'This link could not be found.'}</p>
          <button
            className="btn primary"
            type="button"
            onClick={() => {
              setLoadError(null);
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
  const eventEnded = Boolean(data.event.endsAt && Date.parse(data.event.endsAt) <= clockNow);
  const eventCancelled = Boolean(data.event.cancelledAt);
  const registrationsOpen = data.event.isOpen && !countdown?.started && !eventCancelled;

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
        <div className="signup-public-eyebrow">
          {eventCancelled ? 'EVENT CANCELLED' : eventEnded ? 'EVENT ENDED' : countdown?.started ? 'EVENT IN PROGRESS' : 'LIVE EVENT SIGN-UP'}
        </div>
        <h1>{data.event.title}</h1>
        <div className="signup-public-meta">
          <span>{formatEventDateTime(data.event.startsAt, data.event.timeZone)}</span>
          {data.event.endsAt && <span>Ends {formatEventDateTime(data.event.endsAt, data.event.timeZone)}</span>}
          {data.event.venue && <span>{data.event.venue}</span>}
        </div>
        {countdown && !eventEnded && !eventCancelled && (
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
            ? eventCancelled ? 'Event cancelled' : eventEnded ? 'Event ended' : 'Registration closed'
            : spaces > 0
              ? `${spaces} team space${spaces === 1 ? '' : 's'} left`
              : 'Confirmed teams full'}</strong>
          <span>{!registrationsOpen
            ? eventCancelled
              ? data.event.cancellationMessage || 'This event has been cancelled by the organiser.'
              : eventEnded
                ? 'This event has finished.'
                : countdown?.started
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
                  <input ref={joinNameRef} value={joinName} onChange={(e) => { joinRequestId.current = null; setJoinName(e.target.value); setFieldErrors((current) => ({ ...current, joinName: '' })); }} autoComplete="name" aria-invalid={Boolean(fieldErrors.joinName)} aria-describedby={fieldErrors.joinName ? 'join-name-error' : undefined} />
                  {fieldErrors.joinName && <small id="join-name-error" className="signup-field-error">{fieldErrors.joinName}</small>}
                </label>
                <label>
                  <span>Your WhatsApp number or email</span>
                  <input ref={joinContactRef} value={joinContact} onChange={(e) => { joinRequestId.current = null; setJoinContact(e.target.value); setFieldErrors((current) => ({ ...current, joinContact: '' })); }} autoComplete="email" placeholder="Kept private" aria-invalid={Boolean(fieldErrors.joinContact)} aria-describedby={fieldErrors.joinContact ? 'join-contact-error' : undefined} />
                  {fieldErrors.joinContact && <small id="join-contact-error" className="signup-field-error">{fieldErrors.joinContact}</small>}
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
              <h2>{result.missing
                ? 'No longer on the live list'
                : result.kind === 'solo'
                ? 'You’re looking for a partner!'
                : result.status === 'confirmed'
                  ? 'You’re confirmed!'
                  : 'You’re on the waiting list'}</h2>
              <p>
                {result.missing
                  ? 'The organiser may have changed or removed this registration. Contact them to confirm what happened.'
                  : result.kind === 'solo'
                  ? 'Another player can join you from the live partner list. A team place is counted only after you form a pair.'
                  : result.status === 'confirmed'
                    ? 'Your pair is now on the live confirmed list.'
                  : `You are waiting-list position ${result.position}. The list updates automatically when places change.`}
              </p>
              <p className="signup-public-private">Need to change or cancel it? Only the organiser can edit the live list.</p>
              {contactHref && <a className="btn full" href={contactHref} target="_blank" rel="noreferrer">Contact organiser</a>}
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
                  {eventCancelled
                    ? 'Registrations are closed for this cancelled event.'
                    : eventEnded
                      ? 'Registrations closed when this event started.'
                      : countdown?.started
                    ? 'This event has started, so registrations are closed.'
                    : 'Registrations are currently closed by the organiser.'}
                </div>
              ) : (
                <div className="signup-public-form">
                  <div className="signup-public-mode" role="group" aria-label="Sign-up type">
                    <button className={signupMode === 'pair' ? 'active' : ''} type="button" onClick={() => { registerRequestId.current = null; setSignupMode('pair'); }}>
                      Sign up as a pair
                    </button>
                    <button className={signupMode === 'solo' ? 'active' : ''} type="button" onClick={() => { registerRequestId.current = null; setSignupMode('solo'); }}>
                      Sign up solo
                    </button>
                  </div>
                  {signupMode === 'pair' && (
                    <label>
                      <span>Pair name <small>optional</small></span>
                      <input value={teamName} onChange={(e) => { registerRequestId.current = null; setTeamName(e.target.value); }} placeholder="The Smashers" />
                    </label>
                  )}
                  <label>
                    <span>{signupMode === 'pair' ? 'Player one' : 'Your name'}</span>
                    <input ref={playerOneRef} value={playerOne} onChange={(e) => { registerRequestId.current = null; setPlayerOne(e.target.value); setFieldErrors((current) => ({ ...current, playerOne: '' })); }} autoComplete="name" aria-invalid={Boolean(fieldErrors.playerOne)} aria-describedby={fieldErrors.playerOne ? 'player-one-error' : undefined} />
                    {fieldErrors.playerOne && <small id="player-one-error" className="signup-field-error">{fieldErrors.playerOne}</small>}
                  </label>
                  {signupMode === 'pair' && (
                    <label>
                      <span>Player two</span>
                      <input ref={playerTwoRef} value={playerTwo} onChange={(e) => { registerRequestId.current = null; setPlayerTwo(e.target.value); setFieldErrors((current) => ({ ...current, playerTwo: '' })); }} autoComplete="name" aria-invalid={Boolean(fieldErrors.playerTwo)} aria-describedby={fieldErrors.playerTwo ? 'player-two-error' : undefined} />
                      {fieldErrors.playerTwo && <small id="player-two-error" className="signup-field-error">{fieldErrors.playerTwo}</small>}
                    </label>
                  )}
                  <label>
                    <span>WhatsApp number or email</span>
                    <input ref={contactRef} value={contact} onChange={(e) => { registerRequestId.current = null; setContact(e.target.value); setFieldErrors((current) => ({ ...current, contact: '' })); }} autoComplete="email" placeholder="Kept private" aria-invalid={Boolean(fieldErrors.contact)} aria-describedby={fieldErrors.contact ? 'contact-error' : undefined} />
                    {fieldErrors.contact && <small id="contact-error" className="signup-field-error">{fieldErrors.contact}</small>}
                  </label>
                  <label className="signup-honeypot" aria-hidden>
                    Website
                    <input value={website} onChange={(e) => setWebsite(e.target.value)} tabIndex={-1} autoComplete="off" />
                  </label>
                  <button className="btn primary full lg" type="button" disabled={submitting} onClick={register}>
                    {submitting ? 'Registering…' : signupMode === 'pair' ? 'Register our pair' : 'Register me'}
                  </button>
                  <p className="signup-public-private">
                    Player names appear on the public list. Contact details are visible only to the organiser. See our <a href="/privacy/" target="_blank" rel="noreferrer">privacy policy</a>.
                  </p>
                  {contactHref && <a className="signup-public-contact" href={contactHref} target="_blank" rel="noreferrer">Contact organiser</a>}
                </div>
              )}
            </>
          )}

          {formError && <div className="signup-message error" role="alert">{formError}</div>}
          {refreshError && <div className="signup-message error" role="status">Live-list refresh failed. Your form is safe; we’ll retry automatically.</div>}
        </section>
      </div>

      <footer className="signup-public-footer">
        Lists refresh automatically · Powered by Padel Tournament Maker
      </footer>
    </main>
  );
}
