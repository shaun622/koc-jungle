import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { createTournamentV1, publicProjection } from '@/logic/tournament';
import { TournamentPublicError } from '@/lib/tournamentPublic';
import { TournamentPublicSignup } from '@/routes/tournament/TournamentPublicSignup';

const mocks = vi.hoisted(() => ({ load: vi.fn(), submit: vi.fn() }));
vi.mock('@/lib/tournamentPublic', async (original) => ({ ...await original<typeof import('@/lib/tournamentPublic')>(), loadPublicTournament: mocks.load, submitPublicTournamentPair: mocks.submit }));

function projection() {
  const state = createTournamentV1({ id: '00000000-0000-4000-a000-000000000001', title: 'Club Championship', now: Date.now(), divisionId: 'division', courtIds: ['court'] });
  state.meta.publicSlug = 'club-championship'; state.meta.signupOpen = true; state.meta.startsAt = new Date(Date.now() + 86_400_000).toISOString();
  state.players.push({ id: 'p1', name: 'Alex' }, { id: 'p2', name: 'Sam' });
  state.entries.push({ id: 'entry', divisionId: 'division', teamName: 'Smashers', playerIds: ['p1','p2'], admission: 'confirmed', readiness: 'ready', acceptedAt: 1, waitRank: null, activeLineupRevisionId: 'lineup' });
  state.lineupRevisions.push({ id: 'lineup', entryId: 'entry', playerIds: ['p1','p2'], effectiveFixtureIds: [], createdAt: 1, reason: 'Initial' });
  return publicProjection(state);
}

function renderRoute() {
  render(<MemoryRouter initialEntries={['/t/club-championship/signup']}><Routes><Route path="/t/:publicSlug/signup" element={<TournamentPublicSignup/>}/></Routes></MemoryRouter>);
}

beforeEach(() => { sessionStorage.clear(); mocks.load.mockResolvedValue({ projection: projection(), revision: '0', updatedAt: new Date().toISOString() }); mocks.submit.mockReset(); });
afterEach(() => { cleanup(); sessionStorage.clear(); });

describe('tournament v1 public signup', () => {
  it('loads only the anonymous public projection and never renders a private contact', async () => {
    renderRoute();
    expect(await screen.findByRole('heading', { name: 'Club Championship' })).toBeInTheDocument();
    expect(screen.getByText('Smashers')).toBeInTheDocument();
    expect(screen.getByText('Alex & Sam')).toBeInTheDocument();
    expect(screen.queryByText('+62 private')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Register our pair' })).toBeDisabled();
    fireEvent.change(screen.getByLabelText('Player one'), { target: { value: 'New One' } });
    fireEvent.change(screen.getByLabelText('Player two'), { target: { value: 'New Two' } });
    expect(screen.getByRole('button', { name: 'Register our pair' })).toBeEnabled();
  });

  it('keeps the exact immutable submission ID after an unknown outcome', async () => {
    mocks.submit.mockRejectedValueOnce(new TournamentPublicError('NETWORK', 'Unknown outcome.')).mockResolvedValueOnce({ status: 'replayed', result: { admission: 'confirmed' } });
    renderRoute();
    await screen.findByRole('heading', { name: 'Club Championship' });
    fireEvent.change(screen.getByLabelText('Player one'), { target: { value: 'Retry' } });
    fireEvent.change(screen.getByLabelText('Player two'), { target: { value: 'Pair' } });
    fireEvent.click(screen.getByRole('button', { name: 'Register our pair' }));
    expect(await screen.findByText(/unknown outcome/i)).toBeInTheDocument();
    const first = mocks.submit.mock.calls[0][1];
    fireEvent.click(screen.getByRole('button', { name: 'Retry registration' }));
    await waitFor(() => expect(mocks.submit).toHaveBeenCalledTimes(2));
    expect(mocks.submit.mock.calls[1][1]).toEqual(first);
    expect(await screen.findByText(/pair is confirmed/i)).toBeInTheDocument();
  });
});
