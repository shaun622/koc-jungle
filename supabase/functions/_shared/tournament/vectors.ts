/** Portable protocol vectors used by Vitest now and by the local Deno suite. */
export const TOURNAMENT_SCORING_VECTORS = {
  terminalTiebreaks: [[7, 0], [7, 5], [8, 6], [10, 8]] as const,
  invalidTerminalTiebreaks: [[7, 6], [8, 5], [11, 8]] as const,
  invalidNumbers: [2_147_483_648, 1.5, -1] as const,
} as const;

export const TOURNAMENT_PROTOCOL_VECTORS = {
  maximumScore: 2_147_483_647,
  maximumDecimal: '9223372036854775807',
  rejectedDecimals: ['00', '01', '-1', '9223372036854775808'] as const,
} as const;
