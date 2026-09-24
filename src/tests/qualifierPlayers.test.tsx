import { cleanup, render, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it } from 'vitest';
import { buildDemoEvent } from '@/logic/demoData';
import { QualifierScreen } from '@/routes/QualifierScreen';
import { useEventStore } from '@/store/eventStore';

afterEach(() => {
  cleanup();
  useEventStore.setState({ event: null });
});

describe('qualifier match identities', () => {
  it('shows both players beneath each team name, even when a team name repeats the player names', () => {
    const event = buildDemoEvent();
    event.teams = event.teams.slice(0, 2);
    event.courts = event.courts.slice(0, 1);
    event.teams[0].name = 'The Smashers';
    event.teams[1].name = 'Chris DH & William';
    event.qualifier = {
      durationMs: 1_200_000,
      totalPausedMs: 0,
      shuffleSeed: 1,
      matches: [{
        id: 'qualifier-match',
        courtId: event.courts[0].id,
        teamAId: event.teams[0].id,
        teamBId: event.teams[1].id,
        scoreA: 0,
        scoreB: 0,
        status: 'in-progress',
        pointValueAtTime: event.courts[0].pointValue,
      }],
    };
    useEventStore.setState({ event });

    const { container } = render(<MemoryRouter><QualifierScreen /></MemoryRouter>);
    const identities = container.querySelectorAll('.qual-team');
    expect(identities).toHaveLength(2);
    expect(within(identities[0] as HTMLElement).getByText('The Smashers')).toHaveClass('name');
    expect(within(identities[0] as HTMLElement).getByText('Jon & Sven')).toHaveClass('players');
    expect((identities[1] as HTMLElement).querySelector('.name')).toHaveTextContent('Chris DH & William');
    expect(within(identities[1] as HTMLElement).getAllByText('Chris DH & William')).toHaveLength(2);
    expect((identities[1] as HTMLElement).querySelector('.players')).toHaveTextContent('Chris DH & William');
  });
});
