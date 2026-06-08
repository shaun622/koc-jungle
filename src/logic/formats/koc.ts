/**
 * King of the Court — the founding tournament format.
 *
 * Wraps the existing rotation + seeding logic in the shared
 * `TournamentFormat` interface so other modes can be added without
 * touching the eventStore.
 */

import { computeNextRoundAssignments } from '../rotation';
import { assignRankedTeamsToCourts } from '../seeding';
import type { TournamentFormat } from './index';

export const koc: TournamentFormat = {
  id: 'koc',
  name: 'King of the Court',
  blurb: 'The classic. A qualifier seeds 14 teams onto 7 courts. Winners climb, losers drop, the King defends Centre Court.',
  usesQualifier: true,

  buildFirstRound({ rankedTeamIds, courts }) {
    // KoC pairs the ranked qualifier order onto courts (top 2 → Centre,
    // bottom 2 → lowest). `assignRankedTeamsToCourts` is the existing
    // implementation; just routed through the abstraction now.
    return assignRankedTeamsToCourts(rankedTeamIds, courts);
  },

  computeNextRound({ rounds, courts, tieRule }) {
    const lastRound = rounds[rounds.length - 1];
    if (!lastRound) {
      throw new Error('KoC.computeNextRound called without a prior round.');
    }
    return computeNextRoundAssignments(lastRound, courts, tieRule);
  },

  isComplete({ rounds, settings }) {
    const last = rounds[rounds.length - 1];
    if (!last?.completedAt) return false;
    return last.index >= settings.roundsTotal;
  },
};
