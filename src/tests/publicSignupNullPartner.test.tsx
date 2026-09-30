import { StrictMode } from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock('@/lib/supabase', () => ({ supabase: null, publicSupabase: { rpc: mocks.rpc } }));
import { PublicSignupScreen } from '@/routes/PublicSignupScreen';

const event = {
  id: 'signup', publicSlug: 'night', accountSlug: 'owner', eventSlug: 'night',
  title: 'Test Padel Night', venue: 'Test Club', startsAt: '2099-10-05T10:00:00Z',
  endsAt: '2099-10-05T12:00:00Z', capacityTeams: 4, details: '', prizes: '', isOpen: true,
};
const pair = {
  id: 'pair', signupEventId: 'signup', teamName: 'Smashers', playerOne: 'Alex', playerTwo: 'Sam',
  status: 'confirmed', position: 1, createdAt: '2099-10-01T00:00:00Z',
};
const solo = { ...pair, id: 'solo', teamName: '', playerOne: 'Pat', playerTwo: null, status: 'looking' };
const waiting = { ...pair, id: 'waiting', teamName: 'Lobsters', playerOne: 'Jo', playerTwo: 'Lee', status: 'waitlisted' };
const snapshot = { event, registrations: [pair, waiting, solo] };
const invalidMessage = 'The sign-up server returned an invalid response. Refresh and try again.';

function renderPage() {
  return render(<StrictMode><MemoryRouter initialEntries={['/signup/owner/night']}>
    <Routes><Route path="/signup/:accountSlug/:slug" element={<PublicSignupScreen />} /></Routes>
  </MemoryRouter></StrictMode>);
}

describe('real public reader to signup screen', () => {
  beforeEach(() => mocks.rpc.mockReset());
  afterEach(() => vi.useRealTimers());

  it('renders nullable solo, named pairs, capacity and joining without exposing contacts', async () => {
    mocks.rpc.mockResolvedValue({ data: { ...snapshot, registrations: snapshot.registrations.map(row => ({
      ...row, contact: 'private@example.invalid', playerTwoContact: 'partner-private@example.invalid',
    })) }, error: null });
    renderPage();
    expect(await screen.findByRole('heading', { name: event.title })).toBeInTheDocument();
    expect(screen.getAllByText('Pat')).toHaveLength(1);
    expect(screen.getByText('NEEDS PARTNER')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Join' })).toBeInTheDocument();
    expect(screen.getByText('Smashers')).toBeInTheDocument();
    expect(screen.getByText('Alex & Sam')).toBeInTheDocument();
    expect(screen.getByText('Lobsters')).toBeInTheDocument();
    expect(screen.getByText('PAIR · WAITING')).toBeInTheDocument();
    expect(screen.getByText('1/4')).toBeInTheDocument();
    expect(screen.getByText('3 team spaces left')).toBeInTheDocument();
    expect(screen.queryByText(/private@example.invalid/)).not.toBeInTheDocument();
    expect(mocks.rpc).toHaveBeenCalledWith('get_public_signup_v3', { p_account_slug: 'owner', p_event_slug: 'night' });
  });

  it('keeps typed input and last-good roster through new solos, malformed refresh and recovery', async () => {
    vi.useFakeTimers();
    mocks.rpc.mockResolvedValueOnce({ data: { event, registrations: [pair] }, error: null })
      .mockResolvedValueOnce({ data: snapshot, error: null })
      .mockResolvedValueOnce({ data: { event, registrations: [null] }, error: null })
      .mockResolvedValue({ data: snapshot, error: null });
    renderPage();
    await act(async () => Promise.resolve());
    fireEvent.change(screen.getByLabelText(/^Player one/), { target: { value: 'Unsubmitted name' } });
    await act(async () => { await vi.advanceTimersByTimeAsync(8_000); });
    expect(screen.getByText('Pat')).toBeInTheDocument();
    expect(screen.getByLabelText(/^Player one/)).toHaveValue('Unsubmitted name');
    await act(async () => { await vi.advanceTimersByTimeAsync(8_000); });
    expect(screen.getByText('Live-list refresh failed. Your form is safe; we’ll retry automatically.')).toBeInTheDocument();
    expect(screen.getByText('Pat')).toBeInTheDocument();
    expect(screen.getByText('Smashers')).toBeInTheDocument();
    expect(screen.getByLabelText(/^Player one/)).toHaveValue('Unsubmitted name');
    await act(async () => { await vi.advanceTimersByTimeAsync(8_000); });
    expect(screen.queryByText('Live-list refresh failed. Your form is safe; we’ll retry automatically.')).not.toBeInTheDocument();
    expect(screen.getByText('Pat')).toBeInTheDocument();
    expect(mocks.rpc).toHaveBeenCalledTimes(4);
  });

  it('shows a retryable malformed initial response and recovers', async () => {
    mocks.rpc.mockResolvedValueOnce({ data: { event, registrations: null }, error: null })
      .mockResolvedValue({ data: snapshot, error: null });
    renderPage();
    expect(await screen.findByText('Sign-up unavailable')).toBeInTheDocument();
    expect(screen.getByText(invalidMessage)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByText('Pat')).toBeInTheDocument();
    expect(screen.queryByText(invalidMessage)).not.toBeInTheDocument();
  });

  it.each([
    { isOpen: false },
    { startsAt: '2020-01-01T10:00:00Z', endsAt: '2020-01-01T12:00:00Z' },
  ])('preserves nullable solo roster but prevents joining a closed/past event %j', async (overrides) => {
    mocks.rpc.mockResolvedValue({ data: { ...snapshot, event: { ...event, ...overrides } }, error: null });
    renderPage();
    expect(await screen.findByText('Pat')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Join' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Register our pair' })).not.toBeInTheDocument();
  });
});
