import type { RuleProfile } from './types';

export const RULE_PRESETS = {
  firstToFive: profile('first-to-five', 'First to 5', 'games', 1, 5, 1, null, null, null, 'golden-point', 20),
  standardSet: profile('standard-set', 'One standard set', 'sets', 1, 6, 2, 6, 7, null, 'advantage', 20),
  bestOfThree: profile('best-of-three', 'Best of 3', 'sets', 3, 6, 2, 6, 7, null, 'advantage', 20),
  matchTiebreak: profile('two-sets-match-tiebreak', 'Two sets + match tiebreak', 'sets', 3, 6, 2, 6, 7, 10, 'advantage', 20),
  // The v1 preset used a best-of-three decider despite being labelled as a
  // short set. A new immutable ID/version prevents existing fixtures from
  // being silently reinterpreted when an older snapshot is upgraded.
  customShortSet: profile('custom-short-set-v2', 'One short set', 'sets', 1, 4, 2, 4, 7, null, 'golden-point', 20),
} as const satisfies Record<string, RuleProfile>;

function profile(
  id: string,
  name: string,
  family: RuleProfile['family'],
  bestOfSets: 1 | 3,
  gamesToWin: number,
  gameMargin: 1 | 2,
  tiebreakTrigger: number | null,
  tiebreakTarget: number | null,
  decidingMatchTiebreak: null | 7 | 10,
  gameEnding: RuleProfile['gameEnding'],
  estimatedMinutes: number,
): RuleProfile {
  return {
    id,
    version: 2,
    name,
    family,
    bestOfSets,
    gamesToWin,
    gameMargin,
    tiebreakTrigger,
    tiebreakTarget,
    decidingMatchTiebreak,
    gameEnding,
    estimatedMinutes,
    restMinutes: 15,
  };
}

export function defaultRuleProfiles(): RuleProfile[] {
  return Object.values(RULE_PRESETS).map((item) => ({ ...item }));
}
