import {
  buildSignupUrl,
  isPublicSignupPath,
  normaliseSignupLinkPart,
  publicSignupHashFromPath,
  registrationPairKey,
  findSignupRegistrationForTeam,
  type SignupRegistration,
} from '@/lib/signups';

describe('public event sign-up helpers', () => {
  it('normalises account names for clean URL paths', () => {
    expect(normaliseSignupLinkPart(' Jungle Padel SG! ')).toBe('jungle-padel-sg');
  });

  it('matches the same player pair regardless of order or case', () => {
    expect(registrationPairKey(' Kriss ', 'Alex')).toBe(registrationPairKey('alex', 'KRISS'));
  });

  it('builds a direct-path share link for reliable PWA navigation', () => {
    expect(buildSignupUrl('24-aug-2026-monday-high-silver-koc', 'jungle-padel')).toContain(
      '/signup/jungle-padel/24-aug-2026-monday-high-silver-koc',
    );
  });

  it('converts direct public paths before the hash router mounts', () => {
    expect(
      publicSignupHashFromPath(
        '/signup/jungle-padel/24-aug-2026-monday-high-silver-koc',
        '?manage=22222222-2222-2222-2222-222222222222',
      ),
    ).toBe(
      '#/signup/jungle-padel/24-aug-2026-monday-high-silver-koc?manage=22222222-2222-2222-2222-222222222222',
    );
    expect(publicSignupHashFromPath('/display')).toBeNull();
  });

  it('recognises public sign-up routes so operator events cannot redirect them', () => {
    expect(isPublicSignupPath('/signup/jungle-padel/24-aug-2026-monday-high-silver-koc')).toBe(true);
    expect(isPublicSignupPath('/display')).toBe(false);
  });

  it('finds the authoritative row by its stable registration id', () => {
    const registrations: SignupRegistration[] = [{
      id: 'registration-1',
      signupEventId: 'event-1',
      teamName: 'Old team',
      playerOne: 'Old one',
      playerTwo: 'Old two',
      status: 'confirmed',
      position: 1,
      createdAt: '2026-08-25T00:00:00Z',
    }];
    expect(findSignupRegistrationForTeam(registrations, {
      signupRegistrationId: 'registration-1',
      playerOne: 'Renamed one',
      playerTwo: 'Renamed two',
    })?.id).toBe('registration-1');
  });

  it('uses the original pair key after a local rename', () => {
    const registrations: SignupRegistration[] = [{
      id: 'registration-2',
      signupEventId: 'event-1',
      teamName: 'Original team',
      playerOne: 'Alex',
      playerTwo: 'Kriss',
      status: 'confirmed',
      position: 1,
      createdAt: '2026-08-25T00:00:00Z',
    }];
    expect(findSignupRegistrationForTeam(registrations, {
      signupPairKey: registrationPairKey('Alex', 'Kriss'),
      playerOne: 'New one',
      playerTwo: 'New two',
    })?.id).toBe('registration-2');
  });
});
