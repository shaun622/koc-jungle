import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { EXACT_NINE_PLAYER_ROUNDS, EXACT_ROTATING_STARTERS } from '@/logic/americanoV2/fixtures';
import {
  balancedDefaultRounds,
  generateAmericanoSchedule,
  seededShuffle,
  xorshift32,
  type GenerateAmericanoScheduleInput,
} from '@/logic/americanoV2/schedule';
import { computeScheduleMetrics } from '@/logic/americanoV2/validation';

const EXACT_COUNTS = [4, 5, 8, 9, 12, 13, 16, 17, 20, 21, 24, 25, 28, 29, 32, 33, 36, 37, 40, 41, 44, 45, 48, 49, 52, 53, 56, 57, 60, 61, 64];

function rotatingInput(count: number, scheduleKind: 'full' | 'balanced' | 'custom' = 'full', customRounds?: number): GenerateAmericanoScheduleInput {
  return {
    config: {
      rulesVersion: 2,
      pairingMode: 'rotating',
      pointsPerMatch: 24,
      scheduleKind,
      customRounds,
      paceMinutes: 10,
      paceClockEnabled: false,
    },
    orderedEntrantIds: Array.from({ length: count }, (_, index) => `p${index + 1}`),
    courtIds: Array.from({ length: Math.ceil(count / 4) }, (_, index) => `c${index + 1}`),
    seed: 0x12345678,
    rosterRevision: '7',
  };
}

function assignments(schedule: Awaited<ReturnType<typeof generateAmericanoSchedule>>) {
  return schedule.rounds.map((round) => ({
    matches: round.matches.map((match) => ({ courtId: match.courtId, sideA: match.sideA, sideB: match.sideB })),
    rests: round.restingEntrantIds,
  }));
}

describe('Americano v2 certified exact fixtures', () => {
  it('matches the authorized starter and nine-player checksums', () => {
    const starters = JSON.stringify(EXACT_ROTATING_STARTERS);
    const nine = JSON.stringify(EXACT_NINE_PLAYER_ROUNDS);
    expect(Buffer.byteLength(starters, 'utf8')).toBe(3491);
    expect(createHash('sha256').update(starters).digest('hex')).toBe('d06e38b88ffdb57c936ab02ca9a80079f7a17d1b2b00887ef884e3ddd9b00f72');
    expect(Buffer.byteLength(nine, 'utf8')).toBe(199);
    expect(createHash('sha256').update(nine).digest('hex')).toBe('aadd8cdd7459a8b7c62026a0cbf352ce937c317be1912342ba25957e400bf7d8');
  });

  it.each(EXACT_COUNTS)('expands and independently validates the full %i-player cycle', async (count) => {
    const schedule = await generateAmericanoSchedule(rotatingInput(count));
    expect(schedule.rounds).toHaveLength(count % 4 === 0 ? count - 1 : count);
    expect(schedule.metrics.appearancesEqual).toBe(true);
    expect(schedule.metrics.minimumPartnerFrequency).toBe(1);
    expect(schedule.metrics.maximumPartnerFrequency).toBe(1);
    expect(schedule.metrics.minimumOpponentFrequency).toBe(2);
    expect(schedule.metrics.maximumOpponentFrequency).toBe(2);
  });

  it('uses the specified xorshift zero mapping and deterministic shuffle', () => {
    expect(xorshift32(0)()).toBeCloseTo(xorshift32(0x9e3779b9)(), 15);
    expect(seededShuffle(['a', 'b', 'c', 'd'], 99)).toEqual(seededShuffle(['a', 'b', 'c', 'd'], 99));
  });
});

describe('Americano v2 balanced and custom schedules', () => {
  it('uses seven balanced rounds for seven players with four appearances and three rests each', async () => {
    expect(balancedDefaultRounds(7)).toBe(7);
    const schedule = await generateAmericanoSchedule(rotatingInput(7, 'balanced'));
    expect(schedule.rounds).toHaveLength(7);
    expect(new Set(Object.values(schedule.metrics.appearances))).toEqual(new Set([4]));
    expect(new Set(Object.values(schedule.metrics.rests))).toEqual(new Set([3]));
  });

  it('surfaces an uneven Custom 6 schedule without pretending it was acknowledged', async () => {
    const schedule = await generateAmericanoSchedule(rotatingInput(7, 'custom', 6));
    expect(schedule.metrics.maximumAppearanceSpread).toBe(1);
    expect(schedule.metrics.appearancesEqual).toBe(false);
    expect(schedule.acknowledgements.unevenAppearances).toBe(false);
  });

  it('repeats exact cycles deterministically with fresh fixture identities', async () => {
    const schedule = await generateAmericanoSchedule(rotatingInput(4, 'custom', 5));
    expect(schedule.rounds).toHaveLength(5);
    expect(new Set(schedule.rounds.flatMap((round) => [round.id, ...round.matches.map((match) => match.id)])).size).toBe(10);
    expect(schedule.acknowledgements.repeatedCycle).toBe(false);
    expect(assignments(schedule)[0].matches[0].sideA).toEqual(assignments(schedule)[3].matches[0].sideA);
  });

  it('is deterministic for the same inputs apart from assigned schedule identities', async () => {
    const first = await generateAmericanoSchedule(rotatingInput(11, 'custom', 9));
    const second = await generateAmericanoSchedule(rotatingInput(11, 'custom', 9));
    expect(assignments(first)).toEqual(assignments(second));
    expect(first.metrics).toEqual(second.metrics);
    expect(first.inputFingerprint).toBe(second.inputFingerprint);
  });

  it('keeps the 64-player by 64-round custom generation below the desktop proxy budget', async () => {
    const start = performance.now();
    const schedule = await generateAmericanoSchedule(rotatingInput(64, 'custom', 64));
    expect(schedule.rounds).toHaveLength(64);
    expect(performance.now() - start).toBeLessThan(2_000);
    expect(computeScheduleMetrics(schedule, 'rotating')).toEqual(schedule.metrics);
  });
});

describe('Americano v2 fixed schedules', () => {
  it('uses Berger fixtures once and applies rally points to genuine fixed teams', async () => {
    const teamIds = ['t1', 't2', 't3', 't4'];
    const schedule = await generateAmericanoSchedule({
      config: { rulesVersion: 2, pairingMode: 'fixed', pointsPerMatch: 24, scheduleKind: 'full', paceMinutes: 10, paceClockEnabled: false },
      orderedEntrantIds: teamIds,
      fixedEntrants: teamIds.map((teamId, index) => ({ teamId, playerIds: [`p${index * 2 + 1}`, `p${index * 2 + 2}`] })),
      courtIds: ['c1', 'c2'],
      seed: 17,
    });
    expect(schedule.rounds).toHaveLength(3);
    expect(schedule.metrics.minimumOpponentFrequency).toBe(1);
    expect(schedule.metrics.maximumOpponentFrequency).toBe(1);
  });
});
