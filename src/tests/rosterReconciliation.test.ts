import type { SignupRegistration } from '@/lib/signups';
import type { Team } from '@/types/domain';
import {
  reconcileConfirmedSignupRoster,
  type SignupRosterReconciliation,
} from '@/utils/rosterReconciliation';

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

function team(
  id: string,
  playerOne: string,
  playerTwo: string,
  options: {
    name?: string;
    signupRegistrationId?: string;
    signupPairKey?: string;
    createdAt?: number;
    active?: boolean;
  } = {},
): Team {
  return {
    id,
    name: options.name,
    players: [
      { id: `${id}-player-1`, name: playerOne },
      { id: `${id}-player-2`, name: playerTwo },
    ],
    createdAt: options.createdAt ?? 1,
    active: options.active ?? true,
    signupRegistrationId: options.signupRegistrationId,
    signupPairKey: options.signupPairKey,
  };
}

function applySetupDelta(localTeams: Team[], delta: SignupRosterReconciliation): Team[] {
  const removals = new Set(delta.importedTeamIdsToRemoveOrDeactivate);
  const updates = new Map(delta.teamUpdates.map((update) => [update.teamId, update.patch]));
  const retained = localTeams
    .filter((row) => !removals.has(row.id))
    .map((row) => {
      const patch = updates.get(row.id);
      if (!patch) return row;
      return {
        ...row,
        name: patch.name || undefined,
        players: [
          { ...row.players[0], name: patch.player1 },
          { ...row.players[1], name: patch.player2 },
        ] as Team['players'],
        signupPairKey: patch.signupPairKey,
        signupRegistrationId: patch.signupRegistrationId,
      };
    });
  const additions = delta.teamsToAdd.map((input, index) => team(
    `added-${input.signupRegistrationId}`,
    input.player1,
    input.player2,
    {
      name: input.name,
      signupPairKey: input.signupPairKey,
      signupRegistrationId: input.signupRegistrationId,
      createdAt: 10_000 + index,
    },
  ));
  return [...retained, ...additions];
}

describe('reconcileConfirmedSignupRoster', () => {
  it('uses the stable registration id to update a renamed team and player pair', () => {
    const localTeams = [team('team-1', 'Old One', 'Old Two', {
      name: 'Old team',
      signupRegistrationId: 'registration-1',
      signupPairKey: 'old one|old two',
    })];
    const confirmedRegistrations = [registration(
      'registration-1', 1, 'New One', 'New Two', 'New team',
    )];

    const delta = reconcileConfirmedSignupRoster({ confirmedRegistrations, localTeams, capacity: 1 });

    expect(delta.teamsToAdd).toEqual([]);
    expect(delta.importedTeamIdsToRemoveOrDeactivate).toEqual([]);
    expect(delta.teamUpdates).toEqual([{
      teamId: 'team-1',
      signupRegistrationId: 'registration-1',
      patch: {
        name: 'New team',
        player1: 'New One',
        player2: 'New Two',
        signupPairKey: 'new one|new two',
        signupRegistrationId: 'registration-1',
      },
    }]);

    const reconciled = applySetupDelta(localTeams, delta);
    expect(reconcileConfirmedSignupRoster({ confirmedRegistrations, localTeams: reconciled, capacity: 1 }))
      .toEqual({
        teamsToAdd: [],
        teamUpdates: [],
        orderedRegistrationIds: ['registration-1'],
        importedTeamIdsToRemoveOrDeactivate: [],
      });
  });

  it('replaces a demoted registration with the newly promoted registration at capacity', () => {
    const localTeams = [team('demoted-team', 'Old One', 'Old Two', {
      signupRegistrationId: 'demoted-registration',
      signupPairKey: 'old one|old two',
    })];
    const confirmedRegistrations = [registration(
      'promoted-registration', 1, 'Promoted One', 'Promoted Two', 'Promoted pair',
    )];

    const delta = reconcileConfirmedSignupRoster({ confirmedRegistrations, localTeams, capacity: 1 });

    expect(delta.importedTeamIdsToRemoveOrDeactivate).toEqual(['demoted-team']);
    expect(delta.teamsToAdd).toEqual([{
      name: 'Promoted pair',
      player1: 'Promoted One',
      player2: 'Promoted Two',
      signupPairKey: 'promoted one|promoted two',
      signupRegistrationId: 'promoted-registration',
    }]);
  });

  it('deduplicates repeated registration ids and removes duplicate local claims', () => {
    const confirmedRegistrations = [
      registration('registration-1', 2, 'Later', 'Payload', 'Later payload'),
      registration('registration-1', 1, 'First', 'Pair', 'First payload'),
    ];
    const localTeams = [
      team('newer-duplicate', 'Wrong', 'Names', {
        signupRegistrationId: 'registration-1',
        signupPairKey: 'names|wrong',
        createdAt: 2,
      }),
      team('canonical-team', 'First', 'Pair', {
        name: 'First payload',
        signupRegistrationId: 'registration-1',
        signupPairKey: 'first|pair',
        createdAt: 1,
      }),
    ];

    const delta = reconcileConfirmedSignupRoster({ confirmedRegistrations, localTeams, capacity: 2 });

    expect(delta.teamsToAdd).toEqual([]);
    expect(delta.teamUpdates).toEqual([]);
    expect(delta.importedTeamIdsToRemoveOrDeactivate).toEqual(['newer-duplicate']);
  });

  it('migrates only an explicit legacy signup pair key and never rebinds a stale id', () => {
    const confirmedRegistrations = [
      registration('registration-1', 1, 'Alex', 'Kriss', 'Current pair'),
      registration('registration-2', 2, 'New One', 'New Two', 'New identity'),
    ];
    const localTeams = [
      team('legacy-team', 'KRISS', 'alex', {
        signupPairKey: 'alex|kriss',
      }),
      team('stale-id-team', 'New Two', 'New One', {
        signupRegistrationId: 'old-registration',
        signupPairKey: 'new one|new two',
      }),
    ];

    const delta = reconcileConfirmedSignupRoster({ confirmedRegistrations, localTeams, capacity: 2 });

    expect(delta.teamUpdates).toContainEqual({
      teamId: 'legacy-team',
      signupRegistrationId: 'registration-1',
      patch: {
        name: 'Current pair',
        player1: 'Kriss',
        player2: 'Alex',
        signupPairKey: 'alex|kriss',
        signupRegistrationId: 'registration-1',
      },
    });
    expect(delta.teamsToAdd.map((input) => input.signupRegistrationId)).toEqual(['registration-2']);
    expect(delta.importedTeamIdsToRemoveOrDeactivate).toEqual(['stale-id-team']);
  });

  it('adopts a legacy unlinked local team by an exact normalized unordered player pair', () => {
    const localTeams = [team('legacy-team', '  KRISS ', 'Alex', {
      name: 'Old local name',
    })];
    const confirmedRegistrations = [registration(
      'registration-1', 1, 'alex', 'kriss', 'Canonical team',
    )];

    const delta = reconcileConfirmedSignupRoster({ confirmedRegistrations, localTeams, capacity: 1 });

    expect(delta.teamsToAdd).toEqual([]);
    expect(delta.importedTeamIdsToRemoveOrDeactivate).toEqual([]);
    expect(delta.teamUpdates).toEqual([{
      teamId: 'legacy-team',
      signupRegistrationId: 'registration-1',
      patch: {
        name: 'Canonical team',
        player1: 'kriss',
        player2: 'alex',
        signupPairKey: 'alex|kriss',
        signupRegistrationId: 'registration-1',
      },
    }]);
  });

  it('uses the full court capacity instead of reserving space for a second manual roster', () => {
    const confirmedRegistrations = Array.from({ length: 17 }, (_, index) =>
      registration(
        `registration-${index + 1}`,
        index + 1,
        `Player ${index + 1}A`,
        `Player ${index + 1}B`,
        `Team ${index + 1}`,
      ));
    const localTeams = [team('manual-team', 'Manual One', 'Manual Two')];

    const delta = reconcileConfirmedSignupRoster({ confirmedRegistrations, localTeams, capacity: 16 });
    const reconciled = applySetupDelta(localTeams, delta);

    expect(delta.teamsToAdd).toHaveLength(16);
    expect(delta.teamsToAdd.at(-1)?.signupRegistrationId).toBe('registration-16');
    expect(delta.importedTeamIdsToRemoveOrDeactivate).toEqual(['manual-team']);
    expect(reconciled.filter((row) => row.active)).toHaveLength(16);
    expect(reconcileConfirmedSignupRoster({ confirmedRegistrations, localTeams: reconciled, capacity: 16 }))
      .toEqual({
        teamsToAdd: [],
        teamUpdates: [],
        orderedRegistrationIds: Array.from(
          { length: 16 },
          (_, index) => `registration-${index + 1}`,
        ),
        importedTeamIdsToRemoveOrDeactivate: [],
      });
  });

  it('never projects waitlisted pairs or solo registrations into the local setup roster', () => {
    const localTeams = [
      team('confirmed-team', 'Confirmed One', 'Confirmed Two', {
        signupRegistrationId: 'confirmed-registration',
      }),
      team('waiting-team', 'Waiting One', 'Waiting Two', {
        signupRegistrationId: 'waiting-registration',
      }),
      team('solo-placeholder', 'Solo One', '', {
        signupRegistrationId: 'solo-registration',
      }),
    ];
    const registrations = [
      registration('confirmed-registration', 1, 'Confirmed One', 'Confirmed Two'),
      registration('waiting-registration', 1, 'Waiting One', 'Waiting Two', '', 'waitlisted'),
      registration('solo-registration', 2, 'Solo One', '', '', 'confirmed'),
    ];

    const delta = reconcileConfirmedSignupRoster({
      confirmedRegistrations: registrations,
      localTeams,
      capacity: 3,
    });

    expect(delta.teamsToAdd).toEqual([]);
    expect(delta.importedTeamIdsToRemoveOrDeactivate).toEqual([
      'solo-placeholder',
      'waiting-team',
    ]);
  });
});
