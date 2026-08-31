import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS, type EventState } from '@/types/domain';
import { saveTemplate, templateToEventState } from '@/store/templates';

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
});
