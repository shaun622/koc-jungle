import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it } from 'vitest';
import { DisplayScreen } from '@/routes/DisplayScreen';
import { useEventStore } from '@/store/eventStore';
import { addAmericanoParticipantV3, createAmericanoEventV3, previewAmericanoScheduleV3, startAmericanoEventV3, updateAmericanoConfigV3 } from '@/logic/americanoV3/runtime';
import { computeAmericanoStandingsV3 } from '@/logic/americanoV3/standings';
import type { AmericanoEventStateV3 } from '@/logic/americanoV3/types';

async function liveV3() {
  let event = createAmericanoEventV3('V3 event night', 'rotating', 1);
  event = updateAmericanoConfigV3(event, { scheduleKind: 'custom', customRounds: 1, ranking: { tiebreak: 'shared', championship: 'golden-point' } });
  for (const name of ['Ari', 'Bo', 'Cam', 'Dee']) event = addAmericanoParticipantV3(event, name);
  return startAmericanoEventV3(await previewAmericanoScheduleV3(event, { seed: 82, acknowledgeUnevenAppearances: true }));
}

function renderDisplay() {
  return render(<MemoryRouter><DisplayScreen /></MemoryRouter>);
}

afterEach(() => {
  cleanup();
  window.history.replaceState({}, '', '/');
  useEventStore.setState({ event: null });
});

describe('Americano v3 event-night UI', () => {
  it('scores and completes a round, resolves an exact two-way tie, and keeps final points separate', async () => {
    const event = await liveV3();
    act(() => useEventStore.setState({ event: event as never }));
    renderDisplay();
    const match = event.rounds[0].matches[0];
    const sideA = match.sideA.playerIds.map((id) => event.participants.find((row) => row.id === id)!.name).join(' & ');
    const sideB = match.sideB.playerIds.map((id) => event.participants.find((row) => row.id === id)!.name).join(' & ');

    fireEvent.change(screen.getByLabelText(`${sideA} rally score`), { target: { value: '24' } });
    fireEvent.change(screen.getByLabelText(`${sideB} rally score`), { target: { value: '0' } });
    fireEvent.click(screen.getByRole('button', { name: 'Confirm result' }));
    fireEvent.click(screen.getByRole('button', { name: 'End final round' }));

    expect(await screen.findByText(/Two entrants are tied for first/)).toBeInTheDocument();
    const standingsBefore = computeAmericanoStandingsV3(useEventStore.getState().event as never);
    const [leaderA, leaderB] = standingsBefore.filter((row) => row.rank === 1);
    expect(leaderA).toBeTruthy();
    expect(leaderB).toBeTruthy();

    const supportA = match.sideB.playerIds[0];
    const supportB = match.sideB.playerIds[1];
    fireEvent.change(screen.getByLabelText(new RegExp(`Support for side A`)), { target: { value: supportA } });
    fireEvent.change(screen.getByLabelText(new RegExp(`Support for side B`)), { target: { value: supportB } });
    fireEvent.click(screen.getByLabelText('Support partners do not earn points or places from this final.'));
    fireEvent.click(screen.getByRole('button', { name: 'Prepare final' }));
    expect(await screen.findByText(/Final ready:/)).toBeInTheDocument();

    const finalPanel = screen.getByRole('region', { name: /Championship final/ });
    fireEvent.click(within(finalPanel).getByRole('button', { name: /Side A ·/ }));
    fireEvent.click(within(finalPanel).getByRole('button', { name: 'Confirm final' }));

    await waitFor(() => {
      const current = useEventStore.getState().event as unknown as AmericanoEventStateV3 | null;
      expect(current?.championshipFinal?.outcome?.kind).toBe('golden-point');
    });
    const finalStandings = computeAmericanoStandingsV3(useEventStore.getState().event as never);
    expect(finalStandings.map((row) => row.total)).toEqual(standingsBefore.map((row) => row.total));
    expect(screen.getByText(/SEPARATE DECIDER · NO STANDINGS POINTS/)).toBeInTheDocument();
  });

  it('keeps the v3 TV spectator view read-only', async () => {
    window.history.replaceState({}, '', '/?tv=1');
    const event = await liveV3();
    act(() => useEventStore.setState({ event: event as never }));
    renderDisplay();

    expect(await screen.findByText(/SPECTATOR/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Confirm result' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'End round' })).not.toBeInTheDocument();
  });
});
