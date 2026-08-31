import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { eventRoute } from '@/lib/eventRoutes';
import {
  DndContext,
  type DragEndEvent,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
} from '@dnd-kit/core';
import {
  SortableContext,
  arrayMove,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { useEventStore } from '@/store/eventStore';
import { useAuth } from '@/hooks/useAuth';
import { activeTeams } from '@/store/selectors';
import { getFormat } from '@/logic/formats';
import { isCentreCourt, type Court, type Player, type QualifierUnit, type Team, type TieRule } from '@/types/domain';
import { formatMs, parseDurationInput } from '@/utils/time';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { Icons } from '@/components/Icons';
import { Avatar } from '@/components/Avatar';
import { cropImageFileToAvatar } from '@/utils/avatar';
import { EventSignupPanel } from '@/components/EventSignupPanel';
import { Portal } from '@/components/Portal';
import { RosterShareModal } from '@/components/RosterShareModal';
import { buildRosterShareText } from '@/utils/rosterShare';
import {
  addOrganizerSignupPair,
  deleteOrganizerRegistrationIfStatus,
  findSignupRegistrationForTeam,
  getOrganizerRegistrations,
  getOwnedSignup,
  lockSignupRoster,
  registrationPairKey,
  reorderOrganizerRegistrations,
  seedOrganizerSignupRoster,
  unlockSignupRoster,
  updateOrganizerRegistration,
  type SignupEvent,
  type SignupRegistration,
} from '@/lib/signups';

const TIE_RULE_LABELS: Record<TieRule, string> = {
  'operator-decides': 'Operator nominates winner',
  'team-a-wins': 'Team A wins',
  'split-points': 'Split points',
  replay: 'Replay match',
};

export function SetupScreen() {
  const event = useEventStore((s) => s.event);
  const loadEvent = useEventStore((s) => s.loadEvent);
  const addTeam = useEventStore((s) => s.addTeam);
  const addTeams = useEventStore((s) => s.addTeams);
  const syncConfirmedSignupTeams = useEventStore((s) => s.syncConfirmedSignupTeams);
  const updateTeam = useEventStore((s) => s.updateTeam);
  const removeTeam = useEventStore((s) => s.removeTeam);
  const reorderTeams = useEventStore((s) => s.reorderTeams);
  const renameCourt = useEventStore((s) => s.renameCourt);
  const setCourtPoints = useEventStore((s) => s.setCourtPoints);
  const addCourt = useEventStore((s) => s.addCourt);
  const removeCourt = useEventStore((s) => s.removeCourt);
  const reorderCourts = useEventStore((s) => s.reorderCourts);
  const setEventName = useEventStore((s) => s.setEventName);
  const setEventVenue = useEventStore((s) => s.setEventVenue);
  const setPlayerAvatar = useEventStore((s) => s.setPlayerAvatar);
  const updateSettings = useEventStore((s) => s.updateSettings);
  const startQualifier = useEventStore((s) => s.startQualifier);
  const skipQualifierToSeeding = useEventStore((s) => s.skipQualifierToSeeding);
  const setQualifierEnabled = useEventStore((s) => s.setQualifierEnabled);
  const setFormatConfig = useEventStore((s) => s.setFormatConfig);
  const startTournament = useEventStore((s) => s.startTournament);
  const lastError = useEventStore((s) => s.lastError);
  const auth = useAuth();
  const navigate = useNavigate();

  const [confirmReset, setConfirmReset] = useState(false);
  const [confirmRemoveTeamId, setConfirmRemoveTeamId] = useState<string | null>(null);
  const [rosterShareOpen, setRosterShareOpen] = useState(false);
  const [signupDetails, setSignupDetails] = useState<SignupEvent | null>(null);
  const [onlineRegistrations, setOnlineRegistrations] = useState<SignupRegistration[]>([]);
  const [editingTeamId, setEditingTeamId] = useState<string | null>(null);
  const [teamActionBusyId, setTeamActionBusyId] = useState<string | null>(null);
  const [teamActionError, setTeamActionError] = useState<string | null>(null);
  const [refreshRegistrationsVersion, setRefreshRegistrationsVersion] = useState(0);

  useEffect(() => {
    setSignupDetails(null);
    setOnlineRegistrations([]);
    setEditingTeamId(null);
    setConfirmRemoveTeamId(null);
    setTeamActionBusyId(null);
    setTeamActionError(null);
    setRefreshRegistrationsVersion(0);
  }, [event?.id]);

  const requestRemoveTeam = (id: string) => {
    setConfirmRemoveTeamId(id);
  };
  const confirmedTeam =
    confirmRemoveTeamId && event
      ? event.teams.find((t) => t.id === confirmRemoveTeamId)
      : null;

  // No event: the dedicated /home screen owns the launch experience.
  // RouteGate redirects here, this is just a guard.
  if (!event) return null;

  const teams = activeTeams(event);
  const registrationForTeamIn = (team: Team, registrations: SignupRegistration[]) =>
    findSignupRegistrationForTeam(registrations, {
      signupRegistrationId: team.signupRegistrationId,
      signupPairKey: team.signupPairKey,
      playerOne: team.players[0].name,
      playerTwo: team.players[1].name,
    });
  const registrationForTeam = (team: Team): SignupRegistration | undefined =>
    registrationForTeamIn(team, onlineRegistrations);
  const confirmedRegistration = confirmedTeam ? registrationForTeam(confirmedTeam) : undefined;
  const editingTeam = editingTeamId ? teams.find((team) => team.id === editingTeamId) ?? null : null;

  const loadAuthoritativeRegistrations = async (): Promise<{
    signup: SignupEvent | null;
    registrations: SignupRegistration[];
  }> => {
    let signup = signupDetails?.sourceEventId === event.id ? signupDetails : null;
    if (auth.user) {
      // An authoritative null means this event has no sign-up. Never fall back
      // to component state from a previously opened tournament.
      signup = await getOwnedSignup(auth.user.id, event.id);
    }
    if (!signup) return { signup: null, registrations: [] };
    const registrations = await getOrganizerRegistrations(signup.id);
    setSignupDetails(signup);
    setOnlineRegistrations(registrations);
    return { signup, registrations };
  };

  const resolveRegistrationForTeam = async (team: Team): Promise<{
    signup: SignupEvent | null;
    registration?: SignupRegistration;
    registrations: SignupRegistration[];
  }> => {
    const authoritative = await loadAuthoritativeRegistrations();
    const registration = registrationForTeamIn(team, authoritative.registrations);
    return {
      signup: authoritative.signup,
      registration,
      registrations: authoritative.registrations,
    };
  };

  const addTeamFromSetup = async (draft: {
    teamName: string;
    playerOne: string;
    playerTwo: string;
    contact: string;
  }) => {
    setTeamActionBusyId('add');
    setTeamActionError(null);
    try {
      const authoritative = await loadAuthoritativeRegistrations();
      if (!authoritative.signup) {
        addTeam({
          name: draft.teamName.trim() || undefined,
          player1: draft.playerOne,
          player2: draft.playerTwo,
        });
        return;
      }

      // Add exactly one row. A narrow server mutation cannot overwrite edits
      // made in another organiser tab while this screen was loading.
      let addedRegistration = findSignupRegistrationForTeam(authoritative.registrations, {
        playerOne: draft.playerOne,
        playerTwo: draft.playerTwo,
      });
      if (!addedRegistration) {
        addedRegistration = await addOrganizerSignupPair(
          authoritative.signup.id,
          draft,
          event.status !== 'setup',
        );
      }
      if (
        addedRegistration.status === 'confirmed'
        && !teams.some((team) => registrationForTeamIn(team, [addedRegistration!]))
      ) {
        addTeams([{
          name: addedRegistration.teamName || undefined,
          player1: addedRegistration.playerOne,
          player2: addedRegistration.playerTwo,
          signupPairKey: registrationPairKey(
            addedRegistration.playerOne,
            addedRegistration.playerTwo,
          ),
          signupRegistrationId: addedRegistration.id,
        }]);
      }
      let registrations: SignupRegistration[];
      try {
        registrations = await getOrganizerRegistrations(authoritative.signup.id);
      } catch {
        registrations = [
          ...authoritative.registrations.filter((row) => row.id !== addedRegistration.id),
          addedRegistration,
        ];
      }
      setOnlineRegistrations(registrations);
      if (event.status === 'setup') {
        syncConfirmedSignupTeams(registrations, event.courts.length * 2, { includeIgnored: true });
      }
      setRefreshRegistrationsVersion((version) => version + 1);
    } catch (err) {
      setTeamActionError((err as Error).message);
      throw err;
    } finally {
      setTeamActionBusyId(null);
    }
  };

  const openTeamEdit = async (teamId: string) => {
    const team = teams.find((row) => row.id === teamId);
    if (!team) return;
    setTeamActionBusyId(teamId);
    setTeamActionError(null);
    try {
      await resolveRegistrationForTeam(team);
      setEditingTeamId(teamId);
    } catch (err) {
      setTeamActionError((err as Error).message);
    } finally {
      setTeamActionBusyId(null);
    }
  };

  const removeSelectedTeam = async () => {
    if (!confirmedTeam) return;
    setTeamActionBusyId(confirmedTeam.id);
    setTeamActionError(null);
    try {
      const { signup, registration, registrations: authoritativeRegistrations } =
        await resolveRegistrationForTeam(confirmedTeam);
      if (registration) {
        if (registration.status === 'cancelled') {
          throw new Error('This registration was already removed. Refresh and try again.');
        }
        await deleteOrganizerRegistrationIfStatus(
          registration.id,
          registration.status,
          registration.updatedAt,
          event.status !== 'setup',
        );
        const registrations = signup
          ? await getOrganizerRegistrations(signup.id)
          : onlineRegistrations.filter((row) => row.id !== registration.id);
        setOnlineRegistrations(registrations);
        if (event.status === 'setup') {
          syncConfirmedSignupTeams(registrations, event.courts.length * 2, { includeIgnored: true });
        } else {
          removeTeam(confirmedTeam.id);
          const remainingTeams = teams.filter((team) => team.id !== confirmedTeam.id);
          const promoted = registrations.filter((candidate) =>
            candidate.status === 'confirmed'
            && Boolean(candidate.playerTwo.trim())
            && !remainingTeams.some((team) => registrationForTeamIn(team, [candidate])));
          if (promoted.length > 0) {
            addTeams(promoted.map((candidate) => ({
              name: candidate.teamName || undefined,
              player1: candidate.playerOne,
              player2: candidate.playerTwo,
              signupPairKey: registrationPairKey(candidate.playerOne, candidate.playerTwo),
              signupRegistrationId: candidate.id,
            })));
          }
        }
        setRefreshRegistrationsVersion((version) => version + 1);
      } else if (signup) {
        // The previous delete may have committed even if its response/follow-up
        // fetch was lost. Reconcile the current authoritative snapshot instead
        // of mutating a replacement that merely has the same player names.
        setOnlineRegistrations(authoritativeRegistrations);
        if (event.status === 'setup') {
          syncConfirmedSignupTeams(
            authoritativeRegistrations,
            event.courts.length * 2,
            { includeIgnored: true },
          );
        } else {
          removeTeam(confirmedTeam.id);
          const remainingTeams = teams.filter((team) => team.id !== confirmedTeam.id);
          const promoted = authoritativeRegistrations.filter((candidate) =>
            candidate.status === 'confirmed'
            && Boolean(candidate.playerTwo.trim())
            && !remainingTeams.some((team) => registrationForTeamIn(team, [candidate])));
          addTeams(promoted.map((candidate) => ({
            name: candidate.teamName || undefined,
            player1: candidate.playerOne,
            player2: candidate.playerTwo,
            signupPairKey: registrationPairKey(candidate.playerOne, candidate.playerTwo),
            signupRegistrationId: candidate.id,
          })));
        }
      } else {
        removeTeam(confirmedTeam.id);
      }
      setConfirmRemoveTeamId(null);
    } catch (err) {
      setTeamActionError((err as Error).message);
    } finally {
      setTeamActionBusyId(null);
    }
  };

  const saveTeamEdit = async (draft: {
    teamName: string;
    playerOne: string;
    playerTwo: string;
    contact: string;
  }) => {
    if (!editingTeam) return;
    setTeamActionBusyId(editingTeam.id);
    setTeamActionError(null);
    try {
      const { signup, registration } = await resolveRegistrationForTeam(editingTeam);
      if (registration) {
        if (registration.status === 'cancelled') {
          throw new Error('This registration was already removed. Refresh and try again.');
        }
        const contact = draft.contact.trim() || registration.contact || '';
        await updateOrganizerRegistration(registration.id, { ...draft, contact }, {
          status: registration.status,
          updatedAt: registration.updatedAt,
          allowLocked: event.status !== 'setup',
        });
        setOnlineRegistrations((current) => current.map((row) =>
          row.id === registration.id
            ? {
                ...row,
                teamName: draft.teamName.trim(),
                playerOne: draft.playerOne.trim(),
                playerTwo: draft.playerTwo.trim(),
                contact,
              }
            : row));
        setRefreshRegistrationsVersion((version) => version + 1);
      } else if (signup && event.status === 'setup') {
        throw new Error('This team could not be matched to the live sign-up. Refresh and try again.');
      }
      updateTeam(editingTeam.id, {
        name: draft.teamName,
        player1: draft.playerOne,
        player2: draft.playerTwo,
        signupPairKey: registration
          ? registrationPairKey(draft.playerOne, draft.playerTwo)
          : editingTeam.signupPairKey,
        signupRegistrationId: registration?.id ?? editingTeam.signupRegistrationId,
      });
      setEditingTeamId(null);
    } catch (err) {
      setTeamActionError((err as Error).message);
    } finally {
      setTeamActionBusyId(null);
    }
  };

  const moveTeams = async (orderedIds: string[]) => {
    setTeamActionBusyId('reorder');
    setTeamActionError(null);
    try {
      const { signup, registrations } = await loadAuthoritativeRegistrations();
      if (signup) {
        const orderedTeams = orderedIds
          .map((id) => teams.find((team) => team.id === id))
          .filter((team): team is Team => Boolean(team));
        const orderedRegistrations = orderedTeams.map((team) =>
          registrationForTeamIn(team, registrations));
        if (orderedRegistrations.some((registration) => !registration)) {
          throw new Error('The live roster changed. Refresh before reordering teams.');
        }
        await reorderOrganizerRegistrations(
          signup.id,
          orderedRegistrations.map((registration) => registration!.id),
        );
        const refreshed = await getOrganizerRegistrations(signup.id);
        setOnlineRegistrations(refreshed);
        setRefreshRegistrationsVersion((version) => version + 1);
      }
      reorderTeams(orderedIds);
    } catch (err) {
      setTeamActionError((err as Error).message);
    } finally {
      setTeamActionBusyId(null);
    }
  };
  const format = getFormat(event.format);
  const expectedTeams = event.courts.length * 2;
  const qualifierEnabled = event.settings.qualifierEnabled !== false;
  const qualifierUnit = event.settings.qualifierUnit ?? 'points';
  const canStartQualifier =
    format.usesQualifier && event.status === 'setup' && teams.length === expectedTeams;
  const teamDelta = expectedTeams - teams.length;
  // Non-qualifier formats (Round Robin, Americano, ...) need at least 2
  // active teams. Court-capacity overflow is caught at start time and
  // surfaced via lastError.
  const rrGroupSize = Number(
    (event.formatConfig as { groupSize?: number } | undefined)?.groupSize ?? 4,
  );
  // Bracket seeding: how teams get placed into the draw.
  const bracketSeeding =
    (event.formatConfig as { seedingSource?: 'entered' | 'random' | 'manual' } | undefined)
      ?.seedingSource ?? 'entered';
  const savedSeedOrder =
    (event.formatConfig as { seedOrder?: string[] } | undefined)?.seedOrder ?? [];
  const activeTeamIds = teams.map((t) => t.id);
  // Reconcile the saved order with the current roster (teams may have been
  // added/removed since it was set), keeping saved order first.
  const bracketSeedOrder = [
    ...savedSeedOrder.filter((id) => activeTeamIds.includes(id)),
    ...activeTeamIds.filter((id) => !savedSeedOrder.includes(id)),
  ];
  const canStartNonQualifier =
    !format.usesQualifier
    && event.status === 'setup'
    && teams.length >= 2
    && teams.length <= expectedTeams;

  const closeSignupBeforePlay = async (): Promise<boolean> => {
    setTeamActionBusyId('start');
    setTeamActionError(null);
    try {
      const hasLinkedSignup = teams.some((team) => Boolean(team.signupRegistrationId))
        || Boolean(event.settings.publishedSignupId)
        || signupDetails?.sourceEventId === event.id;
      if (!auth.user && hasLinkedSignup) {
        throw new Error('Sign in as the organiser so the public sign-up can be closed first.');
      }
      let current = auth.user
        ? await getOwnedSignup(auth.user.id, event.id)
        : signupDetails?.sourceEventId === event.id ? signupDetails : null;
      if (!current) {
        if (hasLinkedSignup) {
          throw new Error('Sign in with the account that published this sign-up.');
        }
        return true;
      }

      // A first publish can succeed before its one-time local roster import
      // reaches the server. Complete that durable handshake before locking so
      // an interrupted publish can never turn an empty snapshot into truth.
      if (current.rosterSeededAt == null) {
        await seedOrganizerSignupRoster(
          current.id,
          teams.map((team, index) => ({
            registrationId: team.signupRegistrationId,
            teamName: team.name,
            playerOne: team.players[0].name,
            playerTwo: team.players[1].name,
            rank: index + 1,
          })),
        );
        current = await getOwnedSignup(auth.user!.id, event.id) ?? current;
      }

      // One server transaction fixes capacity from the court count, rebalances
      // the queue, closes registrations and durably locks the roster. Retry a
      // fresh authoritative revision if another organiser tab just changed it.
      for (let attempt = 0; attempt < 3; attempt += 1) {
        const result = await lockSignupRoster(
          current.id,
          current.sourceEventId,
          expectedTeams,
          current.capacityRevision,
        );
        current = result.event;
        if (!result.conflict) break;
      }
      setSignupDetails(current);
      if (
        current.isOpen
        || current.capacityTeams !== expectedTeams
        || !current.rosterLockedAt
      ) {
        throw new Error('Registrations could not be locked to the current courts. Refresh and try starting again.');
      }
      // The event lock used to close registrations serializes after any public
      // sign-up already in flight. Fetch that final queue and project it into
      // the local roster before changing status, so no just-confirmed pair is
      // stranded only on the public link.
      const finalRegistrations = await getOrganizerRegistrations(current.id);
      setOnlineRegistrations(finalRegistrations);
      syncConfirmedSignupTeams(
        finalRegistrations,
        event.courts.length * 2,
        { includeIgnored: true },
      );
      return true;
    } catch (closeError) {
      setTeamActionError(
        `The tournament was not started because the public sign-up could not be closed: ${(closeError as Error).message}`,
      );
      return false;
    } finally {
      setTeamActionBusyId(null);
    }
  };

  const resetScoresAndRounds = async () => {
    setTeamActionBusyId('reset');
    setTeamActionError(null);
    try {
      const hasLinkedSignup = Boolean(event.settings.publishedSignupId)
        || teams.some((team) => Boolean(team.signupRegistrationId))
        || signupDetails?.sourceEventId === event.id;
      if (!auth.user && hasLinkedSignup) {
        throw new Error('Sign in as the organiser to unlock the linked public roster before resetting.');
      }
      let current = auth.user ? await getOwnedSignup(auth.user.id, event.id) : null;
      if (!current && hasLinkedSignup) {
        throw new Error('Sign in with the account that published this sign-up.');
      }
      for (let attempt = 0; current?.rosterLockedAt && attempt < 3; attempt += 1) {
        const result = await unlockSignupRoster(
          current.id,
          current.sourceEventId,
          current.capacityRevision,
        );
        current = result.event;
        if (!result.conflict) break;
      }
      if (current?.rosterLockedAt) {
        throw new Error('The public roster could not be unlocked. Refresh and try again.');
      }
      if (current) setSignupDetails(current);
      loadEvent({
        ...event,
        status: 'setup',
        qualifier: undefined,
        rounds: [],
        pendingAssignments: undefined,
      });
      setConfirmReset(false);
    } catch (resetError) {
      setTeamActionError((resetError as Error).message);
    } finally {
      setTeamActionBusyId(null);
    }
  };

  const beginQualifierFlow = async () => {
    if (!await closeSignupBeforePlay()) return;
    if (qualifierEnabled) {
      startQualifier();
      setTimeout(() => navigate(eventRoute(event.id, 'qualifier')), 0);
    } else {
      skipQualifierToSeeding();
      setTimeout(() => navigate(eventRoute(event.id, 'seeding')), 0);
    }
  };

  const beginTournament = async () => {
    if (!await closeSignupBeforePlay()) return;
    startTournament();
    setTimeout(() => {
      const next = useEventStore.getState().event;
      if (next?.status === 'round-in-progress') {
        navigate(eventRoute(next.id, 'display'));
      }
    }, 0);
  };

  // Setup is reachable mid-event (the display's "Setup & teams" menu item, or
  // navigating back). When the event has already moved past setup, the start
  // button can't apply — so offer a way back to wherever the event is instead
  // of stranding the operator on a dead screen.
  const resumeRoute =
    event.status === 'qualifier'
      ? eventRoute(event.id, 'qualifier')
      : event.status === 'seeding'
        ? eventRoute(event.id, 'seeding')
        : eventRoute(event.id, 'display'); // round-in-progress / between-rounds / complete
  const resumeLabel =
    event.status === 'qualifier'
      ? 'Resume qualifier →'
      : event.status === 'seeding'
        ? 'Resume seeding →'
        : event.status === 'complete'
          ? 'View podium →'
          : 'Back to the event →';

  return (
    <div className="setup">
      <div className="setup-col">
        <h2 className="setup-h">
          Event
          <span className="setup-format-badge">{format.name}</span>
          <button className="btn sm" onClick={() => setConfirmReset(true)}>
            Reset
          </button>
        </h2>
        <div className="setup-sub">
          Event name, venue, round duration, and tie rules.
        </div>
        {format.id === 'round-robin' && (
          <div className="setup-form" style={{ marginBottom: 12 }}>
            <div className="setup-field">
              <label>Group size</label>
              <NumberField
                value={rrGroupSize}
                min={2}
                max={12}
                disabled={event.status !== 'setup'}
                onCommit={(n) => setFormatConfig({ groupSize: n })}
              />
            </div>
            <div className="setup-sub" style={{ marginTop: -4 }}>
              Teams split into groups of this size; everyone plays everyone in
              their group. The trailing group may be smaller.
            </div>
          </div>
        )}
        {format.id === 'bracket' && (
          <div className="setup-form" style={{ marginBottom: 12 }}>
            <div className="setup-field">
              <label>Seeding</label>
              <div style={{ display: 'flex', gap: 6 }}>
                {(['entered', 'random', 'manual'] as const).map((s) => (
                  <button
                    key={s}
                    type="button"
                    className={'btn sm ' + (bracketSeeding === s ? 'primary' : '')}
                    disabled={event.status !== 'setup'}
                    onClick={() => setFormatConfig({ seedingSource: s })}
                  >
                    {s === 'entered' ? 'As entered' : s === 'random' ? 'Random' : 'Manual'}
                  </button>
                ))}
              </div>
            </div>
            <div className="setup-sub" style={{ marginTop: -4 }}>
              {bracketSeeding === 'entered'
                ? 'Teams are seeded in the order you added them. Seed 1 gets the first bye when the field is not a power of 2.'
                : bracketSeeding === 'random'
                  ? 'Teams are drawn into the bracket randomly when you start.'
                  : 'Drag teams into seed order. Seed 1 (top) gets the first bye when the field is not a power of 2.'}
            </div>
            {bracketSeeding === 'manual' && (
              <SortableSeedList
                order={bracketSeedOrder}
                teams={teams}
                disabled={event.status !== 'setup'}
                onReorder={(ids) => setFormatConfig({ seedingSource: 'manual', seedOrder: ids })}
              />
            )}
          </div>
        )}
        <div className="setup-form">
          <div className="setup-field">
            <label>Event name</label>
            <input
              className="setup-input"
              value={event.name}
              onChange={(e) => setEventName(e.target.value)}
            />
          </div>
          <div className="setup-field">
            <label>Venue</label>
            <input
              className="setup-input"
              value={event.venue ?? ''}
              onChange={(e) => setEventVenue(e.target.value)}
              placeholder="High Court Padel"
            />
          </div>
          <DurationField
            label="Round duration"
            valueMs={event.settings.defaultRoundDurationMs}
            onChange={(ms) => updateSettings({ defaultRoundDurationMs: ms })}
          />
          {format.id !== 'bracket' && format.id !== 'round-robin' && (
            <div className="setup-field">
              <label>Total rounds</label>
              <NumberField
                value={event.settings.roundsTotal}
                min={1}
                max={20}
                onCommit={(n) => updateSettings({ roundsTotal: n })}
              />
            </div>
          )}
          <div className="setup-field">
            <label>Tie rule</label>
            <select
              className="setup-input"
              value={event.settings.tieRule}
              onChange={(e) => updateSettings({ tieRule: e.target.value as TieRule })}
            >
              {(Object.keys(TIE_RULE_LABELS) as TieRule[]).map((rule) => (
                <option key={rule} value={rule}>
                  {TIE_RULE_LABELS[rule]}
                </option>
              ))}
            </select>
          </div>
          <DurationField
            label="Warning flash at"
            valueMs={event.settings.warningAtMs}
            onChange={(ms) => updateSettings({ warningAtMs: ms })}
          />
          <div className="setup-field">
            <label>Buzzer on timer end</label>
            <ToggleField
              value={event.settings.soundOnTimerEnd}
              onChange={(v) => updateSettings({ soundOnTimerEnd: v })}
            />
          </div>
          <div className="setup-field">
            <label>Announce round start</label>
            <ToggleField
              value={event.settings.announceRoundStart}
              onChange={(v) => updateSettings({ announceRoundStart: v })}
            />
          </div>

          {format.usesQualifier && (
            <>
              <div className="setup-field">
                <label>Use qualifier round</label>
                <ToggleField
                  value={qualifierEnabled}
                  onChange={(v) => setQualifierEnabled(v)}
                />
              </div>
              {qualifierEnabled && (
                <>
                  <div className="setup-field">
                    <label>Qualifier scored in</label>
                    <select
                      className="setup-input"
                      value={qualifierUnit}
                      onChange={(e) =>
                        updateSettings({ qualifierUnit: e.target.value as QualifierUnit })
                      }
                    >
                      <option value="points">Points</option>
                      <option value="games">Games</option>
                      <option value="time">Time</option>
                    </select>
                  </div>
                  <div className="setup-field">
                    <label>
                      {qualifierUnit === 'time'
                        ? 'Minutes per match'
                        : qualifierUnit === 'games'
                          ? 'Games to'
                          : 'Points to'}
                    </label>
                    <NumberField
                      value={event.settings.qualifierTarget ?? 16}
                      min={1}
                      max={qualifierUnit === 'time' ? 60 : 99}
                      onCommit={(n) => updateSettings({ qualifierTarget: n })}
                    />
                  </div>
                </>
              )}
            </>
          )}
        </div>

        <h2 className="setup-h" style={{ marginTop: 12 }}>
          Courts ({event.courts.length})
          {event.status === 'setup' && (
            <button className="btn sm" onClick={addCourt}>
              + Add court
            </button>
          )}
        </h2>
        <div className="setup-sub">
          Higher position = more prestige. Top court is the Centre / King's Court.
        </div>
        <SortableCourtList
          courts={event.courts}
          canRemove={event.status === 'setup' && event.courts.length > 1}
          canReorder={event.status === 'setup'}
          onRename={renameCourt}
          onPoints={setCourtPoints}
          onRemove={removeCourt}
          onReorder={reorderCourts}
        />
      </div>

      <div className="setup-col">
        <h2 className="setup-h">
          Teams ({teams.length} / {expectedTeams})
        </h2>
        <div className="setup-sub">
          Court count sets the team capacity. Complete pairs fill this roster automatically; overflow pairs wait, and solos stay in Looking for a partner.
        </div>
        <EventSignupPanel
          event={event}
          expectedTeams={expectedTeams}
          teams={teams}
          onAddTeams={addTeams}
          onSyncTeams={syncConfirmedSignupTeams}
          onRegistrationsChange={setOnlineRegistrations}
          refreshRegistrationsVersion={refreshRegistrationsVersion}
          onSignupChange={(signup) => {
            setSignupDetails(signup);
            if (signup && event.settings.publishedSignupId !== signup.id) {
              updateSettings({ publishedSignupId: signup.id });
            }
          }}
        />
        {event.status !== 'setup' && (
          <div className="setup-mid-event-banner">
            <strong>Mid-event edits.</strong> Editing a player name is a safe substitution. The
            team's points and standings stay attached to the team, not the individual player.{' '}
            {event.format === 'americano'
              ? 'Before the round timer starts, adding a team refreshes the draw and fills any available court space. Once play has started, the new team joins from the next round. A removed team drops out of future rounds.'
              : event.format === 'mexicano'
                ? 'A team you add now joins the schedule from the next round; a removed team drops out of it. The current round is unaffected.'
              : event.format === 'round-robin' || event.format === 'bracket'
                ? "This format locks its draw when the tournament starts — a team added now won't be scheduled, and a removed team is simply skipped. The current round is unaffected."
                : "Adding or removing a team won't change the current round; removed teams are skipped in future rotations, and an added team needs to be dragged into a court on the next rotation preview."}
          </div>
        )}
        <NewTeamForm
          busy={teamActionBusyId === 'add'}
          onAdd={addTeamFromSetup}
        />
        <SortableTeamList
          teams={teams}
          canReorder={event.status === 'setup'}
          busyId={teamActionBusyId}
          onReorder={(ids) => void moveTeams(ids)}
          onEdit={(teamId) => void openTeamEdit(teamId)}
          onRemove={requestRemoveTeam}
          onAvatarUpload={(teamId, playerIndex, dataUrl) =>
            setPlayerAvatar(teamId, playerIndex, { photoDataUrl: dataUrl })}
          onAvatarClear={(teamId, playerIndex) => setPlayerAvatar(teamId, playerIndex, undefined)}
        />
        {teamActionError && (
          <div className="signup-message error" role="alert">{teamActionError}</div>
        )}
        <div className="setup-actions">
          <button
            className="btn"
            disabled={teams.length === 0}
            onClick={() => setRosterShareOpen(true)}
          >
            Share roster
          </button>
          {event.status !== 'setup' ? (
            <button
              className="btn full primary lg"
              onClick={() => navigate(resumeRoute)}
            >
              {resumeLabel}
            </button>
          ) : format.usesQualifier ? (
            <button
              className="btn full primary lg"
              disabled={!canStartQualifier || teamActionBusyId === 'start'}
              onClick={() => void beginQualifierFlow()}
            >
              {canStartQualifier
                ? qualifierEnabled
                  ? 'Start qualifier round →'
                  : 'Continue to seeding →'
                : teamDelta > 0
                  ? `Need ${teamDelta} more team(s)`
                  : `Remove ${-teamDelta} team(s)`}
            </button>
          ) : (
            <button
              className="btn full primary lg"
              disabled={!canStartNonQualifier || teamActionBusyId === 'start'}
              onClick={() => void beginTournament()}
            >
              {canStartNonQualifier
                ? 'Start tournament →'
                : teams.length > expectedTeams
                  ? `Remove ${teams.length - expectedTeams} team(s)`
                  : `Need ${Math.max(0, 2 - teams.length)} more team(s)`}
            </button>
          )}
        </div>
        {lastError && event.status === 'setup' && (
          <div style={{ color: 'var(--red)', fontSize: 14, marginTop: 8 }}>
            {lastError}
          </div>
        )}
      </div>

      <ConfirmDialog
        open={confirmReset}
        title="Reset scores and rounds?"
        message="This clears scores and all rounds, then returns to setup. The organiser roster and public sign-up stay intact."
        confirmLabel={teamActionBusyId === 'reset' ? 'Resetting…' : 'Reset'}
        destructive
        onConfirm={() => void resetScoresAndRounds()}
        onCancel={() => setConfirmReset(false)}
      />

      <ConfirmDialog
        open={!!confirmedTeam}
        title="Remove this team completely?"
        message={
          confirmedTeam
            ? confirmedRegistration
              ? `${confirmedTeam.players[0].name} & ${confirmedTeam.players[1].name} will be removed from this competition and from the public sign-up link. This cannot be undone from the link.`
              : event.status === 'setup'
                ? `${confirmedTeam.players[0].name} & ${confirmedTeam.players[1].name} will be removed from this competition.`
                : `${confirmedTeam.players[0].name} & ${confirmedTeam.players[1].name} will be marked inactive and skipped in future rotations. Existing scores stay in the standings.`
            : ''
        }
        confirmLabel={teamActionBusyId ? 'Removing…' : 'Remove team'}
        destructive
        onConfirm={() => void removeSelectedTeam()}
        onCancel={() => setConfirmRemoveTeamId(null)}
      />

      {editingTeam && (
        <EditTeamModal
          team={editingTeam}
          registration={registrationForTeam(editingTeam)}
          saving={teamActionBusyId === editingTeam.id}
          onSave={saveTeamEdit}
          onClose={() => setEditingTeamId(null)}
        />
      )}

      {rosterShareOpen && (
        <RosterShareModal
          title={`${signupDetails?.title || event.name} roster`}
          text={buildRosterShareText({
            event,
            teams,
            signup: signupDetails,
            registrations: onlineRegistrations,
          })}
          onClose={() => setRosterShareOpen(false)}
        />
      )}
    </div>
  );
}

function SortableTeamList({
  teams,
  canReorder,
  busyId,
  onReorder,
  onEdit,
  onRemove,
  onAvatarUpload,
  onAvatarClear,
}: {
  teams: Team[];
  canReorder: boolean;
  busyId: string | null;
  onReorder: (orderedIds: string[]) => void;
  onEdit: (teamId: string) => void;
  onRemove: (teamId: string) => void;
  onAvatarUpload: (teamId: string, playerIndex: 0 | 1, dataUrl: string) => void;
  onAvatarClear: (teamId: string, playerIndex: 0 | 1) => void;
}) {
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
  );
  const ids = teams.map((team) => team.id);
  const handleDragEnd = (dragEvent: DragEndEvent) => {
    const { active, over } = dragEvent;
    if (!over || active.id === over.id) return;
    const from = ids.indexOf(String(active.id));
    const to = ids.indexOf(String(over.id));
    if (from < 0 || to < 0) return;
    onReorder(arrayMove(ids, from, to));
  };

  if (teams.length === 0) {
    return (
      <div className="setup-list">
        <div style={{ color: 'var(--text-2)', fontSize: 14, fontStyle: 'italic' }}>No teams yet.</div>
      </div>
    );
  }

  return (
    <div className="setup-list">
      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
        <SortableContext items={ids} strategy={verticalListSortingStrategy}>
          {teams.map((team, index) => (
            <SortableTeamRow
              key={team.id}
              team={team}
              index={index}
              canReorder={canReorder && !busyId}
              busy={busyId === team.id}
              onEdit={onEdit}
              onRemove={onRemove}
              onAvatarUpload={onAvatarUpload}
              onAvatarClear={onAvatarClear}
            />
          ))}
        </SortableContext>
      </DndContext>
    </div>
  );
}

function SortableTeamRow({
  team,
  index,
  canReorder,
  busy,
  onEdit,
  onRemove,
  onAvatarUpload,
  onAvatarClear,
}: {
  team: Team;
  index: number;
  canReorder: boolean;
  busy: boolean;
  onEdit: (teamId: string) => void;
  onRemove: (teamId: string) => void;
  onAvatarUpload: (teamId: string, playerIndex: 0 | 1, dataUrl: string) => void;
  onAvatarClear: (teamId: string, playerIndex: 0 | 1) => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: team.id,
    disabled: !canReorder,
  });
  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.58 : 1,
    zIndex: isDragging ? 3 : undefined,
  };
  return (
    <div ref={setNodeRef} style={style} className="setup-team-row">
      <button
        className="setup-team-drag"
        type="button"
        disabled={!canReorder}
        {...attributes}
        {...listeners}
        aria-label={canReorder ? `Move team ${index + 1}` : 'Team order is locked after starting'}
        title={canReorder ? 'Drag to rearrange team' : 'Order locked'}
      >
        <Icons.Drag className="icon" />
      </button>
      <div className="setup-team-num">{index + 1}</div>
      <div className="setup-team-identity">
        {team.name && <strong>{team.name}</strong>}
        <div className="setup-team-pair">
          <PlayerInput
            player={team.players[0]}
            placeholder="Player A"
            readOnly
            onNameChange={() => undefined}
            onAvatarUpload={(dataUrl) => onAvatarUpload(team.id, 0, dataUrl)}
            onAvatarClear={() => onAvatarClear(team.id, 0)}
          />
          <PlayerInput
            player={team.players[1]}
            placeholder="Player B"
            readOnly
            onNameChange={() => undefined}
            onAvatarUpload={(dataUrl) => onAvatarUpload(team.id, 1, dataUrl)}
            onAvatarClear={() => onAvatarClear(team.id, 1)}
          />
        </div>
      </div>
      <div className="setup-team-actions">
        <button
          type="button"
          className="setup-team-action"
          disabled={busy}
          onClick={() => onEdit(team.id)}
          aria-label="Edit team"
          title="Edit team"
        >
          <Icons.Edit className="icon" />
        </button>
        <button
          type="button"
          className="setup-team-action danger"
          disabled={busy}
          onClick={() => onRemove(team.id)}
          aria-label="Remove team completely"
          title="Remove team completely"
        >
          <Icons.Trash className="icon" />
        </button>
      </div>
    </div>
  );
}

function EditTeamModal({
  team,
  registration,
  saving,
  onSave,
  onClose,
}: {
  team: Team;
  registration?: SignupRegistration;
  saving: boolean;
  onSave: (draft: { teamName: string; playerOne: string; playerTwo: string; contact: string }) => void;
  onClose: () => void;
}) {
  const [teamName, setTeamName] = useState(team.name ?? '');
  const [playerOne, setPlayerOne] = useState(team.players[0].name);
  const [playerTwo, setPlayerTwo] = useState(team.players[1].name);
  const [contact, setContact] = useState(registration?.contact ?? '');
  const valid = playerOne.trim().length > 0
    && playerTwo.trim().length > 0
    && (!registration || contact.trim().length >= 3);

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
              <h2>Edit team</h2>
              <p>{registration ? 'Changes also update the public sign-up link.' : 'This is a local tournament team.'}</p>
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
              <span>Player two</span>
              <input className="setup-input" value={playerTwo} onChange={(event) => setPlayerTwo(event.target.value)} />
            </label>
            {registration && (
              <label>
                <span>WhatsApp number or email <small>kept private</small></span>
                <input className="setup-input" value={contact} onChange={(event) => setContact(event.target.value)} />
              </label>
            )}
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

function PlayerInput({
  player,
  placeholder,
  onNameChange,
  onAvatarUpload,
  onAvatarClear,
  readOnly = false,
}: {
  player: Player;
  placeholder: string;
  onNameChange: (value: string) => void;
  onAvatarUpload: (dataUrl: string) => void;
  onAvatarClear: () => void;
  readOnly?: boolean;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const hasPhoto = !!player.avatar?.photoDataUrl;
  return (
    <div className="setup-player-input">
      <button
        type="button"
        className="setup-player-avatar"
        onClick={() => inputRef.current?.click()}
        aria-label={hasPhoto ? `Change photo for ${player.name}` : `Add photo for ${player.name}`}
        title={hasPhoto ? 'Change photo' : 'Add photo'}
      >
        <Avatar player={player} size="sm" />
        <span className="setup-player-avatar-overlay">
          {busy ? '…' : hasPhoto ? '✎' : '+'}
        </span>
      </button>
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        style={{ display: 'none' }}
        onChange={async (e) => {
          const file = e.target.files?.[0];
          if (!file) return;
          setBusy(true);
          try {
            const dataUrl = await cropImageFileToAvatar(file);
            onAvatarUpload(dataUrl);
          } catch {
            // Swallow: invalid image; the avatar simply doesn't update.
          } finally {
            setBusy(false);
            // Allow re-selecting the same file.
            e.target.value = '';
          }
        }}
      />
      <input
        className="setup-input setup-player-name"
        value={player.name}
        onChange={(e) => onNameChange(e.target.value)}
        placeholder={placeholder}
        readOnly={readOnly}
      />
      {hasPhoto && (
        <button
          type="button"
          className="setup-player-avatar-clear"
          onClick={onAvatarClear}
          aria-label="Remove photo"
          title="Remove photo"
        >
          <Icons.Close className="icon" />
        </button>
      )}
    </div>
  );
}

function ToggleField({
  value,
  onChange,
}: {
  value: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <button
      type="button"
      className={'settings-toggle ' + (value ? 'on' : '')}
      onClick={() => onChange(!value)}
      aria-pressed={value}
    >
      <span className="settings-toggle-dot" />
    </button>
  );
}

function DurationField({
  label,
  valueMs,
  onChange,
}: {
  label: string;
  valueMs: number;
  onChange: (ms: number) => void;
}) {
  const [text, setText] = useState(formatMs(valueMs));
  return (
    <div className="setup-field">
      <label>{label}</label>
      <input
        className="setup-input"
        value={text}
        onChange={(e) => setText(e.target.value)}
        onFocus={() => setText(formatMs(valueMs))}
        onBlur={() => {
          const parsed = parseDurationInput(text);
          if (parsed !== null) {
            onChange(parsed);
            setText(formatMs(parsed));
          } else {
            setText(formatMs(valueMs));
          }
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
        }}
      />
    </div>
  );
}

function NewTeamForm({
  onAdd,
  busy,
}: {
  onAdd: (draft: {
    teamName: string;
    playerOne: string;
    playerTwo: string;
    contact: string;
  }) => Promise<void>;
  busy: boolean;
}) {
  const [teamName, setTeamName] = useState('');
  const [p1, setP1] = useState('');
  const [p2, setP2] = useState('');
  const [contact, setContact] = useState('');
  const valid = p1.trim() && p2.trim();
  const submit = async () => {
    if (!valid || busy) return;
    try {
      await onAdd({
        teamName: teamName.trim(),
        playerOne: p1.trim(),
        playerTwo: p2.trim(),
        contact: contact.trim(),
      });
      setTeamName('');
      setP1('');
      setP2('');
      setContact('');
    } catch {
      // SetupScreen shows the authoritative server error beside the roster.
    }
  };
  return (
    <div className="setup-team-add-form">
      <input
        className="setup-input"
        placeholder="Team name (optional)"
        value={teamName}
        onChange={(e) => setTeamName(e.target.value)}
      />
      <input
        className="setup-input"
        placeholder="Player A"
        value={p1}
        onChange={(e) => setP1(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') void submit();
        }}
      />
      <input
        className="setup-input"
        placeholder="Player B"
        value={p2}
        onChange={(e) => setP2(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') void submit();
        }}
      />
      <input
        className="setup-input"
        placeholder="WhatsApp or phone (optional)"
        value={contact}
        onChange={(e) => setContact(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') void submit();
        }}
      />
      <button
        className="btn primary team-add-button"
        disabled={!valid || busy}
        onClick={() => void submit()}
      >
        {busy ? 'Adding…' : '+ Add team'}
      </button>
    </div>
  );
}

function NumberField({
  value,
  min,
  max,
  onCommit,
  className = 'setup-input',
  disabled,
}: {
  value: number;
  min: number;
  max: number;
  onCommit: (n: number) => void;
  className?: string;
  disabled?: boolean;
}) {
  const [text, setText] = useState(String(value));
  // Re-sync if external value changes while the field isn't focused
  useEffect(() => {
    setText(String(value));
  }, [value]);
  const commit = () => {
    const n = parseInt(text, 10);
    if (!Number.isNaN(n) && n >= min && n <= max) {
      onCommit(n);
      setText(String(n));
    } else {
      setText(String(value));
    }
  };
  return (
    <input
      type="number"
      inputMode="numeric"
      min={min}
      max={max}
      className={className}
      value={text}
      disabled={disabled}
      onChange={(e) => setText(e.target.value)}
      onFocus={(e) => e.currentTarget.select()}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
      }}
    />
  );
}

function SortableCourtList({
  courts,
  canRemove,
  canReorder,
  onRename,
  onPoints,
  onRemove,
  onReorder,
}: {
  courts: Court[];
  canRemove: boolean;
  canReorder: boolean;
  onRename: (id: string, name: string) => void;
  onPoints: (id: string, value: number) => void;
  onRemove: (id: string) => void;
  onReorder: (orderedIdsTopFirst: string[]) => void;
}) {
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
  );
  const ordered = courts.slice().sort((a, b) => b.position - a.position);
  const ids = ordered.map((c) => c.id);

  const handleDragEnd = (e: DragEndEvent) => {
    const { active, over } = e;
    if (!over || active.id === over.id) return;
    const from = ids.indexOf(String(active.id));
    const to = ids.indexOf(String(over.id));
    if (from < 0 || to < 0) return;
    const next = arrayMove(ids, from, to);
    onReorder(next);
  };

  return (
    <div className="setup-list">
      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
        <SortableContext items={ids} strategy={verticalListSortingStrategy}>
          {ordered.map((c) => (
            <SortableCourtRow
              key={c.id}
              court={c}
              isCentre={isCentreCourt(c, courts)}
              canRemove={canRemove}
              canReorder={canReorder}
              onRename={onRename}
              onPoints={onPoints}
              onRemove={onRemove}
            />
          ))}
        </SortableContext>
      </DndContext>
    </div>
  );
}

function SortableCourtRow({
  court,
  isCentre,
  canRemove,
  canReorder,
  onRename,
  onPoints,
  onRemove,
}: {
  court: Court;
  isCentre: boolean;
  canRemove: boolean;
  canReorder: boolean;
  onRename: (id: string, name: string) => void;
  onPoints: (id: string, value: number) => void;
  onRemove: (id: string) => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: court.id,
    disabled: !canReorder,
  });
  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.6 : 1,
  };
  return (
    <div
      ref={setNodeRef}
      style={style}
      className={'setup-court-row ' + (isCentre ? 'centre' : '')}
    >
      {canReorder ? (
        <button
          className="setup-court-drag"
          {...attributes}
          {...listeners}
          aria-label="Drag to reorder court"
          type="button"
        >
          <Icons.Drag className="icon" />
        </button>
      ) : (
        <span className="setup-court-drag" aria-hidden="true" />
      )}
      <div className="setup-court-pos">{court.position}</div>
      <input
        className="setup-input"
        value={court.name}
        onChange={(e) => onRename(court.id, e.target.value)}
      />
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <NumberField
          className="setup-court-pts-input setup-input"
          value={court.pointValue}
          min={0}
          max={99}
          onCommit={(n) => onPoints(court.id, n)}
        />
        <span
          style={{
            fontSize: 11,
            color: 'var(--text-2)',
            fontFamily: 'var(--font-mono)',
            letterSpacing: '0.12em',
          }}
        >
          PTS
        </span>
      </div>
      {canRemove ? (
        <button
          className="op-score-btn"
          onClick={() => onRemove(court.id)}
          aria-label="Remove court"
          type="button"
        >
          <Icons.Minus className="icon" />
        </button>
      ) : (
        <span style={{ width: 32 }} />
      )}
    </div>
  );
}

function teamLabel(t: Team): string {
  return t.name?.trim() || t.players.map((p) => p.name).join(' & ');
}

/** Drag-to-arrange seed order for a manually-seeded bracket. */
function SortableSeedList({
  order,
  teams,
  disabled,
  onReorder,
}: {
  order: string[];
  teams: Team[];
  disabled: boolean;
  onReorder: (orderedIds: string[]) => void;
}) {
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
  );
  const teamById = new Map(teams.map((t) => [t.id, t]));
  const handleDragEnd = (e: DragEndEvent) => {
    const { active, over } = e;
    if (!over || active.id === over.id) return;
    const from = order.indexOf(String(active.id));
    const to = order.indexOf(String(over.id));
    if (from < 0 || to < 0) return;
    onReorder(arrayMove(order, from, to));
  };
  return (
    <div className="setup-list" style={{ marginTop: 8 }}>
      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
        <SortableContext items={order} strategy={verticalListSortingStrategy}>
          {order.map((id, i) => {
            const t = teamById.get(id);
            if (!t) return null;
            return (
              <SortableSeedRow key={id} id={id} seed={i + 1} label={teamLabel(t)} disabled={disabled} />
            );
          })}
        </SortableContext>
      </DndContext>
    </div>
  );
}

function SortableSeedRow({
  id,
  seed,
  label,
  disabled,
}: {
  id: string;
  seed: number;
  label: string;
  disabled: boolean;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id,
    disabled,
  });
  // Own flex layout (not .setup-court-row, whose 5-col grid reserves an
  // empty points column and squashes the name).
  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.6 : 1,
    display: 'flex',
    alignItems: 'center',
    gap: 10,
    padding: '10px 12px',
    background: 'var(--bg-2)',
    border: '1px solid var(--line-soft)',
    borderRadius: 10,
  };
  return (
    <div ref={setNodeRef} style={style}>
      {!disabled ? (
        <button
          className="setup-court-drag"
          {...attributes}
          {...listeners}
          aria-label="Drag to reorder seed"
          type="button"
        >
          <Icons.Drag className="icon" />
        </button>
      ) : (
        <span className="setup-court-drag" aria-hidden="true" />
      )}
      <div className="setup-court-pos" style={{ minWidth: 16, textAlign: 'center' }}>{seed}</div>
      <span style={{ flex: 1, minWidth: 0, fontWeight: 600 }}>{label}</span>
    </div>
  );
}
