import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_SETTINGS, type EventState } from '@/types/domain';
import type { SignupEvent, SignupRegistration } from '@/lib/signups';

const signupMocks = vi.hoisted(() => ({
  deleteOrganizerWaitlistedRegistration: vi.fn(),
  getOrganizerRegistrations: vi.fn(),
  getOwnedSignup: vi.fn(),
  getSignupAccountSlug: vi.fn(),
  getSignupTemplates: vi.fn(),
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
  details: '',
  prizes: '',
  isOpen: true,
  autoAddPairs: false,
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
  },
];

function panel(refreshRegistrationsVersion = 0) {
  return (
    <EventSignupPanel
      event={event}
      expectedTeams={4}
      teams={[]}
      onAddTeams={vi.fn()}
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

describe('organiser waiting-list deletion', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    signupMocks.getOwnedSignup.mockResolvedValue(signup);
    signupMocks.getSignupAccountSlug.mockResolvedValue('shaun');
    signupMocks.getSignupTemplates.mockResolvedValue([]);
    signupMocks.getOrganizerRegistrations.mockResolvedValue(registrations);
    signupMocks.deleteOrganizerWaitlistedRegistration.mockResolvedValue(undefined);
  });

  it('offers delete controls for waitlisted pairs and solos, but not confirmed teams', async () => {
    await loadPanel();

    expect(screen.getByRole('button', { name: 'Remove Waiting Pair from waiting list' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Remove Shaun from waiting list' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Remove Confirmed Pair from waiting list' })).not.toBeInTheDocument();
  });

  it('does not delete when the organiser cancels confirmation', async () => {
    await loadPanel();
    fireEvent.click(screen.getByRole('button', { name: 'Remove Waiting Pair from waiting list' }));

    expect(screen.getByRole('heading', { name: 'Remove from waiting list?' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(signupMocks.deleteOrganizerWaitlistedRegistration).not.toHaveBeenCalled();
    expect(screen.getByText('Waiting Pair')).toBeInTheDocument();
  });

  it('deletes once, refreshes the authoritative list, and reports success', async () => {
    signupMocks.getOrganizerRegistrations
      .mockResolvedValueOnce(registrations)
      .mockResolvedValueOnce([registrations[0], registrations[2]]);
    await loadPanel();
    fireEvent.click(screen.getByRole('button', { name: 'Remove Waiting Pair from waiting list' }));
    fireEvent.click(screen.getByRole('button', { name: 'Remove' }));

    await waitFor(() => expect(signupMocks.deleteOrganizerWaitlistedRegistration).toHaveBeenCalledTimes(1));
    expect(signupMocks.deleteOrganizerWaitlistedRegistration).toHaveBeenCalledWith('waiting-pair');
    await waitFor(() => expect(signupMocks.getOrganizerRegistrations).toHaveBeenCalledTimes(2));
    expect(await screen.findByText('Waiting Pair removed from the waiting list.')).toBeInTheDocument();
    expect(screen.queryByText('Waiting Pair')).not.toBeInTheDocument();
  });

  it('locks the confirmation while deleting and leaves the row visible on failure', async () => {
    let rejectDelete: (error: Error) => void = () => undefined;
    signupMocks.deleteOrganizerWaitlistedRegistration.mockImplementationOnce(() =>
      new Promise<void>((_resolve, reject) => {
        rejectDelete = reject;
      }));
    await loadPanel();
    fireEvent.click(screen.getByRole('button', { name: 'Remove Waiting Pair from waiting list' }));
    fireEvent.click(screen.getByRole('button', { name: 'Remove' }));

    const busyButton = await screen.findByRole('button', { name: 'Removing…' });
    expect(busyButton).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeDisabled();
    expect(signupMocks.deleteOrganizerWaitlistedRegistration).toHaveBeenCalledTimes(1);

    await act(async () => rejectDelete(new Error('Could not remove this registration.')));

    expect(await screen.findByText('Could not remove this registration.')).toBeInTheDocument();
    expect(screen.getByText('Waiting Pair')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Remove' })).toBeEnabled();
  });

  it('cannot delete a registration promoted while confirmation was open', async () => {
    const promoted: SignupRegistration = {
      ...registrations[1],
      status: 'confirmed',
      position: 2,
    };
    signupMocks.getOrganizerRegistrations
      .mockResolvedValueOnce(registrations)
      .mockResolvedValueOnce([registrations[0], promoted, registrations[2]]);
    signupMocks.deleteOrganizerWaitlistedRegistration.mockRejectedValueOnce(
      new Error('This registration is no longer on the waiting list. Refresh and try again.'),
    );
    await loadPanel();
    fireEvent.click(screen.getByRole('button', { name: 'Remove Waiting Pair from waiting list' }));
    fireEvent.click(screen.getByRole('button', { name: 'Remove' }));

    expect(await screen.findByText('This registration is no longer on the waiting list. Refresh and try again.'))
      .toBeInTheDocument();
    await waitFor(() => expect(signupMocks.getOrganizerRegistrations).toHaveBeenCalledTimes(2));
    expect(screen.getByText('Waiting Pair')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Remove Waiting Pair from waiting list' })).not.toBeInTheDocument();
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

    view.rerender(panel(1));
    await waitFor(() => expect(signupMocks.getOrganizerRegistrations).toHaveBeenCalledTimes(2));
    fireEvent.click(screen.getByRole('button', { name: 'Remove Waiting Pair from waiting list' }));
    fireEvent.click(screen.getByRole('button', { name: 'Remove' }));

    expect(await screen.findByText('Waiting Pair removed from the waiting list.')).toBeInTheDocument();
    expect(screen.queryByText('Waiting Pair')).not.toBeInTheDocument();

    await act(async () => resolveOldRefresh(registrations));

    expect(screen.queryByText('Waiting Pair')).not.toBeInTheDocument();
  });
});
