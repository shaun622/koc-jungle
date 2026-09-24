/** Creation is deliberately disabled in ordinary builds until every rollout
 * gate in the Americano v2 handoff has passed. Readers must not use this flag. */
const localPreview = import.meta.env.DEV || import.meta.env.MODE === 'tournament-test';
export const ENABLE_AMERICANO_V2 = localPreview && import.meta.env.VITE_ENABLE_AMERICANO_V2 === 'true';

/** Tournament V1 uses a separate storage and routing boundary. Keep creation
 * gated until release evidence is complete; local preview enables it explicitly. */
export const ENABLE_TOURNAMENT_V1 = localPreview && import.meta.env.VITE_ENABLE_TOURNAMENT_V1 === 'true';
