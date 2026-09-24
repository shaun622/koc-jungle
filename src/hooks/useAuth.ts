/**
 * useAuth — subscribes to Supabase auth state and exposes the current
 * session + user-friendly sign-in/sign-out helpers. Falls back to a
 * no-op shape when cloud sync is unconfigured (so any consumer keeps
 * working in local-only mode).
 */

import { useEffect, useState } from 'react';
import type { Session, User } from '@supabase/supabase-js';
import { supabase } from '@/lib/supabase';
import { flushCloudSync } from '@/store/cloudSync';
import { useTournamentStore } from '@/store/tournamentStore';

let authSessionGeneration = 0;
let authSessionFingerprint: string | null = null;

function observeSession(session: Session | null): void {
  const fingerprint = session ? `${session.user.id}:${session.access_token}` : null;
  if (fingerprint !== authSessionFingerprint) {
    authSessionFingerprint = fingerprint;
    authSessionGeneration += 1;
  }
}

export const getAuthSessionGeneration = () => authSessionGeneration;
export const isAuthSessionGenerationCurrent = (generation: number) => generation === authSessionGeneration;

export interface AuthState {
  user: User | null;
  loading: boolean;
  /** True iff cloud sync is configured (env vars set at build time). */
  cloudEnabled: boolean;
}

export function useAuth(): AuthState & {
  signInWithEmail: (email: string, password: string) => Promise<{ error?: string }>;
  signUpWithEmail: (
    email: string,
    password: string,
  ) => Promise<{ error?: string; needsConfirmation?: boolean }>;
  requestPasswordReset: (email: string) => Promise<{ error?: string }>;
  signOut: () => Promise<{ error?: string }>;
  deleteAccount: () => Promise<{ error?: string }>;
} {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState<boolean>(supabase !== null);

  useEffect(() => {
    if (!supabase) return;
    let cancelled = false;
    supabase.auth.getSession().then(({ data }) => {
      if (cancelled) return;
      observeSession(data.session);
      setUser(data.session?.user ?? null);
      setLoading(false);
    });
    const { data: sub } = supabase.auth.onAuthStateChange(
      (_event, session: Session | null) => {
        observeSession(session);
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
      const { data, error } = await supabase.auth.signUp({ email, password });
      if (error) return { error: error.message };
      // With email confirmation disabled, signUp returns a session and the
      // user is signed in immediately. Only ask them to "check your inbox"
      // when confirmation is actually required (no session yet).
      return { needsConfirmation: !data.session };
    },

    async requestPasswordReset(email) {
      if (!supabase) return { error: 'Cloud sync not configured.' };
      const redirectTo = typeof window === 'undefined'
        ? undefined
        : `${window.location.origin}/auth/recovery`;
      const { error } = await supabase.auth.resetPasswordForEmail(email, { redirectTo });
      return error ? { error: error.message } : {};
    },

    async signOut() {
      if (!supabase) return {};
      const tournament = useTournamentStore.getState();
      if (tournament.pendingOperations.length) return { error: 'A Tournament operation still has an unknown outcome. Retry it before signing out.' };
      if (tournament.active?.mode === 'connected' && tournament.active.outbox.length) {
        const generation = getAuthSessionGeneration();
        const result = await tournament.syncActive(generation, isAuthSessionGenerationCurrent);
        if (result.status !== 'synced') return { error: 'Tournament changes are still waiting to sync. Retry, or export recovery data before signing out.' };
      }
      if (tournament.active?.mode === 'connected' && tournament.active.projected.lifecycle === 'live') return { error: 'Release or complete the live Tournament before signing out.' };
      const flushed = await flushCloudSync();
      if (!flushed.ok) {
        return { error: flushed.error || `${flushed.pendingEventIds.length} event change(s) are still waiting to sync.` };
      }
      const { error } = await supabase.auth.signOut();
      return error ? { error: error.message } : {};
    },

    async deleteAccount() {
      if (!supabase) return { error: 'Cloud sync not configured.' };
      const tournament = useTournamentStore.getState();
      if (tournament.pendingOperations.length || tournament.records.some((record) => record.mode === 'connected' && (record.outbox.length > 0 || record.projected.lifecycle === 'live'))) return { error: 'Resolve, release, or export your active Tournament work before deleting this account.' };
      // The anon key cannot delete its own auth.users row, so this calls a
      // SECURITY DEFINER Postgres function (see supabase/schema.sql) that
      // removes the signed-in user's events + auth record. Then we sign out
      // to clear the now-orphaned local session.
      const { error } = await supabase.rpc('delete_account');
      if (error) return { error: error.message };
      await supabase.auth.signOut();
      return {};
    },
  };
}
