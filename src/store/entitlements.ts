/**
 * Entitlements store (Stage 2.5 — subscription paywall).
 *
 * Tracks whether the user has the "Pro" entitlement that unlocks:
 *   - King of the Court and Americano during the trial or with Pro
 *   - The future Tournament mode when it launches
 *   - Cloud sync (Stage 2.4)
 *
 * No format is permanently free. A new user gets a one-time seven-day
 * trial; after it expires an active Pro subscription is required.
 *
 * Trial model: native builds use the App Store / Play introductory offer
 * through the purchase flow. The local `startTrial` action exists only for
 * the web preview, where store billing is unavailable.
 *
 * IAP wiring: the actual subscription is gated by the platform billing:
 *   - Native (Capacitor, Stage 2.2): @revenuecat/purchases-capacitor
 *   - Web PWA: @revenuecat/purchases-js
 * Both are out-of-band from this store. This file only tracks the
 * RESULT (pro true/false) and exposes a `refresh()` hook the platform
 * layer calls when entitlements change.
 *
 * When no IAP layer is configured (no env var, dev mode), `pro` stays
 * whatever the user last set locally — including the 7-day trial flag.
 * This keeps the operator's PWA usable while we wire native billing.
 */

import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';

const TRIAL_LENGTH_MS = 7 * 24 * 60 * 60 * 1000;

export interface EntitlementsState {
  /** Final yes/no for whether the user has Pro right now. */
  pro: boolean;
  /** Set while we're round-tripping with the IAP layer. */
  loading: boolean;
  /** ms epoch when the active trial ends. Undefined if no trial. */
  trialEndsAt: number | undefined;
  /** Has this device ever started the 7-day trial? One per device. */
  trialUsed: boolean;
}

interface Actions {
  /** Start the one-time 7-day free trial. No-op if already used. */
  startTrial: () => void;
  /** Set Pro entitlement directly. Called by the IAP layer on entitlement change. */
  setPro: (pro: boolean, trialEndsAt?: number) => void;
  /** Tick the trial clock — call once per render of any Pro-gated UI. */
  tickTrial: () => void;
}

export const useEntitlementsStore = create<EntitlementsState & Actions>()(
  persist(
    (set, get) => ({
      pro: false,
      loading: false,
      trialEndsAt: undefined,
      trialUsed: false,

      startTrial: () => {
        if (get().trialUsed) return;
        const trialEndsAt = Date.now() + TRIAL_LENGTH_MS;
        set({ trialUsed: true, pro: true, trialEndsAt });
      },

      setPro: (pro, trialEndsAt) => set({ pro, trialEndsAt }),

      tickTrial: () => {
        const s = get();
        if (!s.trialEndsAt) return;
        if (s.pro && Date.now() >= s.trialEndsAt) {
          // Trial expired — drop Pro entitlement. The IAP layer can
          // restore it via setPro(true) on the next refresh if the user
          // converted to a paid sub.
          set({ pro: false, trialEndsAt: undefined });
        }
      },
    }),
    {
      name: 'koc-entitlements-v1',
      storage: createJSONStorage(() => localStorage),
    },
  ),
);

/** True iff Pro is required for this feature and the user doesn't have it. */
export function isFeatureLocked(): boolean {
  return !useEntitlementsStore.getState().pro;
}

/** No format is free under the current pricing model. Users get a 7-day
 *  trial to evaluate everything; after that they need an active sub. */
export const FREE_FORMATS = new Set<string>();

export function isFormatLocked(formatId: string): boolean {
  if (FREE_FORMATS.has(formatId)) return false;
  return isFeatureLocked();
}

/** Calendar days remaining in the trial. 0 if no trial / expired. */
export function trialDaysRemaining(): number {
  const s = useEntitlementsStore.getState();
  if (!s.trialEndsAt) return 0;
  const ms = s.trialEndsAt - Date.now();
  if (ms <= 0) return 0;
  return Math.ceil(ms / (24 * 60 * 60 * 1000));
}
