/**
 * Americano — fixed-team rotation, operator-set total rounds.
 *
 * In the classic padel Americano players rotate partners across the night.
 * KoC's data model treats a fixed pair as the atomic unit, so our
 * Americano interpretation is:
 *
 *  - All active teams form a single pool (no groups).
 *  - The Berger schedule (same algorithm as Round Robin) defines the round
 *    order so every team plays as many different opponents as possible.
 *  - The operator picks the total number of rounds in advance
 *    (`event.settings.roundsTotal`). The format simply truncates the full
 *    Berger schedule at that round count.
 *  - The team list is captured at start time and stored on
 *    `formatConfig.teams` so the schedule is deterministic even if teams
 *    are deactivated mid-event.
 *
 * Compared to Round Robin: RR plays the *complete* schedule and groups
 * teams. Americano keeps everyone in one pool and stops after N rounds.
 *
 * Compared to Mexicano (Stage 2.3.2): Americano locks the schedule up
 * front. Mexicano re-pairs from running standings before each round.
 */

import type { TournamentFormat } from './index';
import { bergerRounds } from './roundRobin';
import { packMatchesOntoCourts } from './util';

export interface AmericanoConfig {
  /** Team IDs in their start-of-tournament order. Frozen at start time. */
  teams: string[];
}

export const americano: TournamentFormat = {
  id: 'americano',
  name: 'Americano',
  blurb:
    'Every team in one pool. The schedule rotates so you face as many different opponents as possible across the rounds you set.',
  usesQualifier: false,

  buildFirstRound({ courts, config, rankedTeamIds }) {
    // formatConfig.teams is set by startTournament(); fall back to the
    // ranked / active team list for forward-compat or hand-crafted events.
    const teams = readTeams(config) ?? rankedTeamIds;
    const schedule = bergerRounds(teams);
    const pairs = schedule[0] ?? [];
    return packMatchesOntoCourts(pairs, courts, 'Americano');
  },

  computeNextRound({ rounds, courts, config }) {
    const teams = readTeams(config);
    if (!teams) {
      throw new Error('Americano: event.formatConfig.teams is required.');
    }
    const schedule = bergerRounds(teams);
    // rounds.length completed rounds → next round is index `rounds.length`
    // (0-indexed). If we've outrun the full Berger schedule (e.g. operator
    // set roundsTotal higher than the schedule length) wrap around so the
    // operator always gets a playable round.
    const idx = schedule.length > 0 ? rounds.length % schedule.length : 0;
    const pairs = schedule[idx] ?? [];
    return packMatchesOntoCourts(pairs, courts, 'Americano');
  },

  isComplete({ rounds, settings }) {
    return rounds.length >= settings.roundsTotal;
  },
};

function readTeams(config: unknown): string[] | undefined {
  const cfg = (config ?? {}) as Partial<AmericanoConfig>;
  return Array.isArray(cfg.teams) && cfg.teams.length > 0 ? cfg.teams : undefined;
}
