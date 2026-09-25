import { describe, expect, it } from 'vitest';
import { createAmericanoEventV2 } from '@/logic/americanoV2/runtime';
import { AMERICANO_V3_TRADITIONAL_PRESETS, defaultAmericanoConfigV3 } from '@/logic/americanoV3/scoring';
import { isAmericanoEventV2 } from '@/logic/americanoV2/types';
import { isAmericanoEventV3 } from '@/logic/eventVersions';
import { InvalidEventSchemaError, parseEventState, UnsupportedEventSchemaError } from '@/utils/eventSchema';

function validV3() {
  return {
    ...createAmericanoEventV2('Test v3'),
    schemaVersion: 3 as const,
    formatConfig: defaultAmericanoConfigV3('rotating'),
  };
}

describe('Americano v3 event schema', () => {
  it('dispatches schema 3 exactly and preserves version 2 semantics', () => {
    const v3 = parseEventState(validV3());
    expect(isAmericanoEventV3(v3)).toBe(true);
    expect(isAmericanoEventV2(v3)).toBe(false);
    const v2 = parseEventState(createAmericanoEventV2('Test v2'));
    expect(isAmericanoEventV2(v2)).toBe(true);
    expect(isAmericanoEventV3(v2)).toBe(false);
  });

  it('rejects wrong protocol, mode roster, malformed scores and missing v3 schedule fingerprint version', () => {
    expect(() => parseEventState({ ...validV3(), protocolVersion: 1 })).toThrow(InvalidEventSchemaError);
    expect(() => parseEventState({ ...validV3(), teams: [{ id: 'team', players: [{ id: 'p1', name: 'A' }, { id: 'p2', name: 'B' }], createdAt: 1, active: true }] })).toThrow(/cannot contain fixed teams/);
    const badScore = { ...validV3(), rounds: [{ id: 'r1', index: 1, fixtureRoundId: 'f1', durationMs: 600000, totalPausedMs: 0, completedAt: 1, matches: [{ id: 'm1', courtId: 'c1', sideA: { kind: 'rotating-pair', playerIds: ['a', 'b'] }, sideB: { kind: 'rotating-pair', playerIds: ['c', 'd'] }, result: { kind: 'rally', scoreA: 1, scoreB: 1 }, resultConfirmed: true }] }] };
    expect(() => parseEventState(badScore)).toThrow(/add up to 24/);
    const withSchedule = { ...validV3(), americanoSchedule: { id: 's1', algorithmVersion: 'americano-v2.1', seed: 1, inputFingerprint: 'fp', orderedEntrantIds: [], courtIds: [], rounds: [], metrics: {}, acknowledgements: { fingerprint: 'fp', unevenAppearances: false, repeatedCycle: false }, rosterRevision: '0' } };
    expect(() => parseEventState(withSchedule)).toThrow(/fingerprint version 3/);
  });

  it('rejects a custom config whose saved preset key contradicts its rule snapshot', () => {
    const event = validV3();
    event.formatConfig.scoring = { kind: 'traditional', preset: 'standard-set', rule: AMERICANO_V3_TRADITIONAL_PRESETS['short-set'].rule, standings: { pointsPerGameWon: 1, matchWinBonus: 0 } };
    expect(() => parseEventState(event)).toThrow(/preset does not match/i);
  });

  it('still rejects unknown future event versions instead of treating them as legacy', () => {
    expect(() => parseEventState({ ...validV3(), schemaVersion: 4 })).toThrow(UnsupportedEventSchemaError);
    expect(() => parseEventState({ ...validV3(), schemaVersion: 0 })).toThrow(InvalidEventSchemaError);
  });
});
