import { StrictMode } from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const signupMocks = vi.hoisted(() => ({
  getPublicSignup: vi.fn(),
  registerPublicTeam: vi.fn(),
  joinPublicSingle: vi.fn(),
}));

vi.mock('@/lib/signups', () => signupMocks);

import { PublicSignupScreen } from '@/routes/PublicSignupScreen';

const publicSignup = {
  event: {
    id: 'signup-1',
    ownerUserId: 'owner-1',
    sourceEventId: 'event-1',
    publicSlug: 'share-1',
    accountSlug: 'krissbell',
    eventSlug: '31-aug-2026-silver-king-of-the-court',
    title: 'Silver King of the Court',
    venue: 'Jungle Padel Sanur',
    startsAt: '2026-08-31T10:00:00.000Z',
    endsAt: '2026-08-31T12:00:00.000Z',
    capacityTeams: 16,
    details: '',
    prizes: '',
    isOpen: true,
    autoAddPairs: true,
  },
  registrations: [],
};

function renderSignup() {
  return render(
    <StrictMode>
      <MemoryRouter initialEntries={['/signup/krissbell/31-aug-2026-silver-king-of-the-court']}>
        <Routes>
          <Route path="/signup/:accountSlug/:slug" element={<PublicSignupScreen />} />
        </Routes>
      </MemoryRouter>
    </StrictMode>,
  );
}

describe('public sign-up loading', () => {
  beforeEach(() => {
    signupMocks.getPublicSignup.mockReset();
    signupMocks.registerPublicTeam.mockReset();
    signupMocks.joinPublicSingle.mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('shows a friendly timeout and can retry successfully', async () => {
    signupMocks.getPublicSignup
      .mockRejectedValueOnce(new Error('Query timed out after 12000ms'))
      .mockResolvedValueOnce(publicSignup);

    renderSignup();

    expect(await screen.findByText('Sign-up unavailable')).toBeInTheDocument();
    expect(screen.getByText('The event took too long to load. Check your connection and try again.'))
      .toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));

    expect(await screen.findByRole('heading', { name: 'Silver King of the Court' }))
      .toBeInTheDocument();
    expect(signupMocks.getPublicSignup).toHaveBeenCalledTimes(2);
  });

  it('waits for the current request before scheduling the next poll', async () => {
    vi.useFakeTimers();
    let resolveFirst: (value: typeof publicSignup) => void = () => undefined;
    signupMocks.getPublicSignup.mockImplementationOnce(
      () => new Promise<typeof publicSignup>((resolve) => {
        resolveFirst = resolve;
      }),
    );
    signupMocks.getPublicSignup.mockResolvedValue(publicSignup);

    renderSignup();
    await act(async () => undefined);
    expect(signupMocks.getPublicSignup).toHaveBeenCalledTimes(1);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(24_000);
    });
    expect(signupMocks.getPublicSignup).toHaveBeenCalledTimes(1);

    await act(async () => {
      resolveFirst(publicSignup);
      await Promise.resolve();
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(8_000);
    });
    expect(signupMocks.getPublicSignup).toHaveBeenCalledTimes(2);
  });

  it('renders pair capacity, partner seekers and waiting pairs as disjoint lists', async () => {
    signupMocks.getPublicSignup.mockResolvedValue({
      ...publicSignup,
      event: { ...publicSignup.event, capacityTeams: 2 },
      registrations: [
        {
          id: 'confirmed-pair',
          signupEventId: 'signup-1',
          teamName: 'Confirmed Pair',
          playerOne: 'Alex',
          playerTwo: 'Kriss',
          status: 'confirmed',
          position: 1,
          createdAt: '2026-08-31T00:00:00.000Z',
        },
        {
          id: 'confirmed-solo',
          signupEventId: 'signup-1',
          teamName: '',
          playerOne: 'Legacy Confirmed Solo',
          playerTwo: '',
          status: 'confirmed',
          position: 2,
          createdAt: '2026-08-31T00:01:00.000Z',
        },
        {
          id: 'waiting-pair',
          signupEventId: 'signup-1',
          teamName: 'Waiting Pair',
          playerOne: 'Pat',
          playerTwo: 'Sam',
          status: 'waitlisted',
          position: 1,
          createdAt: '2026-08-31T00:02:00.000Z',
        },
        {
          id: 'waiting-solo',
          signupEventId: 'signup-1',
          teamName: '',
          playerOne: 'Legacy Waiting Solo',
          playerTwo: '   ',
          status: 'waitlisted',
          position: 2,
          createdAt: '2026-08-31T00:03:00.000Z',
        },
      ],
    });

    renderSignup();

    expect(await screen.findByRole('heading', { name: 'Silver King of the Court' }))
      .toBeInTheDocument();
    expect(screen.getByText('1/2')).toBeInTheDocument();
    expect(screen.getByText('1 team space left')).toBeInTheDocument();
    expect(screen.getAllByText('Confirmed Pair')).toHaveLength(1);
    expect(screen.getAllByText('Waiting Pair')).toHaveLength(1);
    expect(screen.getAllByText('Legacy Confirmed Solo')).toHaveLength(1);
    expect(screen.getAllByText('Legacy Waiting Solo')).toHaveLength(1);
    expect(screen.getByText('LOOKING FOR A PARTNER')).toBeInTheDocument();
    expect(screen.getAllByText('NEEDS PARTNER')).toHaveLength(2);
    expect(screen.getAllByText('PAIR · WAITING')).toHaveLength(1);
  });
});
