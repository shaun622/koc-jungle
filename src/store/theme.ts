/**
 * Theme preference store.
 *
 *  - 'auto'  — follow the OS via prefers-color-scheme (re-resolves on change).
 *  - 'light' / 'dark' — force the theme regardless of OS.
 *
 * The resolved theme ends up as a `data-theme` attribute on
 * `document.documentElement`; every CSS variable cascades from
 * `:root[data-theme='...']`. See `useApplyTheme` for the apply side.
 */

import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';

export type ThemePreference = 'auto' | 'light' | 'dark';
export type ResolvedTheme = 'light' | 'dark';

interface ThemeState {
  preference: ThemePreference;
  setPreference: (p: ThemePreference) => void;
  /** Cycle through dark -> light -> auto (used by the TopNav quick toggle). */
  cyclePreference: () => void;
}

export const useThemeStore = create<ThemeState>()(
  persist(
    (set, get) => ({
      // Default to dark — that's the established brand and what every
      // existing PWA user has been seeing.
      preference: 'dark',
      setPreference: (preference) => set({ preference }),
      cyclePreference: () => {
        const order: ThemePreference[] = ['dark', 'light', 'auto'];
        const i = order.indexOf(get().preference);
        set({ preference: order[(i + 1) % order.length] });
      },
    }),
    {
      name: 'koc-theme-v1',
      storage: createJSONStorage(() => localStorage),
    },
  ),
);

/**
 * Resolve the user's preference into the actual theme to apply.
 * Reads the OS preference via matchMedia when in 'auto' mode.
 */
export function resolveTheme(preference: ThemePreference): ResolvedTheme {
  if (preference === 'auto') {
    if (
      typeof window !== 'undefined' &&
      window.matchMedia('(prefers-color-scheme: dark)').matches
    ) {
      return 'dark';
    }
    return 'light';
  }
  return preference;
}
