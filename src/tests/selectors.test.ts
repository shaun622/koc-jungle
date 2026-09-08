import { teamLabelShort, teamPlayersLabel, teamPointsBreakdown } from '@/store/selectors';
import { DEFAULT_SETTINGS, type EventState, type Team } from '@/types/domain';

const namedTeam: Team = {
  id: 'team-1',
  name: 'The Smashers',
  players: [
    { id: 'player-1', name: 'Alex' },
    { id: 'player-2', name: 'Kriss' },
  ],
  createdAt: 0,
  active: true,
};

describe('team display labels', () => {
  it('keeps the custom team name for single-line labels', () => {
    expect(teamLabelShort(namedTeam)).toBe('The Smashers');
  });

  it('uses player names for the second line of a named team', () => {
    expect(teamPlayersLabel(namedTeam)).toBe('Alex & Kriss');
  });

  it('separates earned points from an organiser override', () => {
    const opponent: Team = {
      id: 'team-2', players: [{ id: 'p3', name: 'Pat' }, { id: 'p4', name: 'Sam' }],
      createdAt: 0, active: true,
    };
    const event: EventState = {
      id: 'event-1', name: 'Event', createdAt: 0, status: 'between-rounds',
      settings: DEFAULT_SETTINGS,
      courts: [{ id: 'court-1', name: 'Centre Court', position: 1, pointValue: 9 }],
      teams: [{ ...namedTeam, pointsOverride: 12 }, opponent],
      rounds: [{
        id: 'round-1', index: 1, durationMs: 1_200_000, totalPausedMs: 0, completedAt: 1,
        matches: [{
          id: 'match-1', courtId: 'court-1', teamAId: namedTeam.id, teamBId: opponent.id,
          scoreA: 6, scoreB: 4, status: 'completed', pointValueAtTime: 9,
        }],
      }],
    };

    expect(teamPointsBreakdown(event, namedTeam.id)).toEqual({ earned: 9, adjustment: 3, effective: 12 });
  });
});
