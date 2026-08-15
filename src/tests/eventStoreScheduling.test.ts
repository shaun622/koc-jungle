import { beforeEach, describe, expect, it } from 'vitest';
import { useEventStore } from '@/store/eventStore';
import type { Court, EventState } from '@/types/domain';

function threeCourts(): Court[] {
  return [1, 2, 3].map((position) => ({
    id: `court-${position}`,
    position,
    name: position === 3 ? 'Centre Court' : `Court ${position}`,
    pointValue: 5,
  }));
}

function addTeams(count: number): void {
  for (let i = 1; i <= count; i += 1) {
    useEventStore.getState().addTeam({
      player1: `Player ${i}A`,
      player2: `Player ${i}B`,
    });
  }
}

describe('Americano mid-event roster corrections', () => {
  beforeEach(() => {
    localStorage.clear();
    useEventStore.getState().resetEvent();
  });

  it('fills an empty court when the missing sixth team is added before play starts', () => {
    const store = useEventStore.getState();
    store.createEvent('Americano', 'americano');
    useEventStore.getState().setCourts(threeCourts());
    addTeams(5);
    useEventStore.getState().startTournament();

    expect(useEventStore.getState().event?.rounds[0].matches).toHaveLength(2);

    useEventStore.getState().addTeam({ player1: 'Late A', player2: 'Late B' });

    const event = useEventStore.getState().event;
    const matches = event?.rounds[0].matches ?? [];
    const playing = new Set(matches.flatMap((match) => [match.teamAId, match.teamBId]));
    expect(matches).toHaveLength(3);
    expect(playing.size).toBe(6);
    expect(playing).toEqual(new Set(event?.teams.filter((team) => team.active).map((team) => team.id)));
  });

  it('refreshes an already-built between-round preview after a team is added', () => {
    const store = useEventStore.getState();
    store.createEvent('Americano', 'americano');
    useEventStore.getState().setCourts(threeCourts());
    addTeams(5);
    useEventStore.getState().startTournament();

    const started = useEventStore.getState().event!;
    const stalePreview = started.rounds[0].matches.map((match) => ({
      courtId: match.courtId,
      teamAId: match.teamAId,
      teamBId: match.teamBId,
      wave: match.wave,
    }));
    const betweenRounds: EventState = {
      ...started,
      status: 'between-rounds',
      rounds: [{ ...started.rounds[0], completedAt: Date.now() }],
      pendingAssignments: stalePreview,
    };
    useEventStore.getState().loadEvent(betweenRounds);

    useEventStore.getState().addTeam({ player1: 'Late A', player2: 'Late B' });

    const event = useEventStore.getState().event;
    const assignments = event?.pendingAssignments ?? [];
    const playing = new Set(assignments.flatMap((match) => [match.teamAId, match.teamBId]));
    expect(assignments).toHaveLength(3);
    expect(playing.size).toBe(6);
    expect(playing).toEqual(new Set(event?.teams.filter((team) => team.active).map((team) => team.id)));
  });

  it('does not reshuffle a round whose timer has already started', () => {
    const store = useEventStore.getState();
    store.createEvent('Americano', 'americano');
    useEventStore.getState().setCourts(threeCourts());
    addTeams(5);
    useEventStore.getState().startTournament();
    useEventStore.getState().startRoundTimer();

    const originalMatchIds = useEventStore.getState().event!.rounds[0].matches.map((match) => match.id);
    useEventStore.getState().addTeam({ player1: 'Late A', player2: 'Late B' });

    const event = useEventStore.getState().event!;
    expect(event.rounds[0].matches.map((match) => match.id)).toEqual(originalMatchIds);
    expect((event.formatConfig as { teams: string[] }).teams).toHaveLength(6);
  });
});
