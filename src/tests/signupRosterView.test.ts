import { describe, expect, it } from 'vitest';
import type { SignupRegistration } from '@/lib/signups';
import { buildSignupRosterView } from '@/utils/signupRosterView';

function registration(
  id: string,
  status: SignupRegistration['status'],
  playerTwo: string,
  position: number,
): SignupRegistration {
  return {
    id,
    signupEventId: 'signup-1',
    teamName: playerTwo ? `Team ${id}` : '',
    playerOne: `Player ${id}`,
    playerTwo,
    status,
    position,
    createdAt: `2026-08-31T00:00:${String(position).padStart(2, '0')}.000Z`,
  };
}

describe('signup roster public view', () => {
  it('counts only complete confirmed pairs toward a full event', () => {
    const registrations = Array.from({ length: 16 }, (_, index) =>
      registration(`pair-${index + 1}`, 'confirmed', `Partner ${index + 1}`, index + 1));
    registrations.push(registration('solo-confirmed', 'confirmed', '', 17));

    const view = buildSignupRosterView(registrations, 16);

    expect(view.confirmedPairCount).toBe(16);
    expect(view.pairSpacesLeft).toBe(0);
    expect(view.confirmedPairs).toHaveLength(16);
    expect(view.lookingForPartner.map((row) => row.id)).toEqual(['solo-confirmed']);
    expect(view.waitlistedPairs).toEqual([]);
  });

  it('separates overflow pairs from confirmed pairs without duplicating either', () => {
    const view = buildSignupRosterView([
      registration('confirmed-pair', 'confirmed', 'Partner A', 1),
      registration('waiting-pair', 'waitlisted', 'Partner B', 1),
    ], 1);

    expect(view.pairSpacesLeft).toBe(0);
    expect(view.confirmedPairs.map((row) => row.id)).toEqual(['confirmed-pair']);
    expect(view.waitlistedPairs.map((row) => row.id)).toEqual(['waiting-pair']);
    expect(view.lookingForPartner).toEqual([]);
  });

  it('puts legacy solos in the partner list regardless of confirmed or waiting status', () => {
    const view = buildSignupRosterView([
      registration('legacy-confirmed-solo', 'confirmed', '', 1),
      registration('legacy-waiting-solo', 'waitlisted', '   ', 1),
    ], 4);

    expect(view.confirmedPairs).toEqual([]);
    expect(view.waitlistedPairs).toEqual([]);
    expect(view.lookingForPartner.map((row) => row.id)).toEqual([
      'legacy-confirmed-solo',
      'legacy-waiting-solo',
    ]);
    expect(view.pairSpacesLeft).toBe(4);
  });

  it('shows each active registration at most once even if a snapshot repeats an id', () => {
    const repeated = registration('repeated', 'confirmed', 'Partner', 1);
    const cancelled = registration('cancelled', 'cancelled', 'Partner', 2);
    const view = buildSignupRosterView([
      repeated,
      { ...repeated, status: 'waitlisted' },
      cancelled,
    ], 4);
    const visibleIds = [
      ...view.confirmedPairs,
      ...view.waitlistedPairs,
      ...view.lookingForPartner,
    ].map((row) => row.id);

    expect(visibleIds).toEqual(['repeated']);
  });
});
