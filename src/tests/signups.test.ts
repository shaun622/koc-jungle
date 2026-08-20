import {
  buildSignupUrl,
  isPublicSignupPath,
  normaliseSignupLinkPart,
  publicSignupHashFromPath,
  registrationPairKey,
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
});
