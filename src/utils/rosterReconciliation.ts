import type { SignupRegistration } from '@/lib/signups';
import type { Team } from '@/types/domain';

/** Shape accepted by the existing event-store addTeams action. */
export interface SignupRosterTeamInput {
  name?: string;
  player1: string;
  player2: string;
  signupPairKey: string;
  signupRegistrationId: string;
}

/** A source-of-truth update for one existing local team. */
export interface SignupRosterTeamUpdate {
  teamId: string;
  signupRegistrationId: string;
  patch: {
    /** Empty string deliberately clears a previously stored team name. */
    name: string;
    player1: string;
    player2: string;
    signupPairKey: string;
    signupRegistrationId: string;
  };
}

export interface SignupRosterReconciliation {
  teamsToAdd: SignupRosterTeamInput[];
  teamUpdates: SignupRosterTeamUpdate[];
  /** Stable server order for the active setup roster. */
  orderedRegistrationIds: string[];
  /**
   * Remove these during setup, or deactivate them after play has started.
   * Once a sign-up snapshot is being reconciled, its confirmed pairs are the
   * complete source of truth for the setup roster.
   */
  importedTeamIdsToRemoveOrDeactivate: string[];
}

export interface ReconcileSignupRosterInput {
  confirmedRegistrations: SignupRegistration[];
  localTeams: Team[];
  capacity: number;
}

function clean(value: string | undefined): string {
  return value?.trim() ?? '';
}

function normalizedName(value: string | undefined): string {
  return clean(value)
    .normalize('NFKC')
    .replace(/\s+/g, ' ')
    .toLocaleLowerCase();
}

function pairKey(playerOne: string, playerTwo: string): string {
  return [playerOne, playerTwo]
    .map(normalizedName)
    .sort()
    .join('|');
}

function normalizeStoredPairKey(value: string): string {
  const names = value.split('|');
  return names.length === 2
    ? pairKey(names[0], names[1])
    : normalizedName(value);
}

function finiteOrder(value: number | null | undefined): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : Number.MAX_SAFE_INTEGER;
}

function compareRegistrations(a: SignupRegistration, b: SignupRegistration): number {
  const position = finiteOrder(a.position) - finiteOrder(b.position);
  if (position !== 0) return position;

  const rank = finiteOrder(a.organizerRank) - finiteOrder(b.organizerRank);
  if (rank !== 0) return rank;

  const completed = (a.pairCompletedAt ?? a.createdAt)
    .localeCompare(b.pairCompletedAt ?? b.createdAt);
  if (completed !== 0) return completed;

  const created = a.createdAt.localeCompare(b.createdAt);
  if (created !== 0) return created;

  const id = a.id.localeCompare(b.id);
  if (id !== 0) return id;

  // Duplicate IDs should still resolve deterministically if a malformed
  // snapshot contains conflicting payloads.
  return [a.teamName, a.playerOne, a.playerTwo]
    .map(clean)
    .join('\u0000')
    .localeCompare([b.teamName, b.playerOne, b.playerTwo].map(clean).join('\u0000'));
}

function compareTeams(a: Team, b: Team): number {
  return a.createdAt - b.createdAt || a.id.localeCompare(b.id);
}

function desiredTeam(registration: SignupRegistration): SignupRosterTeamInput {
  const player1 = clean(registration.playerOne);
  const player2 = clean(registration.playerTwo);
  return {
    name: clean(registration.teamName) || undefined,
    player1,
    player2,
    signupPairKey: pairKey(player1, player2),
    signupRegistrationId: registration.id,
  };
}

function preserveExistingPlayerOrder(
  team: Team,
  desired: SignupRosterTeamInput,
): SignupRosterTeamInput {
  const localOne = normalizedName(team.players[0].name);
  const localTwo = normalizedName(team.players[1].name);
  const desiredOne = normalizedName(desired.player1);
  const desiredTwo = normalizedName(desired.player2);
  if (localOne === desiredTwo && localTwo === desiredOne) {
    return { ...desired, player1: desired.player2, player2: desired.player1 };
  }
  return desired;
}

function needsUpdate(team: Team, desired: SignupRosterTeamInput): boolean {
  return !team.active
    || clean(team.name) !== clean(desired.name)
    || team.players[0].name !== desired.player1
    || team.players[1].name !== desired.player2
    || team.signupPairKey !== desired.signupPairKey
    || team.signupRegistrationId !== desired.signupRegistrationId;
}

/**
 * Reconcile the active local roster with a complete authoritative sign-up
 * snapshot. The helper is pure: it creates no IDs and mutates no input.
 *
 * Stable registration IDs always win. An explicit pair key comes next. A final
 * exact, normalized unordered player-pair match adopts legacy local teams that
 * predate registration IDs. That last fallback is deliberately unavailable to
 * teams carrying a stale registration ID: a strong identity must never be
 * silently rebound to a different public row.
 *
 * Capacity is the tournament's complete court capacity. It is never reduced by
 * local/manual teams. The confirmed server snapshot projects the entire setup
 * roster, while waiting pairs and solo registrations never enter it.
 */
export function reconcileConfirmedSignupRoster({
  confirmedRegistrations,
  localTeams,
  capacity,
}: ReconcileSignupRosterInput): SignupRosterReconciliation {
  const safeCapacity = Number.isFinite(capacity)
    ? Math.max(0, Math.floor(capacity))
    : 0;

  const eligible = confirmedRegistrations
    .filter((registration) =>
      registration.status === 'confirmed'
      && Boolean(clean(registration.id))
      && Boolean(clean(registration.playerOne))
      && Boolean(clean(registration.playerTwo)))
    .slice()
    .sort(compareRegistrations);

  // A malformed/duplicated fetch must never create the same public row twice.
  const seenRegistrationIds = new Set<string>();
  const uniqueRegistrations = eligible.filter((registration) => {
    if (seenRegistrationIds.has(registration.id)) return false;
    seenRegistrationIds.add(registration.id);
    return true;
  });

  const activeTeams = localTeams.filter((team) => team.active);
  const candidateTeams = localTeams.slice().sort((a, b) =>
    Number(b.active) - Number(a.active) || compareTeams(a, b));
  const desiredRegistrations = uniqueRegistrations.slice(0, safeCapacity);

  const exactCandidates = new Map<string, Team[]>();
  const explicitPairKeyCandidates = new Map<string, Team[]>();
  const legacyPlayerPairCandidates = new Map<string, Team[]>();

  for (const team of candidateTeams) {
    if (team.signupRegistrationId) {
      const candidates = exactCandidates.get(team.signupRegistrationId) ?? [];
      candidates.push(team);
      exactCandidates.set(team.signupRegistrationId, candidates);
      continue;
    }

    if (team.signupPairKey) {
      const key = normalizeStoredPairKey(team.signupPairKey);
      const candidates = explicitPairKeyCandidates.get(key) ?? [];
      candidates.push(team);
      explicitPairKeyCandidates.set(key, candidates);
    }

    const legacyKey = pairKey(team.players[0].name, team.players[1].name);
    const candidates = legacyPlayerPairCandidates.get(legacyKey) ?? [];
    candidates.push(team);
    legacyPlayerPairCandidates.set(legacyKey, candidates);
  }

  const desiredPairKeyCounts = new Map<string, number>();
  for (const registration of desiredRegistrations) {
    const key = pairKey(registration.playerOne, registration.playerTwo);
    desiredPairKeyCounts.set(key, (desiredPairKeyCounts.get(key) ?? 0) + 1);
  }

  const claimedTeamIds = new Set<string>();
  const teamsToAdd: SignupRosterTeamInput[] = [];
  const teamUpdates: SignupRosterTeamUpdate[] = [];

  for (const registration of desiredRegistrations) {
    const canonicalDesired = desiredTeam(registration);
    const exact = (exactCandidates.get(registration.id) ?? [])
      .find((team) => !claimedTeamIds.has(team.id));
    const explicitPairKey = exact
      ? undefined
      : (explicitPairKeyCandidates.get(canonicalDesired.signupPairKey) ?? [])
        .find((team) => !claimedTeamIds.has(team.id));
    // Player names are not durable identity. Use them only for a unique
    // confirmed pair, and only against local teams with no registration ID.
    const legacyPlayerPair = exact || explicitPairKey
      || desiredPairKeyCounts.get(canonicalDesired.signupPairKey) !== 1
      ? undefined
      : (legacyPlayerPairCandidates.get(canonicalDesired.signupPairKey) ?? [])
        .find((team) => !claimedTeamIds.has(team.id));
    const existing = exact ?? explicitPairKey ?? legacyPlayerPair;

    if (!existing) {
      teamsToAdd.push(canonicalDesired);
      continue;
    }

    // Team order is cosmetic but player objects carry stable ids and avatars.
    // A reversed legacy pair must not swap names across those player objects.
    const desired = preserveExistingPlayerOrder(existing, canonicalDesired);
    claimedTeamIds.add(existing.id);
    if (needsUpdate(existing, desired)) {
      teamUpdates.push({
        teamId: existing.id,
        signupRegistrationId: registration.id,
        patch: {
          name: clean(desired.name),
          player1: desired.player1,
          player2: desired.player2,
          signupPairKey: desired.signupPairKey,
          signupRegistrationId: desired.signupRegistrationId,
        },
      });
    }
  }

  // Any active team not claimed by the authoritative, capacity-limited set is
  // stale, duplicated, or overflow. Organizer-created teams are written to the
  // same server roster before this projection, so there is no second/manual
  // capacity bucket to preserve here.
  const importedTeamIdsToRemoveOrDeactivate = activeTeams
    .filter((team) => !claimedTeamIds.has(team.id))
    .slice()
    .sort(compareTeams)
    .map((team) => team.id);

  return {
    teamsToAdd,
    teamUpdates,
    orderedRegistrationIds: desiredRegistrations.map((registration) => registration.id),
    importedTeamIdsToRemoveOrDeactivate,
  };
}
