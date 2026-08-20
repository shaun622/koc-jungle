import { useCallback, useEffect, useMemo, useState } from 'react';
import { AuthModal } from '@/components/AuthModal';
import { Icons } from '@/components/Icons';
import { useAuth } from '@/hooks/useAuth';
import {
  buildSignupUrl,
  getOrganizerRegistrations,
  getOwnedSignup,
  registrationPairKey,
  saveSignupEvent,
  setSignupOpen,
  shareSignupLink,
  type SignupEvent,
  type SignupRegistration,
} from '@/lib/signups';
import type { EventState, Team } from '@/types/domain';

function inputDateTime(iso: string | null): string {
  if (!iso) return '';
  const date = new Date(iso);
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 16);
}

function toIso(value: string): string | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function formatWhen(startsAt: string | null, endsAt: string | null): string {
  if (!startsAt) return 'Date not set';
  const start = new Date(startsAt);
  const end = endsAt ? new Date(endsAt) : null;
  const day = start.toLocaleDateString(undefined, {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
  });
  const startTime = start.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  const endTime = end?.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  return `${day} · ${startTime}${endTime ? `–${endTime}` : ''}`;
}

export function EventSignupPanel({
  event,
  expectedTeams,
  teams,
  onAddTeam,
}: {
  event: EventState;
  expectedTeams: number;
  teams: Team[];
  onAddTeam: (input: { name?: string; player1: string; player2: string }) => void;
}) {
  const auth = useAuth();
  const [expanded, setExpanded] = useState(false);
  const [authOpen, setAuthOpen] = useState(false);
  const [signup, setSignup] = useState<SignupEvent | null>(null);
  const [registrations, setRegistrations] = useState<SignupRegistration[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [title, setTitle] = useState(event.name);
  const [venue, setVenue] = useState(event.venue ?? '');
  const [startsAt, setStartsAt] = useState('');
  const [endsAt, setEndsAt] = useState('');
  const [capacity, setCapacity] = useState(expectedTeams);
  const [details, setDetails] = useState('');
  const [prizes, setPrizes] = useState('');

  const refreshRegistrations = useCallback(async (signupId: string) => {
    const rows = await getOrganizerRegistrations(signupId);
    setRegistrations(rows);
  }, []);

  useEffect(() => {
    if (!auth.user || !expanded) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    void getOwnedSignup(auth.user.id, event.id)
      .then(async (row) => {
        if (cancelled) return;
        setSignup(row);
        if (!row) return;
        setTitle(row.title);
        setVenue(row.venue);
        setStartsAt(inputDateTime(row.startsAt));
        setEndsAt(inputDateTime(row.endsAt));
        setCapacity(row.capacityTeams);
        setDetails(row.details);
        setPrizes(row.prizes);
        await refreshRegistrations(row.id);
      })
      .catch((err: Error) => !cancelled && setError(err.message))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [auth.user, event.id, expanded, refreshRegistrations]);

  useEffect(() => {
    if (!signup || !expanded) return;
    const timer = window.setInterval(() => {
      void refreshRegistrations(signup.id).catch(() => undefined);
    }, 8_000);
    return () => window.clearInterval(timer);
  }, [expanded, refreshRegistrations, signup]);

  const confirmed = registrations.filter((r) => r.status === 'confirmed');
  const waitlisted = registrations.filter((r) => r.status === 'waitlisted');
  const existingPairs = useMemo(
    () => new Set(teams.map((team) => registrationPairKey(team.players[0].name, team.players[1].name))),
    [teams],
  );
  const importable = confirmed.filter(
    (registration) => !existingPairs.has(registrationPairKey(registration.playerOne, registration.playerTwo)),
  );

  async function save() {
    if (!auth.user) return;
    if (!title.trim()) {
      setError('Give the event a name first.');
      return;
    }
    setSaving(true);
    setMessage(null);
    setError(null);
    try {
      const row = await saveSignupEvent({
        ownerUserId: auth.user.id,
        sourceEventId: event.id,
        title,
        venue,
        startsAt: toIso(startsAt),
        endsAt: toIso(endsAt),
        capacityTeams: Math.max(1, Math.min(128, capacity)),
        details,
        prizes,
      });
      setSignup(row);
      await refreshRegistrations(row.id);
      setMessage(signup ? 'Sign-up page updated.' : 'Sign-up page is live. Share the link with every group.');
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  }

  async function toggleOpen() {
    if (!signup) return;
    setError(null);
    try {
      await setSignupOpen(signup.id, !signup.isOpen);
      setSignup({ ...signup, isOpen: !signup.isOpen });
      setMessage(signup.isOpen ? 'Registrations closed.' : 'Registrations reopened.');
    } catch (err) {
      setError((err as Error).message);
    }
  }

  function importTeams() {
    for (const registration of importable) {
      onAddTeam({
        name: registration.teamName || undefined,
        player1: registration.playerOne,
        player2: registration.playerTwo,
      });
    }
    setMessage(`${importable.length} team${importable.length === 1 ? '' : 's'} added to this event.`);
  }

  return (
    <section className={'signup-admin ' + (expanded ? 'expanded' : '')}>
      <button className="signup-admin-toggle" type="button" onClick={() => setExpanded(!expanded)}>
        <span className="signup-admin-toggle-icon"><Icons.List className="icon" /></span>
        <span>
          <strong>Online team sign-up</strong>
          <small>One live link for confirmed teams and the waiting list.</small>
        </span>
        <span className="signup-admin-toggle-meta">
          {signup ? `${confirmed.length}/${signup.capacityTeams}` : 'SET UP'}
        </span>
      </button>

      {expanded && (
        <div className="signup-admin-body">
          {!auth.cloudEnabled ? (
            <div className="signup-admin-empty">
              Online sign-up needs the Supabase connection enabled in this build.
            </div>
          ) : !auth.user ? (
            <div className="signup-admin-empty">
              <p>Players will not need an account. You only sign in so the private organiser controls stay yours.</p>
              <button className="btn primary" type="button" onClick={() => setAuthOpen(true)}>
                Sign in to publish
              </button>
            </div>
          ) : loading ? (
            <div className="signup-admin-empty">Loading online sign-up…</div>
          ) : (
            <>
              <div className="signup-admin-form">
                <div className="setup-field signup-wide">
                  <label>Public event title</label>
                  <input className="setup-input" value={title} onChange={(e) => setTitle(e.target.value)} />
                </div>
                <div className="setup-field signup-wide">
                  <label>Venue</label>
                  <input className="setup-input" value={venue} onChange={(e) => setVenue(e.target.value)} />
                </div>
                <div className="setup-field">
                  <label>Starts</label>
                  <input className="setup-input" type="datetime-local" value={startsAt} onChange={(e) => setStartsAt(e.target.value)} />
                </div>
                <div className="setup-field">
                  <label>Ends</label>
                  <input className="setup-input" type="datetime-local" value={endsAt} onChange={(e) => setEndsAt(e.target.value)} />
                </div>
                <div className="setup-field">
                  <label>Confirmed team spaces</label>
                  <input
                    className="setup-input"
                    type="number"
                    min={1}
                    max={128}
                    value={capacity}
                    onChange={(e) => setCapacity(Number(e.target.value))}
                  />
                </div>
                <div className="setup-field signup-wide">
                  <label>Event details</label>
                  <textarea className="setup-input signup-textarea" value={details} onChange={(e) => setDetails(e.target.value)} placeholder="Level, inclusions, arrival time…" />
                </div>
                <div className="setup-field signup-wide">
                  <label>Prizes or extras</label>
                  <textarea className="setup-input signup-textarea" value={prizes} onChange={(e) => setPrizes(e.target.value)} placeholder="Winner prizes, food, drinks…" />
                </div>
              </div>

              <div className="signup-admin-actions">
                <button className="btn primary" type="button" disabled={saving} onClick={save}>
                  {saving ? 'Saving…' : signup ? 'Update sign-up page' : 'Publish sign-up page'}
                </button>
                {signup && (
                  <>
                    <button
                      className="btn"
                      type="button"
                      onClick={async () => {
                        setMessage(null);
                        try {
                          await shareSignupLink(signup);
                          setMessage('Link ready to share.');
                        } catch (err) {
                          if ((err as Error).name !== 'AbortError') setError((err as Error).message);
                        }
                      }}
                    >
                      Share link
                    </button>
                    <button className="btn" type="button" onClick={toggleOpen}>
                      {signup.isOpen ? 'Close registrations' : 'Reopen registrations'}
                    </button>
                  </>
                )}
              </div>

              {signup && (
                <>
                  <a className="signup-admin-link" href={buildSignupUrl(signup.publicSlug)} target="_blank" rel="noopener noreferrer">
                    {buildSignupUrl(signup.publicSlug)}
                  </a>
                  <div className="signup-admin-summary">
                    <div><strong>{confirmed.length}</strong><span>Confirmed / {signup.capacityTeams}</span></div>
                    <div><strong>{waitlisted.length}</strong><span>Waiting</span></div>
                    <div><strong>{formatWhen(signup.startsAt, signup.endsAt)}</strong><span>{signup.isOpen ? 'Sign-up open' : 'Sign-up closed'}</span></div>
                  </div>

                  {registrations.length > 0 && (
                    <div className="signup-admin-roster">
                      {registrations.map((registration) => (
                        <div className="signup-admin-row" key={registration.id}>
                          <span className={'signup-position ' + registration.status}>
                            {registration.status === 'confirmed' ? registration.position : `W${registration.position}`}
                          </span>
                          <span>
                            <strong>{registration.teamName || `${registration.playerOne} & ${registration.playerTwo}`}</strong>
                            <small>{registration.playerOne} · {registration.playerTwo}</small>
                          </span>
                          <span className="signup-contact">{registration.contact}</span>
                        </div>
                      ))}
                    </div>
                  )}

                  <button className="btn full" type="button" disabled={importable.length === 0} onClick={importTeams}>
                    {importable.length > 0
                      ? `Add ${importable.length} confirmed team${importable.length === 1 ? '' : 's'} to event`
                      : 'Confirmed teams are already in the event'}
                  </button>
                </>
              )}
            </>
          )}

          {message && <div className="signup-message success">{message}</div>}
          {error && <div className="signup-message error">{error}</div>}
        </div>
      )}
      {authOpen && <AuthModal onClose={() => setAuthOpen(false)} />}
    </section>
  );
}
