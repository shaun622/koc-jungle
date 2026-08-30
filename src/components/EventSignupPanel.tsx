import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AuthModal } from '@/components/AuthModal';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { Icons } from '@/components/Icons';
import { useAuth } from '@/hooks/useAuth';
import {
  buildSignupUrl,
  copySignupLink,
  defaultSignupAccountSlug,
  deleteOrganizerWaitlistedRegistration,
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
  type SignupEventMutationResult,
  type SignupRegistration,
  type SignupTemplate,
} from '@/lib/signups';
import type { EventState, Team } from '@/types/domain';
import { reconcileConfirmedSignupRoster } from '@/utils/rosterReconciliation';

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
  onAddTeams,
  onSyncTeams,
  onRegistrationsChange,
  refreshRegistrationsVersion,
  onSignupChange,
}: {
  event: EventState;
  expectedTeams: number;
  teams: Team[];
  onAddTeams: (inputs: Array<{ name?: string; player1: string; player2: string; signupPairKey?: string; signupRegistrationId?: string }>) => void;
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
  const [waitlistDeleteTarget, setWaitlistDeleteTarget] = useState<SignupRegistration | null>(null);
  const [deletingRegistrationId, setDeletingRegistrationId] = useState<string | null>(null);

  const [title, setTitle] = useState(event.name);
  const [accountSlug, setAccountSlug] = useState('organiser');
  const [venue, setVenue] = useState(event.venue ?? '');
  const [startsAt, setStartsAt] = useState('');
  const [endsAt, setEndsAt] = useState('');
  const [details, setDetails] = useState('');
  const [prizes, setPrizes] = useState('');
  const [autoAddPairs, setAutoAddPairs] = useState(true);
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
  const manualTeamCount = useMemo(
    () => teams.filter((team) =>
      team.active
      && !team.signupRegistrationId
      && !team.signupPairKey).length,
    [teams],
  );
  const onlineSignupCapacity = Math.max(0, expectedTeams - manualTeamCount);

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
        autoAddPairs: current.autoAddPairs,
        signupEventId: current.id,
        baseRevision: current.capacityRevision,
        isOpen: current.isOpen,
      });
    },
  ), [enqueueSignupMutation]);

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
    setAutoAddPairs(true);
    setSelectedTemplateId('');
    setTemplateName('');
    setWaitlistDeleteTarget(null);
    void Promise.all([
      getOwnedSignup(auth.user.id, event.id),
      getSignupAccountSlug(auth.user.id),
    ])
      .then(async ([row, savedAccountSlug]) => {
        if (cancelled) return;
        let currentRow = row;
        if (row) {
          const capacityResult = await syncCapacity(row, onlineSignupCapacity);
          currentRow = capacityResult.event;
          if (cancelled) return;
          if (capacityResult.conflict) {
            setError('This sign-up changed in another tab. Refresh before changing its team limit.');
          } else if (capacityResult.applied) {
            setMessage(`Online team limit synced to ${onlineSignupCapacity}. Extra registrations will wait.`);
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
        setAutoAddPairs(currentRow.autoAddPairs);
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
    event.venue,
    onlineSignupCapacity,
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
    if (!signup || (!expanded && !(autoAddPairs && event.status === 'setup'))) return;
    const timer = window.setInterval(() => {
      void refreshRegistrations(signup.id).catch(() => undefined);
    }, 8_000);
    return () => window.clearInterval(timer);
  }, [autoAddPairs, event.status, expanded, refreshRegistrations, signup]);

  useEffect(() => {
    if (!signup || !refreshRegistrationsVersion) return;
    setRegistrationsReady(false);
    void refreshRegistrations(signup.id).catch((err: Error) => setError(err.message));
  }, [refreshRegistrations, refreshRegistrationsVersion, signup]);

  const confirmed = useMemo(
    () => registrations.filter((registration) => registration.status === 'confirmed'),
    [registrations],
  );
  const waitlisted = useMemo(
    () => registrations.filter((registration) => registration.status === 'waitlisted'),
    [registrations],
  );
  const autoSyncRegistrations = useMemo(() => {
    const ignored = new Set(event.settings.ignoredAutoSignupPairKeys ?? []);
    const ignoredRegistrationIds = new Set(
      event.settings.ignoredAutoSignupRegistrationIds ?? [],
    );
    const alreadyLinked = new Set(
      teams
        .map((team) => team.signupRegistrationId)
        .filter((id): id is string => Boolean(id)),
    );
    return confirmed.filter((registration) =>
      Boolean(registration.playerTwo)
      && (
        alreadyLinked.has(registration.id)
        || (
          !ignoredRegistrationIds.has(registration.id)
          && !ignored.has(registrationPairKey(registration.playerOne, registration.playerTwo))
        )
      ));
  }, [
    confirmed,
    event.settings.ignoredAutoSignupPairKeys,
    event.settings.ignoredAutoSignupRegistrationIds,
    teams,
  ]);
  const autoReconciliation = useMemo(
    () => reconcileConfirmedSignupRoster({
      confirmedRegistrations: autoSyncRegistrations,
      localTeams: teams,
      capacity: expectedTeams,
    }),
    [autoSyncRegistrations, expectedTeams, teams],
  );
  const manualReconciliation = useMemo(
    () => reconcileConfirmedSignupRoster({
      confirmedRegistrations: confirmed,
      localTeams: teams,
      capacity: expectedTeams,
    }),
    [confirmed, expectedTeams, teams],
  );
  const manualChangeCount = manualReconciliation.teamsToAdd.length
    + manualReconciliation.teamUpdates.length
    + manualReconciliation.importedTeamIdsToRemoveOrDeactivate.length;

  useEffect(() => {
    if (
      !signup
      || !registrationsReady
      || appliedRosterVersionRef.current !== requestedRosterVersion
      || !autoAddPairs
      || event.status !== 'setup'
    ) return;
    const added = autoReconciliation.teamsToAdd.length;
    const updated = autoReconciliation.teamUpdates.length;
    const removed = autoReconciliation.importedTeamIdsToRemoveOrDeactivate.length;
    if (added + updated + removed === 0) return;

    onSyncTeams(autoSyncRegistrations, expectedTeams);
    const changes = [
      added ? `${added} added` : '',
      updated ? `${updated} updated` : '',
      removed ? `${removed} removed` : '',
    ].filter(Boolean).join(', ');
    setMessage(`Online roster synced: ${changes}.`);
  }, [
    autoAddPairs,
    autoReconciliation,
    autoSyncRegistrations,
    event.status,
    expectedTeams,
    onSyncTeams,
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
    setAutoAddPairs(template.autoAddPairs);
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
        // Templates describe the complete tournament shape. The remaining
        // online capacity is recalculated from manual teams when published.
        capacityTeams: expectedTeams,
        details,
        prizes,
        autoAddPairs,
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
          capacityTeams: onlineSignupCapacity,
          details,
          prizes,
          autoAddPairs,
          signupEventId: current?.id,
          baseRevision: current?.capacityRevision ?? 0,
          isOpen: current?.isOpen,
        }));
      const row = result.event;
      setSignup(row);
      setAccountSlug(row.accountSlug);
      if (result.conflict) {
        setTitle(row.title);
        setVenue(row.venue);
        setStartsAt(inputDateTime(row.startsAt));
        setEndsAt(inputDateTime(row.endsAt));
        setDetails(row.details);
        setPrizes(row.prizes);
        setAutoAddPairs(row.autoAddPairs);
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

  async function removeWaitlistedRegistration() {
    const registration = waitlistDeleteTarget;
    if (!registration || registration.status !== 'waitlisted' || !signup || deletingRegistrationRef.current) return;

    deletingRegistrationRef.current = registration.id;
    setDeletingRegistrationId(registration.id);
    setError(null);
    setMessage(null);
    try {
      await deleteOrganizerWaitlistedRegistration(registration.id);
      await refreshRegistrations(signup.id);
      setWaitlistDeleteTarget(null);
      setMessage(`${registrationLabel(registration)} removed from the waiting list.`);
    } catch (err) {
      setError((err as Error).message);
      await refreshRegistrations(signup.id).catch(() => undefined);
    } finally {
      deletingRegistrationRef.current = null;
      setDeletingRegistrationId(null);
    }
  }

  function importTeams() {
    const importable = manualReconciliation.teamsToAdd;
    if (event.status === 'setup') {
      onSyncTeams(confirmed, expectedTeams, { includeIgnored: true });
      const updated = manualReconciliation.teamUpdates.length;
      const removed = manualReconciliation.importedTeamIdsToRemoveOrDeactivate.length;
      setMessage(
        `Online roster reviewed: ${importable.length} added, ${updated} updated, ${removed} removed.`,
      );
      return;
    }
    onAddTeams(importable);
    setMessage(
      `${importable.length} team${importable.length === 1 ? '' : 's'} (${importable.length * 2} players) added to this event.`,
    );
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
          {signup ? `${confirmed.length}/${onlineSignupCapacity}` : 'SET UP'}
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
                  <label>Online team limit</label>
                  <input
                    className="setup-input"
                    type="number"
                    value={onlineSignupCapacity}
                    readOnly
                  />
                  <small className="setup-help">
                    The tournament has {expectedTeams} places. {manualTeamCount
                      ? `${manualTeamCount} manually added team${manualTeamCount === 1 ? '' : 's'} already ${manualTeamCount === 1 ? 'uses' : 'use'} ${manualTeamCount === 1 ? 'one' : manualTeamCount}, so the live link offers the remaining places.`
                      : 'The live link offers all of them.'} Pairs have priority; every extra registration joins the waiting list.
                  </small>
                </div>
                <div className="setup-field signup-wide">
                  <label>Confirmed pairs</label>
                  <div className="signup-import-mode" role="group" aria-label="Confirmed pair import mode">
                    <button
                      type="button"
                      className={autoAddPairs ? 'active' : ''}
                      aria-pressed={autoAddPairs}
                      onClick={() => setAutoAddPairs(true)}
                    >
                      <strong>Auto-add</strong>
                      <small>Add complete pairs to the tournament as they sign up</small>
                    </button>
                    <button
                      type="button"
                      className={!autoAddPairs ? 'active' : ''}
                      aria-pressed={!autoAddPairs}
                      onClick={() => setAutoAddPairs(false)}
                    >
                      <strong>Manual review</strong>
                      <small>Keep the review button before adding pairs</small>
                    </button>
                  </div>
                  <small className="setup-help">
                    Saved with this sign-up page and its template. Solo players wait until they form a pair.
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
                    <div><strong>{confirmed.length}</strong><span>Online teams / {onlineSignupCapacity}</span></div>
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
                          {registration.status === 'waitlisted' && (
                            <button
                              className="setup-team-action danger signup-admin-delete"
                              type="button"
                              aria-label={`Remove ${registrationLabel(registration)} from waiting list`}
                              title="Remove from waiting list"
                              disabled={deletingRegistrationId === registration.id}
                              onClick={() => setWaitlistDeleteTarget(registration)}
                            >
                              <Icons.Trash className="icon" />
                            </button>
                          )}
                        </div>
                      ))}
                    </div>
                  )}

                  {autoAddPairs && event.status === 'setup' ? (
                    <div className="signup-auto-status">
                      <strong>Auto-add is on</strong>
                      <span>Complete confirmed pairs are added automatically. Solo players wait until they have a partner.</span>
                    </div>
                  ) : (
                    <>
                      {autoAddPairs && event.status !== 'setup' && (
                        <div className="signup-auto-status paused">
                          <strong>Auto-add is paused</strong>
                          <span>The tournament has started, so late pairs need a manual review before joining.</span>
                        </div>
                      )}
                      <button
                        className="btn full"
                        type="button"
                        disabled={event.status === 'setup'
                          ? manualChangeCount === 0
                          : manualReconciliation.teamsToAdd.length === 0}
                        onClick={importTeams}
                      >
                        {event.status === 'setup' && manualChangeCount > 0
                          ? `Sync ${manualChangeCount} online roster change${manualChangeCount === 1 ? '' : 's'}`
                          : manualReconciliation.teamsToAdd.length > 0
                          ? `Add ${manualReconciliation.teamsToAdd.length} confirmed pair${manualReconciliation.teamsToAdd.length === 1 ? '' : 's'} (${manualReconciliation.teamsToAdd.length * 2} players) to tournament`
                          : 'No new confirmed pairs ready to add'}
                      </button>
                    </>
                  )}
                </>
              )}
            </>
          )}

          {message && <div className="signup-message success">{message}</div>}
          {error && <div className="signup-message error">{error}</div>}
        </div>
      )}
      {authOpen && <AuthModal onClose={() => setAuthOpen(false)} />}
      <ConfirmDialog
        open={Boolean(waitlistDeleteTarget)}
        title="Remove from waiting list?"
        message={waitlistDeleteTarget
          ? `${registrationLabel(waitlistDeleteTarget)} will be permanently removed from this sign-up's waiting list.`
          : ''}
        confirmLabel={deletingRegistrationId ? 'Removing…' : 'Remove'}
        destructive
        busy={Boolean(deletingRegistrationId)}
        onConfirm={() => void removeWaitlistedRegistration()}
        onCancel={() => setWaitlistDeleteTarget(null)}
      />
    </section>
  );
}
