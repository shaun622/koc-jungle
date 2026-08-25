import { teamLabelShort, teamPlayersLabel } from '@/store/selectors';
import type { Team } from '@/types/domain';

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
});
