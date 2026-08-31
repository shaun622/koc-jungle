import { buildRosterShareText, whatsappRosterUrl } from '@/utils/rosterShare';
import { DEFAULT_SETTINGS, type EventState, type Team } from '@/types/domain';
import type { SignupEvent, SignupRegistration } from '@/lib/signups';

function team(id: string, name: string | undefined, playerOne: string, playerTwo: string): Team {
  return {
    id,
    name,
    players: [
      { id: `${id}-1`, name: playerOne },
      { id: `${id}-2`, name: playerTwo },
    ],
    active: true,
    createdAt: 1,
  };
}

const event: EventState = {
  id: 'event-1',
  name: 'Monday Night KoC',
  venue: 'Jungle Padel Sanur',
  createdAt: 1,
  status: 'setup',
  settings: { ...DEFAULT_SETTINGS },
  courts: [
    { id: 'court-1', position: 1, name: 'Court 1', pointValue: 5 },
    { id: 'court-2', position: 2, name: 'Centre Court', pointValue: 7 },
  ],
  teams: [],
  rounds: [],
};

const signup: SignupEvent = {
  id: 'signup-1',
  ownerUserId: 'owner-1',
  sourceEventId: 'event-1',
  publicSlug: 'public-1',
  accountSlug: 'shaun',
  eventSlug: '31-aug-2026-monday-night-koc',
  title: 'Monday Night KoC',
  venue: 'Jungle Padel Sanur',
  startsAt: null,
  endsAt: null,
  capacityTeams: 4,
  capacityRevision: 1,
  details: '',
  prizes: '',
  isOpen: true,
  autoAddPairs: true,
    rosterSeededAt: '2026-08-30T00:00:00.000Z',
    rosterLockedAt: null,
};

const registrations: SignupRegistration[] = [
  {
    id: 'solo-1',
    signupEventId: 'signup-1',
    teamName: '',
    playerOne: 'Shaun',
    playerTwo: '',
    contact: 'private@example.com',
    status: 'confirmed',
    position: 1,
    createdAt: '2026-08-25T00:00:00Z',
  },
  {
    id: 'waiting-1',
    signupEventId: 'signup-1',
    teamName: 'The Challengers',
    playerOne: 'Alex',
    playerTwo: 'Kriss',
    contact: '+62123456789',
    status: 'waitlisted',
    position: 1,
    createdAt: '2026-08-25T00:01:00Z',
  },
];

describe('plain-text roster sharing', () => {
  it('formats ordered teams, solos, waiting pairs and the live link without private contacts', () => {
    const text = buildRosterShareText({
      event,
      signup,
      registrations,
      teams: [
        team('team-1', 'The Smasher', 'Tapia', 'Coello'),
        team('team-2', undefined, 'Jon', 'Sven'),
      ],
    });

    expect(text).toContain('🎾 MONDAY NIGHT KOC');
    expect(text).toContain('👥 2 of 4 teams confirmed');
    expect(text).toContain('1. The Smasher');
    expect(text).toContain('2. Jon & Sven');
    expect(text).not.toContain('1️⃣');
    expect(text.indexOf('The Smasher')).toBeLessThan(text.indexOf('Jon & Sven'));
    expect(text).toContain('Shaun — looking for a partner');
    expect(text).toContain('The Challengers — Alex & Kriss');
    expect(text).toContain('/signup/shaun/31-aug-2026-monday-night-koc');
    expect(text).not.toContain('private@example.com');
    expect(text).not.toContain('+62123456789');
  });

  it('creates a WhatsApp URL with the complete encoded message', () => {
    const text = '🎾 Monday Night\nTapia & Coello';
    const url = whatsappRosterUrl(text);
    expect(url).toBe(`https://wa.me/?text=${encodeURIComponent(text)}`);
  });

  it('uses plain numbering for double-digit roster positions', () => {
    const teams = Array.from({ length: 11 }, (_, index) =>
      team(`team-${index + 1}`, `Team ${index + 1}`, `Player ${index + 1}A`, `Player ${index + 1}B`));
    const text = buildRosterShareText({ event, teams });

    expect(text).toContain('10. Team 10');
    expect(text).toContain('11. Team 11');
    expect(text).not.toContain('🔟');
  });

  it('never repeats a local roster pair in the waiting list', () => {
    const stableIdentityTeam = {
      ...team('team-stable', 'Organiser renamed this team', 'New One', 'New Two'),
      signupRegistrationId: 'waiting-stable',
    };
    const legacyUnlinkedTeam = team(
      'team-legacy',
      'Legacy local team',
      '  KRISS',
      'Alex  ',
    );
    const actualWaiting: SignupRegistration = {
      id: 'waiting-actual',
      signupEventId: signup.id,
      teamName: 'Actually waiting',
      playerOne: 'Waiting One',
      playerTwo: 'Waiting Two',
      status: 'waitlisted',
      position: 3,
      createdAt: '2026-08-25T00:03:00Z',
    };
    const text = buildRosterShareText({
      event,
      signup,
      teams: [stableIdentityTeam, legacyUnlinkedTeam],
      registrations: [
        {
          ...actualWaiting,
          id: 'waiting-stable',
          teamName: 'Old public team name',
          playerOne: 'Old One',
          playerTwo: 'Old Two',
          position: 1,
        },
        {
          ...actualWaiting,
          id: 'waiting-legacy',
          teamName: 'Legacy server copy',
          playerOne: 'alex',
          playerTwo: 'kriss',
          position: 2,
        },
        actualWaiting,
        actualWaiting,
      ],
    });

    expect(text.match(/Organiser renamed this team/g)).toHaveLength(1);
    expect(text.match(/Legacy local team/g)).toHaveLength(1);
    expect(text).not.toContain('Old public team name');
    expect(text).not.toContain('Legacy server copy');
    expect(text.match(/Actually waiting/g)).toHaveLength(1);
    expect(text).toContain('⏳ WAITING LIST');
  });

  it('does not count or print inactive local teams as confirmed', () => {
    const inactive = { ...team('inactive', 'Dropped team', 'Gone One', 'Gone Two'), active: false };
    const text = buildRosterShareText({ event, teams: [inactive] });

    expect(text).toContain('👥 0 of 4 teams confirmed');
    expect(text).not.toContain('Dropped team');
  });
});
