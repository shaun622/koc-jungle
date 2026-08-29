import { describe, expect, it } from 'vitest';
import { eventIdFromPath, eventRoute, eventRouteForStatus } from '@/lib/eventRoutes';
import type { EventState } from '@/types/domain';

function eventWithStatus(status: EventState['status']): EventState {
  return {
    id: 'event-a',
    name: 'Monday KoC',
    createdAt: 1,
    status,
    settings: {
      defaultRoundDurationMs: 1_200_000,
      tieRule: 'operator-decides',
      soundOnTimerEnd: true,
      warningAtMs: 60_000,
      roundsTotal: 6,
      announceRoundStart: false,
    },
    courts: [],
    teams: [],
    rounds: [],
  };
}

describe('event routes', () => {
  it('scopes operator pages to a stable event id', () => {
    expect(eventRoute('a/b', 'display')).toBe('/events/a%2Fb/display');
    expect(eventIdFromPath('/events/a%2Fb/display')).toBe('a/b');
    expect(eventIdFromPath('/signup/account/event')).toBeNull();
  });

  it.each([
    ['setup', 'setup'],
    ['qualifier', 'qualifier'],
    ['seeding', 'seeding'],
    ['round-in-progress', 'display'],
    ['between-rounds', 'display'],
    ['complete', 'display'],
  ] as const)('maps %s to its resumable screen', (status, route) => {
    expect(eventRouteForStatus(eventWithStatus(status))).toBe(`/events/event-a/${route}`);
  });
});
