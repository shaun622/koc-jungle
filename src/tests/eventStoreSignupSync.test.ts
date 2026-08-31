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

  it('keeps a demoted team inactive so a later promotion preserves its identity', () => {
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
    expect(teams).toHaveLength(2);
    expect(teams[0]).toMatchObject({
      name: 'Promoted team',
      signupRegistrationId: 'promoted-registration',
      active: true,
    });
    expect(teams[0].players.map((player) => player.name)).toEqual(['Promoted One', 'Promoted Two']);
    const demoted = teams.find((team) => team.signupRegistrationId === 'demoted-registration')!;
    expect(demoted.active).toBe(false);

    useEventStore.getState().syncConfirmedSignupTeams([
      registration('demoted-registration', 1, 'Old One', 'Old Two', 'Demoted team'),
      registration('promoted-registration', 2, 'Promoted One', 'Promoted Two', 'Promoted team'),
    ], 2);

    const restored = useEventStore.getState().event!.teams
      .find((team) => team.signupRegistrationId === 'demoted-registration')!;
    expect(restored.id).toBe(demoted.id);
    expect(restored.players.map((player) => player.id)).toEqual(
      demoted.players.map((player) => player.id),
    );
    expect(restored.active).toBe(true);
  });

  it('applies authoritative server order without replacing team identities', () => {
    useEventStore.getState().addTeams([
      {
        name: 'First',
        player1: 'First One',
        player2: 'First Two',
        signupPairKey: 'first one|first two',
        signupRegistrationId: 'registration-1',
      },
      {
        name: 'Second',
        player1: 'Second One',
        player2: 'Second Two',
        signupPairKey: 'second one|second two',
        signupRegistrationId: 'registration-2',
      },
    ]);
    const before = new Map(useEventStore.getState().event!.teams.map((team) => [
      team.signupRegistrationId,
      { teamId: team.id, playerIds: team.players.map((player) => player.id) },
    ]));

    useEventStore.getState().syncConfirmedSignupTeams([
      registration('registration-2', 1, 'Second One', 'Second Two', 'Second'),
      registration('registration-1', 2, 'First One', 'First Two', 'First'),
    ], 2);

    const after = useEventStore.getState().event!.teams.filter((team) => team.active);
    expect(after.map((team) => team.signupRegistrationId)).toEqual([
      'registration-2',
      'registration-1',
    ]);
    for (const team of after) {
      expect(team.id).toBe(before.get(team.signupRegistrationId)?.teamId);
      expect(team.players.map((player) => player.id))
        .toEqual(before.get(team.signupRegistrationId)?.playerIds);
    }
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

  it('adopts an exact legacy local pair and fills the complete court capacity', () => {
    useEventStore.getState().addTeam({
      name: 'Manual team',
      player1: 'Manual One',
      player2: 'Manual Two',
    });
    const localTeamId = useEventStore.getState().event!.teams[0].id;
    useEventStore.getState().setPlayerAvatar(localTeamId, 0, {
      color: 'oklch(72% 0.18 190)',
      photoDataUrl: 'data:image/png;base64,legacy-avatar',
    });
    useEventStore.getState().setPointsOverride(localTeamId, 12);
    const manualBefore = useEventStore.getState().event!.teams[0];

    useEventStore.getState().syncConfirmedSignupTeams([
      registration('registration-1', 1, 'manual two', 'manual one', 'Canonical manual team'),
      registration('registration-2', 2, 'Online Two A', 'Online Two B', 'Online two'),
    ], 2);

    const teams = useEventStore.getState().event!.teams;
    expect(teams).toHaveLength(2);
    expect(teams[0].id).toBe(manualBefore.id);
    expect(teams[0].players.map((player) => player.id)).toEqual(
      manualBefore.players.map((player) => player.id),
    );
    expect(teams[0].players[0].avatar).toEqual(manualBefore.players[0].avatar);
    expect(teams[0].pointsOverride).toBe(12);
    expect(teams.map((team) => team.signupRegistrationId)).toEqual([
      'registration-1',
      'registration-2',
    ]);
  });

  it('restores a still-confirmed server pair even if an old client marked it ignored', () => {
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

    useEventStore.getState().syncConfirmedSignupTeams([row], 1);

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
