import { beforeEach, describe, expect, it } from 'vitest';
import type { SignupRegistration } from '@/lib/signups';
import { useEventStore } from '@/store/eventStore';

function registration(
  id: string,
  position: number,
  playerOne: string,
  playerTwo: string,
  teamName = '',
  status: SignupRegistration['status'] = 'confirmed',
): SignupRegistration {
  return {
    id,
    signupEventId: 'signup-event-1',
    teamName,
    playerOne,
    playerTwo,
    status,
    position,
    createdAt: `2026-08-${String(position).padStart(2, '0')}T00:00:00Z`,
  };
}

describe('event-store confirmed signup roster synchronisation', () => {
  beforeEach(() => {
    localStorage.clear();
    useEventStore.getState().resetEvent();
    useEventStore.getState().createEvent('Signup sync', 'koc');
  });

  it('updates a renamed imported team by registration id without replacing player identity or avatars', () => {
    useEventStore.getState().addTeams([{
      name: 'Old team',
      player1: 'Old One',
      player2: 'Old Two',
      signupPairKey: 'old one|old two',
      signupRegistrationId: 'registration-1',
    }]);
    const before = useEventStore.getState().event!.teams[0];
    useEventStore.getState().setPlayerAvatar(before.id, 0, {
      color: 'oklch(70% 0.2 150)',
      photoDataUrl: 'data:image/png;base64,avatar',
    });
    const withAvatar = useEventStore.getState().event!.teams[0];

    useEventStore.getState().syncConfirmedSignupTeams([
      registration('registration-1', 1, 'New One', 'New Two', 'New team'),
    ], 1);

    const after = useEventStore.getState().event!.teams[0];
    expect(after).toMatchObject({
      id: withAvatar.id,
      name: 'New team',
      signupPairKey: 'new one|new two',
      signupRegistrationId: 'registration-1',
    });
    expect(after.players.map((player) => player.id)).toEqual(
      withAvatar.players.map((player) => player.id),
    );
    expect(after.players.map((player) => player.name)).toEqual(['New One', 'New Two']);
    expect(after.players[0].avatar).toEqual(withAvatar.players[0].avatar);
  });

  it('atomically removes a demoted imported team and adds its promoted replacement', () => {
    useEventStore.getState().addTeams([{
      name: 'Demoted team',
      player1: 'Old One',
      player2: 'Old Two',
      signupPairKey: 'old one|old two',
      signupRegistrationId: 'demoted-registration',
    }]);
    let notifications = 0;
    const unsubscribe = useEventStore.subscribe(() => {
      notifications += 1;
    });

    useEventStore.getState().syncConfirmedSignupTeams([
      registration('demoted-registration', 1, 'Old One', 'Old Two', 'Demoted team', 'waitlisted'),
      registration('promoted-registration', 1, 'Promoted One', 'Promoted Two', 'Promoted team'),
    ], 1);
    unsubscribe();

    const teams = useEventStore.getState().event!.teams;
    expect(notifications).toBe(1);
    expect(teams).toHaveLength(1);
    expect(teams[0]).toMatchObject({
      name: 'Promoted team',
      signupRegistrationId: 'promoted-registration',
    });
    expect(teams[0].players.map((player) => player.name)).toEqual(['Promoted One', 'Promoted Two']);
  });

  it('deduplicates registration ids and is idempotent with stable local identities', () => {
    const snapshot = [
      registration('registration-1', 2, 'Later', 'Payload', 'Later payload'),
      registration('registration-1', 1, 'First', 'Pair', 'First payload'),
    ];

    useEventStore.getState().syncConfirmedSignupTeams(snapshot, 2);
    const afterFirstSync = useEventStore.getState().event!;
    const identity = {
      teamId: afterFirstSync.teams[0].id,
      playerIds: afterFirstSync.teams[0].players.map((player) => player.id),
    };
    let notifications = 0;
    const unsubscribe = useEventStore.subscribe(() => {
      notifications += 1;
    });

    useEventStore.getState().syncConfirmedSignupTeams(snapshot, 2);
    unsubscribe();

    const afterSecondSync = useEventStore.getState().event!;
    expect(afterSecondSync).toBe(afterFirstSync);
    expect(notifications).toBe(0);
    expect(afterSecondSync.teams).toHaveLength(1);
    expect(afterSecondSync.teams[0].id).toBe(identity.teamId);
    expect(afterSecondSync.teams[0].players.map((player) => player.id)).toEqual(identity.playerIds);
    expect(afterSecondSync.teams[0]).toMatchObject({
      name: 'First payload',
      signupRegistrationId: 'registration-1',
    });
  });

  it('does not append the same online registration twice through addTeams', () => {
    const onlineTeam = {
      name: 'Online pair',
      player1: 'Online One',
      player2: 'Online Two',
      signupPairKey: 'online one|online two',
      signupRegistrationId: 'registration-1',
    };

    useEventStore.getState().addTeams([onlineTeam, onlineTeam]);
    useEventStore.getState().addTeams([onlineTeam]);

    const teams = useEventStore.getState().event!.teams;
    expect(teams).toHaveLength(1);
    expect(teams[0].signupRegistrationId).toBe('registration-1');
  });

  it('keeps manual teams and uses only their remaining capacity for confirmed signup teams', () => {
    useEventStore.getState().addTeam({
      name: 'Manual team',
      player1: 'Manual One',
      player2: 'Manual Two',
    });
    const manualBefore = useEventStore.getState().event!.teams[0];

    useEventStore.getState().syncConfirmedSignupTeams([
      registration('registration-1', 1, 'Online One A', 'Online One B', 'Online one'),
      registration('registration-2', 2, 'Online Two A', 'Online Two B', 'Online two'),
    ], 2);

    const teams = useEventStore.getState().event!.teams;
    expect(teams).toHaveLength(2);
    expect(teams[0]).toBe(manualBefore);
    expect(teams.map((team) => team.signupRegistrationId)).toEqual([
      undefined,
      'registration-1',
    ]);
  });

  it('lets a manual review restore an intentionally ignored online pair', () => {
    const row = registration('registration-1', 1, 'Online One', 'Online Two', 'Online pair');
    useEventStore.getState().addTeams([{
      name: row.teamName,
      player1: row.playerOne,
      player2: row.playerTwo,
      signupPairKey: 'online one|online two',
      signupRegistrationId: row.id,
    }]);
    const teamId = useEventStore.getState().event!.teams[0].id;
    useEventStore.getState().removeTeam(teamId);
    expect(useEventStore.getState().event!.settings.ignoredAutoSignupRegistrationIds)
      .toEqual([row.id]);

    useEventStore.getState().syncConfirmedSignupTeams([row], 1, { includeIgnored: true });

    const event = useEventStore.getState().event!;
    expect(event.teams).toHaveLength(1);
    expect(event.teams[0].signupRegistrationId).toBe(row.id);
    expect(event.settings.ignoredAutoSignupPairKeys).toEqual([]);
    expect(event.settings.ignoredAutoSignupRegistrationIds).toEqual([]);
  });

  it('does not reconcile the roster after setup has finished', () => {
    const setupEvent = useEventStore.getState().event!;
    useEventStore.getState().loadEvent({ ...setupEvent, status: 'round-in-progress' });
    const before = useEventStore.getState().event;

    useEventStore.getState().syncConfirmedSignupTeams([
      registration('registration-1', 1, 'Online One', 'Online Two'),
    ], 1);

    expect(useEventStore.getState().event).toBe(before);
  });
});
