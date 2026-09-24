import type {
  AmericanoCoverageMetricsV2,
  AmericanoPointsPerMatch,
  AmericanoScheduleV2,
  AmericanoSide,
  PairingMode,
} from '@/logic/americanoV2/types';

export type AmericanoScheduleErrorCode =
  | 'COUNT_HAS_NO_EXACT_CYCLE'
  | 'EXACT_FIXTURE_INVALID'
  | 'INVALID_SCHEDULE'
  | 'GENERATION_BUDGET_EXCEEDED'
  | 'SCHEDULE_TIMEOUT';

export class AmericanoScheduleError extends Error {
  constructor(readonly code: AmericanoScheduleErrorCode, message: string) {
    super(message);
    this.name = 'AmericanoScheduleError';
  }
}

export interface ResultFieldErrors {
  scoreA?: string;
  scoreB?: string;
}

function scoreError(value: number | null, target: AmericanoPointsPerMatch): string | undefined {
  if (value === null) return 'Enter a score.';
  if (!Number.isFinite(value)) return 'Enter a finite number.';
  if (!Number.isInteger(value)) return 'Use a whole number.';
  if (value < 0) return 'Score cannot be negative.';
  if (value > target) return `Score cannot be greater than ${target}.`;
  return undefined;
}

export function validateAmericanoResult(
  scoreA: number | null,
  scoreB: number | null,
  target: AmericanoPointsPerMatch,
): ResultFieldErrors {
  const errors: ResultFieldErrors = {
    scoreA: scoreError(scoreA, target),
    scoreB: scoreError(scoreB, target),
  };
  if (!errors.scoreA && !errors.scoreB && scoreA! + scoreB! !== target) {
    errors.scoreB = `Scores must add up to ${target}.`;
  }
  return errors;
}

export function complementaryAmericanoScore(
  value: number,
  target: AmericanoPointsPerMatch,
): number | null {
  return Number.isInteger(value) && value >= 0 && value <= target ? target - value : null;
}

function unorderedKey(a: string, b: string): string {
  return a < b ? `${a}\u0000${b}` : `${b}\u0000${a}`;
}

function sidePlayerIds(side: AmericanoSide): [string, string] {
  return side.playerIds;
}

function sideEntrantIds(side: AmericanoSide, mode: PairingMode): string[] {
  return mode === 'fixed' && side.kind === 'fixed-team' ? [side.teamId] : [...side.playerIds];
}

function completeMatchupKey(sideA: AmericanoSide, sideB: AmericanoSide, mode: PairingMode): string {
  const a = sideEntrantIds(sideA, mode).slice().sort().join('\u0001');
  const b = sideEntrantIds(sideB, mode).slice().sort().join('\u0001');
  return a < b ? `${a}\u0002${b}` : `${b}\u0002${a}`;
}

function frequencyRange(counts: Map<string, number>, allIds: string[]): [number, number] {
  if (allIds.length < 2) return [0, 0];
  let minimum = Number.POSITIVE_INFINITY;
  let maximum = 0;
  for (let a = 0; a < allIds.length; a += 1) {
    for (let b = a + 1; b < allIds.length; b += 1) {
      const count = counts.get(unorderedKey(allIds[a], allIds[b])) ?? 0;
      minimum = Math.min(minimum, count);
      maximum = Math.max(maximum, count);
    }
  }
  return [Number.isFinite(minimum) ? minimum : 0, maximum];
}

export function computeScheduleMetrics(
  schedule: Pick<AmericanoScheduleV2, 'orderedEntrantIds' | 'rounds'>,
  mode: PairingMode,
): AmericanoCoverageMetricsV2 {
  const ids = schedule.orderedEntrantIds;
  const appearances = Object.fromEntries(ids.map((id) => [id, 0]));
  const rests = Object.fromEntries(ids.map((id) => [id, 0]));
  const partners = new Map<string, number>();
  const opponents = new Map<string, number>();
  const matchupCounts = new Map<string, number>();

  for (const round of schedule.rounds) {
    for (const id of round.restingEntrantIds) rests[id] = (rests[id] ?? 0) + 1;
    for (const match of round.matches) {
      const aEntrants = sideEntrantIds(match.sideA, mode);
      const bEntrants = sideEntrantIds(match.sideB, mode);
      for (const id of [...aEntrants, ...bEntrants]) appearances[id] = (appearances[id] ?? 0) + 1;
      if (mode === 'rotating') {
        const [a1, a2] = sidePlayerIds(match.sideA);
        const [b1, b2] = sidePlayerIds(match.sideB);
        partners.set(unorderedKey(a1, a2), (partners.get(unorderedKey(a1, a2)) ?? 0) + 1);
        partners.set(unorderedKey(b1, b2), (partners.get(unorderedKey(b1, b2)) ?? 0) + 1);
        for (const left of [a1, a2]) {
          for (const right of [b1, b2]) {
            const key = unorderedKey(left, right);
            opponents.set(key, (opponents.get(key) ?? 0) + 1);
          }
        }
      } else {
        const a = aEntrants[0];
        const b = bEntrants[0];
        const key = unorderedKey(a, b);
        opponents.set(key, (opponents.get(key) ?? 0) + 1);
      }
      const matchupKey = completeMatchupKey(match.sideA, match.sideB, mode);
      matchupCounts.set(matchupKey, (matchupCounts.get(matchupKey) ?? 0) + 1);
    }
  }

  const uniquePartners = Object.fromEntries(ids.map((id) => [id, 0]));
  const uniqueOpponents = Object.fromEntries(ids.map((id) => [id, 0]));
  for (let a = 0; a < ids.length; a += 1) {
    for (let b = a + 1; b < ids.length; b += 1) {
      const key = unorderedKey(ids[a], ids[b]);
      if ((partners.get(key) ?? 0) > 0) {
        uniquePartners[ids[a]] += 1;
        uniquePartners[ids[b]] += 1;
      }
      if ((opponents.get(key) ?? 0) > 0) {
        uniqueOpponents[ids[a]] += 1;
        uniqueOpponents[ids[b]] += 1;
      }
    }
  }
  const [minimumPartnerFrequency, maximumPartnerFrequency] = mode === 'rotating'
    ? frequencyRange(partners, ids)
    : [0, 0];
  const [minimumOpponentFrequency, maximumOpponentFrequency] = frequencyRange(opponents, ids);
  const appearanceValues = ids.map((id) => appearances[id] ?? 0);
  const maximumAppearanceSpread = appearanceValues.length
    ? Math.max(...appearanceValues) - Math.min(...appearanceValues)
    : 0;
  return {
    appearances,
    rests,
    uniquePartners,
    uniqueOpponents,
    minimumPartnerFrequency,
    maximumPartnerFrequency,
    minimumOpponentFrequency,
    maximumOpponentFrequency,
    repeatedCompleteMatchups: Array.from(matchupCounts.values()).reduce((sum, count) => sum + Math.max(0, count - 1), 0),
    appearancesEqual: maximumAppearanceSpread === 0,
    maximumAppearanceSpread,
  };
}

export interface ScheduleValidationOptions {
  mode: PairingMode;
  configuredCourtIds: string[];
  expectedRounds: number;
  exactFull: boolean;
}

export function validateAmericanoSchedule(
  schedule: AmericanoScheduleV2,
  options: ScheduleValidationOptions,
): AmericanoCoverageMetricsV2 {
  const ids = schedule.orderedEntrantIds;
  const expectedMatches = options.mode === 'rotating'
    ? Math.floor(ids.length / 4)
    : Math.floor(ids.length / 2);
  if (schedule.rounds.length !== options.expectedRounds) {
    throw new AmericanoScheduleError('INVALID_SCHEDULE', 'Schedule round count does not match the requested round count.');
  }
  const knownIds = new Set(ids);
  if (knownIds.size !== ids.length) throw new AmericanoScheduleError('INVALID_SCHEDULE', 'Entrant IDs must be unique.');
  const courtIds = new Set(options.configuredCourtIds);
  const scheduleIds = new Set<string>();
  const appearanceByPrefix = Object.fromEntries(ids.map((id) => [id, 0]));

  for (const round of schedule.rounds) {
    if (scheduleIds.has(round.id)) throw new AmericanoScheduleError('INVALID_SCHEDULE', 'Round IDs must be unique.');
    scheduleIds.add(round.id);
    if (round.matches.length !== expectedMatches) {
      throw new AmericanoScheduleError('INVALID_SCHEDULE', 'A round is missing or has extra fixtures.');
    }
    const seenEntrants = new Set<string>();
    const seenCourts = new Set<string>();
    for (const match of round.matches) {
      if (scheduleIds.has(match.id)) throw new AmericanoScheduleError('INVALID_SCHEDULE', 'Fixture IDs must be globally unique.');
      scheduleIds.add(match.id);
      if (!courtIds.has(match.courtId) || seenCourts.has(match.courtId)) {
        throw new AmericanoScheduleError('INVALID_SCHEDULE', 'Each configured court may appear at most once per round.');
      }
      seenCourts.add(match.courtId);
      if (options.mode === 'fixed' && (match.sideA.kind !== 'fixed-team' || match.sideB.kind !== 'fixed-team')) {
        throw new AmericanoScheduleError('INVALID_SCHEDULE', 'Fixed schedules require fixed-team sides.');
      }
      if (options.mode === 'rotating' && (match.sideA.kind !== 'rotating-pair' || match.sideB.kind !== 'rotating-pair')) {
        throw new AmericanoScheduleError('INVALID_SCHEDULE', 'Rotating schedules require rotating-pair sides.');
      }
      const matchEntrants = sideEntrantIds(match.sideA, options.mode).concat(sideEntrantIds(match.sideB, options.mode));
      if (new Set(match.sideA.playerIds.concat(match.sideB.playerIds)).size !== 4) {
        throw new AmericanoScheduleError('INVALID_SCHEDULE', 'Every match must contain four distinct players.');
      }
      for (const id of matchEntrants) {
        if (!knownIds.has(id) || seenEntrants.has(id)) {
          throw new AmericanoScheduleError('INVALID_SCHEDULE', 'An entrant is unknown or scheduled twice in one round.');
        }
        seenEntrants.add(id);
        appearanceByPrefix[id] += 1;
      }
    }
    const rests = new Set(round.restingEntrantIds);
    if (rests.size !== round.restingEntrantIds.length) throw new AmericanoScheduleError('INVALID_SCHEDULE', 'Resting entrants must be unique.');
    for (const id of ids) {
      if (seenEntrants.has(id) === rests.has(id)) {
        throw new AmericanoScheduleError('INVALID_SCHEDULE', 'Playing and resting entrants must partition the roster.');
      }
    }
    const prefixValues = Object.values(appearanceByPrefix);
    if (prefixValues.length && Math.max(...prefixValues) - Math.min(...prefixValues) > 1) {
      throw new AmericanoScheduleError('INVALID_SCHEDULE', 'Appearance spread exceeds one at a schedule prefix.');
    }
  }

  const metrics = computeScheduleMetrics(schedule, options.mode);
  if (options.exactFull) {
    const expectedRounds = options.mode === 'rotating'
      ? ids.length % 4 === 0 ? ids.length - 1 : ids.length
      : ids.length % 2 === 0 ? ids.length - 1 : ids.length;
    if (schedule.rounds.length !== expectedRounds || !metrics.appearancesEqual) {
      throw new AmericanoScheduleError('EXACT_FIXTURE_INVALID', 'Exact schedule round or appearance invariants failed.');
    }
    if (options.mode === 'rotating') {
      if (metrics.minimumPartnerFrequency !== 1 || metrics.maximumPartnerFrequency !== 1
        || metrics.minimumOpponentFrequency !== 2 || metrics.maximumOpponentFrequency !== 2) {
        throw new AmericanoScheduleError('EXACT_FIXTURE_INVALID', 'Exact partner/opponent coverage invariants failed.');
      }
    } else if (metrics.minimumOpponentFrequency !== 1 || metrics.maximumOpponentFrequency !== 1) {
      throw new AmericanoScheduleError('EXACT_FIXTURE_INVALID', 'Fixed full schedule opponent coverage failed.');
    }
  }
  return metrics;
}
