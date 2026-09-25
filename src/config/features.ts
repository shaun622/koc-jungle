import { Capacitor } from '@capacitor/core';

/** Americano is released on the web. Native rollout remains a separate release.
 * Readers must not use creation flags. Explicit local preview opt-ins remain. */
const localPreview = import.meta.env.DEV || import.meta.env.MODE === 'tournament-test';
export const ENABLE_AMERICANO_V2 = localPreview
  ? import.meta.env.VITE_ENABLE_AMERICANO_V2 === 'true'
  : !Capacitor.isNativePlatform() && import.meta.env.VITE_ENABLE_AMERICANO_V2 !== 'false';

/** Tournament V1 uses a separate storage and routing boundary. Keep creation
 * gated until release evidence is complete; local preview enables it explicitly. */
export const ENABLE_TOURNAMENT_V1 = localPreview && import.meta.env.VITE_ENABLE_TOURNAMENT_V1 === 'true';
