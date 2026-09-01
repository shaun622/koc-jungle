import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_SETTINGS, type EventState, type Team } from '@/types/domain';
import type {
  SaveSignupInput,
  SignupEvent,
  SignupEventMutationResult,
  SignupRegistration,
} from '@/lib/signups';

const signupMocks = vi.hoisted(() => ({
  deleteOrganizerRegistrationIfStatus: vi.fn(),
  getOrganizerRegistrations: vi.fn(),
  getOwnedSignup: vi.fn(),
  getSignupAccountSlug: vi.fn(),
  getSignupTemplates: vi.fn(),
  saveSignupEvent: vi.fn(),
  seedOrganizerSignupRoster: vi.fn(),
  updateOrganizerRegistration: vi.fn(),
}));

const authUser = vi.hoisted(() => ({ id: 'owner-1', email: 'owner@example.com' }));

vi.mock('@/lib/signups', async () => {
  const actual = await vi.importActual<typeof import('@/lib/signups')>('@/lib/signups');
  return { ...actual, ...signupMocks };
});

vi.mock('@/hooks/useAuth', () => ({
  useAuth: () => ({
    user: authUser,
    loading: false,
    cloudEnabled: true,
    signInWithEmail: vi.fn(),
    signUpWithEmail: vi.fn(),
    signOut: vi.fn(),
    deleteAccount: vi.fn(),
  }),
}));

import { EventSignupPanel } from '@/components/EventSignupPanel';

const event: EventState = {
  id: 'event-1',
  name: 'Monday Night KoC',
  venue: 'Jungle Padel Sanur',
  createdAt: 1,
  status: 'setup',
  settings: { ...DEFAULT_SETTINGS },
  courts: [
    { id: 'court-1', position: 1, name: 'Court 1', pointValue: 5 },
    { id: 'court-2', position: 2, name: 'Centre Court', pointValue: 7 },
  ],
  teams: [],
  rounds: [],
};

const signup: SignupEvent = {
  id: 'signup-1',
  ownerUserId: 'owner-1',
  sourceEventId: 'event-1',
  publicSlug: 'public-1',
  accountSlug: 'shaun',
  eventSlug: '31-aug-2026-monday-night-koc',
  title: 'Monday Night KoC',
  venue: 'Jungle Padel Sanur',
  startsAt: null,
  endsAt: null,
  capacityTeams: 4,
  capacityRevision: 1,
  details: '',
  prizes: '',
  isOpen: true,
  autoAddPairs: false,
  rosterSeededAt: '2026-08-30T00:00:00.000Z',
  rosterLockedAt: null,
};

const registrations: SignupRegistration[] = [
  {
    id: 'confirmed-1',
    signupEventId: 'signup-1',
    teamName: 'Confirmed Pair',
    playerOne: 'Tapia',
    playerTwo: 'Coello',
    contact: 'confirmed@example.com',
    status: 'confirmed',
    position: 1,
    createdAt: '2026-08-29T00:00:00Z',
    updatedAt: '2026-08-29T00:00:00Z',
  },
  {
    id: 'waiting-pair',
    signupEventId: 'signup-1',
    teamName: 'Waiting Pair',
    playerOne: 'Alex',
    playerTwo: 'Kriss',
    contact: 'waiting@example.com',
    status: 'waitlisted',
    position: 1,
    createdAt: '2026-08-29T00:01:00Z',
    updatedAt: '2026-08-29T00:01:00Z',
  },
  {
    id: 'waiting-solo',
    signupEventId: 'signup-1',
    teamName: '',
    playerOne: 'Shaun',
    playerTwo: '',
    contact: 'solo@example.com',
    status: 'waitlisted',
    position: 2,
    createdAt: '2026-08-29T00:02:00Z',
    updatedAt: '2026-08-29T00:02:00Z',
  },
];

function panel({
  expectedTeams = 4,
  teams = [],
  onAddTeams = vi.fn(),
  onSyncTeams = vi.fn(),
  refreshRegistrationsVersion = 0,
}: {
  expectedTeams?: number;
  teams?: Team[];
  onAddTeams?: React.ComponentProps<typeof EventSignupPanel>['onAddTeams'];
  onSyncTeams?: React.ComponentProps<typeof EventSignupPanel>['onSyncTeams'];
  refreshRegistrationsVersion?: number;
} = {}) {
  return (
    <EventSignupPanel
      event={event}
      expectedTeams={expectedTeams}
      teams={teams}
      onAddTeams={onAddTeams}
      onSyncTeams={onSyncTeams}
      refreshRegistrationsVersion={refreshRegistrationsVersion}
    />
  );
}

function renderPanel() {
  const view = render(panel());
  fireEvent.click(screen.getByRole('button', { name: /Online team sign-up/i }));
  return view;
}

async function loadPanel() {
  const view = renderPanel();
  expect(await screen.findByText('Waiting Pair')).toBeInTheDocument();
  return view;
}

describe('organiser registration deletion', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    signupMocks.getOwnedSignup.mockResolvedValue(signup);
    signupMocks.getSignupAccountSlug.mockResolvedValue('shaun');
    signupMocks.getSignupTemplates.mockResolvedValue([]);
    signupMocks.getOrganizerRegistrations.mockResolvedValue(registrations);
    signupMocks.deleteOrganizerRegistrationIfStatus.mockResolvedValue(undefined);
    signupMocks.seedOrganizerSignupRoster.mockResolvedValue({ seeded: true });
    signupMocks.updateOrganizerRegistration.mockResolvedValue(undefined);
  });

  it('keeps confirmed teams in the main roster and shows controls only for waiting and solo registrations', async () => {
    await loadPanel();

    expect(screen.queryByText('Confirmed Pair')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Remove Confirmed Pair from sign-up' })).not.toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Waiting pairs and partner requests' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Remove Waiting Pair from sign-up' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Remove Shaun from sign-up' })).toBeInTheDocument();
  });

  it('lets the organiser edit a waiting registration on the canonical live list', async () => {
    await loadPanel();
    fireEvent.click(screen.getByRole('button', { name: 'Edit Waiting Pair' }));

    expect(screen.getByRole('heading', { name: 'Edit registration' })).toBeInTheDocument();
    fireEvent.change(screen.getByDisplayValue('Waiting Pair'), {
      target: { value: 'Corrected waiting pair' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));

    await waitFor(() => expect(signupMocks.updateOrganizerRegistration).toHaveBeenCalledWith(
      'waiting-pair',
      expect.objectContaining({
        teamName: 'Corrected waiting pair',
        playerOne: 'Alex',
        playerTwo: 'Kriss',
        contact: 'waiting@example.com',
      }),
      {
        status: 'waitlisted',
        updatedAt: '2026-08-29T00:01:00Z',
        allowLocked: false,
      },
    ));
  });

  it('does not delete when the organiser cancels confirmation', async () => {
    await loadPanel();
    fireEvent.click(screen.getByRole('button', { name: 'Remove Waiting Pair from sign-up' }));

    expect(screen.getByRole('heading', { name: 'Remove from sign-up?' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(signupMocks.deleteOrganizerRegistrationIfStatus).not.toHaveBeenCalled();
    expect(screen.getByText('Waiting Pair')).toBeInTheDocument();
  });

  it('deletes once, refreshes the authoritative list, and reports success', async () => {
    signupMocks.getOrganizerRegistrations
      .mockResolvedValueOnce(registrations)
      .mockResolvedValueOnce([registrations[0], registrations[2]]);
    await loadPanel();
    fireEvent.click(screen.getByRole('button', { name: 'Remove Waiting Pair from sign-up' }));
    fireEvent.click(screen.getByRole('button', { name: 'Remove' }));

    await waitFor(() => expect(signupMocks.deleteOrganizerRegistrationIfStatus).toHaveBeenCalledTimes(1));
    expect(signupMocks.deleteOrganizerRegistrationIfStatus).toHaveBeenCalledWith(
      'waiting-pair',
      'waitlisted',
      '2026-08-29T00:01:00Z',
      false,
    );
    await waitFor(() => expect(signupMocks.getOrganizerRegistrations).toHaveBeenCalledTimes(2));
    expect(await screen.findByText('Waiting Pair removed from this sign-up.')).toBeInTheDocument();
    expect(screen.queryByText('Waiting Pair')).not.toBeInTheDocument();
  });

  it('locks the confirmation while deleting and leaves the row visible on failure', async () => {
    let rejectDelete: (error: Error) => void = () => undefined;
    signupMocks.deleteOrganizerRegistrationIfStatus.mockImplementationOnce(() =>
      new Promise<void>((_resolve, reject) => {
        rejectDelete = reject;
      }));
    await loadPanel();
    fireEvent.click(screen.getByRole('button', { name: 'Remove Waiting Pair from sign-up' }));
    fireEvent.click(screen.getByRole('button', { name: 'Remove' }));

    const busyButton = await screen.findByRole('button', { name: 'Removing…' });
    expect(busyButton).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeDisabled();
    expect(signupMocks.deleteOrganizerRegistrationIfStatus).toHaveBeenCalledTimes(1);

    await act(async () => rejectDelete(new Error('Could not remove this registration.')));

    expect(await screen.findByText('Could not remove this registration.')).toBeInTheDocument();
    expect(screen.getByText('Waiting Pair')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Remove' })).toBeEnabled();
  });

  it('deletes by stable id even if the queue is rebalanced while confirmation is open', async () => {
    signupMocks.getOrganizerRegistrations
      .mockResolvedValueOnce(registrations)
      .mockResolvedValueOnce([registrations[0], registrations[2]]);
    await loadPanel();
    fireEvent.click(screen.getByRole('button', { name: 'Remove Waiting Pair from sign-up' }));
    fireEvent.click(screen.getByRole('button', { name: 'Remove' }));

    expect(await screen.findByText('Waiting Pair removed from this sign-up.')).toBeInTheDocument();
    expect(signupMocks.deleteOrganizerRegistrationIfStatus).toHaveBeenCalledWith(
      'waiting-pair',
      'waitlisted',
      '2026-08-29T00:01:00Z',
      false,
    );
    await waitFor(() => expect(signupMocks.getOrganizerRegistrations).toHaveBeenCalledTimes(2));
    expect(screen.queryByText('Waiting Pair')).not.toBeInTheDocument();
  });

  it('ignores an older refresh that resolves after the post-delete refresh', async () => {
    let resolveOldRefresh: (rows: SignupRegistration[]) => void = () => undefined;
    signupMocks.getOrganizerRegistrations
      .mockResolvedValueOnce(registrations)
      .mockImplementationOnce(() => new Promise<SignupRegistration[]>((resolve) => {
        resolveOldRefresh = resolve;
      }))
      .mockResolvedValueOnce([registrations[0], registrations[2]]);
    const view = await loadPanel();

    view.rerender(panel({ refreshRegistrationsVersion: 1 }));
    await waitFor(() => expect(signupMocks.getOrganizerRegistrations).toHaveBeenCalledTimes(2));
    fireEvent.click(screen.getByRole('button', { name: 'Remove Waiting Pair from sign-up' }));
    fireEvent.click(screen.getByRole('button', { name: 'Remove' }));

    expect(await screen.findByText('Waiting Pair removed from this sign-up.')).toBeInTheDocument();
    expect(screen.queryByText('Waiting Pair')).not.toBeInTheDocument();

    await act(async () => resolveOldRefresh(registrations));

    expect(screen.queryByText('Waiting Pair')).not.toBeInTheDocument();
  });
});

describe('online signup synchronisation regressions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    signupMocks.saveSignupEvent.mockReset();
    signupMocks.getSignupAccountSlug.mockResolvedValue('shaun');
    signupMocks.getSignupTemplates.mockResolvedValue([]);
    signupMocks.getOrganizerRegistrations.mockResolvedValue([registrations[0]]);
    signupMocks.seedOrganizerSignupRoster.mockResolvedValue({ seeded: true });
  });

  it('uses clear date controls and five-minute time intervals', async () => {
    signupMocks.getOwnedSignup.mockResolvedValue(signup);

    renderPanel();
    const startsTime = await screen.findByRole('combobox', { name: 'Starts time' });
    const options = Array.from((startsTime as HTMLSelectElement).options).map((option) => option.value);

    expect(screen.getByLabelText('Starts date')).toHaveAttribute('type', 'date');
    expect(screen.getByLabelText('Ends date')).toHaveAttribute('type', 'date');
    expect(options).toContain('18:00');
    expect(options).toContain('18:05');
    expect(options).not.toContain('18:01');
  });

  it('sets the end time from a useful duration shortcut', async () => {
    signupMocks.getOwnedSignup.mockResolvedValue(signup);

    renderPanel();
    fireEvent.change(await screen.findByLabelText('Starts date'), { target: { value: '2026-09-07' } });
    fireEvent.change(screen.getByRole('combobox', { name: 'Starts time' }), { target: { value: '18:05' } });
    fireEvent.click(screen.getByRole('button', { name: '2 hours' }));

    expect(screen.getByLabelText('Ends date')).toHaveValue('2026-09-07');
    expect(screen.getByRole('combobox', { name: 'Ends time' })).toHaveValue('20:05');
  });

  it('highlights and focuses the exact schedule field that needs fixing', async () => {
    signupMocks.getOwnedSignup.mockResolvedValue({
      ...signup,
      startsAt: '2026-09-07T12:00:00.000Z',
      endsAt: '2026-09-07T10:00:00.000Z',
    });

    renderPanel();
    const endsDate = await screen.findByLabelText('Ends date');
    fireEvent.click(screen.getByRole('button', { name: 'Update sign-up page' }));

    expect(screen.getByText('End time must be after the start time.')).toBeInTheDocument();
    expect(endsDate).toHaveAttribute('aria-invalid', 'true');
    await waitFor(() => expect(endsDate).toHaveFocus());
    expect(signupMocks.saveSignupEvent).not.toHaveBeenCalled();
  });

  it('syncs every complete confirmed pair into the one tournament roster', async () => {
    signupMocks.getOwnedSignup.mockResolvedValue({ ...signup, autoAddPairs: true });
    const onSyncTeams = vi.fn();
    render(panel({ teams: [], onSyncTeams }));
    await waitFor(() => expect(onSyncTeams).toHaveBeenCalledTimes(1));
    expect(onSyncTeams.mock.calls[0][0]).toEqual([
      expect.objectContaining({ id: 'confirmed-1' }),
    ]);
  });

  it('does not reconcile a local organiser edit against the previous server snapshot', async () => {
    signupMocks.getOwnedSignup.mockResolvedValue({ ...signup, autoAddPairs: true });
    const originalImportedTeam: Team = {
      id: 'local-confirmed-1',
      name: 'Confirmed Pair',
      players: [
        { id: 'player-tapia', name: 'Tapia' },
        { id: 'player-coello', name: 'Coello' },
      ],
      createdAt: 1,
      active: true,
      signupPairKey: 'coello|tapia',
      signupRegistrationId: 'confirmed-1',
    };
    const renamedImportedTeam: Team = {
      ...originalImportedTeam,
      name: 'Renamed Pair',
      players: [
        { ...originalImportedTeam.players[0], name: 'Renamed Tapia' },
        { ...originalImportedTeam.players[1], name: 'Renamed Coello' },
      ],
      signupPairKey: 'renamed coello|renamed tapia',
    };
    let resolveFreshSnapshot: (rows: SignupRegistration[]) => void = () => undefined;
    signupMocks.getOrganizerRegistrations
      .mockResolvedValueOnce([registrations[0]])
      .mockImplementationOnce(() => new Promise<SignupRegistration[]>((resolve) => {
        resolveFreshSnapshot = resolve;
      }));
    const onSyncTeams = vi.fn();
    const view = render(panel({ teams: [originalImportedTeam], onSyncTeams }));
    await waitFor(() => expect(onSyncTeams).toHaveBeenCalledTimes(1));

    view.rerender(panel({
      teams: [renamedImportedTeam],
      onSyncTeams,
      refreshRegistrationsVersion: 1,
    }));
    await waitFor(() => expect(signupMocks.getOrganizerRegistrations).toHaveBeenCalledTimes(2));
    await act(async () => undefined);

    expect(onSyncTeams).toHaveBeenCalledTimes(1);

    await act(async () => resolveFreshSnapshot([{
      ...registrations[0],
      teamName: 'Renamed Pair',
      playerOne: 'Renamed Tapia',
      playerTwo: 'Renamed Coello',
    }]));
    await waitFor(() => expect(onSyncTeams).toHaveBeenCalledTimes(2));
    expect(onSyncTeams.mock.calls[1][0]).toEqual([
      expect.objectContaining({
        id: 'confirmed-1',
        teamName: 'Renamed Pair',
        playerOne: 'Renamed Tapia',
        playerTwo: 'Renamed Coello',
      }),
    ]);
  });

  it('does not let an older capacity write beat the latest expected team count', async () => {
    signupMocks.getOwnedSignup.mockResolvedValue(signup);
    let remoteCapacity = signup.capacityTeams;
    let resolveStaleWrite: (() => void) | undefined;
    signupMocks.saveSignupEvent
      .mockImplementationOnce((input: SaveSignupInput) => new Promise<SignupEventMutationResult>((resolve) => {
        resolveStaleWrite = () => {
          remoteCapacity = input.capacityTeams;
          resolve({
            event: { ...signup, capacityTeams: input.capacityTeams, capacityRevision: 2 },
            applied: true,
            conflict: false,
          });
        };
      }))
      .mockImplementation(async (input: SaveSignupInput) => {
        remoteCapacity = input.capacityTeams;
        return {
          event: { ...signup, capacityTeams: input.capacityTeams, capacityRevision: 3 },
          applied: true,
          conflict: false,
        };
      });

    const view = render(panel({ expectedTeams: 6 }));
    await waitFor(() => expect(signupMocks.saveSignupEvent).toHaveBeenCalledTimes(1));
    expect(signupMocks.saveSignupEvent.mock.calls[0][0]).toEqual(
      expect.objectContaining({ capacityTeams: 6 }),
    );

    view.rerender(panel({ expectedTeams: 4 }));
    await waitFor(() => expect(signupMocks.getOwnedSignup).toHaveBeenCalledTimes(2));

    await act(async () => {
      resolveStaleWrite?.();
      await Promise.resolve();
    });

    await waitFor(() => {
      const calls = signupMocks.saveSignupEvent.mock.calls;
      expect(calls[calls.length - 1]?.[0]).toEqual(
        expect.objectContaining({ capacityTeams: 4, baseRevision: 2 }),
      );
    });
    expect(remoteCapacity).toBe(4);
  });

  it('does not replay local teams into an existing online roster', async () => {
    signupMocks.getOwnedSignup.mockResolvedValue(signup);
    const manualTeam: Team = {
      id: 'manual-team',
      name: 'Invited pair',
      players: [
        { id: 'manual-player-1', name: 'Manual One' },
        { id: 'manual-player-2', name: 'Manual Two' },
      ],
      createdAt: 1,
      active: true,
    };

    render(panel({ teams: [manualTeam] }));

    await waitFor(() => expect(signupMocks.getOrganizerRegistrations).toHaveBeenCalled());
    expect(signupMocks.seedOrganizerSignupRoster).not.toHaveBeenCalled();
    expect(signupMocks.saveSignupEvent).not.toHaveBeenCalled();
  });

  it('never seeds again when an established sign-up is updated', async () => {
    signupMocks.getOwnedSignup.mockResolvedValue(signup);
    signupMocks.saveSignupEvent.mockResolvedValue({
      event: { ...signup, capacityRevision: 2 },
      applied: true,
      conflict: false,
    });

    renderPanel();
    fireEvent.click(await screen.findByRole('button', { name: 'Update sign-up page' }));

    await waitFor(() => expect(signupMocks.saveSignupEvent).toHaveBeenCalledTimes(1));
    expect(signupMocks.seedOrganizerSignupRoster).not.toHaveBeenCalled();
  });

  it('seeds an unseeded existing sign-up during initial load', async () => {
    signupMocks.getOwnedSignup.mockResolvedValue({ ...signup, rosterSeededAt: null });
    const manualTeam: Team = {
      id: 'manual-team',
      name: 'Invited pair',
      players: [
        { id: 'manual-player-1', name: 'Manual One' },
        { id: 'manual-player-2', name: 'Manual Two' },
      ],
      createdAt: 1,
      active: true,
    };

    render(panel({ teams: [manualTeam] }));

    await waitFor(() => expect(signupMocks.seedOrganizerSignupRoster).toHaveBeenCalledWith(
      'signup-1',
      [expect.objectContaining({
        playerOne: 'Manual One',
        playerTwo: 'Manual Two',
        rank: 1,
      })],
    ));
  });

  it('adopts local teams once when the online sign-up is first published', async () => {
    signupMocks.getOwnedSignup.mockResolvedValue(null);
    signupMocks.saveSignupEvent.mockResolvedValue({
      event: { ...signup, rosterSeededAt: null },
      applied: true,
      conflict: false,
    });
    const manualTeam: Team = {
      id: 'manual-team',
      name: 'Invited pair',
      players: [
        { id: 'manual-player-1', name: 'Manual One' },
        { id: 'manual-player-2', name: 'Manual Two' },
      ],
      createdAt: 1,
      active: true,
    };

    render(panel({ teams: [manualTeam] }));
    fireEvent.click(await screen.findByRole('button', { name: /Online team sign-up/i }));
    fireEvent.click(screen.getByRole('button', { name: 'Publish sign-up page' }));

    await waitFor(() => expect(signupMocks.seedOrganizerSignupRoster).toHaveBeenCalledWith(
      'signup-1',
      [expect.objectContaining({
        playerOne: 'Manual One',
        playerTwo: 'Manual Two',
        rank: 1,
      })],
    ));
  });

  it('durably seeds an empty roster on first publish', async () => {
    signupMocks.getOwnedSignup.mockResolvedValue(null);
    signupMocks.saveSignupEvent.mockResolvedValue({
      event: { ...signup, rosterSeededAt: null },
      applied: true,
      conflict: false,
    });

    render(panel());
    fireEvent.click(await screen.findByRole('button', { name: /Online team sign-up/i }));
    fireEvent.click(screen.getByRole('button', { name: 'Publish sign-up page' }));

    await waitFor(() => expect(signupMocks.seedOrganizerSignupRoster).toHaveBeenCalledWith(
      'signup-1',
      [],
    ));
  });

  it('retries the one-time seed safely after a publish network failure', async () => {
    const published = { ...signup, rosterSeededAt: null };
    signupMocks.getOwnedSignup.mockResolvedValue(null);
    signupMocks.saveSignupEvent.mockResolvedValue({
      event: published,
      applied: true,
      conflict: false,
    });
    signupMocks.seedOrganizerSignupRoster
      .mockRejectedValueOnce(new Error('Connection lost after publishing.'))
      .mockResolvedValueOnce({ seeded: false });

    render(panel());
    fireEvent.click(await screen.findByRole('button', { name: /Online team sign-up/i }));
    fireEvent.click(screen.getByRole('button', { name: 'Publish sign-up page' }));

    expect(await screen.findByText('Connection lost after publishing.')).toBeInTheDocument();
    expect(signupMocks.seedOrganizerSignupRoster).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole('button', { name: 'Update sign-up page' }));

    await waitFor(() => expect(signupMocks.seedOrganizerSignupRoster).toHaveBeenCalledTimes(2));
    expect(signupMocks.seedOrganizerSignupRoster.mock.calls[1]).toEqual(['signup-1', []]);
    expect(await screen.findByText('Sign-up page updated.')).toBeInTheDocument();
  });

  it('reloads the authoritative form after a save conflict instead of enabling a stale retry', async () => {
    signupMocks.getOwnedSignup.mockResolvedValue(signup);
    signupMocks.saveSignupEvent.mockResolvedValueOnce({
      event: {
        ...signup,
        title: 'Latest title from another tab',
        details: 'Latest details',
        capacityRevision: 2,
      },
      applied: false,
      conflict: true,
    });
    renderPanel();
    const titleInput = await screen.findByDisplayValue('Monday Night KoC');
    fireEvent.change(titleInput, { target: { value: 'Stale local title' } });
    fireEvent.click(screen.getByRole('button', { name: 'Update sign-up page' }));

    expect(await screen.findByText(
      'This sign-up changed in another tab, so the latest version was reloaded. Review it before saving again.',
    )).toBeInTheDocument();
    expect(screen.getByDisplayValue('Latest title from another tab')).toBeInTheDocument();
    expect(screen.queryByDisplayValue('Stale local title')).not.toBeInTheDocument();
    expect(signupMocks.saveSignupEvent).toHaveBeenCalledTimes(1);
  });
});
