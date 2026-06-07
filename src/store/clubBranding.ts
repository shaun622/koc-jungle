/**
 * Club branding (operator-level, persisted across events).
 *
 * Lets a club show its own name and/or logo in the top-left of the app
 * instead of the default "Padel Tournament Maker" wordmark + crowned ball.
 * Stored separately from any single event so it sticks night to night.
 */

import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';

interface ClubBrandingState {
  /** Display name shown beside the logo. Empty = use the app name. */
  name: string;
  /** Square PNG data URL, or null to use the app logo. */
  logoDataUrl: string | null;
  setName: (name: string) => void;
  setLogo: (dataUrl: string | null) => void;
  clear: () => void;
}

export const useClubBrandingStore = create<ClubBrandingState>()(
  persist(
    (set) => ({
      name: '',
      logoDataUrl: null,
      setName: (name) => set({ name }),
      setLogo: (logoDataUrl) => set({ logoDataUrl }),
      clear: () => set({ name: '', logoDataUrl: null }),
    }),
    {
      name: 'koc-club-branding-v1',
      storage: createJSONStorage(() => localStorage),
    },
  ),
);
