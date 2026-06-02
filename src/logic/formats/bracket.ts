/**
 * Single-elimination bracket.
 *
 *  - Bracket size = the next power of 2 ≥ team count.
 *  - Top seeds get a bye in round 1 when N < bracket size. Byes don't
 *    consume court time — they're recorded structurally and the team
 *    auto-advances to round 2.
 *  - Round R has bracket_size / 2^(R+1) playable matches (plus any bye
 *    pass-throughs from round R-1).
 *  - Seeding follows the standard "balanced" tree: #1 only meets #2 in
 *    the final; #1 meets #4 in the semi at the earliest; etc.
 *
 * Storage: `formatConfig.slots: (string | null)[]` is the bracket-position
 * ordering of team IDs (or null for bye slots). round.matches is paired
 * by team ID against the slots; order of matches within a round is
 * irrelevant — we look up by participating teams.
 */

import type { Match, MainRound, TieRule } from '@/types/domain';
import { decideWinnerLoser } from '@/logic/rotation';
import type { TournamentFormat } from './index';
import { packMatchesOntoCourts } from './util';

export interface BracketConfig {
  bracketSize: number;
  slots: (string | null)[];
}

export const bracket: TournamentFormat = {
  id: 'bracket',
  name: 'Bracket',
  blurb:
    'Single elimination. Win to advance, lose to go home. Top seeds bye into round 2 when the field isn\'t a power of 2.',
  usesQualifier: false,

  buildFirstRound({ courts, config, rankedTeamIds }) {
    const cfg = asConfig(config, rankedTeamIds);
    const pairs = round1Pairs(cfg);
    return packMatchesOntoCourts(pairs, courts, 'Bracket');
  },

  computeNextRound({ rounds, courts, config, tieRule }) {
    const cfg = asConfig(config, []);
    const nextRoundIdx = rounds.length;
    if (nextRoundIdx >= bracketRoundCount(cfg.bracketSize)) {
      return []; // tournament finished
    }
    const positions = computeBracketPositionsAfter(rounds, cfg, tieRule);
    const matchCount = cfg.bracketSize / 2 ** (nextRoundIdx + 1);
    const pairs: Array<[string, string]> = [];
    for (let i = 0; i < matchCount; i++) {
      const a = positions[2 * i];
      const b = positions[2 * i + 1];
      if (a && b) pairs.push([a, b]);
    }
    return packMatchesOntoCourts(pairs, courts, 'Bracket');
  },

  isComplete({ rounds, config }) {
    const cfg = asConfig(config, []);
    return rounds.length >= bracketRoundCount(cfg.bracketSize);
  },
};

/** log2(bracketSize). 4-team → 2, 8 → 3, 16 → 4. */
export function bracketRoundCount(bracketSize: number): number {
  if (bracketSize < 2) return 0;
  return Math.log2(bracketSize);
}

/** Smallest power of 2 ≥ n; with a floor of 2 so a 1-team event still bracketSize=2 (degenerate but well-formed). */
export function nextPowerOf2(n: number): number {
  if (n < 2) return 2;
  return 2 ** Math.ceil(Math.log2(n));
}

/**
 * Standard balanced-bracket seeding for a bracket of `size`.
 * Returns indices into the seeded-team list in the order they should be
 * placed into bracket slots. e.g. size 4 → [0, 3, 1, 2] means slots
 * are [#1, #4, #2, #3] so round-1 pairings are #1-vs-#4 and #2-vs-#3.
 */
export function bracketSeedingOrder(size: number): number[] {
  if (size <= 1) return [0];
  const half = size / 2;
  const top = bracketSeedingOrder(half);
  const out: number[] = [];
  for (const idx of top) {
    out.push(idx);
    out.push(size - 1 - idx);
  }
  return out;
}

/**
 * Build the bracket-position-ordered slots from a seeded team list.
 * Missing slots (when team count < bracketSize) are null = bye.
 */
export function buildBracketSlots(
  seededTeamIds: string[],
  bracketSize: number,
): (string | null)[] {
  const order = bracketSeedingOrder(bracketSize);
  const slots: (string | null)[] = new Array(bracketSize).fill(null);
  for (let i = 0; i < order.length; i++) {
    slots[i] = seededTeamIds[order[i]] ?? null;
  }
  return slots;
}

function round1Pairs(cfg: BracketConfig): Array<[string, string]> {
  const pairs: Array<[string, string]> = [];
  for (let i = 0; i < cfg.slots.length; i += 2) {
    const a = cfg.slots[i];
    const b = cfg.slots[i + 1];
    if (a && b) pairs.push([a, b]);
    // If either is null → bye, the non-null team auto-advances; no match.
  }
  return pairs;
}

/**
 * Walk the bracket round-by-round given the completed rounds; return
 * the positions array as it stands BEFORE the next round.
 *
 * positions[i] for round R = the team currently occupying bracket
 * position i at the start of round R. Two consecutive entries pair up.
 */
function computeBracketPositionsAfter(
  rounds: MainRound[],
  cfg: BracketConfig,
  tieRule: TieRule,
): (string | null)[] {
  let positions: (string | null)[] = cfg.slots.slice();
  for (let r = 0; r < rounds.length; r++) {
    positions = advanceOneRound(positions, rounds[r], tieRule);
  }
  return positions;
}

function advanceOneRound(
  positions: (string | null)[],
  round: MainRound,
  tieRule: TieRule,
): (string | null)[] {
  const next: (string | null)[] = [];
  for (let i = 0; i < positions.length; i += 2) {
    const a = positions[i];
    const b = positions[i + 1];
    if (!a && !b) {
      next.push(null);
    } else if (!a) {
      next.push(b); // bye pass-through
    } else if (!b) {
      next.push(a); // bye pass-through
    } else {
      // Find the match in this round between teams a and b.
      const match = findMatch(round.matches, a, b);
      if (!match || !match.status || match.status !== 'completed') {
        // Match not yet completed — fall back to higher seed (a).
        next.push(a);
      } else {
        const decided = decideWinnerLoser(match, tieRule);
        next.push(decided.winnerId ?? a);
      }
    }
  }
  return next;
}

function findMatch(matches: Match[], teamA: string, teamB: string): Match | undefined {
  return matches.find(
    (m) =>
      (m.teamAId === teamA && m.teamBId === teamB) ||
      (m.teamAId === teamB && m.teamBId === teamA),
  );
}

function asConfig(config: unknown, rankedTeamIds: string[]): BracketConfig {
  const cfg = (config ?? {}) as Partial<BracketConfig>;
  if (cfg.bracketSize && Array.isArray(cfg.slots) && cfg.slots.length === cfg.bracketSize) {
    return { bracketSize: cfg.bracketSize, slots: cfg.slots };
  }
  if (rankedTeamIds.length === 0) {
    throw new Error('Bracket: event.formatConfig.slots is required.');
  }
  const bracketSize = nextPowerOf2(rankedTeamIds.length);
  return { bracketSize, slots: buildBracketSlots(rankedTeamIds, bracketSize) };
}
