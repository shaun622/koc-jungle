import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DisplayScreen } from '@/routes/DisplayScreen';
import { buildDemoEvent } from '@/logic/demoData';
import { flushEventCatalogPersistence, useEventStore } from '@/store/eventStore';
import { teamPlayersLabel } from '@/store/selectors';
import type { EventState } from '@/types/domain';

// Keep account UI and native feedback outside this presentation regression.
// The display, score controls, event store, and score-clamping logic stay real.
vi.mock('@/components/AppMenu', () => ({ AppMenu: () => <button>Menu</button> }));
vi.mock('@/lib/haptics', () => ({ hapticTick: vi.fn() }));

function liveEvent(courtCount = 8): EventState {
  const event = buildDemoEvent();
  event.id = 'scoreboard-regression';
  event.format = 'koc';
  event.status = 'round-in-progress';
  event.settings.announceRoundStart = false;
  event.settings.soundOnTimerEnd = false;
  event.courts = Array.from({ length: courtCount }, (_, index) => ({
    id: `court-${index + 1}`,
    position: index + 1,
    name: index === courtCount - 1 ? 'Centre Court' : `Court ${index + 1}`,
    pointValue: index + 3,
  }));
  event.teams = Array.from({ length: courtCount * 2 }, (_, index) => ({
    id: `team-${index + 1}`,
    name: `Team ${index + 1}`,
    active: true,
    createdAt: 1,
    players: [
      { id: `player-${index + 1}-a`, name: `Player ${index + 1} A` },
      { id: `player-${index + 1}-b`, name: `Player ${index + 1} B` },
    ],
  }));
  event.rounds = [{
    id: 'round-3', index: 3, durationMs: 1200000, totalPausedMs: 0,
    startedAt: Date.now() - 300000, pausedAt: Date.now(),
    matches: event.courts.map((court, index) => ({
      id: `match-${index + 1}`, courtId: court.id,
      teamAId: event.teams[index * 2].id, teamBId: event.teams[index * 2 + 1].id,
      scoreA: 3, scoreB: 1, status: 'in-progress', pointValueAtTime: court.pointValue,
    })),
  }];
  return event;
}

function show(event: EventState) {
  useEventStore.setState({ event, hydrated: true, lastError: null });
  return render(<MemoryRouter><DisplayScreen /></MemoryRouter>);
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal('matchMedia', vi.fn((query: string) => ({
    matches: false, media: query, onchange: null,
    addEventListener: vi.fn(), removeEventListener: vi.fn(),
    addListener: vi.fn(), removeListener: vi.fn(), dispatchEvent: vi.fn(),
  })));
});

afterEach(async () => {
  cleanup();
  await flushEventCatalogPersistence();
  useEventStore.setState({ event: null, lastError: null });
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('quiet production scoreboard controls', () => {
  it.each([3, 7, 8])('retains a named increase and decrease control for every team on %i courts, including Centre Court', (courtCount) => {
    const event = liveEvent(courtCount);
    const { container } = show(event);
    expect(screen.getAllByRole('button', { name: /^Increase .+ score$/ })).toHaveLength(courtCount * 2);
    expect(screen.getAllByRole('button', { name: /^Decrease .+ score$/ })).toHaveLength(courtCount * 2);
    for (const team of event.teams) {
      const players = teamPlayersLabel(team);
      expect(screen.getByRole('button', { name: `Increase ${players} score` })).toBeEnabled();
      expect(screen.getByRole('button', { name: `Decrease ${players} score` })).toBeEnabled();
    }
    const centre = within(container.querySelector<HTMLElement>('.tv-centre')!);
    for (const team of event.teams.slice(-2)) {
      expect(centre.getByRole('button', { name: `Increase ${teamPlayersLabel(team)} score` })).toBeEnabled();
      expect(centre.getByRole('button', { name: `Decrease ${teamPlayersLabel(team)} score` })).toBeEnabled();
    }
  });

  it('changes only the selected score once per click on every side and Centre Court', () => {
    const event = liveEvent();
    show(event);
    for (const [matchIndex, match] of event.rounds[0].matches.entries()) {
      for (const side of ['A', 'B'] as const) {
        const team = event.teams.find(candidate => candidate.id === match[side === 'A' ? 'teamAId' : 'teamBId'])!;
        const expected = structuredClone(useEventStore.getState().event!);
        const key = side === 'A' ? 'scoreA' : 'scoreB';
        expected.rounds[0].matches[matchIndex][key] += 1;
        fireEvent.click(screen.getByRole('button', { name: `Increase ${teamPlayersLabel(team)} score` }));
        expect(useEventStore.getState().event).toEqual(expected);
        expected.rounds[0].matches[matchIndex][key] -= 1;
        fireEvent.click(screen.getByRole('button', { name: `Decrease ${teamPlayersLabel(team)} score` }));
        expect(useEventStore.getState().event).toEqual(expected);
      }
    }
    expect(useEventStore.getState().event).toEqual(event);
  });

  it('clamps both teams at zero on side courts and Centre Court', () => {
    const event = liveEvent(3);
    event.rounds[0].matches.forEach(match => { match.scoreA = 0; match.scoreB = 0; });
    const snapshot = structuredClone(event);
    show(event);
    for (const team of event.teams) {
      fireEvent.click(screen.getByRole('button', { name: `Decrease ${teamPlayersLabel(team)} score` }));
      expect(useEventStore.getState().event).toEqual(snapshot);
    }
  });

  it('does not change the event or start its paused timer when rendered or resized', () => {
    const event = liveEvent();
    const snapshot = structuredClone(event);
    const { rerender } = show(event);
    expect(useEventStore.getState().event).toBe(event);
    act(() => {
      fireEvent(window, new Event('resize'));
      vi.advanceTimersByTime(1000);
    });
    rerender(<MemoryRouter><DisplayScreen /></MemoryRouter>);
    expect(useEventStore.getState().event).toBe(event);
    expect(event).toEqual(snapshot);
  });
});
