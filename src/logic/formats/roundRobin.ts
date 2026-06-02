/**
 * Round Robin — each team plays every other team within their group.
 *
 * - Group composition is fixed at setup time and stored on
 *   `event.formatConfig` as `{ groupSize, groups: string[][] }`.
 * - The schedule is deterministic (Berger tables) so we don't have to
 *   persist anything beyond the group lineup; `computeNextRound` derives
 *   round N's fixtures from the group composition and the count of
 *   completed rounds.
 * - Mixed group sizes are handled (e.g. one group of 4 plus one of 6 —
 *   the larger group plays more rounds; smaller groups finish early and
 *   sit out the trailing rounds).
 * - Court assignment: floor(groupSize / 2) matches per group per round;
 *   matches are packed onto the highest-position courts first.
 */

import type { TournamentFormat } from './index';
import { packMatchesOntoCourts } from './util';

export interface RoundRobinConfig {
  groupSize: number;
  /** One inner array per group — each holds the team IDs for that group. */
  groups: string[][];
}

export const roundRobin: TournamentFormat = {
  id: 'round-robin',
  name: 'Round Robin',
  blurb:
    'Each team plays every other team in their group. Top of the table wins. Fair and complete — no rotation, no surprises.',
  usesQualifier: false,

  buildFirstRound({ courts, config }) {
    return packMatchesOntoCourts(buildRound(1, asConfig(config)), courts, 'Round Robin');
  },

  computeNextRound({ rounds, courts, config }) {
    const nextRoundIdx = rounds.length + 1;
    return packMatchesOntoCourts(buildRound(nextRoundIdx, asConfig(config)), courts, 'Round Robin');
  },

  isComplete({ rounds, config }) {
    const cfg = asConfig(config);
    const maxRounds = cfg.groups
      .map((g) => bergerRoundCount(g.length))
      .reduce((a, b) => Math.max(a, b), 0);
    return rounds.length >= maxRounds;
  },
};

/**
 * Total number of rounds a single group needs to complete a round-robin.
 *  - Even G: G-1 rounds (everyone plays once per round).
 *  - Odd G: G rounds (one team has a bye each round).
 */
export function bergerRoundCount(groupSize: number): number {
  if (groupSize < 2) return 0;
  return groupSize % 2 === 0 ? groupSize - 1 : groupSize;
}

/**
 * Generate the full round-robin schedule for a single group using Berger
 * tables (standard chess-pairing algorithm). Returns one inner array per
 * round; each round contains [teamA, teamB] tuples. Bye fixtures (odd
 * group sizes) are filtered out so callers see only playable pairs.
 */
export function bergerRounds(teamIds: string[]): Array<Array<[string, string]>> {
  if (teamIds.length < 2) return [];
  const isOdd = teamIds.length % 2 !== 0;
  const padded: Array<string | null> = isOdd ? [...teamIds, null] : teamIds.slice();
  const N = padded.length;
  const numRounds = N - 1;

  let current = padded.slice();
  const rounds: Array<Array<[string, string]>> = [];
  for (let r = 0; r < numRounds; r++) {
    const pairs: Array<[string, string]> = [];
    for (let i = 0; i < N / 2; i++) {
      const a = current[i];
      const b = current[N - 1 - i];
      if (a && b) pairs.push([a, b]);
    }
    rounds.push(pairs);
    // Rotate: keep current[0] fixed, shift the rest by one
    // (the last element moves into position 1 each round).
    const fixed = current[0];
    const rest = current.slice(1);
    rest.unshift(rest.pop() ?? null);
    current = [fixed, ...rest];
  }
  return rounds;
}

function buildRound(
  roundIdx: number,
  cfg: RoundRobinConfig,
): Array<[string, string]> {
  const all: Array<[string, string]> = [];
  for (const group of cfg.groups) {
    const schedule = bergerRounds(group);
    const pairs = schedule[roundIdx - 1];
    if (pairs) all.push(...pairs);
  }
  return all;
}


function asConfig(config: unknown): RoundRobinConfig {
  // Defensive: callers should pass a well-formed config but legacy or
  // hand-crafted events might not.
  const cfg = (config ?? {}) as Partial<RoundRobinConfig>;
  if (!Array.isArray(cfg.groups) || cfg.groups.length === 0) {
    throw new Error('Round Robin: event.formatConfig.groups is required.');
  }
  return {
    groupSize: cfg.groupSize ?? cfg.groups[0]?.length ?? 0,
    groups: cfg.groups,
  };
}

/**
 * Helper used at setup time to slice an ordered team list into groups of
 * the requested size. Imbalanced totals get distributed top-down (the
 * trailing group may be smaller than groupSize).
 */
export function splitTeamsIntoGroups(
  orderedTeamIds: string[],
  groupSize: number,
): string[][] {
  if (groupSize < 2) {
    throw new Error('Round Robin: groupSize must be at least 2.');
  }
  const groups: string[][] = [];
  for (let i = 0; i < orderedTeamIds.length; i += groupSize) {
    groups.push(orderedTeamIds.slice(i, i + groupSize));
  }
  return groups;
}
