import {
  buildSignupUrl,
  isPublicSignupPath,
  publicSignupHashFromPath,
  registrationPairKey,
} from '@/lib/signups';

describe('public event sign-up helpers', () => {
  it('matches the same player pair regardless of order or case', () => {
    expect(registrationPairKey(' Kriss ', 'Alex')).toBe(registrationPairKey('alex', 'KRISS'));
  });

  it('builds a direct-path share link for reliable PWA navigation', () => {
    expect(buildSignupUrl('11111111-1111-1111-1111-111111111111')).toContain(
      '/signup/11111111-1111-1111-1111-111111111111',
    );
  });

  it('converts direct public paths before the hash router mounts', () => {
    expect(
      publicSignupHashFromPath(
        '/signup/11111111-1111-1111-1111-111111111111',
        '?manage=22222222-2222-2222-2222-222222222222',
      ),
    ).toBe(
      '#/signup/11111111-1111-1111-1111-111111111111?manage=22222222-2222-2222-2222-222222222222',
    );
    expect(publicSignupHashFromPath('/display')).toBeNull();
  });

  it('recognises public sign-up routes so operator events cannot redirect them', () => {
    expect(isPublicSignupPath('/signup/11111111-1111-1111-1111-111111111111')).toBe(true);
    expect(isPublicSignupPath('/display')).toBe(false);
  });
});
