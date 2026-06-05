/**
 * Tournament format rule guides.
 *
 * Single source of truth for the long-form rules / how-it-works copy
 * that appears in three places:
 *  - The /help route (a card per format)
 *  - The 'Show rules' popover on each landing-card mode button
 *  - The App Store / Play Store listing description (the operator
 *    copies these into the store dashboards manually)
 */

import type { TournamentFormatId } from '@/types/domain';

export interface FormatRuleGuide {
  id: TournamentFormatId;
  name: string;
  /** One-line summary shown as the card subtitle. */
  tagline: string;
  /** When to pick this format. 1-2 sentences. */
  bestFor: string;
  /** Bulleted list of rules, displayed in order. */
  rules: string[];
  /** How points / advancement / final ranking is decided. */
  scoring: string;
}

const koc: FormatRuleGuide = {
  id: 'koc',
  name: 'King of the Court',
  tagline: 'Winners climb, losers drop, the King defends Centre Court.',
  bestFor:
    'Mixed-skill nights and social play. The classic padel night where everyone moves between courts each round and the strongest team ends up defending the top.',
  rules: [
    'Teams are seeded onto courts via a short qualifier round, or the operator can skip the qualifier and seed manually.',
    'Each round, every court plays simultaneously for a fixed duration set by the operator.',
    'At the end of the round, the winning team on each court moves UP one court and the losing team moves DOWN one court.',
    'Centre Court is special: the winner stays as "King" and defends; the loser drops one court.',
    'Bottom Court: the loser stays put; the winner moves up.',
    'Total event length is set by the operator (default 6 rounds).',
  ],
  scoring:
    'Each court has a point value (higher courts pay more). Win the match → earn the court\'s point value. Final ranking sorts by total points; ties break on games-for, then qualifier score, then alphabetical.',
};

const americano: FormatRuleGuide = {
  id: 'americano',
  name: 'Americano',
  tagline: 'One pool, rotating opponents. Maximum variety in the rounds you set.',
  bestFor:
    'Open nights with a fixed time window where you want to mix it up and face as many different opponents as possible. Set the round count to fit the time you have.',
  rules: [
    'All teams form one shared pool — no groups.',
    'The schedule rotates each round (Berger tables) so each team faces as many different opponents as the rounds allow.',
    'The operator picks the total number of rounds; the format truncates the full schedule at that count.',
    'If the operator sets more rounds than the full schedule has, it wraps and repeats from the start.',
    'Court position determines point value as in other formats.',
  ],
  scoring:
    'Win → earn the court\'s point value. Final ranking by total points; ties break on games-for, then alphabetical.',
};

const mexicano: FormatRuleGuide = {
  id: 'mexicano',
  name: 'Mexicano',
  tagline: 'Re-pairs every round from the live standings. Tight games, round after round.',
  bestFor:
    'Competitive nights where you want close, balanced matchups every round. Top teams meet at the end on Centre Court.',
  rules: [
    'Round 1 pairs consecutive teams in the stored order — drag the team list on Setup to control the opening pairings.',
    'After every round, teams are re-ranked by accumulated points.',
    'Round 2 onwards: adjacent-ranked teams play each other (1st vs 2nd, 3rd vs 4th, …).',
    'The top match is scheduled on the highest court so leaders meet on the showpiece court each round.',
    'Odd team counts: the lowest-ranked team byes that round.',
    'The operator sets the total number of rounds.',
  ],
  scoring:
    'Same court-position-based scoring. Final ranking by total points; ties break on games-for.',
};

const roundRobin: FormatRuleGuide = {
  id: 'round-robin',
  name: 'Round Robin',
  tagline: 'Every team plays every team in their group. Fair, complete, transparent.',
  bestFor:
    'Tournaments where ranking integrity matters and every team should face every other team. Top of the table wins, no luck of the draw.',
  rules: [
    'Teams are split into groups (operator picks the group size, default 4).',
    'Each team plays every other team in their group exactly once.',
    'Schedule is generated using Berger tables — the standard chess-pairing algorithm.',
    'Total rounds per group = group size − 1 (even sizes) or group size (odd sizes, with one team on bye per round).',
    'Mixed group sizes are supported — smaller groups finish their rounds early and sit out the trailing rounds.',
    'All groups play simultaneously across the available courts.',
  ],
  scoring:
    'Win → earn the court\'s point value. Final ranking by total points; ties break on games-for, then qualifier score (if a qualifier was used), then alphabetical.',
};

const bracket: FormatRuleGuide = {
  id: 'bracket',
  name: 'Bracket',
  tagline: 'Single elimination knockout. Win to advance, lose to go home.',
  bestFor:
    'High-stakes nights or end-of-tournament finals. One clear winner. Quick to run once the field is set.',
  rules: [
    'Bracket size is the next power of 2 above the team count (e.g. 5 teams → 8-bracket).',
    'Top seeds get byes in Round 1 when the field isn\'t already a power of 2 — they auto-advance to Round 2.',
    'Each round halves the field. Winners advance, losers are eliminated.',
    'Seeding follows the balanced format: #1 only meets #2 in the final, #1 meets #3 in the semi at the earliest.',
    'Total rounds = log₂(bracket size). 4 teams → 2 rounds. 8 → 3. 16 → 4.',
  ],
  scoring:
    'Win to advance. The team that wins the final round is the tournament champion. No points tally — bracket position is the result.',
};

export const FORMAT_RULES: Record<TournamentFormatId, FormatRuleGuide> = {
  koc,
  americano,
  mexicano,
  'round-robin': roundRobin,
  bracket,
};

/** Display order for the Help screen + landing card. KoC first (flagship), Americano next (most-requested new format). */
export const FORMAT_ORDER: TournamentFormatId[] = [
  'koc',
  'americano',
  'mexicano',
  'round-robin',
  'bracket',
];
