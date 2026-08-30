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
  /** Remove these during setup, or deactivate them after play has started. */
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

function pairKey(playerOne: string, playerTwo: string): string {
  return [playerOne, playerTwo]
    .map((name) => clean(name).toLocaleLowerCase())
    .sort()
    .join('|');
}

function finiteOrder(value: number | null | undefined): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : Number.MAX_SAFE_INTEGER;
}

function compareRegistrations(a: SignupRegistration, b: SignupRegistration): number {
  const position = finiteOrder(a.position) - finiteOrder(b.position);
  if (position !== 0) return position;

  const rank = finiteOrder(a.organizerRank) - finiteOrder(b.organizerRank);
  if (rank !== 0) return rank;

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

function needsUpdate(team: Team, desired: SignupRosterTeamInput): boolean {
  return clean(team.name) !== clean(desired.name)
    || team.players[0].name !== desired.player1
    || team.players[1].name !== desired.player2
    || team.signupPairKey !== desired.signupPairKey
    || team.signupRegistrationId !== desired.signupRegistrationId;
}

/**
 * Reconcile the active local roster with a complete authoritative sign-up
 * snapshot. The helper is pure: it creates no IDs and mutates no input.
 *
 * Stable registration IDs always win. Pair-key fallback is limited to legacy
 * imported teams that have an explicit signupPairKey but no registration ID.
 * Unlinked/manual teams are never edited or removed, but they consume capacity.
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
  const manualActiveCount = activeTeams.filter(
    (team) => !team.signupRegistrationId && !team.signupPairKey,
  ).length;
  const onlineCapacity = Math.max(0, safeCapacity - manualActiveCount);
  const desiredRegistrations = uniqueRegistrations.slice(0, onlineCapacity);

  const exactCandidates = new Map<string, Team[]>();
  const legacyCandidates = new Map<string, Team[]>();

  for (const team of activeTeams.slice().sort(compareTeams)) {
    if (team.signupRegistrationId) {
      const candidates = exactCandidates.get(team.signupRegistrationId) ?? [];
      candidates.push(team);
      exactCandidates.set(team.signupRegistrationId, candidates);
    } else if (team.signupPairKey) {
      const key = clean(team.signupPairKey).toLocaleLowerCase();
      const candidates = legacyCandidates.get(key) ?? [];
      candidates.push(team);
      legacyCandidates.set(key, candidates);
    }
  }

  const claimedTeamIds = new Set<string>();
  const teamsToAdd: SignupRosterTeamInput[] = [];
  const teamUpdates: SignupRosterTeamUpdate[] = [];

  for (const registration of desiredRegistrations) {
    const desired = desiredTeam(registration);
    const exact = (exactCandidates.get(registration.id) ?? [])
      .find((team) => !claimedTeamIds.has(team.id));
    const legacy = exact
      ? undefined
      : (legacyCandidates.get(desired.signupPairKey) ?? [])
        .find((team) => !claimedTeamIds.has(team.id));
    const existing = exact ?? legacy;

    if (!existing) {
      teamsToAdd.push(desired);
      continue;
    }

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

  // Any active team managed by sign-up identity that was not claimed by the
  // authoritative, capacity-limited set is stale, duplicated, or overflow.
  const importedTeamIdsToRemoveOrDeactivate = activeTeams
    .filter((team) =>
      Boolean(team.signupRegistrationId || team.signupPairKey)
      && !claimedTeamIds.has(team.id))
    .slice()
    .sort(compareTeams)
    .map((team) => team.id);

  return {
    teamsToAdd,
    teamUpdates,
    importedTeamIdsToRemoveOrDeactivate,
  };
}
