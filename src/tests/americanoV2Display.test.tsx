import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it } from 'vitest';
import { DisplayScreen } from '@/routes/DisplayScreen';
import { useEventStore } from '@/store/eventStore';
import {
  previewAmericanoSchedule,
  startAmericanoEvent,
  updateAmericanoConfig,
} from '@/logic/americanoV2/runtime';
import { americanoV2Fixture } from '@/tests/americanoV2Fixtures';

async function liveEvent(rounds = 1) {
  let event = americanoV2Fixture('rotating');
  event = updateAmericanoConfig(event, { scheduleKind: 'custom', customRounds: rounds });
  event = await previewAmericanoSchedule(event, {
    seed: 91,
    acknowledgeRepeatedCycle: true,
    acknowledgeUnevenAppearances: true,
  });
  return startAmericanoEvent(event);
}

function renderDisplay() {
  return render(<MemoryRouter><DisplayScreen /></MemoryRouter>);
}

afterEach(() => {
  cleanup();
  window.history.replaceState({}, '', '/');
  useEventStore.setState({ event: null });
});

describe('Americano v2 event-night UI', () => {
  it('auto-fills the complementary result but waits for Confirm and End before completing', async () => {
    const event = await liveEvent();
    act(() => useEventStore.setState({ event: event as never }));
    renderDisplay();
    const match = event.rounds[0].matches[0];
    const sideA = match.sideA.playerIds.map((id) => event.participants.find((row) => row.id === id)!.name).join(' & ');
    const sideB = match.sideB.playerIds.map((id) => event.participants.find((row) => row.id === id)!.name).join(' & ');
    const a = screen.getByLabelText(`${sideA} score`);
    const b = screen.getByLabelText(`${sideB} score`);

    fireEvent.change(a, { target: { value: '10' } });
    expect(b).toHaveValue('14');
    fireEvent.click(screen.getByRole('button', { name: 'Confirm result' }));
    expect(screen.getByRole('button', { name: 'Confirmed' })).toBeInTheDocument();
    expect(useEventStore.getState().event?.status).toBe('round-in-progress');
    fireEvent.click(screen.getByRole('button', { name: 'End final round' }));

    expect(await screen.findByText('AMERICANO COMPLETE')).toBeInTheDocument();
    expect(useEventStore.getState().event?.status).toBe('complete');
  });

  it('makes the explicit TV route read-only', async () => {
    window.history.replaceState({}, '', '/?tv=1');
    const event = await liveEvent();
    act(() => useEventStore.setState({ event: event as never }));
    renderDisplay();

    expect(screen.getAllByRole('textbox').every((input) => input.hasAttribute('disabled'))).toBe(true);
    expect(screen.queryByRole('button', { name: 'Confirm result' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Finish early' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /End final round/ })).not.toBeInTheDocument();
  });

  it('highlights and focuses the score field that needs fixing', async () => {
    const initial = await liveEvent();
    const event = {
      ...initial,
      rounds: initial.rounds.map((round, index) => index === 0 ? {
        ...round,
        matches: round.matches.map((match, matchIndex) => matchIndex === 0 ? { ...match, scoreA: 10, scoreB: 10 } : match),
      } : round),
    };
    act(() => useEventStore.setState({ event: event as never }));
    renderDisplay();
    const inputs = screen.getAllByRole('textbox');
    fireEvent.click(screen.getByRole('button', { name: 'Confirm result' }));

    expect(inputs[1]).toHaveAttribute('aria-invalid', 'true');
    expect(inputs[1]).toHaveFocus();
    expect(screen.getByRole('alert')).toHaveTextContent('Scores must add up to 24.');
    const storedMatch = useEventStore.getState().event?.rounds[0].matches[0];
    expect(storedMatch && 'resultConfirmed' in storedMatch ? storedMatch.resultConfirmed : null).toBe(false);
  });

  it('requires confirmation and excludes the whole unfinished round when finishing early', async () => {
    const event = await liveEvent(2);
    act(() => useEventStore.setState({ event: event as never }));
    renderDisplay();
    fireEvent.click(screen.getByRole('button', { name: 'Finish early' }));
    expect(screen.getByText(/entire unfinished round/i)).toBeInTheDocument();
    const finishButtons = screen.getAllByRole('button', { name: 'Finish early' });
    fireEvent.click(finishButtons[finishButtons.length - 1]);
    await waitFor(() => expect(useEventStore.getState().event?.status).toBe('complete'));
    const completed = useEventStore.getState().event as unknown as Awaited<ReturnType<typeof liveEvent>>;
    expect(completed.completionReason).toBe('early');
    expect(completed.rounds[0].excludedReason).toBe('ended-early');
  });
});
