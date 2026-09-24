import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock('@/lib/supabase', () => ({ supabase: null, publicSupabase: { rpc: mocks.rpc } }));
import { getPublicSignup } from '@/lib/signups';

beforeEach(() => mocks.rpc.mockReset());
describe('public signup rolling deployment compatibility', () => {
  it.each(['PGRST202', '42883'])('reads existing KoC signups without new migrations (%s)', async (code) => {
    mocks.rpc.mockResolvedValueOnce({ data: null, error: { code, message: 'Function missing' } });
    mocks.rpc.mockResolvedValueOnce({ data: { event: { capacityTeams: 16 }, confirmed: [], waiting: [] }, error: null });
    const result = await getPublicSignup('real-event', 'organiser');
    expect(mocks.rpc).toHaveBeenNthCalledWith(2, 'get_public_signup_v2', { p_account_slug: 'organiser', p_event_slug: 'real-event' });
    expect(result.event.protocolVersion).toBe(1);
    expect(result.event.capacity).toEqual({ unit: 'teams', value: 16 });
  });
  it('keeps v3 available for existing versioned signups', async () => {
    mocks.rpc.mockResolvedValue({ data: { event: { protocolVersion: 2, entryMode: 'individual', capacity: { unit: 'players', value: 8 } } }, error: null });
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
