import { useCallback, useEffect, useMemo, useState } from 'react';
import { AuthModal } from '@/components/AuthModal';
import { Icons } from '@/components/Icons';
import { useAuth } from '@/hooks/useAuth';
import {
  buildSignupUrl,
  copySignupLink,
  defaultSignupAccountSlug,
  deleteSignupTemplate,
  getOrganizerRegistrations,
  getOwnedSignup,
  getSignupAccountSlug,
  getSignupTemplates,
  registrationPairKey,
  normaliseSignupLinkPart,
  saveSignupEvent,
  saveSignupTemplate,
  setSignupOpen,
  shareSignupLink,
  type SignupEvent,
  type SignupRegistration,
  type SignupTemplate,
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

function templateSchedule(startsAt: string, endsAt: string): {
  startsWeekday: number | null;
  startsTime: string;
  durationMinutes: number | null;
} {
  if (!startsAt) return { startsWeekday: null, startsTime: '', durationMinutes: null };
  const start = new Date(startsAt);
  const end = endsAt ? new Date(endsAt) : null;
  const duration = end && end > start ? Math.round((end.getTime() - start.getTime()) / 60_000) : null;
  return {
    startsWeekday: start.getDay(),
    startsTime: startsAt.slice(11, 16),
    durationMinutes: duration,
  };
}

function nextTemplateSchedule(template: SignupTemplate): { startsAt: string; endsAt: string } {
  if (template.startsWeekday === null || !template.startsTime) {
    return { startsAt: '', endsAt: '' };
  }
  const [hours, minutes] = template.startsTime.split(':').map(Number);
  const now = new Date();
  const start = new Date(now);
  start.setHours(hours, minutes, 0, 0);
  start.setDate(start.getDate() + ((template.startsWeekday - start.getDay() + 7) % 7));
  if (start <= now) start.setDate(start.getDate() + 7);
  const end = template.durationMinutes
    ? new Date(start.getTime() + template.durationMinutes * 60_000)
    : null;
  return {
    startsAt: inputDateTime(start.toISOString()),
    endsAt: end ? inputDateTime(end.toISOString()) : '',
  };
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
  const [accountSlug, setAccountSlug] = useState('organiser');
  const [venue, setVenue] = useState(event.venue ?? '');
  const [startsAt, setStartsAt] = useState('');
  const [endsAt, setEndsAt] = useState('');
  const [capacity, setCapacity] = useState(expectedTeams);
  const [details, setDetails] = useState('');
  const [prizes, setPrizes] = useState('');
  const [templates, setTemplates] = useState<SignupTemplate[]>([]);
  const [selectedTemplateId, setSelectedTemplateId] = useState('');
  const [templateName, setTemplateName] = useState('');
  const [templateSaving, setTemplateSaving] = useState(false);

  const refreshRegistrations = useCallback(async (signupId: string) => {
    const rows = await getOrganizerRegistrations(signupId);
    setRegistrations(rows);
  }, []);

  useEffect(() => {
    if (!auth.user || !expanded) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    setSignup(null);
    setRegistrations([]);
    setTitle(event.name);
    setVenue(event.venue ?? '');
    setStartsAt('');
    setEndsAt('');
    setCapacity(expectedTeams);
    setDetails('');
    setPrizes('');
    setSelectedTemplateId('');
    setTemplateName('');
    void Promise.all([
      getOwnedSignup(auth.user.id, event.id),
      getSignupAccountSlug(auth.user.id),
    ])
      .then(async ([row, savedAccountSlug]) => {
        if (cancelled) return;
        setSignup(row);
        setAccountSlug(
          row?.accountSlug
          || savedAccountSlug
          || defaultSignupAccountSlug(auth.user?.email, auth.user?.id ?? ''),
        );
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
  }, [auth.user, event.id, event.name, event.venue, expanded, expectedTeams, refreshRegistrations]);

  useEffect(() => {
    if (!auth.user || !expanded) return;
    let cancelled = false;
    void getSignupTemplates(auth.user.id)
      .then((rows) => !cancelled && setTemplates(rows))
      .catch((err: Error) => !cancelled && setError(err.message));
    return () => {
      cancelled = true;
    };
  }, [auth.user, expanded]);

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

  function applyTemplate(templateId: string) {
    setSelectedTemplateId(templateId);
    const template = templates.find((row) => row.id === templateId);
    if (!template) return;
    const schedule = nextTemplateSchedule(template);
    setTemplateName(template.name);
    setTitle(template.title);
    setVenue(template.venue);
    setCapacity(template.capacityTeams);
    setStartsAt(schedule.startsAt);
    setEndsAt(schedule.endsAt);
    setDetails(template.details);
    setPrizes(template.prizes);
    setMessage(`${template.name} loaded. Check the date, then update the sign-up page.`);
    setError(null);
  }

  async function saveCurrentTemplate() {
    if (!auth.user) return;
    if (!templateName.trim()) {
      setError('Give this template a name, such as Monday Night.');
      return;
    }
    const schedule = templateSchedule(startsAt, endsAt);
    setTemplateSaving(true);
    setMessage(null);
    setError(null);
    try {
      const row = await saveSignupTemplate({
        ownerUserId: auth.user.id,
        name: templateName,
        title,
        venue,
        capacityTeams: Math.max(1, Math.min(128, capacity)),
        details,
        prizes,
        ...schedule,
      });
      setTemplates((current) =>
        [...current.filter((template) => template.id !== row.id && template.name !== row.name), row]
          .sort((a, b) => a.name.localeCompare(b.name)),
      );
      setSelectedTemplateId(row.id);
      setTemplateName(row.name);
      setMessage(`${row.name} template saved.`);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setTemplateSaving(false);
    }
  }

  async function removeSelectedTemplate() {
    const selected = templates.find((template) => template.id === selectedTemplateId);
    if (!selected || !window.confirm(`Delete the ${selected.name} template?`)) return;
    setTemplateSaving(true);
    setError(null);
    try {
      await deleteSignupTemplate(selected.id);
      setTemplates((current) => current.filter((template) => template.id !== selected.id));
      setSelectedTemplateId('');
      setTemplateName('');
      setMessage(`${selected.name} template deleted.`);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setTemplateSaving(false);
    }
  }

  async function save() {
    if (!auth.user) return;
    if (!title.trim()) {
      setError('Give the event a name first.');
      return;
    }
    if (!accountSlug.trim()) {
      setError('Give the account link a name first.');
      return;
    }
    setSaving(true);
    setMessage(null);
    setError(null);
    try {
      const row = await saveSignupEvent({
        ownerUserId: auth.user.id,
        sourceEventId: event.id,
        accountSlug,
        title,
        venue,
        startsAt: toIso(startsAt),
        endsAt: toIso(endsAt),
        capacityTeams: Math.max(1, Math.min(128, capacity)),
        details,
        prizes,
      });
      setSignup(row);
      setAccountSlug(row.accountSlug);
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
              <div className="signup-template-panel">
                <div className="signup-template-heading">
                  <strong>Saved sign-up templates</strong>
                  <small>Selecting one fills the form and schedules its next matching weekday.</small>
                </div>
                <div className="signup-template-controls">
                  <select
                    className="setup-input"
                    aria-label="Saved sign-up template"
                    value={selectedTemplateId}
                    onChange={(event) => applyTemplate(event.target.value)}
                  >
                    <option value="">{templates.length ? 'Select a template…' : 'No templates saved yet'}</option>
                    {templates.map((template) => (
                      <option value={template.id} key={template.id}>{template.name}</option>
                    ))}
                  </select>
                  <input
                    className="setup-input"
                    value={templateName}
                    onChange={(event) => setTemplateName(event.target.value)}
                    placeholder="Template name, e.g. Monday Night"
                    aria-label="Template name"
                  />
                  <button className="btn" type="button" disabled={templateSaving} onClick={saveCurrentTemplate}>
                    {templateSaving ? 'Saving…' : 'Save template'}
                  </button>
                  <button
                    className="btn ghost"
                    type="button"
                    disabled={!selectedTemplateId || templateSaving}
                    onClick={removeSelectedTemplate}
                  >
                    Delete
                  </button>
                </div>
              </div>

              <div className="signup-admin-form">
                <div className="setup-field signup-wide">
                  <label>Account link name</label>
                  <input
                    className="setup-input"
                    value={accountSlug}
                    onChange={(e) => setAccountSlug(normaliseSignupLinkPart(e.target.value, ''))}
                    placeholder="jungle-padel"
                  />
                  <small className="setup-help">
                    Your links start with signup/{accountSlug || 'account-name'}/
                  </small>
                </div>
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
                  <label>Confirmed team limit</label>
                  <input
                    className="setup-input"
                    type="number"
                    min={1}
                    max={128}
                    value={capacity}
                    onChange={(e) => setCapacity(Number(e.target.value))}
                  />
                  <small className="setup-help">
                    Change this anytime. Extra teams wait automatically; raising the limit promotes them in order.
                  </small>
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
                  <div className="signup-admin-link-row">
                    <input
                      className="signup-admin-link"
                      aria-label="Public sign-up link"
                      readOnly
                      value={buildSignupUrl(signup.eventSlug, signup.accountSlug)}
                      onFocus={(event) => event.currentTarget.select()}
                    />
                    <button
                      className="btn"
                      type="button"
                      onClick={async () => {
                        setError(null);
                        try {
                          await copySignupLink(signup);
                          setMessage('Sign-up link copied.');
                        } catch (err) {
                          setError((err as Error).message);
                        }
                      }}
                    >
                      Copy link
                    </button>
                    <a className="btn" href={buildSignupUrl(signup.eventSlug, signup.accountSlug)} target="_blank" rel="noopener noreferrer">
                      Open page
                    </a>
                  </div>
                  <div className="signup-admin-summary">
                    <div><strong>{confirmed.length}</strong><span>Confirmed / {signup.capacityTeams}</span></div>
                    <div><strong>{waitlisted.length}</strong><span>Waiting list</span></div>
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
