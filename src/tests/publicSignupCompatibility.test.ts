import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock('@/lib/supabase', () => ({ supabase: null, publicSupabase: { rpc: mocks.rpc } }));
import { getPublicSignup } from '@/lib/signups';

beforeEach(() => mocks.rpc.mockReset());
describe('public signup rolling deployment compatibility', () => {
  it.each(['PGRST202', '42883'])('reads existing KoC signups without new migrations (%s)', async (code) => {
    mocks.rpc.mockResolvedValueOnce({ data: null, error: { code, message: 'Function missing' } });
    mocks.rpc.mockResolvedValueOnce({ data: { event: { capacityTeams: 16 }, registrations: [{ id: 'solo', playerTwo: null }] }, error: null });
    const result = await getPublicSignup('real-event', 'organiser');
    expect(mocks.rpc).toHaveBeenNthCalledWith(2, 'get_public_signup_v2', { p_account_slug: 'organiser', p_event_slug: 'real-event' });
    expect(result.event.protocolVersion).toBe(1);
    expect(result.event.capacity).toEqual({ unit: 'teams', value: 16 });
    expect(result.registrations[0].playerTwo).toBe('');
  });
  it('keeps v3 available for existing versioned signups', async () => {
    mocks.rpc.mockResolvedValue({ data: { event: { protocolVersion: 2, entryMode: 'individual', capacity: { unit: 'players', value: 8 } }, registrations: [] }, error: null });
    const result = await getPublicSignup('americano');
    expect(result.event.protocolVersion).toBe(2);
    expect(result.event.capacity).toEqual({ unit: 'players', value: 8 });
    expect(mocks.rpc).toHaveBeenCalledTimes(1);
  });
  it('does not mask backend failures or permissions errors', async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { code: '42501', message: 'Not allowed' } });
    await expect(getPublicSignup('event')).rejects.toThrow('Not allowed');
    expect(mocks.rpc).toHaveBeenCalledTimes(1);
  });
});

describe('public registration response contract', () => {
  it('normalizes only missing partners without mutating rows, metadata or rules', async () => {
    const partners = [null, undefined, '', '   ', ' Sam '];
    const registrations = partners.map((partner, index) => Object.freeze({
      id: `row-${index}`, teamName: 'Team', playerOne: ' Alex ',
      ...(partner === undefined ? {} : { playerTwo: partner }),
      status: 'looking', position: index + 1, organizerRank: index,
      createdAt: '2099-01-01', updatedAt: '2099-01-02', pairCompletedAt: null,
    }));
    const event = { capacityTeams: 4, competitionRules: { rulesVersion: 3 } };
    const data = Object.freeze({ event: Object.freeze(event), registrations: Object.freeze(registrations) });
    mocks.rpc.mockResolvedValue({ data, error: null });
    const result = await getPublicSignup('event');
    expect(result.registrations).toEqual(registrations.map(row => ({ ...row, playerTwo: row.playerTwo ?? '' })));
    expect(result.registrations).not.toBe(registrations);
    expect(registrations[0].playerTwo).toBeNull();
    expect(registrations[1]).not.toHaveProperty('playerTwo');
    expect(result.event.competitionRules).toEqual(event.competitionRules);
    expect(result.event.capacity).toEqual({ unit: 'teams', value: 4 });
  });

  it.each([undefined, null, {}, [null], [42], [[]], [{ playerTwo: 24 }], [{ playerTwo: {} }]].map(registrations => ({ registrations })))(
    'rejects malformed roster $registrations without hiding data', async ({ registrations }) => {
      mocks.rpc.mockResolvedValue({ data: { event: { capacityTeams: 4 }, registrations }, error: null });
      await expect(getPublicSignup('event')).rejects.toThrow('The sign-up server returned an invalid response. Refresh and try again.');
      expect(mocks.rpc).toHaveBeenCalledTimes(1);
    },
  );
});
