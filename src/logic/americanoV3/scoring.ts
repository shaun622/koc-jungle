import {
  scoreSummary,
  validateRuleProfile,
  TournamentRuleError,
  type RuleProfile,
  type TournamentScore,
  type TournamentSetScore,
} from '@/logic/tournament';
import { isValidAmericanoPoints, MAX_AMERICANO_POINTS } from '@/logic/americanoV2/types';
import { validateSessionPlan } from './sessionPlan';
import type {
  AmericanoConfigV3,
  AmericanoResultDraftV3,
  MatchScoringV3,
  TraditionalPresetKey,
  TraditionalRule,
  TraditionalRowDraftV3,
} from './types';

export const AMERICANO_V3_RULES_VERSION = 3 as const;
export const MAX_AMERICANO_STANDINGS_WEIGHT = 1_000;

type PresetDefinition = { label: string; rule: TraditionalRule };

export const AMERICANO_V3_TRADITIONAL_PRESETS: Record<Exclude<TraditionalPresetKey, 'custom'>, PresetDefinition> = {
  'first-to-five': {
    label: 'First to 5 games (maximum 9 games)',
    rule: { family: 'games', bestOfSets: 1, gamesToWin: 5, gameMargin: 1, tiebreakTrigger: null, tiebreakTarget: null, decidingMatchTiebreak: null, gameEnding: 'golden-point' },
  },
  'short-set': {
    label: 'One short set',
    rule: { family: 'sets', bestOfSets: 1, gamesToWin: 4, gameMargin: 2, tiebreakTrigger: 4, tiebreakTarget: 7, decidingMatchTiebreak: null, gameEnding: 'golden-point' },
  },
  'standard-set': {
    label: 'One standard set',
    rule: { family: 'sets', bestOfSets: 1, gamesToWin: 6, gameMargin: 2, tiebreakTrigger: 6, tiebreakTarget: 7, decidingMatchTiebreak: null, gameEnding: 'advantage' },
  },
  'best-of-three': {
    label: 'Best of 3 sets',
    rule: { family: 'sets', bestOfSets: 3, gamesToWin: 6, gameMargin: 2, tiebreakTrigger: 6, tiebreakTarget: 7, decidingMatchTiebreak: null, gameEnding: 'advantage' },
  },
  'best-of-three-match-tiebreak': {
    label: 'Best of 3 — deciding match tiebreak',
    rule: { family: 'sets', bestOfSets: 3, gamesToWin: 6, gameMargin: 2, tiebreakTrigger: 6, tiebreakTarget: 7, decidingMatchTiebreak: 10, gameEnding: 'advantage' },
  },
};

export class AmericanoScoringV3Error extends Error {
  constructor(readonly code: string, message: string, readonly field?: string) {
    super(message);
    this.name = 'AmericanoScoringV3Error';
  }
}

export interface AmericanoScoreSummaryV3 {
  winner: 'A' | 'B' | null;
  setsA: number;
  setsB: number;
  gamesA: number;
  gamesB: number;
  terminal: boolean;
}

export interface DraftValidationV3 {
  valid: boolean;
  complete: boolean;
  summary: AmericanoScoreSummaryV3 | null;
  error?: { field: string; message: string };
}

export function ruleProfileV3(rule: TraditionalRule, paceMinutes = 10): RuleProfile {
  return {
    id: 'americano-v3',
    version: 2,
    name: 'Americano custom rules',
    ...rule,
    estimatedMinutes: paceMinutes,
    restMinutes: 0,
  };
}

function rulesEqual(left: TraditionalRule, right: TraditionalRule): boolean {
  return left.family === right.family
    && left.bestOfSets === right.bestOfSets
    && left.gamesToWin === right.gamesToWin
    && left.gameMargin === right.gameMargin
    && left.tiebreakTrigger === right.tiebreakTrigger
    && left.tiebreakTarget === right.tiebreakTarget
    && left.decidingMatchTiebreak === right.decidingMatchTiebreak
    && left.gameEnding === right.gameEnding;
}

export function validateMatchScoringV3(scoring: MatchScoringV3, paceMinutes = 10): void {
  if (scoring.allowUnfinished !== undefined && typeof scoring.allowUnfinished !== 'boolean') throw new AmericanoScoringV3Error('INVALID_MATCH_RULE', 'Allow unfinished matches must be true or false.');
  if (scoring.kind === 'rally') {
    if (!isValidAmericanoPoints(scoring.pointsPerMatch)) {
      throw new AmericanoScoringV3Error('INVALID_POINTS', 'Enter a positive whole number for rally points per match.', 'formatConfig.scoring.pointsPerMatch');
    }
    return;
  }
  if (scoring.kind !== 'traditional') throw new AmericanoScoringV3Error('INVALID_MATCH_RULE', 'Choose rally points, games or sets.', 'formatConfig.scoring.kind');

  const profile = ruleProfileV3(scoring.rule, paceMinutes);
  try {
    validateRuleProfile(profile);
  } catch (error) {
    if (error instanceof TournamentRuleError) {
      throw new AmericanoScoringV3Error('INVALID_MATCH_RULE', error.message, `formatConfig.scoring.rule.${error.field ?? 'family'}`);
    }
    throw error;
  }

  if (scoring.preset !== 'custom') {
    const preset = AMERICANO_V3_TRADITIONAL_PRESETS[scoring.preset];
    if (!preset || !rulesEqual(scoring.rule, preset.rule)) {
      throw new AmericanoScoringV3Error('INVALID_MATCH_RULE', 'This preset does not match its saved rules.', 'formatConfig.scoring.preset');
    }
  }
  for (const key of ['pointsPerGameWon', 'matchWinBonus'] as const) {
    const weight = scoring.standings[key];
    const min = key === 'pointsPerGameWon' ? 1 : 0;
    if (!Number.isInteger(weight) || weight < min || weight > MAX_AMERICANO_STANDINGS_WEIGHT) {
      throw new AmericanoScoringV3Error(
        'INVALID_STANDINGS_RULE',
        `${key === 'pointsPerGameWon' ? 'Points per game won' : 'Match win bonus'} must be a whole number from ${min} to ${MAX_AMERICANO_STANDINGS_WEIGHT}.`,
        `formatConfig.scoring.standings.${key}`,
      );
    }
  }
}

export function validateAmericanoConfigV3(config: AmericanoConfigV3): void {
  if (config.rulesVersion !== AMERICANO_V3_RULES_VERSION) throw new AmericanoScoringV3Error('INVALID_MATCH_RULE', 'Americano rules version is unsupported.', 'formatConfig.rulesVersion');
  if (config.pairingMode !== 'fixed' && config.pairingMode !== 'rotating') throw new AmericanoScoringV3Error('INVALID_MATCH_RULE', 'Pairing mode must be rotating or fixed.', 'formatConfig.pairingMode');
  if (config.scheduleKind !== 'full' && config.scheduleKind !== 'balanced' && config.scheduleKind !== 'custom') throw new AmericanoScoringV3Error('INVALID_SCHEDULE', 'Schedule kind is unsupported.', 'formatConfig.scheduleKind');
  if (config.scheduleKind === 'custom') {
    if (!Number.isInteger(config.customRounds) || config.customRounds! < 1 || config.customRounds! > 64) throw new AmericanoScoringV3Error('INVALID_SCHEDULE', 'Custom rounds must be a whole number from 1 to 64.', 'formatConfig.customRounds');
  } else if (config.customRounds !== undefined) throw new AmericanoScoringV3Error('INVALID_SCHEDULE', 'Custom rounds only applies to a custom schedule.', 'formatConfig.customRounds');
  if (!Number.isInteger(config.paceMinutes) || config.paceMinutes < 1 || config.paceMinutes > 240) throw new AmericanoScoringV3Error('INVALID_MATCH_RULE', 'Round length must be 1–240 whole minutes.', 'formatConfig.paceMinutes');
  if (config.sessionPlan !== undefined) validateSessionPlan(config.sessionPlan);
  if (typeof config.paceClockEnabled !== 'boolean') throw new AmericanoScoringV3Error('INVALID_MATCH_RULE', 'Pace clock enabled must be true or false.', 'formatConfig.paceClockEnabled');
  if (!config.ranking || !['shared', 'difference', 'head-to-head', 'head-to-head-then-difference'].includes(config.ranking.tiebreak)) throw new AmericanoScoringV3Error('INVALID_TIE_POLICY', 'Choose a supported standings tie rule.', 'formatConfig.ranking.tiebreak');
  if (config.pairingMode === 'rotating' && config.ranking.tiebreak.startsWith('head-to-head')) throw new AmericanoScoringV3Error('INVALID_TIE_POLICY', 'Head-to-head is only available for fixed pairs.', 'formatConfig.ranking.tiebreak');
  if (!['none', 'golden-point', 'tiebreak-7', 'tiebreak-10'].includes(config.ranking.championship)) throw new AmericanoScoringV3Error('INVALID_TIE_POLICY', 'Choose a supported championship final rule.', 'formatConfig.ranking.championship');
  validateMatchScoringV3(config.scoring, config.paceMinutes);
}

export function defaultAmericanoConfigV3(pairingMode: 'rotating' | 'fixed'): AmericanoConfigV3 {
  return {
    rulesVersion: 3,
    pairingMode,
    scoring: { kind: 'rally', pointsPerMatch: 24 },
    ranking: { tiebreak: 'shared', championship: 'none' },
    scheduleKind: 'full',
    paceMinutes: 10,
    paceClockEnabled: false,
  };
}

export function createTraditionalResultDraftV3(): AmericanoResultDraftV3 {
  return {
    kind: 'traditional',
    sets: [{ kind: 'set', gamesA: null, gamesB: null, tiebreakPointsA: null, tiebreakPointsB: null }],
  };
}

function integerOrNull(value: unknown): value is number | null {
  return value === null || (typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= MAX_AMERICANO_POINTS);
}

function rowIsComplete(row: TraditionalRowDraftV3): boolean {
  if (row.kind === 'match-tiebreak') return row.pointsA !== null && row.pointsB !== null;
  return row.gamesA !== null && row.gamesB !== null
    && ((row.tiebreakPointsA === null && row.tiebreakPointsB === null)
      || (row.tiebreakPointsA !== null && row.tiebreakPointsB !== null));
}

function convertRow(row: TraditionalRowDraftV3): TournamentSetScore | null {
  if (!rowIsComplete(row)) return null;
  if (row.kind === 'match-tiebreak') {
    return { gamesA: row.pointsA!, gamesB: row.pointsB!, decidingMatchTiebreak: true };
  }
  return {
    gamesA: row.gamesA!, gamesB: row.gamesB!,
    ...(row.tiebreakPointsA !== null ? { tiebreakPointsA: row.tiebreakPointsA, tiebreakPointsB: row.tiebreakPointsB! } : {}),
  };
}

function assertDraftShape(draft: AmericanoResultDraftV3, scoring: MatchScoringV3): void {
  if (scoring.kind === 'rally') {
    if (draft.kind !== 'rally' || !integerOrNull(draft.scoreA) || !integerOrNull(draft.scoreB)) {
      throw new AmericanoScoringV3Error('INVALID_SCORE', 'Rally scores must be blank or non-negative whole numbers.', 'result');
    }
    if ((draft.scoreA !== null || draft.scoreB !== null)
      && (draft.scoreA === null || draft.scoreB === null || draft.scoreA > scoring.pointsPerMatch || draft.scoreB > scoring.pointsPerMatch)) {
      throw new AmericanoScoringV3Error('INVALID_SCORE', `Enter both rally scores from 0 to ${scoring.pointsPerMatch}.`, 'result');
    }
    return;
  }
  if (draft.kind !== 'traditional' || !Array.isArray(draft.sets) || draft.sets.length < 1 || draft.sets.length > scoring.rule.bestOfSets) {
    throw new AmericanoScoringV3Error('INVALID_SCORE', 'Traditional score rows do not match the selected format.', 'result.sets');
  }
  for (let i = 0; i < draft.sets.length; i += 1) {
    const row = draft.sets[i];
    if (row.kind === 'set') {
      if (!integerOrNull(row.gamesA) || !integerOrNull(row.gamesB) || !integerOrNull(row.tiebreakPointsA) || !integerOrNull(row.tiebreakPointsB)) {
        throw new AmericanoScoringV3Error('INVALID_SCORE', 'Enter blank or non-negative whole-number scores.', `result.sets.${i}`);
      }
    } else if (row.kind === 'match-tiebreak') {
      if (!integerOrNull(row.pointsA) || !integerOrNull(row.pointsB)) throw new AmericanoScoringV3Error('INVALID_SCORE', 'Enter blank or non-negative whole-number tiebreak scores.', `result.sets.${i}`);
    } else {
      throw new AmericanoScoringV3Error('INVALID_SCORE', 'Unknown score row.', `result.sets.${i}`);
    }
  }
}

function mapSummary(summary: ReturnType<typeof scoreSummary>): AmericanoScoreSummaryV3 {
  return { ...summary };
}

export function validateAmericanoResultDraftV3(
  draft: AmericanoResultDraftV3,
  scoring: MatchScoringV3,
  complete: boolean,
  paceMinutes = 10,
): DraftValidationV3 {
  try {
    validateMatchScoringV3(scoring, paceMinutes);
    if (draft.endedEarly !== undefined && typeof draft.endedEarly !== 'boolean') throw new AmericanoScoringV3Error('INVALID_SCORE', 'Finish with score played must be true or false.');
    const endedEarly = draft.endedEarly === true;
    assertDraftShape(draft, scoring);
    if (scoring.kind === 'rally') {
      if (draft.kind !== 'rally') throw new AmericanoScoringV3Error('INVALID_SCORE', 'This result must use rally points.', 'result.kind');
      if (draft.scoreA === null || draft.scoreB === null) {
        if (complete) throw new AmericanoScoringV3Error('INVALID_SCORE', 'Enter both rally scores before confirming.', 'result');
        return { valid: true, complete: false, summary: null };
      }
      const total = draft.scoreA + draft.scoreB;
      if (endedEarly ? total > scoring.pointsPerMatch : total !== scoring.pointsPerMatch) throw new AmericanoScoringV3Error('INVALID_SCORE', endedEarly ? `Enter actual scores totalling at most ${scoring.pointsPerMatch}.` : `Scores must add up to ${scoring.pointsPerMatch}.`, 'result.scoreB');
      return { valid: true, complete: true, summary: { winner: draft.scoreA === draft.scoreB ? null : draft.scoreA > draft.scoreB ? 'A' : 'B', setsA: 0, setsB: 0, gamesA: draft.scoreA, gamesB: draft.scoreB, terminal: true } };
    }
    if (draft.kind !== 'traditional') throw new AmericanoScoringV3Error('INVALID_SCORE', 'This result must use game or set scores.', 'result.kind');
    const rows: TournamentSetScore[] = [];
    let sawIncomplete = false;
    for (let index = 0; index < draft.sets.length; index += 1) {
      const row = draft.sets[index];
      if (rowIsComplete(row)) {
        if (sawIncomplete) throw new AmericanoScoringV3Error('INVALID_SCORE', 'Complete score rows cannot follow a blank row.', `result.sets.${index}`);
        rows.push(convertRow(row)!);
      } else {
        if (complete) throw new AmericanoScoringV3Error('INVALID_SCORE', 'Complete every score field before confirming.', `result.sets.${index}`);
        if (index !== draft.sets.length - 1) throw new AmericanoScoringV3Error('INVALID_SCORE', 'Only the last score row may be incomplete.', `result.sets.${index}`);
        sawIncomplete = true;
      }
    }
    if (rows.length === 0) {
      if (complete) throw new AmericanoScoringV3Error('INVALID_SCORE', 'Enter a complete match score before confirming.', 'result.sets');
      return { valid: true, complete: false, summary: null };
    }
    // A stopped set tiebreak has not awarded its final game yet. Validate its
    // point progress separately, then count only games actually completed.
    const last = rows[rows.length - 1];
    let partialTiebreakLead: 'A' | 'B' | null = null;
    if (endedEarly && last.tiebreakPointsA !== undefined && last.gamesA !== last.gamesB) {
      scoreSummary({ sets: [last] }, { ...ruleProfileV3(scoring.rule, paceMinutes), bestOfSets: 1, decidingMatchTiebreak: null }, true);
    }
    if (endedEarly && last.gamesA === scoring.rule.tiebreakTrigger && last.gamesB === scoring.rule.tiebreakTrigger && last.tiebreakPointsA !== undefined) {
      const a = last.tiebreakPointsA; const b = last.tiebreakPointsB!;
      if (Math.max(a, b) >= scoring.rule.tiebreakTarget! && Math.abs(a - b) >= 2) throw new AmericanoScoringV3Error('INVALID_SCORE', 'This tiebreak is finished. Record its winning game as well.');
      partialTiebreakLead = a === b ? null : a > b ? 'A' : 'B';
      delete last.tiebreakPointsA; delete last.tiebreakPointsB;
    }
    const summary = scoreSummary({ sets: rows } satisfies TournamentScore, ruleProfileV3(scoring.rule, paceMinutes), complete && !endedEarly);
    if (endedEarly) {
      if (sawIncomplete) throw new AmericanoScoringV3Error('INVALID_SCORE', 'Enter both scores or remove the blank last row.');
      if (!summary.terminal) summary.winner = summary.setsA === summary.setsB
        ? summary.setsA + summary.setsB === rows.length ? null
          : partialTiebreakLead ?? (last.gamesA === last.gamesB ? null : last.gamesA > last.gamesB ? 'A' : 'B')
        : summary.setsA > summary.setsB ? 'A' : 'B';
      return { valid: true, complete: true, summary: mapSummary(summary) };
    }
    const lastIsComplete = !sawIncomplete;
    return { valid: true, complete: lastIsComplete && summary.terminal && summary.winner !== null, summary: mapSummary(summary) };
  } catch (error) {
    if (error instanceof AmericanoScoringV3Error) return { valid: false, complete: false, summary: null, error: { field: error.field ?? 'result', message: error.message } };
    if (error instanceof TournamentRuleError) return { valid: false, complete: false, summary: null, error: { field: `result.${error.field ?? 'sets'}`, message: error.message } };
    return { valid: false, complete: false, summary: null, error: { field: 'result', message: error instanceof Error ? error.message : 'The score is invalid.' } };
  }
}

export function scoreWinnerV3(draft: AmericanoResultDraftV3, scoring: MatchScoringV3, paceMinutes = 10): 'A' | 'B' | null {
  const result = validateAmericanoResultDraftV3(draft, scoring, true, paceMinutes);
  if (!result.valid) throw new AmericanoScoringV3Error('INVALID_SCORE', result.error!.message, result.error!.field);
  return result.summary!.winner;
}

export function standingAwardForSideV3(
  scoring: MatchScoringV3,
  summary: AmericanoScoreSummaryV3,
  side: 'A' | 'B',
): number {
  if (scoring.kind === 'rally') return side === 'A' ? summary.gamesA : summary.gamesB;
  const games = side === 'A' ? summary.gamesA : summary.gamesB;
  return games * scoring.standings.pointsPerGameWon + (summary.winner === side ? scoring.standings.matchWinBonus : 0);
}

export function confirmedSummaryV3(
  draft: AmericanoResultDraftV3,
  scoring: MatchScoringV3,
  paceMinutes = 10,
): AmericanoScoreSummaryV3 {
  const result = validateAmericanoResultDraftV3(draft, scoring, true, paceMinutes);
  if (!result.valid || !result.summary) throw new AmericanoScoringV3Error('INVALID_SCORE', result.error?.message ?? 'The score is incomplete.', result.error?.field);
  return result.summary;
}

export function isValidScoreIntegerV3(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= MAX_AMERICANO_POINTS;
}
