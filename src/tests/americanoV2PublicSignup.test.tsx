import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const signupMocks = vi.hoisted(() => ({
  getPublicSignup: vi.fn(),
  registerPublicTeam: vi.fn(),
  joinPublicSingle: vi.fn(),
}));
const americanoMocks = vi.hoisted(() => ({
  registerPublicAmericanoPlayer: vi.fn(),
  registerPublicAmericanoSingle: vi.fn(),
  registerPublicAmericanoPair: vi.fn(),
  joinPublicAmericanoPair: vi.fn(),
}));

vi.mock('@/lib/signups', () => signupMocks);
vi.mock('@/lib/americanoV2', () => americanoMocks);

import { PublicSignupScreen } from '@/routes/PublicSignupScreen';

const baseEvent = {
  id: 'signup-v2', publicSlug: 'public-v2', accountSlug: 'owner', eventSlug: 'americano-night',
  title: 'Americano Night', venue: 'Test Club', startsAt: '2099-09-11T10:00:00.000Z',
  endsAt: '2099-09-11T12:00:00.000Z', capacityTeams: 8,
  capacity: { unit: 'players', value: 8 }, protocolVersion: 2, entryMode: 'individual',
  details: '', prizes: '', isOpen: true, cancelledAt: null, cancellationMessage: '',
  organizerName: 'Owner', publicContactMethod: null, publicContactValue: '', autoAddPairs: false,
};

function renderPage() {
  return render(<MemoryRouter initialEntries={['/signup/owner/americano-night']}><Routes><Route path="/signup/:accountSlug/:slug" element={<PublicSignupScreen />} /></Routes></MemoryRouter>);
}

describe('Americano v2 public signup', () => {
  beforeEach(() => {
    Object.values(signupMocks).forEach((mock) => mock.mockReset());
    Object.values(americanoMocks).forEach((mock) => mock.mockReset());
  });

  it('renders rotating mode as individual players with no team or partner controls', async () => {
    signupMocks.getPublicSignup.mockResolvedValue({
      event: baseEvent,
      registrations: [{
        id: 'player-1', signupEventId: 'signup-v2', teamName: '', playerOne: 'Alex', playerTwo: '',
        status: 'confirmed', position: 1, createdAt: '2099-09-01T00:00:00.000Z',
      }],
    });
    renderPage();

    expect(await screen.findByRole('heading', { name: 'Americano Night' })).toBeInTheDocument();
    expect(screen.getByText('Players rotate partners each round. Points belong to each player.')).toBeInTheDocument();
    expect(screen.getByLabelText(/^Your name/)).toBeInTheDocument();
    expect(screen.queryByLabelText(/^Pair name/)).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Sign up solo' })).not.toBeInTheDocument();
    expect(screen.getAllByText('Alex')).toHaveLength(1);
    expect(screen.getByText('PLAYER · CONFIRMED')).toBeInTheDocument();
  });

  it('uses the individual v2 RPC and maps its field error back to the contact control', async () => {
    signupMocks.getPublicSignup.mockResolvedValue({ event: baseEvent, registrations: [] });
    americanoMocks.registerPublicAmericanoPlayer.mockResolvedValue({
      status: 'rejected', requestId: 'request-1', code: 'INVALID_PAYLOAD', message: 'Enter a valid contact.', field: 'contact',
    });
    renderPage();
    await screen.findByRole('heading', { name: 'Americano Night' });
    fireEvent.change(screen.getByLabelText(/^Your name/), { target: { value: 'Alex' } });
    fireEvent.change(screen.getByLabelText(/^WhatsApp number or email/), { target: { value: 'x' } });
    fireEvent.click(screen.getByRole('button', { name: 'Register as a player' }));

    await waitFor(() => expect(americanoMocks.registerPublicAmericanoPlayer).toHaveBeenCalledWith(expect.objectContaining({
      accountSlug: 'owner', eventSlug: 'americano-night', playerName: 'Alex', contact: 'x', requestId: expect.any(String),
    })));
    expect(await screen.findAllByText('Enter a valid contact.')).toHaveLength(2);
    expect(screen.getByLabelText(/^WhatsApp number or email/)).toHaveFocus();
    expect(signupMocks.registerPublicTeam).not.toHaveBeenCalled();
  });

  it('routes fixed-pair registration and partner joining through protocol-2 RPCs', async () => {
    const fixed = {
      ...baseEvent,
      capacityTeams: 4,
      capacity: { unit: 'teams', value: 4 },
      entryMode: 'fixed-pairs',
    };
    signupMocks.getPublicSignup.mockResolvedValue({
      event: fixed,
      registrations: [{
        id: 'solo-1', signupEventId: 'signup-v2', teamName: '', playerOne: 'Pat', playerTwo: '',
        status: 'looking', position: 1, createdAt: '2099-09-01T00:00:00.000Z',
      }],
    });
    americanoMocks.joinPublicAmericanoPair.mockResolvedValue({
      status: 'applied', requestId: 'join', registrationId: 'solo-1', entryMode: 'fixed-pairs', registrationStatus: 'confirmed', position: 1,
    });
    renderPage();
    await screen.findByRole('heading', { name: 'Americano Night' });
    fireEvent.click(screen.getByRole('button', { name: 'Join' }));
    fireEvent.change(screen.getByLabelText(/^Your name/), { target: { value: 'Sam' } });
    fireEvent.change(screen.getByLabelText(/^Your WhatsApp number or email/), { target: { value: '+621234' } });
    fireEvent.click(screen.getByRole('button', { name: 'Join Pat' }));

    await waitFor(() => expect(americanoMocks.joinPublicAmericanoPair).toHaveBeenCalledWith(expect.objectContaining({
      registrationId: 'solo-1', playerTwo: 'Sam', contact: '+621234', requestId: expect.any(String),
    })));
    expect(signupMocks.joinPublicSingle).not.toHaveBeenCalled();
  });

  it('routes a fixed-pair solo signup to the partner-request RPC', async () => {
    const fixed = {
      ...baseEvent,
      capacityTeams: 4,
      capacity: { unit: 'teams', value: 4 },
      entryMode: 'fixed-pairs',
    };
    signupMocks.getPublicSignup.mockResolvedValue({ event: fixed, registrations: [] });
    americanoMocks.registerPublicAmericanoSingle.mockResolvedValue({
      status: 'applied', requestId: 'single', registrationId: 'solo-2', entryMode: 'fixed-pairs', registrationStatus: 'looking', position: 1,
    });
    renderPage();
    await screen.findByRole('heading', { name: 'Americano Night' });
    fireEvent.click(screen.getByRole('button', { name: 'Sign up solo' }));
    fireEvent.change(screen.getByLabelText(/^Your name/), { target: { value: 'Taylor' } });
    fireEvent.change(screen.getByLabelText(/^WhatsApp number or email/), { target: { value: '+621235' } });
    fireEvent.click(screen.getByRole('button', { name: 'Register me' }));

    await waitFor(() => expect(americanoMocks.registerPublicAmericanoSingle).toHaveBeenCalledWith(expect.objectContaining({
      accountSlug: 'owner', eventSlug: 'americano-night', playerOne: 'Taylor', contact: '+621235', requestId: expect.any(String),
    })));
    expect(americanoMocks.registerPublicAmericanoPair).not.toHaveBeenCalled();
    expect(signupMocks.registerPublicTeam).not.toHaveBeenCalled();
  });
});
