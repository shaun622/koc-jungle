import { buildSignupUrl, isPublicSignupPath, registrationPairKey } from '@/lib/signups';

describe('public event sign-up helpers', () => {
  it('matches the same player pair regardless of order or case', () => {
    expect(registrationPairKey(' Kriss ', 'Alex')).toBe(registrationPairKey('alex', 'KRISS'));
  });

  it('builds a hash-router share link for the public event', () => {
    expect(buildSignupUrl('11111111-1111-1111-1111-111111111111')).toContain(
      '#/signup/11111111-1111-1111-1111-111111111111',
    );
  });

  it('recognises public sign-up routes so operator events cannot redirect them', () => {
    expect(isPublicSignupPath('/signup/11111111-1111-1111-1111-111111111111')).toBe(true);
    expect(isPublicSignupPath('/display')).toBe(false);
  });
});
