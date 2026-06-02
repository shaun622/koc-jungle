/**
 * Mexicano — dynamic re-pairing every round based on running points.
 *
 * The chaotic-but-balanced cousin of Americano. After every round we
 * rank the teams by their accumulated points; the next round pairs
 * adjacent-ranked teams (1st vs 2nd, 3rd vs 4th, ...). The top match
 * goes on the highest-position court so the best teams meet on the
 * showpiece court each round.
 *
 *  - Round 1 uses the team list in its stored order (operator-controlled
 *    by reordering teams on the Setup screen).
 *  - Round 2 onwards: standings → consecutive pairing.
 *  - Odd team count: the last-ranked team byes the round.
 *  - Operator-set `settings.roundsTotal` decides when the event ends.
 *
 * The team pool is captured into `formatConfig.teams` at start time so
 * deactivating a team mid-event doesn't change the pool size (the team
 * just sinks to the bottom of the ranking and may bye).
 */

import type { TournamentFormat } from './index';
import { packMatchesOntoCourts, rankTeamsByPoints } from './util';

export interface MexicanoConfig {
  /** Team IDs in their start-of-tournament order (round-1 seeding). */
  teams: string[];
}

export const mexicano: TournamentFormat = {
  id: 'mexicano',
  name: 'Mexicano',
  blurb:
    'Dynamic re-pairing every round: after each round the leaderboard re-sorts and adjacent teams play each other. Top teams clash on the top court.',
  usesQualifier: false,

  buildFirstRound({ courts, config, rankedTeamIds }) {
    const teams = readTeams(config) ?? rankedTeamIds;
    const pairs = pairAdjacent(teams);
    return packMatchesOntoCourts(pairs, courts, 'Mexicano');
  },

  computeNextRound({ rounds, courts, config, teams, tieRule }) {
    // Pool = teams enrolled at start time. Intersect with currently
    // active teams so deactivated mid-event ones bye permanently.
    const pool = new Set(readTeams(config) ?? teams.map((t) => t.id));
    const activeIds = new Set(teams.filter((t) => t.active).map((t) => t.id));
    const ranked = rankTeamsByPoints(rounds, teams, tieRule).filter(
      (id) => pool.has(id) && activeIds.has(id),
    );
    const pairs = pairAdjacent(ranked);
    return packMatchesOntoCourts(pairs, courts, 'Mexicano');
  },

  isComplete({ rounds, settings }) {
    return rounds.length >= settings.roundsTotal;
  },
};

function readTeams(config: unknown): string[] | undefined {
  const cfg = (config ?? {}) as Partial<MexicanoConfig>;
  return Array.isArray(cfg.teams) && cfg.teams.length > 0 ? cfg.teams : undefined;
}

/**
 * Pair consecutive entries: [a, b, c, d] → [[a, b], [c, d]].
 * The trailing odd entry byes (returns one fewer match).
 */
function pairAdjacent(ids: string[]): Array<[string, string]> {
  const pairs: Array<[string, string]> = [];
  for (let i = 0; i + 1 < ids.length; i += 2) {
    pairs.push([ids[i], ids[i + 1]]);
  }
  return pairs;
}
