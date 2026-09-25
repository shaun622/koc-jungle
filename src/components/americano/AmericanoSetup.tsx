import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { AuthModal } from '@/components/AuthModal';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { Icons } from '@/components/Icons';
import { RosterShareModal } from '@/components/RosterShareModal';
import { useAuth } from '@/hooks/useAuth';
import { hasExactRotatingCycle } from '@/logic/americanoV2/fixtures';
import {
  addAmericanoFixedTeam,
  addAmericanoParticipant,
  freshAmericanoCopy,
  previewAmericanoSchedule,
  removeAmericanoFixedTeam,
  removeAmericanoParticipant,
  reorderAmericanoFixedTeams,
  reorderAmericanoParticipants,
  replaceAmericanoCourts,
  startAmericanoEvent,
  updateAmericanoConfig,
  updateAmericanoFixedTeam,
  updateAmericanoParticipant,
} from '@/logic/americanoV2/runtime';
import { isValidAmericanoPoints, MAX_AMERICANO_POINTS, type AmericanoEventStateV2, type PairingMode } from '@/logic/americanoV2/types';
import {
  getOrganizerSignupV3,
  mutateAmericanoSignupEntry,
  publishAmericanoSignupV3,
  cancelAmericanoSignup,
  clearPendingAmericanoRequest,
  correctAmericanoSignupLabels,
  readPendingAmericanoRequests,
  saveAmericanoConfigV2,
  saveAmericanoEventV2,
  sealPendingAmericanoRequest,
  setAmericanoSignupOpen,
  startAmericanoV2,
  type OwnerReplyV2,
  type OwnerSnapshotV2,
  type SignupSnapshotV3,
} from '@/lib/americanoV2';
import { buildSignupUrl, defaultSignupAccountSlug } from '@/lib/signups';
import { eventRoute } from '@/lib/eventRoutes';
import { newId } from '@/logic/idGen';
import {
  deletePrivateEntryDraft,
  deletePrivateEntryDraftsForEvent,
  readPrivateEntryDrafts,
  savePrivateEntryDraft,
} from '@/store/privateEntryDrafts';
import { applyExternalEventToActiveFacade, saveEventToLocalCatalog, useEventStore } from '@/store/eventStore';
import { deleteCloudEvent } from '@/store/cloudSync';
import type { Team } from '@/types/domain';
import { buildRosterShareText } from '@/utils/rosterShare';

const PACE_OPTIONS = [5, 10, 15, 20, 25, 30] as const;

function dateTimeLocal(iso: string | null | undefined): string {
  if (!iso) return '';
  const date = new Date(iso);
  if (!Number.isFinite(date.getTime())) return '';
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 16);
}

function localToIso(value: string): string | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.toISOString() : null;
}

function replySnapshot(reply: OwnerReplyV2): { event: AmericanoEventStateV2; signup: SignupSnapshotV3 | null; updatedAt: string } {
  if (reply.status === 'rejected') throw new Error(reply.message);
  if (reply.status === 'conflict') throw new OwnerConflictError(reply.snapshot);
  return { event: reply.snapshot.event.state, signup: reply.snapshot.signup, updatedAt: reply.snapshot.event.updatedAt };
}

class OwnerConflictError extends Error {
  constructor(readonly snapshot: OwnerSnapshotV2) {
    super('This event changed on another device. Your local draft was kept. Download it or reload the latest server version.');
    this.name = 'OwnerConflictError';
  }
}

function eventEntrantCount(event: AmericanoEventStateV2): number {
  return event.formatConfig.pairingMode === 'rotating'
    ? event.participants.filter((participant) => participant.active).length
    : event.teams.filter((team) => team.active).length;
}

function capacityFor(event: AmericanoEventStateV2): number {
  return event.courts.length * (event.formatConfig.pairingMode === 'rotating' ? 4 : 2);
}

export function AmericanoSetup({ event }: { event: AmericanoEventStateV2 }) {
  const loadEvent = useEventStore((state) => state.loadEvent);
  const deleteLocalEvent = useEventStore((state) => state.deleteLocalEvent);
  const navigate = useNavigate();
  const auth = useAuth();
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [pointsDraft, setPointsDraft] = useState(String(event.formatConfig.pointsPerMatch));
  const pointsInputRef = useRef<HTMLInputElement>(null);
  const previewSectionRef = useRef<HTMLElement>(null);
  const [authOpen, setAuthOpen] = useState(false);
  const [signup, setSignup] = useState<SignupSnapshotV3 | null>(null);
  const [signupReadFailed, setSignupReadFailed] = useState(false);
  const signupSnapshotRef = useRef<SignupSnapshotV3 | null>(null);
  const signupEpochRef = useRef(0);
  const retrySignupRef = useRef<(() => Promise<void>) | null>(null);
  const metadataDirtyRef = useRef(false);
  const [contacts, setContacts] = useState<Record<string, string>>({});
  const [teamName, setTeamName] = useState('');
  const [playerOne, setPlayerOne] = useState('');
  const [playerTwo, setPlayerTwo] = useState('');
  const [contact, setContact] = useState('');
  const [confirmCopy, setConfirmCopy] = useState<PairingMode | null>(null);
  const [confirmCancel, setConfirmCancel] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);
  const [duplicatePending, setDuplicatePending] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editTeamName, setEditTeamName] = useState('');
  const [editPlayerOne, setEditPlayerOne] = useState('');
  const [editPlayerTwo, setEditPlayerTwo] = useState('');
  const [editContact, setEditContact] = useState('');
  const [courtNames, setCourtNames] = useState<Record<string, string>>(() => Object.fromEntries(event.courts.map((court) => [court.id, court.name])));
  const [conflictSnapshot, setConflictSnapshot] = useState<OwnerSnapshotV2 | null>(null);
  const publishPendingRef = useRef<ReturnType<typeof sealPendingAmericanoRequest> | null>(null);
  const startPendingRef = useRef<ReturnType<typeof sealPendingAmericanoRequest> | null>(null);
  const [metadata, setMetadataState] = useState(() => ({
    title: event.name,
    venue: event.venue ?? '',
    startsAt: '',
    endsAt: '',
    details: '',
    prizes: '',
    organizerName: '',
    publicContactMethod: '' as '' | 'whatsapp' | 'email',
    publicContactValue: '',
  }));

  function setMetadata(next: typeof metadata | ((current: typeof metadata) => typeof metadata)) {
    metadataDirtyRef.current = true;
    setMetadataState(next);
  }

  function acceptSignup(next: SignupSnapshotV3 | null, resetMetadata = false) {
    const previous = signupSnapshotRef.current;
    if (next && previous?.id === next.id && (
      BigInt(next.capacityRevision ?? '0') < BigInt(previous.capacityRevision ?? '0')
      || BigInt(next.rosterRevision ?? '0') < BigInt(previous.rosterRevision ?? '0')
    )) return;
    signupSnapshotRef.current = next;
    setSignup(next);
    setSignupReadFailed(false);
    if (next && (!metadataDirtyRef.current || resetMetadata)) {
      metadataDirtyRef.current = false;
      setMetadataState({
        title: next.title, venue: next.venue,
        startsAt: dateTimeLocal(next.startsAt), endsAt: dateTimeLocal(next.endsAt),
        details: next.details, prizes: next.prizes, organizerName: next.organizerName,
        publicContactMethod: next.publicContactMethod ?? '', publicContactValue: next.publicContactValue,
      });
    }
  }

  const signupReady = !event.settings.publishedSignupId
    || (signup?.id === event.settings.publishedSignupId && !signupReadFailed);

  useEffect(() => {
    signupEpochRef.current += 1;
    signupSnapshotRef.current = null;
    metadataDirtyRef.current = false;
    setSignup(null);
    setSignupReadFailed(false);
    setMetadataState({ title: event.name, venue: event.venue ?? '', startsAt: '', endsAt: '',
      details: '', prizes: '', organizerName: '', publicContactMethod: '', publicContactValue: '' });
  }, [event.id]);

  const mode = event.formatConfig.pairingMode;
  // "fixed" is a Tailwind positioning utility, not a pairing-mode CSS modifier.
  const rosterLayoutClass = mode === 'rotating' ? ' rotating' : '';
  const pointsError = isValidAmericanoPoints(Number(pointsDraft)) ? ''
    : Number(pointsDraft) > MAX_AMERICANO_POINTS ? 'This number is too large.' : 'Enter a whole number of 1 or more.';
  const entrants = eventEntrantCount(event);
  const entrantsNeeded = Math.max(0, (mode === 'rotating' ? 4 : 2) - entrants);
  const capacity = capacityFor(event);
  const schedule = event.americanoSchedule;
  const exactAvailable = mode === 'fixed' || hasExactRotatingCycle(entrants);
  const repeatedCycle = Boolean(schedule && event.formatConfig.scheduleKind === 'custom' && schedule.metrics.repeatedCompleteMatchups > 0);
  const unusedCourtSlots = schedule?.rounds.reduce((total, round) => total + round.unusedCourtIds.length, 0) ?? 0;
  const confirmed = signup?.registrations.filter((registration) => registration.status === 'confirmed') ?? [];
  const waiting = signup?.registrations.filter((registration) => registration.status === 'waitlisted') ?? [];
  const looking = signup?.registrations.filter((registration) => registration.status === 'looking') ?? [];

  useEffect(() => {
    setPointsDraft(String(event.formatConfig.pointsPerMatch));
  }, [event.id, event.formatConfig.pointsPerMatch]);

  useEffect(() => {
    void readPrivateEntryDrafts(event.id).then(setContacts).catch(() => setMessage('Private contact drafts could not be loaded on this device.'));
  }, [event.id]);

  useEffect(() => {
    if (!auth.user) return;
    const pending = readPendingAmericanoRequests()
      .filter((row) => row.ownerId === auth.user!.id && row.eventId === event.id);
    publishPendingRef.current = pending.find((row) => row.operation === 'publish-signup-v3') ?? null;
    startPendingRef.current = pending.find((row) => row.operation === 'start-americano-v2') ?? null;
  }, [auth.user, event.id]);

  useEffect(() => {
    setCourtNames(Object.fromEntries(event.courts.map((court) => [court.id, court.name])));
  }, [event.courts]);

  useEffect(() => {
    const signupId = event.settings.publishedSignupId;
    if (!signupId || !auth.user) {
      setSignup(null);
      signupSnapshotRef.current = null;
      retrySignupRef.current = null;
      return;
    }
    let cancelled = false;
    const refresh = async () => {
      const epoch = signupEpochRef.current;
      try {
        const next = await getOrganizerSignupV3(signupId);
        if (!cancelled && epoch === signupEpochRef.current) {
          acceptSignup(next);
        }
      } catch (error) {
        if (!cancelled && epoch === signupEpochRef.current) {
          setSignupReadFailed(true);
          setMessage((error as Error).message);
        }
      }
    };
    retrySignupRef.current = refresh;
    void refresh();
    const timer = window.setInterval(() => void refresh(), 8_000);
    return () => { cancelled = true; retrySignupRef.current = null; window.clearInterval(timer); };
  }, [auth.user, event.id, event.settings.publishedSignupId]);

  function commitLocal(next: AmericanoEventStateV2) {
    loadEvent(next);
    setMessage('');
  }

  function handleError(error: unknown) {
    if (error instanceof OwnerConflictError) setConflictSnapshot(error.snapshot);
    setMessage(error instanceof Error ? error.message : String(error));
  }

  function downloadLocalDraft() {
    const blob = new Blob([JSON.stringify(event, null, 2)], { type: 'application/json' });
    const href = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = href;
    anchor.download = `${event.name.trim().replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '').toLowerCase() || 'americano'}-conflict-draft.json`;
    anchor.click();
    URL.revokeObjectURL(href);
  }

  async function applyOwner(reply: OwnerReplyV2) {
    const snapshot = replySnapshot(reply);
    signupEpochRef.current += 1;
    await saveEventToLocalCatalog(snapshot.event, {
      updatedAt: Number.isFinite(Date.parse(snapshot.updatedAt))
        ? Date.parse(snapshot.updatedAt)
        : Date.now(),
      makeActive: true,
    });
    applyExternalEventToActiveFacade(snapshot.event);
    acceptSignup(snapshot.signup);
    return snapshot;
  }

  async function reloadConflict() {
    if (!conflictSnapshot) return;
    setBusy(true);
    signupEpochRef.current += 1;
    try {
      await saveEventToLocalCatalog(conflictSnapshot.event.state, {
        updatedAt: Date.parse(conflictSnapshot.event.updatedAt), makeActive: true,
      });
      applyExternalEventToActiveFacade(conflictSnapshot.event.state);
      acceptSignup(conflictSnapshot.signup, true);
      setConflictSnapshot(null);
      setMessage('Latest server version loaded.');
    } catch (error) { handleError(error); }
    finally { setBusy(false); }
  }

  async function configurePublished(next: AmericanoEventStateV2) {
    if (!signupReady) return;
    if (!signup) return commitLocal(next);
    setBusy(true);
    try {
      await applyOwner(await saveAmericanoConfigV2({
        eventId: event.id,
        baseEventRevision: event.revision,
        signupEventId: signup.id,
        baseCapacityRevision: signup.capacityRevision,
        baseRosterRevision: signup.rosterRevision,
        courts: next.courts,
        config: next.formatConfig,
      }));
    } catch (error) {
      handleError(error);
    } finally { setBusy(false); }
  }

  async function addEntry(acknowledgePossibleDuplicate = false) {
    setMessage('');
    try {
      if (signup) {
        setBusy(true);
        const reply = await mutateAmericanoSignupEntry({
          eventId: event.id,
          baseEventRevision: event.revision,
          signupEventId: signup.id,
          baseCapacityRevision: signup.capacityRevision!,
          baseRosterRevision: signup.rosterRevision!,
          command: {
            type: 'add', acknowledgePossibleDuplicate,
            entry: mode === 'rotating'
              ? { playerOne: playerOne.trim(), contact: contact.trim() }
              : { teamName: teamName.trim(), playerOne: playerOne.trim(), playerTwo: playerTwo.trim(), contact: contact.trim() },
          },
        });
        if (reply.status === 'rejected' && reply.code === 'POSSIBLE_DUPLICATE' && !acknowledgePossibleDuplicate) {
          setDuplicatePending(true);
          setMessage('This looks similar to an existing entry. Check the details, or choose Add anyway to keep it as a separate person/team.');
          return;
        }
        await applyOwner(reply);
      } else if (mode === 'rotating') {
        const next = addAmericanoParticipant(event, playerOne);
        const id = next.participants.at(-1)!.id;
        await savePrivateEntryDraft(event.id, id, contact);
        setContacts((current) => ({ ...current, [id]: contact.trim() }));
        commitLocal(next);
      } else {
        const next = addAmericanoFixedTeam(event, { teamName, playerOne, playerTwo });
        const id = next.teams.at(-1)!.id;
        await savePrivateEntryDraft(event.id, id, contact);
        setContacts((current) => ({ ...current, [id]: contact.trim() }));
        commitLocal(next);
      }
      setDuplicatePending(false);
      setTeamName(''); setPlayerOne(''); setPlayerTwo(''); setContact('');
    } catch (error) {
      handleError(error);
    } finally { setBusy(false); }
  }

  async function removeEntry(id: string) {
    setMessage('');
    try {
      if (signup) {
        const registrationId = id.startsWith('registration:') ? id.slice('registration:'.length) : id;
        const registration = signup.registrations.find((candidate) => candidate.id === registrationId);
        if (!registration) throw new Error('Refresh this registration before removing it.');
        setBusy(true);
        await applyOwner(await mutateAmericanoSignupEntry({
          eventId: event.id, baseEventRevision: event.revision, signupEventId: signup.id,
          baseCapacityRevision: signup.capacityRevision!, baseRosterRevision: signup.rosterRevision!,
          command: { type: 'delete', registrationId: id, expectedStatus: registration.status, expectedUpdatedAt: registration.updatedAt },
        }));
      } else {
        commitLocal(mode === 'rotating' ? removeAmericanoParticipant(event, id) : removeAmericanoFixedTeam(event, id));
        await deletePrivateEntryDraft(event.id, id);
      }
    } catch (error) { handleError(error); }
    finally { setBusy(false); }
  }

  function moveEntry(id: string, delta: number) {
    if (signup) {
      void movePublishedEntry(id, delta);
      return;
    }
    const ids = mode === 'rotating' ? event.participants.map((entry) => entry.id) : event.teams.map((entry) => entry.id);
    const index = ids.indexOf(id);
    const target = index + delta;
    if (index < 0 || target < 0 || target >= ids.length) return;
    [ids[index], ids[target]] = [ids[target], ids[index]];
    commitLocal(mode === 'rotating' ? reorderAmericanoParticipants(event, ids) : reorderAmericanoFixedTeams(event, ids));
  }

  async function movePublishedEntry(id: string, delta: number) {
    const registrationId = id.startsWith('registration:') ? id.slice('registration:'.length) : id;
    const queue = signup!.registrations
      .filter((row) => mode === 'rotating' ? row.status !== 'cancelled' : row.status !== 'cancelled' && row.status !== 'looking')
      .sort((left, right) => (left.organizerRank ?? Number.MAX_SAFE_INTEGER) - (right.organizerRank ?? Number.MAX_SAFE_INTEGER));
    const index = queue.findIndex((row) => row.id === registrationId);
    const target = index + delta;
    if (index < 0 || target < 0 || target >= queue.length) return;
    const ids = queue.map((row) => row.id);
    [ids[index], ids[target]] = [ids[target], ids[index]];
    setBusy(true); setMessage('');
    try {
      await applyOwner(await mutateAmericanoSignupEntry({
        eventId: event.id, baseEventRevision: event.revision, signupEventId: signup!.id,
        baseCapacityRevision: signup!.capacityRevision!, baseRosterRevision: signup!.rosterRevision!,
        command: { type: 'reorder', registrationIds: ids },
      }));
    } catch (error) { handleError(error); }
    finally { setBusy(false); }
  }

  function beginEdit(id: string) {
    const registrationId = id.startsWith('registration:') ? id.slice('registration:'.length) : id;
    const registration = signup?.registrations.find((row) => row.id === registrationId);
    if (registration) {
      setEditTeamName(registration.teamName);
      setEditPlayerOne(registration.playerOne);
      setEditPlayerTwo(registration.playerTwo ?? '');
      setEditContact(registration.contact ?? '');
    } else if (mode === 'rotating') {
      const participant = event.participants.find((row) => row.id === id)!;
      setEditPlayerOne(participant.name); setEditTeamName(''); setEditPlayerTwo(''); setEditContact(contacts[id] ?? '');
    } else {
      const team = event.teams.find((row) => row.id === id)!;
      setEditTeamName(team.name ?? ''); setEditPlayerOne(team.players[0].name); setEditPlayerTwo(team.players[1].name); setEditContact(contacts[id] ?? '');
    }
    setEditingId(id);
  }

  async function saveEdit() {
    if (!editingId) return;
    setBusy(true); setMessage('');
    try {
      const registrationId = editingId.startsWith('registration:') ? editingId.slice('registration:'.length) : editingId;
      const registration = signup?.registrations.find((row) => row.id === registrationId);
      if (signup && registration) {
        const entry = mode === 'rotating'
          ? { playerOne: editPlayerOne.trim(), contact: editContact.trim() }
          : { teamName: editTeamName.trim(), playerOne: editPlayerOne.trim(), playerTwo: editPlayerTwo.trim(), contact: editContact.trim() };
        const reply = event.status === 'setup'
          ? await mutateAmericanoSignupEntry({
            eventId: event.id, baseEventRevision: event.revision, signupEventId: signup.id,
            baseCapacityRevision: signup.capacityRevision!, baseRosterRevision: signup.rosterRevision!,
            command: { type: 'edit', registrationId, expectedStatus: registration.status, expectedUpdatedAt: registration.updatedAt, entry },
          })
          : await correctAmericanoSignupLabels({
            eventId: event.id, baseEventRevision: event.revision, signupEventId: signup.id,
            baseCapacityRevision: signup.capacityRevision!, baseRosterRevision: signup.rosterRevision!,
            registrationId, expectedUpdatedAt: registration.updatedAt, labels: entry,
          });
        await applyOwner(reply);
      } else {
        const next = mode === 'rotating'
          ? updateAmericanoParticipant(event, editingId, editPlayerOne)
          : updateAmericanoFixedTeam(event, editingId, { teamName: editTeamName, playerOne: editPlayerOne, playerTwo: editPlayerTwo });
        await savePrivateEntryDraft(event.id, editingId, editContact);
        setContacts((current) => ({ ...current, [editingId]: editContact.trim() }));
        commitLocal(next);
      }
      setEditingId(null);
    } catch (error) { handleError(error); }
    finally { setBusy(false); }
  }

  async function setSignupOpen(isOpen: boolean) {
    if (!signup) return;
    setBusy(true); setMessage('');
    try {
      await applyOwner(await setAmericanoSignupOpen({
        eventId: event.id, baseEventRevision: event.revision, signupEventId: signup.id,
        baseCapacityRevision: signup.capacityRevision!, isOpen,
      }));
      setMessage(isOpen ? 'Registrations opened.' : 'Registrations closed.');
    } catch (error) { handleError(error); }
    finally { setBusy(false); }
  }

  async function cancelSignup() {
    if (!signup) return;
    setBusy(true); setMessage('');
    try {
      await applyOwner(await cancelAmericanoSignup({
        eventId: event.id, baseEventRevision: event.revision, signupEventId: signup.id,
        baseCapacityRevision: signup.capacityRevision!, message: 'This event has been cancelled by the organiser.',
      }));
      setMessage('Event cancelled. The public page remains available with the cancellation notice.');
    } catch (error) { handleError(error); }
    finally { setBusy(false); setConfirmCancel(false); }
  }

  async function deleteEvent() {
    setBusy(true); setMessage('');
    try {
      if (event.revision !== '0') await deleteCloudEvent(event.id);
      await deleteLocalEvent(event.id);
      navigate('/home');
    } catch (error) { handleError(error); }
    finally { setBusy(false); setConfirmDelete(false); }
  }

  async function createPreview(options: { uneven?: boolean; repeat?: boolean; reshuffle?: boolean } = {}) {
    if (!signupReady) return;
    if (pointsError) { pointsInputRef.current?.focus(); return; }
    setBusy(true); setMessage('');
    try {
      const next = await previewAmericanoSchedule(event, {
        seed: schedule?.seed,
        reshuffle: options.reshuffle,
        acknowledgeUnevenAppearances: options.uneven ?? schedule?.acknowledgements.unevenAppearances,
        acknowledgeRepeatedCycle: options.repeat ?? schedule?.acknowledgements.repeatedCycle,
        rosterRevision: signup?.rosterRevision,
      });
      commitLocal(next);
      return true;
    } catch (error) { handleError(error); }
    finally { setBusy(false); }
  }

  async function reviewAndStart() {
    if (!signupReady) return;
    if (pointsError) { pointsInputRef.current?.focus(); return; }
    if (!schedule && !await createPreview()) return;
    previewSectionRef.current?.scrollIntoView({ block: 'start' });
    previewSectionRef.current?.focus({ preventScroll: true });
  }

  async function publish() {
    if (!signupReady) return;
    if (pointsError) { pointsInputRef.current?.focus(); return; }
    if (!auth.user) { setAuthOpen(true); return; }
    setBusy(true); setMessage('');
    try {
      let base = event;
      if (event.revision === '0') {
        const saved = replySnapshot(await saveAmericanoEventV2(event, '0'));
        base = saved.event;
        applyExternalEventToActiveFacade(base);
      }
      const privateContacts = await readPrivateEntryDrafts(event.id);
      const entries = mode === 'rotating'
        ? base.participants.filter((entry) => entry.active).map((entry, index) => ({
          localEntrantId: entry.id, playerOne: entry.name, contact: privateContacts[entry.id] ?? '', rank: index + 1,
        }))
        : base.teams.filter((team) => team.active).map((team, index) => ({
          localEntrantId: team.id, teamName: team.name ?? '', playerOne: team.players[0].name,
          playerTwo: team.players[1].name, contact: privateContacts[team.id] ?? '', rank: index + 1,
        }));
      const computedInput: Omit<Parameters<typeof publishAmericanoSignupV3>[0], 'requestId'> = {
        eventId: base.id, baseEventRevision: base.revision,
        signupEventId: signup?.id, baseCapacityRevision: signup?.capacityRevision,
        baseRosterRevision: signup?.rosterRevision,
        metadata: {
          accountSlug: signup?.accountSlug ?? defaultSignupAccountSlug(auth.user.email, auth.user.id),
          title: metadata.title.trim() || base.name,
          venue: metadata.venue.trim(), startsAt: localToIso(metadata.startsAt), endsAt: localToIso(metadata.endsAt),
          details: metadata.details.trim(), prizes: metadata.prizes.trim(), timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
          organizerName: metadata.organizerName.trim(), publicContactMethod: metadata.publicContactMethod || null,
          publicContactValue: metadata.publicContactValue.trim(),
        },
        initialEntries: signup ? [] : entries,
      };
      const pending = publishPendingRef.current ?? sealPendingAmericanoRequest({
        ownerId: auth.user.id,
        eventId: base.id,
        baseRevision: base.revision,
        requestId: crypto.randomUUID(),
        operation: 'publish-signup-v3',
        payload: computedInput as Record<string, unknown>,
      });
      publishPendingRef.current = pending;
      let responseReceived = false;
      let snapshot: Awaited<ReturnType<typeof applyOwner>>;
      try {
        const response = await publishAmericanoSignupV3({
          ...(pending.payload as unknown as Omit<Parameters<typeof publishAmericanoSignupV3>[0], 'requestId'>),
          requestId: pending.requestId,
        });
        responseReceived = true;
        snapshot = await applyOwner(response);
      } finally {
        if (responseReceived) {
          clearPendingAmericanoRequest(pending.ownerId, pending.eventId, pending.requestId);
          publishPendingRef.current = null;
        }
      }
      if (!signup && snapshot.signup) {
        await deletePrivateEntryDraftsForEvent(event.id);
        setContacts({});
      }
      acceptSignup(snapshot.signup, true);
      setMessage(signup ? 'Sign-up page updated.' : 'Sign-up page published.');
    } catch (error) { handleError(error); }
    finally { setBusy(false); }
  }

  async function start() {
    if (!signupReady) return;
    if (pointsError) { pointsInputRef.current?.focus(); return; }
    setBusy(true); setMessage('');
    try {
      const startState = startAmericanoEvent(event);
      if (event.revision !== '0') {
        if (!auth.user) throw new Error('Sign in before starting this cloud-saved event.');
        const computedInput: Omit<Parameters<typeof startAmericanoV2>[0], 'requestId'> = {
          eventId: event.id, baseEventRevision: event.revision, signupEventId: signup?.id,
          baseCapacityRevision: signup?.capacityRevision, baseRosterRevision: signup?.rosterRevision,
          startState,
        };
        const pending = startPendingRef.current ?? sealPendingAmericanoRequest({
          ownerId: auth.user.id,
          eventId: event.id,
          baseRevision: event.revision,
          requestId: crypto.randomUUID(),
          operation: 'start-americano-v2',
          payload: computedInput as Record<string, unknown>,
        });
        startPendingRef.current = pending;
        let responseReceived = false;
        let snapshot: Awaited<ReturnType<typeof applyOwner>>;
        try {
          const response = await startAmericanoV2({
            ...(pending.payload as unknown as Omit<Parameters<typeof startAmericanoV2>[0], 'requestId'>),
            requestId: pending.requestId,
          });
          responseReceived = true;
          snapshot = await applyOwner(response);
        } finally {
          if (responseReceived) {
            clearPendingAmericanoRequest(pending.ownerId, pending.eventId, pending.requestId);
            startPendingRef.current = null;
          }
        }
        navigate(eventRoute(snapshot.event.id, 'display'));
      } else {
        commitLocal(startState);
        navigate(eventRoute(event.id, 'display'));
      }
    } catch (error) { handleError(error); }
    finally { setBusy(false); }
  }

  function requestModeChange(nextMode: PairingMode) {
    if (nextMode === mode) return;
    try {
      commitLocal(updateAmericanoConfig(event, { pairingMode: nextMode }));
    } catch {
      setConfirmCopy(nextMode);
    }
  }

  const localRows = mode === 'rotating' ? event.participants : event.teams;

  return (
    <div className="americano-setup">
      <header className="americano-setup-hero">
        <div><span className="eyebrow">AMERICANO SETUP</span><h1>{event.name}</h1><p>{mode === 'rotating' ? 'Change partners each round. Points belong to each player.' : 'Keep your partner. Points belong to your team.'}</p></div>
        <div className="americano-mode-switch" role="group" aria-label="Americano pairing mode">
          <button type="button" className={mode === 'rotating' ? 'active' : ''} onClick={() => requestModeChange('rotating')}>Rotating pairs</button>
          <button type="button" className={mode === 'fixed' ? 'active' : ''} onClick={() => requestModeChange('fixed')}>Fixed pairs</button>
        </div>
      </header>

      {!signupReady && <div className="signup-message error" role="alert">
        Load the published signup before changing this event or starting play.
        <button className="btn" onClick={() => auth.user ? void retrySignupRef.current?.() : setAuthOpen(true)}>{auth.user ? 'Retry signup' : 'Sign in'}</button>
      </div>}
      <fieldset disabled={busy || !signupReady} style={{ border: 0, padding: 0, margin: 0, minWidth: 0 }}>
      <div className="americano-setup-columns">
      <div className="americano-setup-settings">
        <div className="setup-panel americano-config-card">
          <h2>Rules & schedule</h2>
          <div className="americano-fields two">
            <label><span>Points per match</span><input ref={pointsInputRef} type="number" inputMode="numeric" min={1} max={MAX_AMERICANO_POINTS} step={1} value={pointsDraft} disabled={busy || event.status !== 'setup'} aria-invalid={Boolean(pointsError)} aria-describedby={pointsError ? 'americano-points-error' : undefined} onChange={(e) => {
              setPointsDraft(e.target.value);
              const points = Number(e.target.value);
              if (!signup && isValidAmericanoPoints(points)) commitLocal(updateAmericanoConfig(event, { pointsPerMatch: points }));
            }} onBlur={() => {
              const points = Number(pointsDraft);
              if (signup && isValidAmericanoPoints(points) && points !== event.formatConfig.pointsPerMatch) void configurePublished(updateAmericanoConfig(event, { pointsPerMatch: points }));
            }} />{pointsError && <small id="americano-points-error" className="americano-points-error" role="alert">{pointsError}</small>}</label>
            <label><span>Schedule</span><select value={event.formatConfig.scheduleKind} disabled={busy || event.status !== 'setup'} onChange={(e) => void configurePublished(updateAmericanoConfig(event, { scheduleKind: e.target.value as 'full' | 'balanced' | 'custom' }))}><option value="full">Full rotation</option>{mode === 'rotating' && <option value="balanced">Balanced</option>}<option value="custom">Custom rounds</option></select></label>
            {event.formatConfig.scheduleKind === 'custom' && <label><span>Rounds (1–64)</span><input type="number" min={1} max={64} value={event.formatConfig.customRounds ?? 1} onChange={(e) => void configurePublished(updateAmericanoConfig(event, { customRounds: Math.max(1, Math.min(64, Number(e.target.value))) }))} /></label>}
            <label><span>Estimated pace</span><select value={event.formatConfig.paceMinutes} disabled={busy || event.status !== 'setup'} onChange={(e) => void configurePublished(updateAmericanoConfig(event, { paceMinutes: Number(e.target.value) as 5 | 10 | 15 | 20 | 25 | 30 }))}>{PACE_OPTIONS.map((value) => <option key={value} value={value}>{value} minutes</option>)}</select></label>
          </div>
          <label className="americano-check"><input type="checkbox" checked={event.formatConfig.paceClockEnabled} disabled={busy || event.status !== 'setup'} onChange={(e) => void configurePublished(updateAmericanoConfig(event, { paceClockEnabled: e.target.checked }))} /><span><strong>Show advisory pace clock</strong><small>It never ends a match or forces a result.</small></span></label>
          {!exactAvailable && event.formatConfig.scheduleKind === 'full' && <div className="signup-message error">A complete once-with-every-partner rotation is not available for this player count. Use a balanced schedule.</div>}
        </div>

        <div className="setup-panel americano-courts-card">
          <div className="americano-card-head"><div><h2>Courts</h2><p>{capacity} confirmed {mode === 'rotating' ? 'players' : 'teams'} maximum</p></div><button className="btn" type="button" disabled={busy || event.status !== 'setup' || event.courts.length >= 16} onClick={() => void configurePublished(replaceAmericanoCourts(event, [...event.courts, { id: newId(), position: event.courts.length + 1, name: `Court ${event.courts.length + 1}`, pointValue: 1 }]))}>+ Add court</button></div>
          <div className="americano-court-list">{event.courts.map((court, index) => <div key={court.id}><span>{index + 1}</span><input value={courtNames[court.id] ?? court.name} disabled={busy || event.status !== 'setup'} onChange={(e) => setCourtNames((current) => ({ ...current, [court.id]: e.target.value }))} onBlur={() => { const nextName = (courtNames[court.id] ?? court.name).trim() || `Court ${index + 1}`; if (nextName !== court.name) void configurePublished(replaceAmericanoCourts(event, event.courts.map((item) => item.id === court.id ? { ...item, name: nextName } : item))); }} /><button className="icon-button" aria-label={`Remove ${court.name}`} disabled={busy || event.status !== 'setup' || event.courts.length <= 1} onClick={() => void configurePublished(replaceAmericanoCourts(event, event.courts.filter((item) => item.id !== court.id)))}><Icons.Trash className="icon" /></button></div>)}</div>
        </div>
      </div>

      <div className="americano-setup-roster">
      <section className="setup-panel americano-roster-card">
        <div className="americano-card-head"><div><h2>{mode === 'rotating' ? 'Players' : 'Teams'}</h2><p>{entrants}/{capacity} confirmed. Overflow entries wait automatically after publishing.</p></div></div>
        <div className={'americano-add-row' + rosterLayoutClass}>
          {mode === 'fixed' && <input placeholder="Team name (optional)" value={teamName} onChange={(e) => setTeamName(e.target.value)} />}
          <input placeholder={mode === 'rotating' ? 'Player name' : 'Player one'} value={playerOne} onChange={(e) => setPlayerOne(e.target.value)} />
          {mode === 'fixed' && <input placeholder="Player two" value={playerTwo} onChange={(e) => setPlayerTwo(e.target.value)} />}
          <input placeholder="WhatsApp or phone (private)" value={contact} onChange={(e) => setContact(e.target.value)} />
          <button className="btn primary" disabled={busy || event.status !== 'setup'} onClick={() => void addEntry()}>Add</button>
        </div>
        {duplicatePending && <button className="btn warning" disabled={busy} onClick={() => void addEntry(true)}>Add anyway as a separate entry</button>}
        <div className="americano-roster-list">
          {localRows.map((entry, index) => {
            const team = mode === 'fixed' ? entry as Team : null;
            const participant = mode === 'rotating' ? entry as AmericanoEventStateV2['participants'][number] : null;
            const registrationId = entry.id.startsWith('registration:') ? entry.id.slice('registration:'.length) : entry.id;
            const registration = signup?.registrations.find((row) => row.id === registrationId);
            return <div className={'americano-roster-row ' + (editingId === entry.id ? 'editing' : '')} key={entry.id}>
              <span className="position">{index + 1}</span>
              {editingId === entry.id ? <div className={'americano-edit-fields' + rosterLayoutClass}>
                {mode === 'fixed' && <input aria-label="Edit team name" placeholder="Team name (optional)" value={editTeamName} onChange={(e) => setEditTeamName(e.target.value)} />}
                <input aria-label="Edit player one" value={editPlayerOne} onChange={(e) => setEditPlayerOne(e.target.value)} />
                {mode === 'fixed' && <input aria-label="Edit player two" value={editPlayerTwo} onChange={(e) => setEditPlayerTwo(e.target.value)} />}
                <input aria-label="Edit private contact" placeholder="Private contact" value={editContact} onChange={(e) => setEditContact(e.target.value)} />
              </div> : <div className="labels"><strong>{team ? team.name || `${team.players[0].name} & ${team.players[1].name}` : participant!.name}</strong>{team && team.name && <small>{team.players[0].name} & {team.players[1].name}</small>}<small>{registration?.contact || contacts[entry.id] ? 'Private contact saved' : 'No private contact saved'}</small></div>}
              <div className="americano-row-actions">{editingId === entry.id ? <><button className="btn" disabled={busy} onClick={() => void saveEdit()}>Save</button><button className="btn" disabled={busy} onClick={() => setEditingId(null)}>Cancel</button></> : <><button className="icon-button" aria-label="Move up" disabled={busy || index === 0 || event.status !== 'setup'} onClick={() => moveEntry(entry.id, -1)}>↑</button><button className="icon-button" aria-label="Move down" disabled={busy || (index === localRows.length - 1 && !waiting.length) || event.status !== 'setup'} onClick={() => moveEntry(entry.id, 1)}>↓</button><button className="icon-button" aria-label="Edit" disabled={busy} onClick={() => beginEdit(entry.id)}><Icons.Edit className="icon" /></button><button className="icon-button danger" aria-label="Delete" disabled={busy || event.status !== 'setup'} onClick={() => void removeEntry(entry.id)}><Icons.Trash className="icon" /></button></>}</div>
            </div>;
          })}
          {localRows.length === 0 && <div className="signup-public-empty">Add {mode === 'rotating' ? 'at least four players' : 'at least two complete teams'} to begin.</div>}
        </div>
        <div className="americano-start-actions">
          <button type="button" className="btn primary lg full" disabled={busy || entrantsNeeded > 0 || event.status !== 'setup'} aria-describedby="americano-start-help" onClick={() => void reviewAndStart()}>Review &amp; start event</button>
          <p id="americano-start-help">{entrantsNeeded > 0
            ? `Add ${entrantsNeeded} more ${mode === 'rotating' ? (entrantsNeeded === 1 ? 'player' : 'players') : (entrantsNeeded === 1 ? 'complete team' : 'complete teams')} to review and start.`
            : 'Review the schedule first, then confirm Start event to begin Round 1.'}</p>
        </div>
        {signup && (looking.length > 0 || waiting.length > 0) && <div className="americano-secondary-roster">
          {looking.length > 0 && <div><h3>Looking for a partner · {looking.length}</h3>{looking.map((row) => <div className="americano-wait-row" key={row.id}><span><strong>{row.playerOne}</strong><small>{row.contact}</small></span><div className="americano-row-actions"><button className="icon-button" aria-label={`Edit ${row.playerOne}`} disabled={busy} onClick={() => beginEdit(row.id)}><Icons.Edit className="icon" /></button><button className="icon-button danger" aria-label={`Delete ${row.playerOne}`} disabled={busy || event.status !== 'setup'} onClick={() => void removeEntry(row.id)}><Icons.Trash className="icon" /></button></div></div>)}</div>}
          {waiting.length > 0 && <div><h3>Waiting list · {waiting.length}</h3>{waiting.map((row, index) => <div className="americano-wait-row" key={row.id}><span><strong>{index + 1}. {mode === 'rotating' ? row.playerOne : row.teamName || `${row.playerOne} & ${row.playerTwo}`}</strong><small>{row.contact}</small></span><div className="americano-row-actions"><button className="icon-button" aria-label="Move waiting entry up" disabled={busy || event.status !== 'setup'} onClick={() => void movePublishedEntry(row.id, -1)}>↑</button><button className="icon-button" aria-label="Move waiting entry down" disabled={busy || event.status !== 'setup' || index === waiting.length - 1} onClick={() => void movePublishedEntry(row.id, 1)}>↓</button><button className="icon-button" aria-label="Edit waiting entry" disabled={busy} onClick={() => beginEdit(row.id)}><Icons.Edit className="icon" /></button><button className="icon-button danger" aria-label="Delete waiting entry" disabled={busy || event.status !== 'setup'} onClick={() => void removeEntry(row.id)}><Icons.Trash className="icon" /></button></div></div>)}</div>}
        </div>}
        {editingId && !localRows.some((row) => row.id === editingId) && <div className="americano-secondary-editor">
          <h3>Edit registration</h3>
          <div className={'americano-edit-fields' + rosterLayoutClass}>
            {mode === 'fixed' && <input aria-label="Edit team name" placeholder="Team name (optional)" value={editTeamName} onChange={(e) => setEditTeamName(e.target.value)} />}
            <input aria-label="Edit player one" value={editPlayerOne} onChange={(e) => setEditPlayerOne(e.target.value)} />
            {mode === 'fixed' && <input aria-label="Edit player two" value={editPlayerTwo} onChange={(e) => setEditPlayerTwo(e.target.value)} />}
            <input aria-label="Edit private contact" placeholder="Private contact" value={editContact} onChange={(e) => setEditContact(e.target.value)} />
          </div>
          <div className="button-row"><button className="btn primary" disabled={busy} onClick={() => void saveEdit()}>Save changes</button><button className="btn" disabled={busy} onClick={() => setEditingId(null)}>Cancel</button></div>
        </div>}
      </section>

      <section className="setup-panel americano-signup-card">
        <div className="americano-card-head"><div><h2>Public sign-up</h2><p>One canonical roster. Public contact details stay private to the organiser.</p></div>{signup && <button className="btn" onClick={() => navigator.clipboard.writeText(buildSignupUrl(signup.eventSlug, signup.accountSlug))}>Copy link</button>}</div>
        <div className="americano-fields two">
          <label><span>Event title</span><input value={metadata.title} onChange={(e) => setMetadata((value) => ({ ...value, title: e.target.value }))} /></label>
          <label><span>Venue</span><input value={metadata.venue} onChange={(e) => setMetadata((value) => ({ ...value, venue: e.target.value }))} /></label>
          <label><span>Starts</span><input type="datetime-local" value={metadata.startsAt} onChange={(e) => setMetadata((value) => ({ ...value, startsAt: e.target.value }))} /></label>
          <label><span>Ends</span><input type="datetime-local" value={metadata.endsAt} onChange={(e) => setMetadata((value) => ({ ...value, endsAt: e.target.value }))} /></label>
          <label><span>Organiser name</span><input value={metadata.organizerName} onChange={(e) => setMetadata((value) => ({ ...value, organizerName: e.target.value }))} /></label>
          <label><span>Public contact</span><div className="americano-inline-fields"><select value={metadata.publicContactMethod} onChange={(e) => setMetadata((value) => ({ ...value, publicContactMethod: e.target.value as typeof value.publicContactMethod }))}><option value="">None</option><option value="whatsapp">WhatsApp</option><option value="email">Email</option></select><input value={metadata.publicContactValue} onChange={(e) => setMetadata((value) => ({ ...value, publicContactValue: e.target.value }))} /></div></label>
          <label className="wide"><span>Details</span><textarea value={metadata.details} onChange={(e) => setMetadata((value) => ({ ...value, details: e.target.value }))} /></label>
          <label className="wide"><span>Prizes & extras</span><textarea value={metadata.prizes} onChange={(e) => setMetadata((value) => ({ ...value, prizes: e.target.value }))} /></label>
        </div>
        <div className="button-row"><button className="btn primary" disabled={busy} onClick={() => void publish()}>{signup ? 'Update sign-up page' : 'Publish sign-up page'}</button>{signup && <button className="btn" disabled={busy || Boolean(signup.cancelledAt)} onClick={() => void setSignupOpen(!signup.isOpen)}>{signup.isOpen ? 'Close registrations' : 'Open registrations'}</button>}{signup && <button className="btn" disabled={busy} onClick={() => setShareOpen(true)}>Share roster</button>}{signup && <button className="btn danger" disabled={busy || Boolean(signup.cancelledAt)} onClick={() => setConfirmCancel(true)}>Cancel event</button>}<button className="btn danger" disabled={busy} onClick={() => setConfirmDelete(true)}>Delete event</button></div>
        {signup && <span className="americano-live-status">{confirmed.length}/{signup.capacity.value} confirmed · {waiting.length} waiting</span>}
      </section>

      <section ref={previewSectionRef} tabIndex={-1} aria-labelledby="americano-schedule-heading" className="setup-panel americano-preview-card">
        <div className="americano-card-head"><div><h2 id="americano-schedule-heading">Schedule preview</h2><p>Fixtures are frozen when the event starts.</p></div><div className="button-row"><button className="btn" disabled={busy || entrants < (mode === 'rotating' ? 4 : 2)} onClick={() => void createPreview({ reshuffle: Boolean(schedule) })}>{schedule ? 'Reshuffle' : 'Preview schedule'}</button></div></div>
        {schedule ? <>
          <div className="americano-preview-stats"><span><strong>{event.formatConfig.scheduleKind === 'balanced' ? 'Balanced' : event.formatConfig.scheduleKind === 'custom' ? 'Custom' : 'Full rotation'}</strong>Schedule</span><span><strong>{entrants}/{capacity}</strong>{mode === 'rotating' ? 'Players' : 'Teams'} confirmed</span><span><strong>{schedule.rounds.length}</strong>Rounds</span><span><strong>{schedule.rounds.length * event.formatConfig.paceMinutes} min</strong>Estimated duration</span><span><strong>{event.formatConfig.pointsPerMatch}</strong>Points per match</span><span><strong>{schedule.metrics.repeatedCompleteMatchups}</strong>Repeated matchups</span><span><strong>{unusedCourtSlots}</strong>Unused court slots</span></div>
          <div className="americano-coverage-list">{schedule.orderedEntrantIds.map((id) => <span key={id}><strong>{mode === 'rotating' ? event.participants.find((entry) => entry.id === id)?.name : event.teams.find((entry) => entry.id === id)?.name || id}</strong>{schedule.metrics.appearances[id]} matches · {schedule.metrics.rests[id]} rests · {schedule.metrics.uniquePartners[id]} partners · {schedule.metrics.uniqueOpponents[id]} opponents</span>)}</div>
          {schedule.metrics.maximumAppearanceSpread > 0 && <label className="americano-check warning"><input type="checkbox" checked={schedule.acknowledgements.unevenAppearances} onChange={(e) => void createPreview({ uneven: e.target.checked })} /><span><strong>Uneven number of matches</strong><small>I understand totals can favour people who play more matches.</small></span></label>}
          {repeatedCycle && <label className="americano-check warning"><input type="checkbox" checked={schedule.acknowledgements.repeatedCycle} onChange={(e) => void createPreview({ repeat: e.target.checked })} /><span><strong>Repeated schedule cycle</strong><small>I understand some partnerships or matchups repeat.</small></span></label>}
          <button className="btn primary lg full" disabled={busy} onClick={() => void start()}>Start event</button>
        </> : <div className="signup-public-empty">Choose the roster, courts and rules, then preview the complete schedule.</div>}
      </section>

      </div>
      </div>

      </fieldset>

      {message && <div className="signup-message error" role="alert">{message}</div>}
      {conflictSnapshot && <div className="setup-panel americano-conflict-card" role="alert">
        <div><strong>Another device saved a newer version.</strong><p>Your form is still on this screen. Download it before replacing it if you need a copy.</p></div>
        <div className="button-row"><button className="btn" onClick={downloadLocalDraft}>Download local draft</button><button className="btn primary" disabled={busy} onClick={() => void reloadConflict()}>Reload server version</button></div>
      </div>}
      {authOpen && <AuthModal onClose={() => setAuthOpen(false)} />}
      {shareOpen && <RosterShareModal title={signup?.title ?? event.name} text={buildRosterShareText({ event, signup, registrations: signup?.registrations })} onClose={() => setShareOpen(false)} />}
      {confirmCancel && <ConfirmDialog open title="Cancel this event?" message="The public page will remain visible with a cancellation notice. Existing roster and results are preserved." confirmLabel="Cancel event" destructive onCancel={() => setConfirmCancel(false)} onConfirm={() => void cancelSignup()} />}
      {confirmDelete && <ConfirmDialog open title="Delete this event?" message="This removes the organiser event from your account. A published public page is tombstoned so delayed saves cannot bring it back." confirmLabel="Delete event" destructive onCancel={() => setConfirmDelete(false)} onConfirm={() => void deleteEvent()} />}
      {confirmCopy && <ConfirmDialog open title="Create a new Americano?" message="Published or populated events keep their pairing mode. A fresh event will copy only the rules and court labels; this event remains unchanged." confirmLabel="Create new event" onCancel={() => setConfirmCopy(null)} onConfirm={() => { const copy = freshAmericanoCopy({ ...event, formatConfig: { ...event.formatConfig, pairingMode: confirmCopy } }); loadEvent(copy); setConfirmCopy(null); navigate(eventRoute(copy.id, 'setup')); }} />}
    </div>
  );
}
