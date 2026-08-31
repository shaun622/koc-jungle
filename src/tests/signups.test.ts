const signupsSupabaseMocks = vi.hoisted(() => ({
  rpc: vi.fn(),
}));

vi.mock('@/lib/supabase', () => ({
  supabase: { rpc: signupsSupabaseMocks.rpc },
  publicSupabase: { rpc: vi.fn() },
}));

import {
  addOrganizerSignupPair,
  buildSignupUrl,
  isPublicSignupPath,
  normaliseSignupLinkPart,
  publicSignupHashFromPath,
  registrationPairKey,
  findSignupRegistrationForTeam,
  lockSignupRoster,
  saveSignupEvent,
  seedOrganizerSignupRoster,
  setSignupOpen,
  syncOrganizerSignupRoster,
  unlockSignupRoster,
  updateOrganizerRegistration,
  type SaveSignupInput,
  type SignupRegistration,
} from '@/lib/signups';

const signupEventRow = {
  id: 'signup-1',
  owner_user_id: 'owner-1',
  source_event_id: 'event-1',
  public_slug: '00000000-0000-0000-0000-000000000001',
  friendly_slug: '31-aug-2026-monday-night-koc',
  account_slug: 'shaun',
  event_slug: '31-aug-2026-monday-night-koc',
  title: 'Monday Night KoC',
  venue: 'Jungle Padel',
  starts_at: '2026-08-31T10:00:00.000Z',
  ends_at: '2026-08-31T12:00:00.000Z',
  capacity_teams: 4,
  capacity_revision: 8,
  details: '',
  prizes: '',
  is_open: true,
  auto_add_pairs: true,
  roster_seeded_at: '2026-08-30T00:00:00.000Z',
  roster_locked_at: null,
};

const saveInput: SaveSignupInput = {
  ownerUserId: 'owner-1',
  sourceEventId: 'event-1',
  accountSlug: 'shaun',
  title: 'Monday Night KoC',
  venue: 'Jungle Padel',
  startsAt: '2026-08-31T10:00:00.000Z',
  endsAt: '2026-08-31T12:00:00.000Z',
  capacityTeams: 4,
  details: '',
  prizes: '',
  autoAddPairs: true,
  signupEventId: 'signup-1',
  baseRevision: 7,
};

describe('public event sign-up helpers', () => {
  it('normalises account names for clean URL paths', () => {
    expect(normaliseSignupLinkPart(' Jungle Padel SG! ')).toBe('jungle-padel-sg');
  });

  it('matches the same player pair regardless of order or case', () => {
    expect(registrationPairKey(' Kriss ', 'Alex')).toBe(registrationPairKey('alex', 'KRISS'));
  });

  it('builds a direct-path share link for reliable PWA navigation', () => {
    expect(buildSignupUrl('24-aug-2026-monday-high-silver-koc', 'jungle-padel')).toContain(
      '/signup/jungle-padel/24-aug-2026-monday-high-silver-koc',
    );
  });

  it('converts direct public paths before the hash router mounts', () => {
    expect(
      publicSignupHashFromPath(
        '/signup/jungle-padel/24-aug-2026-monday-high-silver-koc',
        '?manage=22222222-2222-2222-2222-222222222222',
      ),
    ).toBe(
      '#/signup/jungle-padel/24-aug-2026-monday-high-silver-koc?manage=22222222-2222-2222-2222-222222222222',
    );
    expect(publicSignupHashFromPath('/display')).toBeNull();
  });

  it('recognises public sign-up routes so operator events cannot redirect them', () => {
    expect(isPublicSignupPath('/signup/jungle-padel/24-aug-2026-monday-high-silver-koc')).toBe(true);
    expect(isPublicSignupPath('/display')).toBe(false);
  });

  it('finds the authoritative row by its stable registration id', () => {
    const registrations: SignupRegistration[] = [{
      id: 'registration-1',
      signupEventId: 'event-1',
      teamName: 'Old team',
      playerOne: 'Old one',
      playerTwo: 'Old two',
      status: 'confirmed',
      position: 1,
      createdAt: '2026-08-25T00:00:00Z',
    }];
    expect(findSignupRegistrationForTeam(registrations, {
      signupRegistrationId: 'registration-1',
      playerOne: 'Renamed one',
      playerTwo: 'Renamed two',
    })?.id).toBe('registration-1');
  });

  it('does not fall back to matching names when a stable registration id is stale', () => {
    const registrations: SignupRegistration[] = [{
      id: 'replacement-registration',
      signupEventId: 'event-1',
      teamName: 'Replacement team',
      playerOne: 'Old one',
      playerTwo: 'Old two',
      status: 'confirmed',
      position: 1,
      createdAt: '2026-08-25T00:00:00Z',
    }];
    expect(findSignupRegistrationForTeam(registrations, {
      signupRegistrationId: 'deleted-registration',
      playerOne: 'Old one',
      playerTwo: 'Old two',
    })).toBeUndefined();
  });

  it('uses the original pair key after a local rename', () => {
    const registrations: SignupRegistration[] = [{
      id: 'registration-2',
      signupEventId: 'event-1',
      teamName: 'Original team',
      playerOne: 'Alex',
      playerTwo: 'Kriss',
      status: 'confirmed',
      position: 1,
      createdAt: '2026-08-25T00:00:00Z',
    }];
    expect(findSignupRegistrationForTeam(registrations, {
      signupPairKey: registrationPairKey('Alex', 'Kriss'),
      playerOne: 'New one',
      playerTwo: 'New two',
    })?.id).toBe('registration-2');
  });
});

describe('locked organiser signup mutations', () => {
  beforeEach(() => {
    signupsSupabaseMocks.rpc.mockReset();
  });

  it('saves through the revision-guarded RPC and maps the authoritative event', async () => {
    signupsSupabaseMocks.rpc.mockResolvedValueOnce({
      data: {
        applied: true,
        conflict: false,
        capacityRevision: 8,
        event: signupEventRow,
      },
      error: null,
    });

    const result = await saveSignupEvent(saveInput);

    expect(signupsSupabaseMocks.rpc).toHaveBeenCalledWith('organizer_save_signup_event', {
      p_source_event_id: 'event-1',
      p_account_slug: 'shaun',
      p_title: 'Monday Night KoC',
      p_venue: 'Jungle Padel',
      p_starts_at: '2026-08-31T10:00:00.000Z',
      p_ends_at: '2026-08-31T12:00:00.000Z',
      p_expected_capacity: 4,
      p_base_revision: 7,
      p_details: '',
      p_prizes: '',
      p_auto_add_pairs: true,
      p_signup_event_id: 'signup-1',
      p_is_open: null,
    });
    expect(result).toMatchObject({
      applied: true,
      conflict: false,
      event: {
        id: 'signup-1',
        capacityTeams: 4,
        capacityRevision: 8,
        rosterSeededAt: '2026-08-30T00:00:00.000Z',
      },
    });
  });

  it('returns the current server event on a CAS conflict without retrying', async () => {
    signupsSupabaseMocks.rpc.mockResolvedValueOnce({
      data: {
        applied: false,
        conflict: true,
        capacityRevision: 9,
        event: { ...signupEventRow, capacity_teams: 6, capacity_revision: 9 },
      },
      error: null,
    });

    const result = await saveSignupEvent(saveInput);

    expect(result).toMatchObject({
      applied: false,
      conflict: true,
      event: { capacityTeams: 6, capacityRevision: 9 },
    });
    expect(signupsSupabaseMocks.rpc).toHaveBeenCalledTimes(1);
  });

  it('fails closed when updating a known signup without its base revision', async () => {
    await expect(saveSignupEvent({ ...saveInput, baseRevision: undefined } as unknown as SaveSignupInput))
      .rejects.toThrow('Refresh this sign-up before saving it again.');
    expect(signupsSupabaseMocks.rpc).not.toHaveBeenCalled();
  });

  it('opens or closes through the same revision stream', async () => {
    signupsSupabaseMocks.rpc.mockResolvedValueOnce({
      data: {
        applied: true,
        conflict: false,
        capacityRevision: 9,
        event: { ...signupEventRow, is_open: false, capacity_revision: 9 },
      },
      error: null,
    });

    const result = await setSignupOpen('signup-1', false, 'event-1', 8);

    expect(signupsSupabaseMocks.rpc).toHaveBeenCalledWith('organizer_set_signup_open', {
      p_signup_event_id: 'signup-1',
      p_source_event_id: 'event-1',
      p_is_open: false,
      p_base_revision: 8,
    });
    expect(result.event).toMatchObject({ isOpen: false, capacityRevision: 9 });
  });

  it('atomically locks the roster to court capacity before play', async () => {
    signupsSupabaseMocks.rpc.mockResolvedValueOnce({
      data: {
        applied: true,
        conflict: false,
        capacityRevision: 9,
        event: {
          ...signupEventRow,
          capacity_teams: 6,
          capacity_revision: 9,
          is_open: false,
          roster_locked_at: '2026-08-31T01:00:00.000Z',
        },
      },
      error: null,
    });

    const result = await lockSignupRoster('signup-1', 'event-1', 6, 8);

    expect(signupsSupabaseMocks.rpc).toHaveBeenCalledWith('organizer_lock_signup_roster', {
      p_signup_event_id: 'signup-1',
      p_source_event_id: 'event-1',
      p_expected_capacity: 6,
      p_base_revision: 8,
    });
    expect(result.event).toMatchObject({
      capacityTeams: 6,
      isOpen: false,
      rosterLockedAt: '2026-08-31T01:00:00.000Z',
    });
  });

  it('unlocks only through the explicit reset mutation', async () => {
    signupsSupabaseMocks.rpc.mockResolvedValueOnce({
      data: {
        applied: true,
        conflict: false,
        capacityRevision: 10,
        event: {
          ...signupEventRow,
          capacity_revision: 10,
          is_open: false,
          roster_locked_at: null,
        },
      },
      error: null,
    });

    const result = await unlockSignupRoster('signup-1', 'event-1', 9);

    expect(signupsSupabaseMocks.rpc).toHaveBeenCalledWith('organizer_unlock_signup_roster', {
      p_signup_event_id: 'signup-1',
      p_source_event_id: 'event-1',
      p_base_revision: 9,
    });
    expect(result.event).toMatchObject({ isOpen: false, rosterLockedAt: null });
  });

  it('edits a registration only through the owner-checked RPC', async () => {
    signupsSupabaseMocks.rpc.mockResolvedValueOnce({ data: {}, error: null });

    await updateOrganizerRegistration('registration-1', {
      teamName: ' The Pair ',
      playerOne: ' Alex ',
      playerTwo: ' Kriss ',
      contact: ' +123 ',
    }, {
      status: 'confirmed',
      updatedAt: '2026-08-31T00:00:00Z',
    });

    expect(signupsSupabaseMocks.rpc).toHaveBeenCalledWith('organizer_update_signup_registration_guarded', {
      p_registration_id: 'registration-1',
      p_team_name: 'The Pair',
      p_player_one: 'Alex',
      p_player_two: 'Kriss',
      p_contact: '+123',
      p_expected_status: 'confirmed',
      p_expected_updated_at: '2026-08-31T00:00:00Z',
      p_allow_locked: false,
    });
  });

  it('adds one organiser pair without replaying the full roster', async () => {
    signupsSupabaseMocks.rpc.mockResolvedValueOnce({
      data: {
        id: 'registration-2',
        signupEventId: 'signup-1',
        teamName: 'The Pair',
        playerOne: 'Alex',
        playerTwo: 'Kriss',
        contact: '+123',
        status: 'confirmed',
        organizerRank: null,
        pairCompletedAt: '2026-08-31T00:00:00Z',
        createdAt: '2026-08-31T00:00:00Z',
      },
      error: null,
    });

    const result = await addOrganizerSignupPair('signup-1', {
      teamName: ' The Pair ',
      playerOne: ' Alex ',
      playerTwo: ' Kriss ',
      contact: ' +123 ',
    });

    expect(signupsSupabaseMocks.rpc).toHaveBeenCalledWith('organizer_add_signup_pair', {
      p_signup_event_id: 'signup-1',
      p_team_name: 'The Pair',
      p_player_one: 'Alex',
      p_player_two: 'Kriss',
      p_contact: '+123',
      p_allow_locked: false,
    });
    expect(result).toMatchObject({
      id: 'registration-2',
      status: 'confirmed',
      pairCompletedAt: '2026-08-31T00:00:00Z',
    });
  });

  it('adopts an organiser roster through one owner-checked transaction', async () => {
    signupsSupabaseMocks.rpc.mockResolvedValueOnce({ data: [], error: null });

    await syncOrganizerSignupRoster('signup-1', [{
      registrationId: 'registration-1',
      teamName: ' The Pair ',
      playerOne: ' Alex ',
      playerTwo: ' Kriss ',
      contact: ' +123 ',
      rank: 1,
    }]);

    expect(signupsSupabaseMocks.rpc).toHaveBeenCalledWith('organizer_sync_signup_roster', {
      p_signup_event_id: 'signup-1',
      p_teams: [{
        registrationId: 'registration-1',
        teamName: 'The Pair',
        playerOne: 'Alex',
        playerTwo: 'Kriss',
        contact: '+123',
        rank: 1,
      }],
    });
  });

  it('seeds an organiser roster through the durable one-time RPC', async () => {
    signupsSupabaseMocks.rpc.mockResolvedValueOnce({
      data: { seeded: true, roster: [] },
      error: null,
    });

    const result = await seedOrganizerSignupRoster('signup-1', [{
      registrationId: 'registration-1',
      teamName: ' The Pair ',
      playerOne: ' Alex ',
      playerTwo: ' Kriss ',
      contact: ' +123 ',
      rank: 1,
    }]);

    expect(signupsSupabaseMocks.rpc).toHaveBeenCalledWith('organizer_seed_signup_roster', {
      p_signup_event_id: 'signup-1',
      p_teams: [{
        registrationId: 'registration-1',
        teamName: 'The Pair',
        playerOne: 'Alex',
        playerTwo: 'Kriss',
        contact: '+123',
        rank: 1,
      }],
    });
    expect(result).toEqual({ seeded: true });
  });

  it('accepts an already-seeded retry without replaying the payload', async () => {
    signupsSupabaseMocks.rpc.mockResolvedValueOnce({
      data: { seeded: false, roster: [] },
      error: null,
    });

    await expect(seedOrganizerSignupRoster('signup-1', []))
      .resolves.toEqual({ seeded: false });
    expect(signupsSupabaseMocks.rpc).toHaveBeenCalledWith('organizer_seed_signup_roster', {
      p_signup_event_id: 'signup-1',
      p_teams: [],
    });
  });
});
