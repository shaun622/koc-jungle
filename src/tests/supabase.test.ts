import { afterEach, describe, expect, it, vi } from 'vitest';

const createClient = vi.hoisted(() => vi.fn(
  (_url: string, _key: string, _options?: Record<string, unknown>) => ({ client: true }),
));

vi.mock('@supabase/supabase-js', () => ({ createClient }));

describe('Supabase client separation', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
    createClient.mockClear();
  });

  it('gives public RPCs a fixed anonymous token and bounded timeout', async () => {
    vi.stubEnv('VITE_SUPABASE_URL', 'https://example.supabase.co');
    vi.stubEnv('VITE_SUPABASE_ANON_KEY', 'public-anon-key');

    await import('@/lib/supabase');

    expect(createClient).toHaveBeenCalledTimes(2);
    const publicOptions = createClient.mock.calls[1][2] as {
      db: { timeout: number };
      accessToken: () => Promise<string | null>;
    };
    expect(publicOptions).toMatchObject({ db: { timeout: 12_000 } });
    await expect(publicOptions.accessToken()).resolves.toBe('public-anon-key');
  });
});
