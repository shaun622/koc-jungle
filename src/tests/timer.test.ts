import { describe, expect, it, vi } from 'vitest';
import { computeRemaining } from '@/hooks/useTimer';
import type { MainRound } from '@/types/domain';

function round(partial: Partial<MainRound> = {}): MainRound {
  return {
    id: 'r',
    index: 1,
    matches: [],
    durationMs: 20 * 60 * 1000,
    totalPausedMs: 0,
    ...partial,
  };
}

describe('computeRemaining', () => {
  it('returns full duration when not started', () => {
    expect(computeRemaining(round(), 1_000_000)).toBe(20 * 60 * 1000);
  });

  it('subtracts elapsed time when running', () => {
    const startedAt = 1_000_000;
    const now = startedAt + 5 * 60 * 1000;
    expect(computeRemaining(round({ startedAt }), now)).toBe(15 * 60 * 1000);
  });

  it('respects pauses', () => {
    const startedAt = 1_000_000;
    const pausedAt = startedAt + 4 * 60 * 1000;
    const now = pausedAt + 10 * 60 * 1000;
    // Effective elapsed = (now - startedAt) - (now - pausedAt) = 4 min
    expect(computeRemaining(round({ startedAt, pausedAt }), now)).toBe(16 * 60 * 1000);
  });

  it('respects accumulated pauses', () => {
    const startedAt = 1_000_000;
    const totalPausedMs = 3 * 60 * 1000;
    const now = startedAt + 10 * 60 * 1000;
    // elapsed = 10 - 3 = 7 min ; remaining = 13 min
    expect(computeRemaining(round({ startedAt, totalPausedMs }), now)).toBe(13 * 60 * 1000);
  });

  it('returns negative after timer expires', () => {
    const startedAt = 1_000_000;
    const now = startedAt + 25 * 60 * 1000;
    const r = computeRemaining(round({ startedAt }), now);
    expect(r).toBeLessThan(0);
  });

  it('serialization round-trip preserves computation', () => {
    const startedAt = 1_000_000;
    const r = round({ startedAt, totalPausedMs: 2_000 });
    const json = JSON.stringify(r);
    const restored = JSON.parse(json) as MainRound;
    const now = startedAt + 60_000;
    expect(computeRemaining(restored, now)).toBe(computeRemaining(r, now));
  });

  it('mocked Date.now works', () => {
    const spy = vi.spyOn(Date, 'now').mockReturnValue(2_000_000);
    const r = round({ startedAt: 2_000_000 - 30_000 });
    expect(computeRemaining(r)).toBe(20 * 60 * 1000 - 30_000);
    spy.mockRestore();
  });
});
