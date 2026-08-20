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
    expect(buildSignupUrl('24-aug-2026-monday-high-silver-koc')).toContain(
      '/signup/24-aug-2026-monday-high-silver-koc',
    );
  });

  it('converts direct public paths before the hash router mounts', () => {
    expect(
      publicSignupHashFromPath(
        '/signup/24-aug-2026-monday-high-silver-koc',
        '?manage=22222222-2222-2222-2222-222222222222',
      ),
    ).toBe(
      '#/signup/24-aug-2026-monday-high-silver-koc?manage=22222222-2222-2222-2222-222222222222',
    );
    expect(publicSignupHashFromPath('/display')).toBeNull();
  });

  it('recognises public sign-up routes so operator events cannot redirect them', () => {
    expect(isPublicSignupPath('/signup/24-aug-2026-monday-high-silver-koc')).toBe(true);
    expect(isPublicSignupPath('/display')).toBe(false);
  });
});
