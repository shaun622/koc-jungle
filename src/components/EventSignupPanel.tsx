import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AuthModal } from '@/components/AuthModal';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { Icons } from '@/components/Icons';
import { Portal } from '@/components/Portal';
import { useAuth } from '@/hooks/useAuth';
import {
  buildSignupUrl,
  copySignupLink,
  defaultSignupAccountSlug,
  deleteOrganizerRegistrationIfStatus,
  deleteSignupTemplate,
  getOrganizerRegistrations,
  getOwnedSignup,
  getSignupAccountSlug,
  getSignupTemplates,
  normaliseSignupLinkPart,
  saveSignupEvent,
  saveSignupTemplate,
  seedOrganizerSignupRoster,
  setSignupOpen,
  shareSignupLink,
  updateOrganizerRegistration,
  type SignupEvent,
  type SignupEventMutationResult,
  type SignupRegistration,
  type SignupTemplate,
} from '@/lib/signups';
import type { EventState, Team } from '@/types/domain';
import { buildSignupRosterView } from '@/utils/signupRosterView';

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

function registrationLabel(registration: SignupRegistration): string {
  if (!registration.playerTwo) return registration.playerOne;
  return registration.teamName?.trim()
    || `${registration.playerOne} & ${registration.playerTwo}`;
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
  onSyncTeams,
  onRegistrationsChange,
  refreshRegistrationsVersion,
  onSignupChange,
}: {
  event: EventState;
  expectedTeams: number;
  teams: Team[];
  /** Kept for compatibility with older callers; roster syncing is now automatic. */
  onAddTeams?: (inputs: Array<{ name?: string; player1: string; player2: string; signupPairKey?: string; signupRegistrationId?: string }>) => void;
  onSyncTeams: (
    registrations: SignupRegistration[],
    capacity: number,
    options?: { includeIgnored?: boolean },
  ) => void;
  onRegistrationsChange?: (registrations: SignupRegistration[]) => void;
  refreshRegistrationsVersion?: number;
  onSignupChange?: (signup: SignupEvent | null) => void;
}) {
  const auth = useAuth();
  const [expanded, setExpanded] = useState(false);
  const [authOpen, setAuthOpen] = useState(false);
  const [signup, setSignup] = useState<SignupEvent | null>(null);
  const [registrations, setRegistrations] = useState<SignupRegistration[]>([]);
  const [registrationsReady, setRegistrationsReady] = useState(false);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [registrationDeleteTarget, setRegistrationDeleteTarget] = useState<SignupRegistration | null>(null);
  const [registrationEditTarget, setRegistrationEditTarget] = useState<SignupRegistration | null>(null);
  const [deletingRegistrationId, setDeletingRegistrationId] = useState<string | null>(null);
  const [editingRegistrationId, setEditingRegistrationId] = useState<string | null>(null);

  const [title, setTitle] = useState(event.name);
  const [accountSlug, setAccountSlug] = useState('organiser');
  const [venue, setVenue] = useState(event.venue ?? '');
  const [startsAt, setStartsAt] = useState('');
  const [endsAt, setEndsAt] = useState('');
  const [details, setDetails] = useState('');
  const [prizes, setPrizes] = useState('');
  const [templates, setTemplates] = useState<SignupTemplate[]>([]);
  const [selectedTemplateId, setSelectedTemplateId] = useState('');
  const [templateName, setTemplateName] = useState('');
  const [templateSaving, setTemplateSaving] = useState(false);
  const deletingRegistrationRef = useRef<string | null>(null);
  const registrationsRefreshVersion = useRef(0);
  const requestedRosterVersion = refreshRegistrationsVersion ?? 0;
  const requestedRosterVersionRef = useRef(requestedRosterVersion);
  const appliedRosterVersionRef = useRef(-1);
  requestedRosterVersionRef.current = requestedRosterVersion;
  const signupMutationQueue = useRef<Promise<SignupEvent | null>>(Promise.resolve(null));
  const onlineSignupCapacity = expectedTeams;

  const enqueueSignupMutation = useCallback((
    fallback: SignupEvent | null,
    sourceEventId: string,
    mutation: (current: SignupEvent | null) => Promise<SignupEventMutationResult>,
  ): Promise<SignupEventMutationResult> => {
    const operation = signupMutationQueue.current
      .catch(() => null)
      .then((queued) => mutation(
        queued?.sourceEventId === sourceEventId ? queued : fallback,
      ));
    signupMutationQueue.current = operation.then(
      (result) => result.event,
      () => fallback,
    );
    return operation;
  }, []);

  const syncCapacity = useCallback((
    row: SignupEvent,
    capacity: number,
  ): Promise<SignupEventMutationResult> => enqueueSignupMutation(
    row,
    row.sourceEventId,
    async (queued) => {
      const current = queued?.id === row.id ? queued : row;
      if (current.capacityTeams === capacity) {
        return { event: current, applied: false, conflict: false };
      }
      return saveSignupEvent({
        ownerUserId: current.ownerUserId,
        sourceEventId: current.sourceEventId,
        accountSlug: current.accountSlug,
        title: current.title,
        venue: current.venue,
        startsAt: current.startsAt,
        endsAt: current.endsAt,
        capacityTeams: capacity,
        details: current.details,
        prizes: current.prizes,
        // Retained only for backward-compatible schema writes; roster sync is
        // now always automatic while the tournament is in setup.
        autoAddPairs: true,
        signupEventId: current.id,
        baseRevision: current.capacityRevision,
        isOpen: current.isOpen,
      });
    },
  ), [enqueueSignupMutation]);

  const organizerRoster = useMemo(
    () => teams
      .filter((team) => team.active)
      .map((team, index) => ({
        registrationId: team.signupRegistrationId,
        teamName: team.name,
        playerOne: team.players[0].name,
        playerTwo: team.players[1].name,
        rank: index + 1,
      })),
    [teams],
  );
  const organizerRosterRef = useRef(organizerRoster);
  organizerRosterRef.current = organizerRoster;
  const refreshRegistrations = useCallback(async (signupId: string) => {
    const refreshVersion = ++registrationsRefreshVersion.current;
    const rows = await getOrganizerRegistrations(signupId);
    if (refreshVersion === registrationsRefreshVersion.current) {
      appliedRosterVersionRef.current = requestedRosterVersionRef.current;
      setRegistrations(rows);
      setRegistrationsReady(true);
    }
  }, []);

  useEffect(() => {
    onRegistrationsChange?.(registrations);
  }, [onRegistrationsChange, registrations]);

  useEffect(() => {
    onSignupChange?.(signup);
  }, [onSignupChange, signup]);

  useEffect(() => {
    if (!auth.user) return;
    let cancelled = false;
    registrationsRefreshVersion.current += 1;
    setLoading(true);
    setError(null);
    setSignup(null);
    setRegistrations([]);
    setRegistrationsReady(false);
    appliedRosterVersionRef.current = -1;
    setTitle(event.name);
    setVenue(event.venue ?? '');
    setStartsAt('');
    setEndsAt('');
    setDetails('');
    setPrizes('');
    setSelectedTemplateId('');
    setTemplateName('');
    setRegistrationDeleteTarget(null);
    setRegistrationEditTarget(null);
    void Promise.all([
      getOwnedSignup(auth.user.id, event.id),
      getSignupAccountSlug(auth.user.id),
    ])
      .then(async ([row, savedAccountSlug]) => {
        if (cancelled) return;
        let currentRow = row;
        if (row && event.status === 'setup') {
          const capacityResult = await syncCapacity(row, expectedTeams);
          currentRow = capacityResult.event;
          if (cancelled) return;
          if (capacityResult.conflict) {
            setError('This sign-up changed in another tab. Refresh before changing its team limit.');
          } else if (capacityResult.applied) {
            setMessage(`Team capacity synced to ${expectedTeams} from ${event.courts.length} courts.`);
          }
        }
        setSignup(currentRow);
        setAccountSlug(
          currentRow?.accountSlug
          || savedAccountSlug
          || defaultSignupAccountSlug(auth.user?.email, auth.user?.id ?? ''),
        );
        if (!currentRow) return;
        setTitle(currentRow.title);
        setVenue(currentRow.venue);
        setStartsAt(inputDateTime(currentRow.startsAt));
        setEndsAt(inputDateTime(currentRow.endsAt));
        setDetails(currentRow.details);
        setPrizes(currentRow.prizes);
        if (currentRow.rosterSeededAt == null) {
          try {
            await seedOrganizerSignupRoster(currentRow.id, organizerRosterRef.current);
            currentRow = { ...currentRow, rosterSeededAt: new Date().toISOString() };
            if (cancelled) return;
            setSignup(currentRow);
          } catch (seedError) {
            // Keep the event locally marked as unseeded. A later save/load can
            // safely retry because the server owns the one-time transition.
            if (!cancelled) setError((seedError as Error).message);
            // Do not reconcile an empty/partial server snapshot while the
            // one-time import is still pending: that could erase local teams.
            return;
          }
        }
        if (cancelled) return;
        await refreshRegistrations(currentRow.id);
      })
      .catch((err: Error) => !cancelled && setError(err.message))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [
    auth.user,
    event.id,
    event.name,
    event.status,
    event.venue,
    event.courts.length,
    expectedTeams,
    refreshRegistrations,
    syncCapacity,
  ]);

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
    if (!signup || (!expanded && event.status !== 'setup')) return;
    const timer = window.setInterval(() => {
      void refreshRegistrations(signup.id).catch(() => undefined);
    }, 8_000);
    return () => window.clearInterval(timer);
  }, [event.status, expanded, refreshRegistrations, signup]);

  useEffect(() => {
    if (!signup || !refreshRegistrationsVersion) return;
    setRegistrationsReady(false);
    void refreshRegistrations(signup.id).catch((err: Error) => setError(err.message));
  }, [refreshRegistrations, refreshRegistrationsVersion, signup]);

  const { confirmedPairs, waitlistedPairs, lookingForPartner } = useMemo(
    () => buildSignupRosterView(registrations, expectedTeams),
    [expectedTeams, registrations],
  );

  useEffect(() => {
    if (
      !signup
      || !registrationsReady
      || appliedRosterVersionRef.current !== requestedRosterVersion
      || event.status !== 'setup'
    ) return;
    onSyncTeams(registrations, expectedTeams, { includeIgnored: true });
  }, [
    confirmedPairs,
    event.status,
    expectedTeams,
    onSyncTeams,
    registrations,
    registrationsReady,
    requestedRosterVersion,
    signup,
  ]);

  function applyTemplate(templateId: string) {
    setSelectedTemplateId(templateId);
    const template = templates.find((row) => row.id === templateId);
    if (!template) return;
    const schedule = nextTemplateSchedule(template);
    setTemplateName(template.name);
    setTitle(template.title);
    setVenue(template.venue);
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
        // Capacity always describes the whole tournament and is recalculated
        // from the selected court count when the template is published.
        capacityTeams: expectedTeams,
        details,
        prizes,
        autoAddPairs: true,
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
    const ownerUserId = auth.user.id;
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
      const result = await enqueueSignupMutation(signup, event.id, (current) =>
        saveSignupEvent({
          ownerUserId,
          sourceEventId: event.id,
          accountSlug,
          title,
          venue,
          startsAt: toIso(startsAt),
          endsAt: toIso(endsAt),
          capacityTeams: expectedTeams,
          details,
          prizes,
          autoAddPairs: true,
          signupEventId: current?.id,
          baseRevision: current?.capacityRevision ?? 0,
          isOpen: current?.isOpen,
        }));
      let row = result.event;
      setSignup(row);
      setAccountSlug(row.accountSlug);
      // New and legacy unseeded sign-ups both use the same durable handshake.
      // Empty rosters must be seeded too: null means "not attempted", while a
      // timestamp permanently prevents stale device state being replayed.
      // This also runs for an authoritative conflict response: it is still a
      // real signup row, and the server makes the transition exactly once.
      if (row.rosterSeededAt == null) {
        await seedOrganizerSignupRoster(row.id, organizerRoster);
        row = { ...row, rosterSeededAt: new Date().toISOString() };
        setSignup(row);
      }
      if (result.conflict) {
        setTitle(row.title);
        setVenue(row.venue);
        setStartsAt(inputDateTime(row.startsAt));
        setEndsAt(inputDateTime(row.endsAt));
        setDetails(row.details);
        setPrizes(row.prizes);
        setError('This sign-up changed in another tab, so the latest version was reloaded. Review it before saving again.');
        return;
      }
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
    if (event.status !== 'setup' && !signup.isOpen) {
      setError('Registrations stay closed after the tournament starts.');
      return;
    }
    setError(null);
    try {
      const shouldOpen = !signup.isOpen;
      const result = await enqueueSignupMutation(signup, event.id, (current) => {
        const authoritative = current?.id === signup.id ? current : signup;
        return setSignupOpen(
          authoritative.id,
          shouldOpen,
          authoritative.sourceEventId,
          authoritative.capacityRevision,
        );
      });
      setSignup(result.event);
      if (result.conflict) {
        setError('This sign-up changed in another tab. Refresh before opening or closing it.');
        return;
      }
      setMessage(shouldOpen ? 'Registrations reopened.' : 'Registrations closed.');
    } catch (err) {
      setError((err as Error).message);
    }
  }

  async function removeSelectedRegistration() {
    const registration = registrationDeleteTarget;
    if (!registration || !signup || deletingRegistrationRef.current) return;
    if (registration.status === 'cancelled') {
      setRegistrationDeleteTarget(null);
      setError('This registration was already removed. The list has been refreshed.');
      await refreshRegistrations(signup.id).catch(() => undefined);
      return;
    }
    if (
      event.status !== 'setup'
      && registration.status === 'confirmed'
      && Boolean(registration.playerTwo.trim())
    ) {
      setRegistrationDeleteTarget(null);
      setError('The event is already running. Remove this team from the tournament roster below.');
      return;
    }

    deletingRegistrationRef.current = registration.id;
    setDeletingRegistrationId(registration.id);
    setError(null);
    setMessage(null);
    try {
      await deleteOrganizerRegistrationIfStatus(
        registration.id,
        registration.status,
        registration.updatedAt,
        event.status !== 'setup',
      );
      await refreshRegistrations(signup.id);
      setRegistrationDeleteTarget(null);
      setMessage(`${registrationLabel(registration)} removed from this sign-up.`);
    } catch (err) {
      setError((err as Error).message);
      await refreshRegistrations(signup.id).catch(() => undefined);
    } finally {
      deletingRegistrationRef.current = null;
      setDeletingRegistrationId(null);
    }
  }

  async function saveRegistrationEdit(draft: {
    teamName: string;
    playerOne: string;
    playerTwo: string;
    contact: string;
  }) {
    const registration = registrationEditTarget;
    if (!registration || !signup || editingRegistrationId) return;
    if (registration.status === 'cancelled') {
      setRegistrationEditTarget(null);
      setError('This registration was already removed. The list has been refreshed.');
      await refreshRegistrations(signup.id).catch(() => undefined);
      return;
    }
    setEditingRegistrationId(registration.id);
    setError(null);
    setMessage(null);
    try {
      await updateOrganizerRegistration(registration.id, draft, {
        status: registration.status,
        updatedAt: registration.updatedAt,
        allowLocked: event.status !== 'setup',
      });
      await refreshRegistrations(signup.id);
      setRegistrationEditTarget(null);
      setMessage(`${registrationLabel(registration)} updated on the live sign-up.`);
    } catch (editError) {
      setError((editError as Error).message);
      await refreshRegistrations(signup.id).catch(() => undefined);
    } finally {
      setEditingRegistrationId(null);
    }
  }

  return (
    <section className={'signup-admin ' + (expanded ? 'expanded' : '')}>
      <button className="signup-admin-toggle" type="button" onClick={() => setExpanded(!expanded)}>
        <span className="signup-admin-toggle-icon"><Icons.List className="icon" /></span>
        <span>
          <strong>Online team sign-up</strong>
          <small>One live link for confirmed teams, solo players and the waiting list.</small>
        </span>
        <span className="signup-admin-toggle-meta">
          {signup ? `${confirmedPairs.length}/${onlineSignupCapacity}` : 'SET UP'}
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
                  <label>Team capacity</label>
                  <input
                    className="setup-input"
                    type="number"
                    value={onlineSignupCapacity}
                    readOnly
                  />
                  <small className="setup-help">
                    Set automatically by {event.courts.length} court{event.courts.length === 1 ? '' : 's'} × 2 teams.
                    Complete pairs fill these places; every extra pair joins the waiting list.
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
                    {(event.status === 'setup' || signup.isOpen) && (
                      <button className="btn" type="button" onClick={toggleOpen}>
                        {signup.isOpen ? 'Close registrations' : 'Reopen registrations'}
                      </button>
                    )}
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
                    <div><strong>{confirmedPairs.length}</strong><span>Confirmed teams / {onlineSignupCapacity}</span></div>
                    <div><strong>{waitlistedPairs.length}</strong><span>Teams waiting</span></div>
                    <div><strong>{lookingForPartner.length}</strong><span>Looking for a partner</span></div>
                    <div><strong>{formatWhen(signup.startsAt, signup.endsAt)}</strong><span>{signup.isOpen ? 'Sign-up open' : 'Sign-up closed'}</span></div>
                  </div>

                  {registrations.length > 0 && (
                    <div className="signup-admin-roster">
                      {registrations.map((registration) => (
                        <div className="signup-admin-row" key={registration.id}>
                          <span className={'signup-position ' + registration.status}>
                            {!registration.playerTwo
                              ? 'S'
                              : registration.status === 'confirmed'
                                ? registration.position
                                : `W${registration.position}`}
                          </span>
                          <span>
                            <strong>
                              {registration.playerTwo
                                ? registration.teamName || `${registration.playerOne} & ${registration.playerTwo}`
                                : registration.playerOne}
                            </strong>
                            <small>
                              {registration.playerTwo
                                ? `${registration.playerOne} · ${registration.playerTwo}`
                                : 'Solo · looking for partner'}
                            </small>
                          </span>
                          <span className="signup-contact">
                            {registration.contact}
                            {registration.playerTwoContact ? ` · ${registration.playerTwoContact}` : ''}
                          </span>
                          <span className="signup-admin-row-actions">
                            {event.status === 'setup' ? (
                                <button
                                  className="setup-team-action"
                                  type="button"
                                  aria-label={`Edit ${registrationLabel(registration)}`}
                                  title="Edit registration"
                                  disabled={Boolean(editingRegistrationId || deletingRegistrationId)}
                                  onClick={() => setRegistrationEditTarget(registration)}
                                >
                                  <Icons.Edit className="icon" />
                                </button>
                              ) : null}
                          {event.status === 'setup'
                            || registration.status !== 'confirmed'
                            || !registration.playerTwo.trim() ? (
                              <button
                                className="setup-team-action danger signup-admin-delete"
                                type="button"
                                aria-label={`Remove ${registrationLabel(registration)} from sign-up`}
                                title="Remove from sign-up"
                                disabled={deletingRegistrationId === registration.id}
                                onClick={() => setRegistrationDeleteTarget(registration)}
                              >
                                <Icons.Trash className="icon" />
                              </button>
                            ) : <span aria-label="Manage this confirmed team in the tournament roster" />}
                          </span>
                        </div>
                      ))}
                    </div>
                  )}

                  <div className={'signup-auto-status ' + (event.status === 'setup' ? '' : 'paused')}>
                    <strong>{event.status === 'setup' ? 'One roster, kept in sync' : 'Roster locked for play'}</strong>
                    <span>
                      {event.status === 'setup'
                        ? 'Complete pairs fill the tournament automatically. Overflow pairs wait, and solos stay in Looking for a partner.'
                        : 'The tournament has started, so its playing roster is no longer changed by new registrations.'}
                    </span>
                  </div>
                </>
              )}
            </>
          )}

          {message && <div className="signup-message success">{message}</div>}
          {error && <div className="signup-message error">{error}</div>}
        </div>
      )}
      {authOpen && <AuthModal onClose={() => setAuthOpen(false)} />}
      {registrationEditTarget && (
        <SignupRegistrationEditModal
          registration={registrationEditTarget}
          saving={editingRegistrationId === registrationEditTarget.id}
          onSave={(draft) => void saveRegistrationEdit(draft)}
          onClose={() => setRegistrationEditTarget(null)}
        />
      )}
      <ConfirmDialog
        open={Boolean(registrationDeleteTarget)}
        title="Remove from sign-up?"
        message={registrationDeleteTarget
          ? `${registrationLabel(registrationDeleteTarget)} will be permanently removed. If this frees a team place, the first complete pair on the waiting list will move into the event.`
          : ''}
        confirmLabel={deletingRegistrationId ? 'Removing…' : 'Remove'}
        destructive
        busy={Boolean(deletingRegistrationId)}
        onConfirm={() => void removeSelectedRegistration()}
        onCancel={() => setRegistrationDeleteTarget(null)}
      />
    </section>
  );
}

function SignupRegistrationEditModal({
  registration,
  saving,
  onSave,
  onClose,
}: {
  registration: SignupRegistration;
  saving: boolean;
  onSave: (draft: {
    teamName: string;
    playerOne: string;
    playerTwo: string;
    contact: string;
  }) => void;
  onClose: () => void;
}) {
  const [teamName, setTeamName] = useState(registration.teamName);
  const [playerOne, setPlayerOne] = useState(registration.playerOne);
  const [playerTwo, setPlayerTwo] = useState(registration.playerTwo);
  const [contact, setContact] = useState(registration.contact ?? '');
  const valid = playerOne.trim().length > 0
    && contact.trim().length >= 3
    && (!playerTwo.trim() || playerTwo.trim().toLocaleLowerCase() !== playerOne.trim().toLocaleLowerCase());

  useEffect(() => {
    const onKeyDown = (keyboardEvent: KeyboardEvent) => {
      if (keyboardEvent.key === 'Escape' && !saving) onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onClose, saving]);

  return (
    <Portal>
      <div className="modal-backdrop" onClick={() => !saving && onClose()}>
        <div className="modal edit-team-modal" onClick={(event) => event.stopPropagation()}>
          <div className="edit-team-heading">
            <div>
              <h2>Edit registration</h2>
              <p>Changes update the organiser roster and public sign-up link.</p>
            </div>
            <button className="op-score-btn" type="button" disabled={saving} onClick={onClose} aria-label="Close">
              <Icons.Close className="icon" />
            </button>
          </div>
          <div className="edit-team-fields">
            <label>
              <span>Team name <small>optional</small></span>
              <input className="setup-input" value={teamName} onChange={(event) => setTeamName(event.target.value)} />
            </label>
            <label>
              <span>Player one</span>
              <input className="setup-input" value={playerOne} onChange={(event) => setPlayerOne(event.target.value)} />
            </label>
            <label>
              <span>Player two <small>leave blank while looking</small></span>
              <input className="setup-input" value={playerTwo} onChange={(event) => setPlayerTwo(event.target.value)} />
            </label>
            <label>
              <span>WhatsApp number or email <small>kept private</small></span>
              <input className="setup-input" value={contact} onChange={(event) => setContact(event.target.value)} />
            </label>
          </div>
          <div className="modal-actions">
            <button className="btn" type="button" disabled={saving} onClick={onClose}>Cancel</button>
            <button
              className="btn primary"
              type="button"
              disabled={!valid || saving}
              onClick={() => onSave({ teamName, playerOne, playerTwo, contact })}
            >
              {saving ? 'Saving…' : 'Save changes'}
            </button>
          </div>
        </div>
      </div>
    </Portal>
  );
}
