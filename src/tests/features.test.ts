import { afterEach, describe, expect, it, vi } from 'vitest';

afterEach(() => { vi.unstubAllEnvs(); vi.resetModules(); });
describe('format rollout gates', () => {
  it('keeps unfinished modes disabled in production even with old preview flags', async () => {
    vi.stubEnv('DEV', false);
    vi.stubEnv('MODE', 'production');
    vi.stubEnv('VITE_ENABLE_AMERICANO_V2', 'true');
    vi.stubEnv('VITE_ENABLE_TOURNAMENT_V1', 'true');
    const flags = await import('@/config/features');
    expect(flags.ENABLE_AMERICANO_V2).toBe(false);
    expect(flags.ENABLE_TOURNAMENT_V1).toBe(false);
  });
  it('retains explicit local preview opt-ins', async () => {
    vi.stubEnv('DEV', true);
    vi.stubEnv('MODE', 'development');
    vi.stubEnv('VITE_ENABLE_AMERICANO_V2', 'true');
    vi.stubEnv('VITE_ENABLE_TOURNAMENT_V1', 'true');
    const flags = await import('@/config/features');
    expect(flags.ENABLE_AMERICANO_V2).toBe(true);
    expect(flags.ENABLE_TOURNAMENT_V1).toBe(true);
  });
});
