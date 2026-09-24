/** Creation is deliberately disabled in ordinary builds until every rollout
 * gate in the Americano v2 handoff has passed. Readers must not use this flag. */
export const ENABLE_AMERICANO_V2 = import.meta.env.VITE_ENABLE_AMERICANO_V2 === 'true';

/** Tournament V1 uses a separate storage and routing boundary. Keep creation
 * gated until release evidence is complete; local preview enables it explicitly. */
export const ENABLE_TOURNAMENT_V1 = import.meta.env.VITE_ENABLE_TOURNAMENT_V1 === 'true';
