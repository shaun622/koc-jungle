import { describe, expect, it } from 'vitest';
import { standingAwardForSideV3, validateAmericanoResultDraftV3 } from '@/logic/americanoV3/scoring';

describe('Americano V3 per-match time-out override', () => {
  const scoring = { kind: 'rally' as const, pointsPerMatch: 24 };
  const stopped = { kind: 'rally' as const, scoreA: 10, scoreB: 8, endedEarly: true };

  it('records actual points for events with no advance setup option', () => {
    const result = validateAmericanoResultDraftV3(stopped, scoring, true);
    expect(result).toMatchObject({ valid: true, complete: true, summary: { winner: 'A', gamesA: 10, gamesB: 8 } });
    expect(standingAwardForSideV3(scoring, result.summary!, 'A')).toBe(10);
    expect(standingAwardForSideV3(scoring, result.summary!, 'B')).toBe(8);
    expect(validateAmericanoResultDraftV3(stopped, { ...scoring, allowUnfinished: false }, true).valid).toBe(true);
  });

  it('still requires an explicit per-match choice and rejects above-target scores', () => {
    expect(validateAmericanoResultDraftV3({ ...stopped, endedEarly: false }, scoring, true).valid).toBe(false);
    expect(validateAmericanoResultDraftV3({ ...stopped, scoreA: 20 }, scoring, true).valid).toBe(false);
    expect(validateAmericanoResultDraftV3({ ...stopped, scoreA: 9, scoreB: 9 }, scoring, true).summary?.winner).toBeNull();
  });
});
