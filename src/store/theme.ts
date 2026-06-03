/**
 * Theme preference store.
 *
 * Two options only: 'dark' (default) and 'light'. No auto / system-follow
 * mode — keeps the brand consistent regardless of OS setting.
 *
 * The preference ends up as a `data-theme` attribute on
 * `document.documentElement`; every CSS variable cascades from
 * `:root[data-theme='...']`. See `useApplyTheme` for the apply side.
 */

import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';

export type ThemePreference = 'light' | 'dark';

interface ThemeState {
  preference: ThemePreference;
  setPreference: (p: ThemePreference) => void;
  /** Flip between dark and light (TopNav quick toggle). */
  cyclePreference: () => void;
}

export const useThemeStore = create<ThemeState>()(
  persist(
    (set, get) => ({
      // Default to dark — established brand for existing users.
      preference: 'dark',
      setPreference: (preference) => set({ preference }),
      cyclePreference: () => {
        set({ preference: get().preference === 'dark' ? 'light' : 'dark' });
      },
    }),
    {
      name: 'koc-theme-v1',
      storage: createJSONStorage(() => localStorage),
      // Migrate users whose persisted value is the now-removed 'auto'.
      migrate: (persisted: unknown): ThemeState => {
        const state = (persisted as Partial<ThemeState>) ?? {};
        const pref = state.preference;
        return {
          ...(state as ThemeState),
          preference: pref === 'light' ? 'light' : 'dark',
        };
      },
      version: 2,
    },
  ),
);
