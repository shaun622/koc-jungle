import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS, type EventState } from '@/types/domain';
import { saveTemplate, templateToEventState } from '@/store/templates';
import { americanoV2Fixture } from '@/tests/americanoV2Fixtures';
import { isAmericanoEventV2 } from '@/logic/americanoV2/types';

function linkedEvent(): EventState {
  return {
    id: 'source-event',
    name: 'Monday KoC',
    createdAt: 1,
    status: 'setup',
    settings: {
      ...DEFAULT_SETTINGS,
      publishedSignupId: 'old-signup',
      ignoredAutoSignupPairKeys: ['old-pair'],
      ignoredAutoSignupRegistrationIds: ['old-registration'],
    },
    courts: [{ id: 'court-1', name: 'Centre Court', position: 1, pointValue: 9 }],
    teams: [{
      id: 'team-1',
      name: 'Smashers',
      players: [
        { id: 'player-1', name: 'Kriss' },
        { id: 'player-2', name: 'Alex' },
      ],
      createdAt: 1,
      active: true,
      signupRegistrationId: 'old-registration',
      signupPairKey: 'alex|kriss',
      pointsOverride: 99,
    }],
    rounds: [],
  };
}

describe('event templates', () => {
  it('does not copy online-signup identity into an independent event', () => {
    const template = saveTemplate(`linked-${Date.now()}`, linkedEvent());
    const event = templateToEventState(template);

    expect(event.settings.publishedSignupId).toBeUndefined();
    expect(event.settings.ignoredAutoSignupPairKeys).toBeUndefined();
    expect(event.settings.ignoredAutoSignupRegistrationIds).toBeUndefined();
    expect(event.teams[0]).toMatchObject({ name: 'Smashers' });
    expect(event.teams[0].signupRegistrationId).toBeUndefined();
    expect(event.teams[0].signupPairKey).toBeUndefined();
    expect(event.teams[0].pointsOverride).toBeUndefined();
  });

  it.each(['rotating', 'fixed'] as const)('stores %s v2 rules but creates fresh unlinked identities without results', (mode) => {
    const source = americanoV2Fixture(mode);
    source.formatConfig.pointsPerMatch = 21;
    if (mode === 'rotating') source.participants[0].signupRegistrationId = 'registration-1';
    else source.teams[0].signupRegistrationId = 'registration-1';
    source.settings.publishedSignupId = 'signup-1';
    const template = saveTemplate(`v2-${Date.now()}`, source);
    expect(template.version).toBe(2);
    const next = templateToEventState(template);
    expect(isAmericanoEventV2(next)).toBe(true);
    if (!isAmericanoEventV2(next)) throw new Error('Expected Americano v2 event.');
    expect(next.id).not.toBe(source.id);
    expect(next.courts.map(({ id }) => id)).not.toEqual(source.courts.map(({ id }) => id));
    if (mode === 'rotating') {
      expect(next.participants.map(({ id }) => id)).not.toEqual(source.participants.map(({ id }) => id));
      expect(next.participants.every((participant) => participant.signupRegistrationId === undefined)).toBe(true);
    } else {
      expect(next.teams.map(({ id }) => id)).not.toEqual(source.teams.map(({ id }) => id));
      expect(next.teams.flatMap((team) => team.players.map(({ id }) => id)))
        .not.toEqual(source.teams.flatMap((team) => team.players.map(({ id }) => id)));
      expect(next.teams.every((team) => team.signupRegistrationId === undefined)).toBe(true);
    }
    expect(next.formatConfig).toEqual(source.formatConfig);
    expect(next.rounds).toEqual([]);
    expect(next.americanoSchedule).toBeUndefined();
    expect(next.settings.publishedSignupId).toBeUndefined();
  });
});
