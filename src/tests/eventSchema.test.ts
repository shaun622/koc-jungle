import { describe, expect, it } from 'vitest';
import { americanoV2Fixture } from '@/tests/americanoV2Fixtures';
import {
  InvalidEventSchemaError,
  UnsupportedEventSchemaError,
  isLegacyEventState,
  parseEventState,
} from '@/utils/eventSchema';
import { isAmericanoEventV2 } from '@/logic/americanoV2/types';
import { DEFAULT_SETTINGS, type EventState } from '@/types/domain';

function legacyFixture(): EventState {
  return {
    id: 'legacy',
    name: 'Legacy',
    createdAt: 1,
    status: 'setup',
    settings: { ...DEFAULT_SETTINGS },
    courts: [],
    teams: [],
    rounds: [],
  };
}

describe('versioned event schema reader', () => {
  it('keeps absent and explicit schema 1 events on the legacy branch', () => {
    expect(isLegacyEventState(parseEventState(legacyFixture()))).toBe(true);
    expect(isLegacyEventState(parseEventState({ ...legacyFixture(), schemaVersion: 1 }))).toBe(true);
  });

  it('accepts a valid rules-version-2 Americano without treating it as legacy', () => {
    const parsed = parseEventState(americanoV2Fixture());
    expect(isAmericanoEventV2(parsed)).toBe(true);
  });

  it('rejects unknown schema versions with an update-required error', () => {
    expect(() => parseEventState({ ...legacyFixture(), schemaVersion: 3 })).toThrow(UnsupportedEventSchemaError);
  });

  it('rejects schema 2 with missing rulesVersion instead of falling back', () => {
    const malformed = americanoV2Fixture();
    const formatConfig = { ...malformed.formatConfig } as Record<string, unknown>;
    delete formatConfig.rulesVersion;
    expect(() => parseEventState({ ...malformed, formatConfig })).toThrow(InvalidEventSchemaError);
  });

  it('rejects a rotating event containing fixed teams', () => {
    const rotating = americanoV2Fixture('rotating');
    const fixed = americanoV2Fixture('fixed');
    expect(() => parseEventState({ ...rotating, teams: fixed.teams })).toThrow(/cannot contain fixed teams/i);
  });

  it.each([0, -1, 2.5, Infinity, NaN, 2147483648, '21', null])('rejects invalid point totals: %s', (pointsPerMatch) => {
    const event = americanoV2Fixture();
    expect(() => parseEventState({ ...event, formatConfig: { ...event.formatConfig, pointsPerMatch } }))
      .toThrow(/positive whole number/i);
  });

  it('rejects malformed persisted legacy event bodies', () => {
    expect(() => parseEventState({ ...legacyFixture(), rounds: 'not-an-array' })).toThrow(InvalidEventSchemaError);
  });
});
