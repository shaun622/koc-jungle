import { Capacitor } from '@capacitor/core';

/** Americano is released on the web. Native rollout remains a separate release.
 * Readers must not use creation flags. Explicit local preview opt-ins remain. */
const localPreview = import.meta.env.DEV || import.meta.env.MODE === 'tournament-test';
export const ENABLE_AMERICANO_V2 = localPreview
  ? import.meta.env.VITE_ENABLE_AMERICANO_V2 === 'true'
  : !Capacitor.isNativePlatform() && import.meta.env.VITE_ENABLE_AMERICANO_V2 !== 'false';

/** Schema 3 creation remains opt-in, while every supported build can still read
 * and run an existing v3 event. It never upgrades an existing schema-2 event. */
export const ENABLE_AMERICANO_V3 = ENABLE_AMERICANO_V2
  && localPreview
  && import.meta.env.VITE_ENABLE_AMERICANO_V3 === 'true';

/** Tournament V1 uses a separate storage and routing boundary. Keep creation
 * gated until release evidence is complete; local preview enables it explicitly. */
export const ENABLE_TOURNAMENT_V1 = localPreview && import.meta.env.VITE_ENABLE_TOURNAMENT_V1 === 'true';
