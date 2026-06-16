/**
 * Supabase client (Stage 2.4 — cloud sync).
 *
 * Local-only mode is the default. Cloud sync activates iff both
 * VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY are set at build time.
 * When either is missing `supabase` is null and the rest of the app
 * silently falls back to the existing localStorage-only flow.
 *
 * Provisioning checklist for the user (one-time):
 *  1. Create a free Supabase project at https://app.supabase.com
 *  2. Run the migration SQL in supabase/schema.sql against the project's
 *     SQL editor (creates the `events` table + RLS + delete_account RPC).
 *  3. Enable Email auth in Auth → Providers.
 *  4. Copy the project URL + anon public key into `.env.local`:
 *       VITE_SUPABASE_URL=...
 *       VITE_SUPABASE_ANON_KEY=...
 *  5. `npm run build` and redeploy.
 */

import { createClient, type SupabaseClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

export const supabase: SupabaseClient | null =
  url && anonKey
    ? createClient(url, anonKey, {
        auth: {
          persistSession: true,
          autoRefreshToken: true,
          // The web app uses HashRouter; PKCE works fine with the hash.
          flowType: 'pkce',
          // Native apps (Capacitor, Stage 2.2) override this with the
          // custom URI scheme registered in Info.plist / AndroidManifest.
          storageKey: 'koc-auth',
        },
      })
    : null;

export function isCloudConfigured(): boolean {
  return supabase !== null;
}
