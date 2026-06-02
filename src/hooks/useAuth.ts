/**
 * useAuth — subscribes to Supabase auth state and exposes the current
 * session + user-friendly sign-in/sign-out helpers. Falls back to a
 * no-op shape when cloud sync is unconfigured (so any consumer keeps
 * working in local-only mode).
 */

import { useEffect, useState } from 'react';
import type { Session, User } from '@supabase/supabase-js';
import { supabase } from '@/lib/supabase';

export interface AuthState {
  user: User | null;
  loading: boolean;
  /** True iff cloud sync is configured (env vars set at build time). */
  cloudEnabled: boolean;
}

export function useAuth(): AuthState & {
  signInWithEmail: (email: string, password: string) => Promise<{ error?: string }>;
  signUpWithEmail: (email: string, password: string) => Promise<{ error?: string }>;
  signInWithApple: () => Promise<{ error?: string }>;
  signOut: () => Promise<void>;
} {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState<boolean>(supabase !== null);

  useEffect(() => {
    if (!supabase) return;
    let cancelled = false;
    supabase.auth.getSession().then(({ data }) => {
      if (cancelled) return;
      setUser(data.session?.user ?? null);
      setLoading(false);
    });
    const { data: sub } = supabase.auth.onAuthStateChange(
      (_event, session: Session | null) => {
        setUser(session?.user ?? null);
      },
    );
    return () => {
      cancelled = true;
      sub.subscription.unsubscribe();
    };
  }, []);

  return {
    user,
    loading,
    cloudEnabled: supabase !== null,

    async signInWithEmail(email, password) {
      if (!supabase) return { error: 'Cloud sync not configured.' };
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      return error ? { error: error.message } : {};
    },

    async signUpWithEmail(email, password) {
      if (!supabase) return { error: 'Cloud sync not configured.' };
      const { error } = await supabase.auth.signUp({ email, password });
      return error ? { error: error.message } : {};
    },

    async signInWithApple() {
      if (!supabase) return { error: 'Cloud sync not configured.' };
      const { error } = await supabase.auth.signInWithOAuth({
        provider: 'apple',
        options: {
          // Apple insists on returning to the exact URL it has on file.
          // The web PWA uses HashRouter, so any path resolves the same SPA.
          redirectTo:
            typeof window !== 'undefined' ? window.location.origin : undefined,
        },
      });
      return error ? { error: error.message } : {};
    },

    async signOut() {
      if (!supabase) return;
      await supabase.auth.signOut();
    },
  };
}
