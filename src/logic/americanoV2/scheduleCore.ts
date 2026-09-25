import { newId } from '@/logic/idGen';
import { bergerRounds } from '@/logic/formats/roundRobin';
import {
  AMERICANO_V2_ALGORITHM_VERSION,
  type AmericanoConfigV2,
  type AmericanoCoverageMetricsV2,
  type AmericanoScheduleRoundV2,
  type AmericanoScheduleV2,
  type AmericanoSide,
  type PairingMode,
  type ScheduleKind,
} from '@/logic/americanoV2/types';
import {
  AmericanoScheduleError,
  computeScheduleMetrics,
  validateAmericanoSchedule,
} from '@/logic/americanoV2/validation';
import {
  EXACT_NINE_PLAYER_ROUNDS,
  EXACT_ROTATING_STARTERS,
  hasExactRotatingCycle,
  type StarterTuple,
} from '@/logic/americanoV2/fixtures';

const MAX_GENERATION_EVALUATIONS = 1_000_000;
const BALANCED_CANDIDATE_COUNT = 8;

export interface FixedEntrantInput {
  teamId: string;
  playerIds: [string, string];
}

export interface GenerateAmericanoScheduleInput {
  config: {
    rulesVersion?: number;
    pairingMode: PairingMode;
    scheduleKind: ScheduleKind;
    customRounds?: number;
    paceMinutes: number;
    paceClockEnabled: boolean;
  } & Partial<Pick<AmericanoConfigV2, 'pointsPerMatch'>>;
  orderedEntrantIds: string[];
  fixedEntrants?: FixedEntrantInput[];
  courtIds: string[];
  seed: number;
  rosterRevision?: string;
  acknowledgeUnevenAppearances?: boolean;
  acknowledgeRepeatedCycle?: boolean;
  fingerprintVersion?: 3;
  fingerprintConfig?: unknown;
}

type NumericFixture = [number, number, number, number];
type IdFixture = [string, string, string, string];

export function xorshift32(seed: number): () => number {
  let state = seed >>> 0;
  if (state === 0) state = 0x9e3779b9;
  return () => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    state >>>= 0;
    return state / 4_294_967_296;
  };
}

export function seededShuffle<T>(values: readonly T[], seed: number): T[] {
  const result = values.slice();
  const random = xorshift32(seed);
  for (let index = result.length - 1; index > 0; index -= 1) {
    const swap = Math.floor(random() * (index + 1));
    [result[index], result[swap]] = [result[swap], result[index]];
  }
  return result;
}

export function balancedDefaultRounds(playerCount: number): number {
  const matches = Math.floor(playerCount / 4);
  if (playerCount < 4 || matches === 0) return 0;
  return playerCount / greatestCommonDivisor(playerCount, 4 * matches);
}

function greatestCommonDivisor(a: number, b: number): number {
  let left = Math.abs(a);
  let right = Math.abs(b);
  while (right !== 0) [left, right] = [right, left % right];
  return left;
}

function compareNumbers(left: readonly number[], right: readonly number[]): number {
  const length = Math.min(left.length, right.length);
  for (let index = 0; index < length; index += 1) {
    if (left[index] !== right[index]) return left[index] - right[index];
  }
  return left.length - right.length;
}

function canonicalNumericFixture(fixture: readonly number[]): NumericFixture {
  let sideA: [number, number] = fixture[0] < fixture[1]
    ? [fixture[0], fixture[1]]
    : [fixture[1], fixture[0]];
  let sideB: [number, number] = fixture[2] < fixture[3]
    ? [fixture[2], fixture[3]]
    : [fixture[3], fixture[2]];
  if (compareNumbers(sideA, sideB) > 0) [sideA, sideB] = [sideB, sideA];
  return [sideA[0], sideA[1], sideB[0], sideB[1]];
}

function canonicalIdFixture(fixture: IdFixture, baseIndex: Map<string, number>): IdFixture {
  const numeric = canonicalNumericFixture(fixture.map((id) => baseIndex.get(id) ?? -1));
  const byIndex = new Map(fixture.map((id) => [baseIndex.get(id) ?? -1, id]));
  return numeric.map((index) => byIndex.get(index)!) as IdFixture;
}

function exactNumericRounds(playerCount: number): NumericFixture[][] {
  if (playerCount === 9) {
    return EXACT_NINE_PLAYER_ROUNDS.map((round) => round.map((fixture) => canonicalNumericFixture(fixture))
      .sort(compareNumbers));
  }
  const starter = EXACT_ROTATING_STARTERS[playerCount];
  if (!starter) {
    throw new AmericanoScheduleError(
      'COUNT_HAS_NO_EXACT_CYCLE',
      'A complete once-with-every-partner rotation is not available for this player count. Use a balanced schedule.',
    );
  }
  const roundCount = playerCount % 4 === 0 ? playerCount - 1 : playerCount;
  return Array.from({ length: roundCount }, (_, roundIndex) => starter
    .map((tuple: StarterTuple) => tuple.map((index) => {
      if (playerCount % 4 === 0) return index === 0 ? 0 : 1 + ((index - 1 + roundIndex) % (playerCount - 1));
      return (index + roundIndex) % playerCount;
    }))
    .map(canonicalNumericFixture)
    .sort(compareNumbers));
}

function repeatedPrefix<T>(cycle: readonly T[], rounds: number): T[] {
  return Array.from({ length: rounds }, (_, index) => cycle[index % cycle.length]);
}

function pairKey(a: string, b: string): string {
  return a < b ? `${a}\u0000${b}` : `${b}\u0000${a}`;
}

interface BalancedCandidate {
  rounds: IdFixture[][];
  quality: number[];
  flattened: number[];
}

function generateBalancedRounds(
  orderedEntrantIds: string[],
  seed: number,
  roundCount: number,
): IdFixture[][] {
  const baseOrder = seededShuffle(orderedEntrantIds, seed);
  const baseIndex = new Map(baseOrder.map((id, index) => [id, index]));
  const matchesPerRound = Math.floor(baseOrder.length / 4);
  let evaluations = 0;
  const candidates: BalancedCandidate[] = [];

  for (let candidateIndex = 0; candidateIndex < BALANCED_CANDIDATE_COUNT; candidateIndex += 1) {
    const played = new Map(baseOrder.map((id) => [id, 0]));
    const partnerCounts = new Map<string, number>();
    const opponentCounts = new Map<string, number>();
    const lastPlayedRound = new Map(baseOrder.map((id) => [id, -1]));
    const lastPartner = new Map<string, string | null>(baseOrder.map((id) => [id, null]));
    const lastOpponents = new Map<string, Set<string>>(baseOrder.map((id) => [id, new Set<string>()]));
    const matchupCounts = new Map<string, number>();
    let partnerRepeats = 0;
    let opponentRepeats = 0;
    const rounds: IdFixture[][] = [];

    for (let roundIndex = 0; roundIndex < roundCount; roundIndex += 1) {
      const roundSeed = (seed
        ^ Math.imul(candidateIndex + 1, 0x9e3779b9)
        ^ Math.imul(roundIndex + 1, 0x85ebca6b)) >>> 0;
      const roundOrder = seededShuffle(baseOrder, roundSeed);
      const roundRank = new Map(roundOrder.map((id, index) => [id, index]));
      const selected = baseOrder.slice().sort((left, right) =>
        (played.get(left)! - played.get(right)!)
        || (lastPlayedRound.get(left)! - lastPlayedRound.get(right)!)
        || (roundRank.get(left)! - roundRank.get(right)!))
        .slice(0, matchesPerRound * 4);
      const unpaired = new Set(selected);
      const pairs: Array<[string, string]> = [];
      while (unpaired.size > 0) {
        const available = Array.from(unpaired).sort((a, b) => roundRank.get(a)! - roundRank.get(b)!);
        const a = available[0];
        unpaired.delete(a);
        let chosen: string | null = null;
        let chosenQuality: number[] | null = null;
        for (const b of Array.from(unpaired)) {
          evaluations += 1;
          if (evaluations > MAX_GENERATION_EVALUATIONS) {
            throw new AmericanoScheduleError('GENERATION_BUDGET_EXCEEDED', 'Balanced schedule generation exceeded its evaluation budget.');
          }
          const quality = [
            partnerCounts.get(pairKey(a, b)) ?? 0,
            Number(lastPartner.get(a) === b) + Number(lastPartner.get(b) === a),
            roundRank.get(b)!,
          ];
          if (!chosenQuality || compareNumbers(quality, chosenQuality) < 0) {
            chosen = b;
            chosenQuality = quality;
          }
        }
        if (!chosen) throw new AmericanoScheduleError('INVALID_SCHEDULE', 'Balanced partner selection failed.');
        unpaired.delete(chosen);
        pairs.push([a, chosen]);
      }

      const availablePairs = pairs.slice();
      const fixtures: IdFixture[] = [];
      while (availablePairs.length > 0) {
        const first = availablePairs.shift()!;
        let chosenIndex = -1;
        let chosenQuality: number[] | null = null;
        for (let index = 0; index < availablePairs.length; index += 1) {
          evaluations += 1;
          if (evaluations > MAX_GENERATION_EVALUATIONS) {
            throw new AmericanoScheduleError('GENERATION_BUDGET_EXCEEDED', 'Balanced schedule generation exceeded its evaluation budget.');
          }
          const other = availablePairs[index];
          const cross = [
            pairKey(first[0], other[0]), pairKey(first[0], other[1]),
            pairKey(first[1], other[0]), pairKey(first[1], other[1]),
          ];
          const crossCounts = cross.map((key) => opponentCounts.get(key) ?? 0);
          let lastRepeat = 0;
          for (const left of first) for (const right of other) {
            lastRepeat += Number(lastOpponents.get(left)?.has(right));
            lastRepeat += Number(lastOpponents.get(right)?.has(left));
          }
          const quality = [Math.max(...crossCounts), crossCounts.reduce((sum, value) => sum + value, 0), lastRepeat, index];
          if (!chosenQuality || compareNumbers(quality, chosenQuality) < 0) {
            chosenIndex = index;
            chosenQuality = quality;
          }
        }
        if (chosenIndex < 0) throw new AmericanoScheduleError('INVALID_SCHEDULE', 'Balanced opponent selection failed.');
        const other = availablePairs.splice(chosenIndex, 1)[0];
        fixtures.push(canonicalIdFixture([first[0], first[1], other[0], other[1]], baseIndex));
      }
      fixtures.sort((left, right) => compareNumbers(left.map((id) => baseIndex.get(id)!), right.map((id) => baseIndex.get(id)!)));

      for (const [a, b, c, d] of fixtures) {
        for (const [left, right] of [[a, b], [c, d]] as Array<[string, string]>) {
          partnerRepeats += Number(lastPartner.get(left) === right) + Number(lastPartner.get(right) === left);
          const key = pairKey(left, right);
          partnerCounts.set(key, (partnerCounts.get(key) ?? 0) + 1);
          lastPartner.set(left, right);
          lastPartner.set(right, left);
        }
        for (const left of [a, b]) for (const right of [c, d]) {
          opponentRepeats += Number(lastOpponents.get(left)?.has(right)) + Number(lastOpponents.get(right)?.has(left));
          const key = pairKey(left, right);
          opponentCounts.set(key, (opponentCounts.get(key) ?? 0) + 1);
        }
        lastOpponents.set(a, new Set([c, d]));
        lastOpponents.set(b, new Set([c, d]));
        lastOpponents.set(c, new Set([a, b]));
        lastOpponents.set(d, new Set([a, b]));
        const sideA = [a, b].sort().join('\u0001');
        const sideB = [c, d].sort().join('\u0001');
        const matchKey = sideA < sideB ? `${sideA}\u0002${sideB}` : `${sideB}\u0002${sideA}`;
        matchupCounts.set(matchKey, (matchupCounts.get(matchKey) ?? 0) + 1);
      }
      for (const id of selected) {
        played.set(id, played.get(id)! + 1);
        lastPlayedRound.set(id, roundIndex);
      }
      rounds.push(fixtures);
    }

    const allPairCounts = (counts: Map<string, number>) => {
      const result: number[] = [];
      for (let a = 0; a < baseOrder.length; a += 1) {
        for (let b = a + 1; b < baseOrder.length; b += 1) result.push(counts.get(pairKey(baseOrder[a], baseOrder[b])) ?? 0);
      }
      return result;
    };
    const partnershipValues = allPairCounts(partnerCounts);
    const oppositionValues = allPairCounts(opponentCounts);
    const quality = [
      Math.max(0, ...partnershipValues),
      partnershipValues.reduce((sum, value) => sum + value * value, 0),
      partnerRepeats,
      Math.max(0, ...oppositionValues),
      oppositionValues.reduce((sum, value) => sum + value * value, 0),
      opponentRepeats,
      Array.from(matchupCounts.values()).reduce((sum, count) => sum + Math.max(0, count - 1), 0),
    ];
    candidates.push({
      rounds,
      quality,
      flattened: rounds.flatMap((round) => round.flatMap((fixture) => fixture.map((id) => baseIndex.get(id)!))),
    });
  }

  candidates.sort((left, right) => compareNumbers(left.quality, right.quality) || compareNumbers(left.flattened, right.flattened));
  return candidates[0].rounds;
}

function buildRotatingIdRounds(input: GenerateAmericanoScheduleInput): { rounds: IdFixture[][]; exactFull: boolean; repeated: boolean } {
  const count = input.orderedEntrantIds.length;
  const baseOrder = seededShuffle(input.orderedEntrantIds, input.seed);
  const exactAvailable = hasExactRotatingCycle(count);
  if (input.config.scheduleKind === 'full' && !exactAvailable) {
    throw new AmericanoScheduleError(
      'COUNT_HAS_NO_EXACT_CYCLE',
      'A complete once-with-every-partner rotation is not available for this player count. Use a balanced schedule.',
    );
  }
  if (input.config.scheduleKind === 'balanced' && exactAvailable) {
    throw new AmericanoScheduleError('INVALID_SCHEDULE', 'Use Full for a player count with an exact rotation.');
  }
  if (input.config.scheduleKind === 'balanced') {
    return { rounds: generateBalancedRounds(input.orderedEntrantIds, input.seed, balancedDefaultRounds(count)), exactFull: false, repeated: false };
  }
  const requestedRounds = input.config.scheduleKind === 'custom'
    ? input.config.customRounds!
    : count % 4 === 0 ? count - 1 : count;
  if (!exactAvailable) {
    return { rounds: generateBalancedRounds(input.orderedEntrantIds, input.seed, requestedRounds), exactFull: false, repeated: false };
  }
  const baseRounds = exactNumericRounds(count).map((round) => round.map((fixture) => fixture.map((index) => baseOrder[index]) as IdFixture));
  return {
    rounds: repeatedPrefix(baseRounds, requestedRounds),
    exactFull: input.config.scheduleKind === 'full',
    repeated: requestedRounds > baseRounds.length,
  };
}

function buildFixedIdRounds(input: GenerateAmericanoScheduleInput): { rounds: Array<Array<[string, string]>>; exactFull: boolean; repeated: boolean } {
  const baseOrder = seededShuffle(input.orderedEntrantIds, input.seed);
  const full = bergerRounds(baseOrder);
  const requestedRounds = input.config.scheduleKind === 'custom' ? input.config.customRounds! : full.length;
  return {
    rounds: repeatedPrefix(full, requestedRounds),
    exactFull: input.config.scheduleKind !== 'custom',
    repeated: requestedRounds > full.length,
  };
}

function canonicalJsonValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalJsonValue);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => [key, canonicalJsonValue(entry)]));
  }
  return value;
}

export function canonicalJson(value: unknown): string {
  return JSON.stringify(canonicalJsonValue(value));
}

export async function sha256Hex(value: string): Promise<string> {
  const digest = await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

function emptyMetrics(ids: string[]): AmericanoCoverageMetricsV2 {
  const zeroes = Object.fromEntries(ids.map((id) => [id, 0]));
  return {
    appearances: { ...zeroes }, rests: { ...zeroes }, uniquePartners: { ...zeroes }, uniqueOpponents: { ...zeroes },
    minimumPartnerFrequency: 0, maximumPartnerFrequency: 0, minimumOpponentFrequency: 0, maximumOpponentFrequency: 0,
    repeatedCompleteMatchups: 0, appearancesEqual: true, maximumAppearanceSpread: 0,
  };
}

export async function generateAmericanoSchedule(input: GenerateAmericanoScheduleInput): Promise<AmericanoScheduleV2> {
  if (input.courtIds.length < 1 || input.courtIds.length > 16 || new Set(input.courtIds).size !== input.courtIds.length) {
    throw new AmericanoScheduleError('INVALID_SCHEDULE', 'Americano requires 1–16 uniquely identified courts.');
  }
  if (new Set(input.orderedEntrantIds).size !== input.orderedEntrantIds.length) {
    throw new AmericanoScheduleError('INVALID_SCHEDULE', 'Entrant IDs must be unique.');
  }
  const capacity = input.config.pairingMode === 'rotating' ? input.courtIds.length * 4 : input.courtIds.length * 2;
  const minimum = input.config.pairingMode === 'rotating' ? 4 : 2;
  if (input.orderedEntrantIds.length < minimum || input.orderedEntrantIds.length > capacity) {
    throw new AmericanoScheduleError('INVALID_SCHEDULE', `Confirmed field must contain ${minimum}–${capacity} entrants.`);
  }

  const fixedById = new Map((input.fixedEntrants ?? []).map((entry) => [entry.teamId, entry]));
  if (input.config.pairingMode === 'fixed' && input.orderedEntrantIds.some((id) => !fixedById.has(id))) {
    throw new AmericanoScheduleError('INVALID_SCHEDULE', 'Every fixed entrant must include its two player identities.');
  }
  const baseIndex = new Map(seededShuffle(input.orderedEntrantIds, input.seed).map((id, index) => [id, index]));
  let exactFull = false;
  let repeated = false;
  let rawRounds: Array<Array<IdFixture | [string, string]>>;
  if (input.config.pairingMode === 'rotating') {
    const built = buildRotatingIdRounds(input);
    rawRounds = built.rounds;
    exactFull = built.exactFull;
    repeated = built.repeated;
  } else {
    const built = buildFixedIdRounds(input);
    rawRounds = built.rounds;
    exactFull = built.exactFull;
    repeated = built.repeated;
  }

  const rounds: AmericanoScheduleRoundV2[] = rawRounds.map((rawRound, roundIndex) => {
    const normalized = rawRound.map((fixture) => {
      if (input.config.pairingMode === 'rotating') return canonicalIdFixture(fixture as IdFixture, baseIndex);
      const [left, right] = fixture as [string, string];
      return baseIndex.get(left)! < baseIndex.get(right)! ? [left, right] as [string, string] : [right, left] as [string, string];
    }).sort((left, right) => compareNumbers(left.map((id) => baseIndex.get(id)!), right.map((id) => baseIndex.get(id)!)));
    const playing = new Set(normalized.flat());
    const matches = normalized.map((fixture, matchIndex) => {
      const courtId = input.courtIds[(matchIndex + roundIndex) % input.courtIds.length];
      let sideA: AmericanoSide;
      let sideB: AmericanoSide;
      if (input.config.pairingMode === 'rotating') {
        const ids = fixture as IdFixture;
        sideA = { kind: 'rotating-pair', playerIds: [ids[0], ids[1]] };
        sideB = { kind: 'rotating-pair', playerIds: [ids[2], ids[3]] };
      } else {
        const ids = fixture as [string, string];
        const a = fixedById.get(ids[0])!;
        const b = fixedById.get(ids[1])!;
        sideA = { kind: 'fixed-team', teamId: a.teamId, playerIds: [...a.playerIds] };
        sideB = { kind: 'fixed-team', teamId: b.teamId, playerIds: [...b.playerIds] };
      }
      return { id: newId(), courtId, sideA, sideB };
    });
    const usedCourtIds = new Set(matches.map((match) => match.courtId));
    return {
      id: newId(),
      index: roundIndex + 1,
      matches,
      restingEntrantIds: input.orderedEntrantIds.filter((id) => !playing.has(id)),
      unusedCourtIds: input.courtIds.filter((id) => !usedCourtIds.has(id)),
    };
  });

  const schedule: AmericanoScheduleV2 = {
    id: newId(),
    algorithmVersion: AMERICANO_V2_ALGORITHM_VERSION,
    seed: input.seed >>> 0,
    inputFingerprint: '',
    orderedEntrantIds: input.orderedEntrantIds.slice(),
    courtIds: input.courtIds.slice(),
    rounds,
    metrics: emptyMetrics(input.orderedEntrantIds),
    acknowledgements: {
      fingerprint: '',
      unevenAppearances: Boolean(input.acknowledgeUnevenAppearances),
      repeatedCycle: Boolean(input.acknowledgeRepeatedCycle),
    },
    rosterRevision: input.rosterRevision ?? '0',
  };
  schedule.metrics = computeScheduleMetrics(schedule, input.config.pairingMode);
  const fingerprintPayload = input.fingerprintVersion === 3 ? {
    fingerprintVersion: 3,
    algorithmVersion: schedule.algorithmVersion,
    formatConfig: input.fingerprintConfig,
    seed: schedule.seed,
    orderedEntrantIds: schedule.orderedEntrantIds,
    membership: input.config.pairingMode === 'fixed' ? input.fixedEntrants : null,
    courtIds: schedule.courtIds,
    rosterRevision: schedule.rosterRevision,
    fixtures: schedule.rounds.map((round) => ({
      matches: round.matches.map((match) => ({ courtId: match.courtId, sideA: match.sideA, sideB: match.sideB })),
      rests: round.restingEntrantIds,
    })),
    metrics: schedule.metrics,
  } : {
    algorithmVersion: schedule.algorithmVersion,
    pairingMode: input.config.pairingMode,
    pointsPerMatch: input.config.pointsPerMatch!,
    scheduleKind: input.config.scheduleKind,
    customRounds: input.config.customRounds ?? null,
    paceMinutes: input.config.paceMinutes,
    paceClockEnabled: input.config.paceClockEnabled,
    seed: schedule.seed,
    orderedEntrantIds: schedule.orderedEntrantIds,
    membership: input.config.pairingMode === 'fixed' ? input.fixedEntrants : null,
    courtIds: schedule.courtIds,
    rosterRevision: schedule.rosterRevision,
    fixtures: schedule.rounds.map((round) => ({
      matches: round.matches.map((match) => ({ courtId: match.courtId, sideA: match.sideA, sideB: match.sideB })),
      rests: round.restingEntrantIds,
    })),
    metrics: schedule.metrics,
  };
  schedule.inputFingerprint = await sha256Hex(canonicalJson(fingerprintPayload));
  schedule.acknowledgements.fingerprint = schedule.inputFingerprint;
  validateAmericanoSchedule(schedule, {
    mode: input.config.pairingMode,
    configuredCourtIds: input.courtIds,
    expectedRounds: rounds.length,
    exactFull,
  });
  if (schedule.metrics.maximumAppearanceSpread > 0 && !input.acknowledgeUnevenAppearances) {
    // Preview is valid but Start must require this acknowledgement. The caller
    // uses the metric and acknowledgement independently; generation does not fail.
  }
  if (repeated && !input.acknowledgeRepeatedCycle) {
    // As above, a repeat warning belongs to preview/Start rather than generation.
  }
  if (input.fingerprintVersion === 3) {
    return { ...schedule, fingerprintVersion: 3 } as AmericanoScheduleV2;
  }
  return schedule;
}
