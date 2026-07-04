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

  buildFirstRound({ courts, config, rankedTeamIds, teams }) {
    // formatConfig.teams is set by startTournament(); fall back to the
    // ranked / active team list for forward-compat or hand-crafted events.
    // Only ACTIVE teams play.
    const pool = activePool(config, teams, rankedTeamIds);
    const schedule = bergerRounds(pool);
    const pairs = schedule[0] ?? [];
    return packMatchesOntoCourts(pairs, courts, 'Americano');
  },

  computeNextRound({ rounds, courts, config, teams }) {
    if (!readTeams(config)) {
      throw new Error('Americano: event.formatConfig.teams is required.');
    }
    // Build the schedule from the ACTIVE pool: teams deactivated mid-event
    // drop out and teams added mid-event (appended to formatConfig.teams by
    // addTeam) join in. This also avoids ever scheduling an inactive team,
    // which would otherwise fail assignment validation and block the round.
    const pool = activePool(config, teams);
    const schedule = bergerRounds(pool);
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

/**
 * The teams that actually play: the frozen config order (which grows as teams
 * are added mid-event) intersected with the currently-active roster, order
 * preserved. Falls back to the ranked / active list when no config is present.
 */
function activePool(
  config: unknown,
  teams: { id: string; active: boolean }[],
  fallback?: string[],
): string[] {
  const base = readTeams(config) ?? fallback ?? teams.map((t) => t.id);
  // No roster provided (degenerate / unit-test) → nothing to filter against.
  if (teams.length === 0) return base;
  const activeIds = new Set(teams.filter((t) => t.active).map((t) => t.id));
  return base.filter((id) => activeIds.has(id));
}
