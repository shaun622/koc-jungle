import type { SignupRegistration } from '@/lib/signups';

export interface SignupRosterView {
  confirmedPairs: SignupRegistration[];
  waitlistedPairs: SignupRegistration[];
  lookingForPartner: SignupRegistration[];
  confirmedPairCount: number;
  pairSpacesLeft: number;
}

function isCompletePair(registration: SignupRegistration): boolean {
  return Boolean(registration.playerTwo.trim());
}

/**
 * Build the single public roster view from legacy registration rows.
 *
 * Older solo registrations may be marked either confirmed or waitlisted.
 * Their status must never make them appear in a team list: a solo is always
 * shown once in the partner list until a second player joins it.
 */
export function buildSignupRosterView(
  registrations: SignupRegistration[],
  capacityTeams: number,
): SignupRosterView {
  const confirmedPairs: SignupRegistration[] = [];
  const waitlistedPairs: SignupRegistration[] = [];
  const lookingForPartner: SignupRegistration[] = [];
  const seenRegistrationIds = new Set<string>();

  for (const registration of registrations) {
    if (registration.status === 'cancelled' || seenRegistrationIds.has(registration.id)) continue;
    seenRegistrationIds.add(registration.id);

    if (!isCompletePair(registration)) {
      lookingForPartner.push(registration);
    } else if (registration.status === 'confirmed') {
      confirmedPairs.push(registration);
    } else {
      waitlistedPairs.push(registration);
    }
  }

  const safeCapacity = Number.isFinite(capacityTeams)
    ? Math.max(0, Math.floor(capacityTeams))
    : 0;

  return {
    confirmedPairs,
    waitlistedPairs,
    lookingForPartner,
    confirmedPairCount: confirmedPairs.length,
    pairSpacesLeft: Math.max(0, safeCapacity - confirmedPairs.length),
  };
}
