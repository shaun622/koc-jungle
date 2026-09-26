import { afterEach, describe, expect, it, vi } from 'vitest';
const platform = vi.hoisted(() => ({ native: false }));
vi.mock('@capacitor/core', () => ({ Capacitor: { isNativePlatform: () => platform.native } }));

afterEach(() => { platform.native = false; vi.unstubAllEnvs(); vi.resetModules(); });
describe('format rollout gates', () => {
  it('enables v3 web creation only with an explicit opt-in', async () => {
    vi.stubEnv('DEV', false);
    vi.stubEnv('MODE', 'production');
    vi.stubEnv('VITE_ENABLE_AMERICANO_V2', 'true');
    vi.stubEnv('VITE_ENABLE_AMERICANO_V3', 'true');
    expect((await import('@/config/features')).ENABLE_AMERICANO_V3).toBe(true);
    vi.resetModules();
    vi.stubEnv('VITE_ENABLE_AMERICANO_V3', 'false');
    expect((await import('@/config/features')).ENABLE_AMERICANO_V3).toBe(false);
    vi.resetModules();
    vi.stubEnv('VITE_ENABLE_AMERICANO_V3', undefined);
    expect((await import('@/config/features')).ENABLE_AMERICANO_V3).toBe(false);
  });
  it('keeps v3 native creation disabled even with the production opt-in', async () => {
    platform.native = true;
    vi.stubEnv('DEV', false);
    vi.stubEnv('MODE', 'production');
    vi.stubEnv('VITE_ENABLE_AMERICANO_V2', 'true');
    vi.stubEnv('VITE_ENABLE_AMERICANO_V3', 'true');
    expect((await import('@/config/features')).ENABLE_AMERICANO_V3).toBe(false);
  });
  it('respects the parent Americano kill switch for v3 creation', async () => {
    vi.stubEnv('DEV', false);
    vi.stubEnv('MODE', 'production');
    vi.stubEnv('VITE_ENABLE_AMERICANO_V2', 'false');
    vi.stubEnv('VITE_ENABLE_AMERICANO_V3', 'true');
    expect((await import('@/config/features')).ENABLE_AMERICANO_V3).toBe(false);
  });
  it('enables web Americano but keeps Tournament disabled despite old preview flags', async () => {
    vi.stubEnv('DEV', false);
    vi.stubEnv('MODE', 'production');
    vi.stubEnv('VITE_ENABLE_AMERICANO_V2', 'true');
    vi.stubEnv('VITE_ENABLE_TOURNAMENT_V1', 'true');
    const flags = await import('@/config/features');
    expect(flags.ENABLE_AMERICANO_V2).toBe(true);
    expect(flags.ENABLE_TOURNAMENT_V1).toBe(false);
  });
  it('does not unlock native Americano as part of the web rollout', async () => {
    platform.native = true;
    vi.stubEnv('DEV', false);
    vi.stubEnv('MODE', 'production');
    vi.stubEnv('VITE_ENABLE_AMERICANO_V2', 'true');
    expect((await import('@/config/features')).ENABLE_AMERICANO_V2).toBe(false);
  });
  it('supports explicitly disabling web creation without disabling readers', async () => {
    vi.stubEnv('DEV', false);
    vi.stubEnv('MODE', 'production');
    vi.stubEnv('VITE_ENABLE_AMERICANO_V2', 'false');
    expect((await import('@/config/features')).ENABLE_AMERICANO_V2).toBe(false);
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
