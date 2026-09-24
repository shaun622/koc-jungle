import { invariant, TournamentRuleError } from './errors';
import type { RuleProfile, TournamentResult, TournamentScore, TournamentSetScore } from './types';

const MAX_SCORE = 2_147_483_647;
const MAX_REASON_LENGTH = 500;

export interface ScoreSummary {
  winner: 'A' | 'B' | null;
  setsA: number;
  setsB: number;
  gamesA: number;
  gamesB: number;
  terminal: boolean;
}

export function validateRuleProfile(profile: RuleProfile): void {
  invariant(profile.version >= 1 && Number.isInteger(profile.version), 'RULE_VERSION', 'Rule version must be a positive integer.', 'version');
  invariant(profile.family === 'games' || profile.family === 'sets', 'MATCH_FAMILY', 'Match family must be games or sets.', 'family');
  invariant(profile.gameEnding === 'advantage' || profile.gameEnding === 'golden-point' || profile.gameEnding === 'star-point', 'GAME_ENDING', 'Choose a supported game ending.', 'gameEnding');
  invariant(profile.gamesToWin >= 1 && profile.gamesToWin <= 99 && Number.isInteger(profile.gamesToWin), 'GAME_TARGET', 'Games to win must be from 1 to 99.', 'gamesToWin');
  invariant(profile.gameMargin === 1 || profile.gameMargin === 2, 'GAME_MARGIN', 'Game margin must be one or two.', 'gameMargin');
  invariant(profile.bestOfSets === 1 || profile.bestOfSets === 3, 'SET_COUNT', 'Best of sets must be one or three.', 'bestOfSets');

  if (profile.family === 'games') {
    invariant(profile.bestOfSets === 1, 'GAME_FAMILY_SETS', 'A games match uses one score row.', 'bestOfSets');
    invariant(profile.decidingMatchTiebreak === null, 'GAME_FAMILY_DECIDER', 'A games match cannot use a deciding match tiebreak.', 'decidingMatchTiebreak');
  }

  if (profile.tiebreakTrigger === null) {
    invariant(profile.tiebreakTarget === null, 'TIEBREAK_TARGET', 'Remove the tiebreak target when no tiebreak is used.', 'tiebreakTarget');
  } else {
    invariant(Number.isInteger(profile.tiebreakTrigger) && profile.tiebreakTrigger >= 1, 'TIEBREAK_TRIGGER', 'Tiebreak trigger must be a positive integer.', 'tiebreakTrigger');
    invariant(Number.isInteger(profile.tiebreakTarget) && (profile.tiebreakTarget ?? 0) >= 1 && (profile.tiebreakTarget ?? 0) <= 99, 'TIEBREAK_TARGET', 'Tiebreak target must be from 1 to 99.', 'tiebreakTarget');
    const allowedTriggers = profile.gameMargin === 1
      ? [profile.gamesToWin - 1]
      : [profile.gamesToWin - 1, profile.gamesToWin];
    invariant(
      allowedTriggers.includes(profile.tiebreakTrigger),
      'TIEBREAK_REACHABILITY',
      `For this scoring format the tiebreak must start at ${allowedTriggers.join(' or ')} games all.`,
      'tiebreakTrigger',
    );
  }

  if (profile.decidingMatchTiebreak !== null) {
    invariant(profile.family === 'sets' && profile.bestOfSets === 3, 'DECIDING_TIEBREAK_FORMAT', 'A deciding match tiebreak requires a best-of-three sets match.', 'decidingMatchTiebreak');
    invariant(profile.decidingMatchTiebreak === 7 || profile.decidingMatchTiebreak === 10, 'DECIDING_TIEBREAK_TARGET', 'A deciding match tiebreak target must be 7 or 10.', 'decidingMatchTiebreak');
  }

  invariant(profile.estimatedMinutes >= 1 && profile.estimatedMinutes <= 240 && Number.isInteger(profile.estimatedMinutes), 'ESTIMATED_MINUTES', 'Estimated minutes must be from 1 to 240.', 'estimatedMinutes');
  invariant(profile.restMinutes >= 0 && profile.restMinutes <= 240 && Number.isInteger(profile.restMinutes), 'REST_MINUTES', 'Rest minutes must be from 0 to 240.', 'restMinutes');
}

export function scoreSummary(score: TournamentScore, profile: RuleProfile, complete: boolean): ScoreSummary {
  validateRuleProfile(profile);
  invariant(Array.isArray(score.sets) && score.sets.length > 0, 'SCORE_EMPTY', 'Enter a score.', 'score');
  const maxRows = profile.family === 'games' ? 1 : profile.bestOfSets;
  invariant(score.sets.length <= maxRows, 'TOO_MANY_SETS', `This match allows at most ${maxRows} score rows.`, 'score');

  let setsA = 0;
  let setsB = 0;
  let gamesA = 0;
  let gamesB = 0;
  let terminal = false;

  for (let index = 0; index < score.sets.length; index += 1) {
    invariant(!terminal, 'EXTRA_SET', 'Remove score rows entered after the match was won.', `score.sets.${index}`);
    const row = score.sets[index];
    const isLast = index === score.sets.length - 1;
    const requireTerminalRow = complete || !isLast;
    const deciding = Boolean(row.decidingMatchTiebreak);

    if (deciding) {
      invariant(profile.family === 'sets' && profile.decidingMatchTiebreak !== null, 'UNEXPECTED_DECIDER', 'This match does not use a deciding match tiebreak.', `score.sets.${index}`);
      invariant(index === 2 && setsA === 1 && setsB === 1, 'DECIDER_POSITION', 'The deciding match tiebreak is played only at one set all.', `score.sets.${index}`);
      const winner = validateTiebreak(row.gamesA, row.gamesB, profile.decidingMatchTiebreak, requireTerminalRow);
      if (winner === 'A') setsA += 1;
      if (winner === 'B') setsB += 1;
    } else {
      invariant(!(profile.family === 'sets' && profile.decidingMatchTiebreak !== null && index === 2), 'DECIDER_REQUIRED', 'The third score row must be the deciding match tiebreak.', `score.sets.${index}`);
      const rowWinner = validateSet(row, profile, requireTerminalRow);
      gamesA += row.gamesA;
      gamesB += row.gamesB;
      if (profile.family === 'sets') {
        if (rowWinner === 'A') setsA += 1;
        if (rowWinner === 'B') setsB += 1;
      }
    }

    if (profile.family === 'games') {
      terminal = ordinaryOrTiebreakWinner(row, profile) !== null;
    } else {
      const winsNeeded = profile.bestOfSets === 1 ? 1 : 2;
      terminal = setsA === winsNeeded || setsB === winsNeeded;
    }
  }

  let winner: 'A' | 'B' | null = null;
  if (profile.family === 'games' && terminal) {
    winner = ordinaryOrTiebreakWinner(score.sets[0], profile);
  } else if (setsA > setsB) {
    winner = 'A';
  } else if (setsB > setsA) {
    winner = 'B';
  }

  if (complete) invariant(terminal && winner !== null, 'SCORE_INCOMPLETE', 'The score does not contain a completed match.', 'score');
  return { winner, setsA, setsB, gamesA, gamesB, terminal };
}

function validateSet(row: TournamentSetScore, profile: RuleProfile, requireTerminal: boolean): 'A' | 'B' | null {
  integerScore(row.gamesA, 'gamesA');
  integerScore(row.gamesB, 'gamesB');
  const hasTieA = row.tiebreakPointsA !== undefined;
  const hasTieB = row.tiebreakPointsB !== undefined;
  invariant(hasTieA === hasTieB, 'TIEBREAK_PAIR', 'Enter both tiebreak scores or neither.', 'score');
  invariant(!row.decidingMatchTiebreak, 'UNEXPECTED_DECIDER', 'Use a deciding match tiebreak row only for the configured third-set decider.', 'score');

  const a = row.gamesA;
  const b = row.gamesB;
  const rowWinner: 'A' | 'B' | null = a === b ? null : a > b ? 'A' : 'B';
  const trigger = profile.tiebreakTrigger;

  if (hasTieA && hasTieB) {
    invariant(trigger !== null && profile.tiebreakTarget !== null, 'UNEXPECTED_TIEBREAK', 'This score format has no tiebreak.', 'score');
    invariant((a === trigger + 1 && b === trigger) || (b === trigger + 1 && a === trigger), 'TIEBREAK_GAMES', `A tiebreak set must finish ${trigger + 1}-${trigger}.`, 'score');
    const pointWinner = validateTiebreak(row.tiebreakPointsA as number, row.tiebreakPointsB as number, profile.tiebreakTarget, requireTerminal);
    if (pointWinner !== null) invariant(pointWinner === rowWinner, 'TIEBREAK_WINNER', 'The tiebreak winner must match the set winner.', 'score');
    if (requireTerminal) invariant(pointWinner !== null, 'TIEBREAK_SCORE', 'The tiebreak score is not complete.', 'score');
    return pointWinner;
  }

  const terminalWinner = ordinaryEndpoint(a, b, profile);
  if (requireTerminal) {
    if (trigger !== null && a === trigger && b === trigger) {
      invariant(false, 'TIEBREAK_REQUIRED', `A ${trigger}-${trigger} score requires tiebreak points.`, 'score');
    }
    invariant(terminalWinner !== null, 'SCORE_INCOMPLETE', 'This score row has not reached a valid finishing point.', 'score');
    return terminalWinner;
  }

  invariant(reachablePartial(a, b, profile), 'SCORE_UNREACHABLE', 'This score has passed the format’s finishing point.', 'score');
  return terminalWinner;
}

function ordinaryOrTiebreakWinner(row: TournamentSetScore, profile: RuleProfile): 'A' | 'B' | null {
  const hasTie = row.tiebreakPointsA !== undefined && row.tiebreakPointsB !== undefined;
  if (hasTie && profile.tiebreakTarget !== null) {
    return tiebreakWinner(row.tiebreakPointsA as number, row.tiebreakPointsB as number, profile.tiebreakTarget);
  }
  return ordinaryEndpoint(row.gamesA, row.gamesB, profile);
}

function ordinaryEndpoint(a: number, b: number, profile: RuleProfile): 'A' | 'B' | null {
  if (a === b) return null;
  const high = Math.max(a, b);
  const low = Math.min(a, b);
  const terminal = profile.gameMargin === 1
    ? high === profile.gamesToWin && low <= profile.gamesToWin - 1
    : (high === profile.gamesToWin && low <= profile.gamesToWin - 2)
      || (high > profile.gamesToWin && high - low === 2);
  if (!terminal) return null;
  if (profile.tiebreakTrigger !== null && low >= profile.tiebreakTrigger) return null;
  return a > b ? 'A' : 'B';
}

function reachablePartial(a: number, b: number, profile: RuleProfile): boolean {
  if (ordinaryEndpoint(a, b, profile) !== null) return true;
  if (profile.tiebreakTrigger !== null) return Math.max(a, b) <= profile.tiebreakTrigger;
  if (profile.gameMargin === 1) return Math.max(a, b) < profile.gamesToWin;
  if (Math.max(a, b) < profile.gamesToWin) return true;
  return Math.abs(a - b) < 2;
}

function tiebreakWinner(a: number, b: number, target: number): 'A' | 'B' | null {
  const high = Math.max(a, b);
  const low = Math.min(a, b);
  const terminal = (high === target && low <= target - 2) || (high > target && high - low === 2);
  return terminal ? (a > b ? 'A' : 'B') : null;
}

function validateTiebreak(a: number, b: number, target: number, requireTerminal: boolean): 'A' | 'B' | null {
  integerScore(a, 'tiebreakPointsA');
  integerScore(b, 'tiebreakPointsB');
  const winner = tiebreakWinner(a, b, target);
  if (requireTerminal) invariant(winner !== null, 'TIEBREAK_SCORE', `Tiebreak winner must reach ${target} and lead by two.`, 'score');
  else {
    const high = Math.max(a, b);
    const low = Math.min(a, b);
    invariant(!((high === target && low > target - 2) || (high > target && high - low > 2)), 'TIEBREAK_UNREACHABLE', 'This tiebreak score has passed a valid finishing point.', 'score');
  }
  return winner;
}

function integerScore(value: number, field: string): void {
  invariant(Number.isInteger(value) && value >= 0 && value <= MAX_SCORE, 'SCORE_NUMBER', 'Scores must be non-negative whole numbers no greater than 2147483647.', field);
}

export function validateResult(result: Omit<TournamentResult, 'revision' | 'confirmedAt'>, profile: RuleProfile, entryA: string, entryB: string): void {
  invariant(result.winnerEntryId === entryA || result.winnerEntryId === entryB, 'RESULT_WINNER', 'Winner must be one of the actual entries.', 'winnerEntryId');
  invariant(typeof result.reason === 'string' && result.reason.length <= MAX_REASON_LENGTH, 'RESULT_REASON_LENGTH', 'Result reason must be 500 characters or fewer.', 'reason');

  if (result.kind === 'played') {
    invariant(result.score !== null, 'RESULT_SCORE', 'A played result needs a complete score.', 'score');
    invariant(result.reportedScore === undefined || result.reportedScore === null, 'PLAYED_REPORTED_SCORE', 'A played result does not use a separate reported score.', 'reportedScore');
    const summary = scoreSummary(result.score, profile, true);
    const derived = summary.winner === 'A' ? entryA : entryB;
    invariant(result.winnerEntryId === derived, 'RESULT_WINNER', 'Winner does not match the score.', 'winnerEntryId');
    return;
  }

  invariant(result.reason.trim().length > 0, 'RESULT_REASON', 'Enter a reason for the non-played result.', 'reason');
  if (result.kind === 'walkover') {
    invariant(result.score === null, 'WALKOVER_SCORE', 'Walkovers do not use an invented score.', 'score');
    invariant(result.reportedScore === undefined || result.reportedScore === null, 'WALKOVER_REPORTED_SCORE', 'Walkovers do not use a reported score.', 'reportedScore');
  } else if (result.kind === 'retirement') {
    invariant(result.reportedScore === undefined || result.reportedScore === null, 'RETIREMENT_REPORTED_SCORE', 'Retirements store an optional unfinished score, not a separate reported score.', 'reportedScore');
    if (result.score) {
      const summary = scoreSummary(result.score, profile, false);
      invariant(!summary.terminal, 'RETIREMENT_TERMINAL', 'A retirement score must remain unfinished.', 'score');
    }
  } else {
    invariant(result.score === null, 'ADMIN_SCORE', 'Administrative results do not alter the played score.', 'score');
    if (result.reportedScore) scoreSummary(result.reportedScore, profile, false);
  }
}

export function equivalentScoringProfile(a: RuleProfile, b: RuleProfile): boolean {
  return a.family === b.family && a.bestOfSets === b.bestOfSets && a.gamesToWin === b.gamesToWin
    && a.gameMargin === b.gameMargin && a.tiebreakTrigger === b.tiebreakTrigger
    && a.tiebreakTarget === b.tiebreakTarget && a.decidingMatchTiebreak === b.decidingMatchTiebreak
    && a.gameEnding === b.gameEnding;
}

export function resultSummary(result: TournamentResult, profile: RuleProfile): ScoreSummary {
  if (result.kind === 'played' && result.score) return scoreSummary(result.score, profile, true);
  return { winner: null, setsA: 0, setsB: 0, gamesA: 0, gamesB: 0, terminal: true };
}

export function humanScore(score: TournamentScore | null): string {
  if (!score) return '';
  return score.sets.map((set) => {
    if (set.decidingMatchTiebreak) return `[${set.gamesA}-${set.gamesB}]`;
    const tie = set.tiebreakPointsA === undefined ? '' : ` (${set.tiebreakPointsA}-${set.tiebreakPointsB})`;
    return `${set.gamesA}-${set.gamesB}${tie}`;
  }).join(', ');
}

export { TournamentRuleError };
