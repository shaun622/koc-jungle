import { canonicalJson, sha256Hex } from '@/logic/americanoV2/scheduleCore';
import { newId } from '@/logic/idGen';
import { computeAmericanoStandingsV3 } from './standings';
import type {
  AmericanoEventStateV3,
  AmericanoStandingV3,
  ChampionshipFinalV3,
  ChampionshipOutcomeV3,
} from './types';
import { AmericanoRuntimeV3Error } from './runtime';

export type ChampionshipStatusV3 =
  | { kind: 'no-results' }
  | { kind: 'incomplete' }
  | { kind: 'shared-leaders'; leaders: AmericanoStandingV3[] }
  | { kind: 'champion'; leader: AmericanoStandingV3 }
  | { kind: 'not-configured'; leaders: [AmericanoStandingV3, AmericanoStandingV3] }
  | { kind: 'available'; leaders: [AmericanoStandingV3, AmericanoStandingV3] }
  | { kind: 'pending'; final: ChampionshipFinalV3; leaders: [AmericanoStandingV3, AmericanoStandingV3] }
  | { kind: 'current'; final: ChampionshipFinalV3; leaders: [AmericanoStandingV3, AmericanoStandingV3] }
  | { kind: 'stale'; final: ChampionshipFinalV3; leaders?: [AmericanoStandingV3, AmericanoStandingV3] };

function includedCompletedRounds(event: AmericanoEventStateV3) {
  return event.rounds.filter((round) => Boolean(round.completedAt) && !round.excludedReason);
}

function firstPlaceLeaders(event: AmericanoEventStateV3): AmericanoStandingV3[] {
  return computeAmericanoStandingsV3(event).filter((row) => row.rank === 1);
}

export async function championshipBasisFingerprintV3(event: AmericanoEventStateV3): Promise<string> {
  const pairingMode = event.formatConfig.pairingMode;
  const orderedEntrantIds = event.americanoSchedule?.orderedEntrantIds
    ?? (pairingMode === 'fixed'
      ? event.teams.filter((team) => team.active).map((team) => team.id)
      : event.participants.filter((player) => player.active).map((player) => player.id));
  const membership = pairingMode === 'fixed'
    ? orderedEntrantIds.map((teamId) => {
      const team = event.teams.find((candidate) => candidate.id === teamId);
      return { entrantId: teamId, playerIds: team?.players.map((player) => player.id) ?? [] };
    })
    : orderedEntrantIds.map((playerId) => ({ entrantId: playerId, playerIds: [playerId] }));
  const includedRounds = includedCompletedRounds(event).map((round) => ({
    fixtureRoundId: round.fixtureRoundId,
    matches: round.matches.map((match) => ({
      matchId: match.id,
      result: match.result,
      resultConfirmed: match.resultConfirmed,
    })),
  }));
  return sha256Hex(canonicalJson({
    schemaVersion: event.schemaVersion,
    formatConfig: event.formatConfig,
    scheduleInputFingerprint: event.americanoSchedule?.inputFingerprint ?? null,
    membership,
    includedRounds,
  }));
}

export async function championshipStatusV3(event: AmericanoEventStateV3): Promise<ChampionshipStatusV3> {
  if (includedCompletedRounds(event).length === 0) return { kind: 'no-results' };
  if (event.status !== 'complete') return { kind: 'incomplete' };
  const leaders = firstPlaceLeaders(event);
  const pair = leaders.length === 2 ? leaders as [AmericanoStandingV3, AmericanoStandingV3] : undefined;
  if (event.championshipFinal) {
    const fingerprint = await championshipBasisFingerprintV3(event);
    if (fingerprint !== event.championshipFinal.basisFingerprint
      || !pair
      || event.championshipFinal.contenderIds[0] !== pair[0].entrantId
      || event.championshipFinal.contenderIds[1] !== pair[1].entrantId) {
      return { kind: 'stale', final: event.championshipFinal, leaders: pair };
    }
    return event.championshipFinal.outcome
      ? { kind: 'current', final: event.championshipFinal, leaders: pair }
      : { kind: 'pending', final: event.championshipFinal, leaders: pair };
  }
  if (leaders.length > 2) return { kind: 'shared-leaders', leaders };
  if (leaders.length === 1) return { kind: 'champion', leader: leaders[0] };
  if (leaders.length !== 2) return { kind: 'no-results' };
  const eligiblePair = leaders as [AmericanoStandingV3, AmericanoStandingV3];
  if (event.formatConfig.ranking.championship === 'none') return { kind: 'not-configured', leaders: eligiblePair };
  return { kind: 'available', leaders: eligiblePair };
}

function finalists(event: AmericanoEventStateV3): [AmericanoStandingV3, AmericanoStandingV3] {
  if (event.status !== 'complete' || includedCompletedRounds(event).length === 0) {
    throw new AmericanoRuntimeV3Error('FINAL_NOT_ELIGIBLE', 'Complete ordinary play with at least one included result before preparing a final.');
  }
  if (event.formatConfig.ranking.championship === 'none') {
    throw new AmericanoRuntimeV3Error('FINAL_NOT_ELIGIBLE', 'Championship finals are turned off for this event.');
  }
  const leaders = firstPlaceLeaders(event);
  if (leaders.length !== 2) {
    throw new AmericanoRuntimeV3Error('FINAL_NOT_ELIGIBLE', leaders.length > 2
      ? 'Three or more leaders share first place; this final can only resolve a two-way tie.'
      : 'The event does not have exactly two tied first-place entrants.');
  }
  return leaders as [AmericanoStandingV3, AmericanoStandingV3];
}

export async function prepareChampionshipFinalV3(
  event: AmericanoEventStateV3,
  input: { courtId?: string; supportPlayerIds?: [string, string]; acknowledgeSupportPlayersNoPoints?: boolean },
): Promise<AmericanoEventStateV3> {
  const leaders = finalists(event);
  const courtId = input.courtId ?? event.courts[0]?.id;
  if (!courtId || !event.courts.some((court) => court.id === courtId)) {
    throw new AmericanoRuntimeV3Error('INVALID_FINAL_PARTNERS', 'Choose an available court for the final.', 'championshipFinal.courtId');
  }
  let supportPlayerIds: [string, string] | null = null;
  if (event.formatConfig.pairingMode === 'rotating') {
    if (input.acknowledgeSupportPlayersNoPoints !== true) {
      throw new AmericanoRuntimeV3Error('INVALID_FINAL_PARTNERS', 'Confirm that support partners do not earn standings points or places from this final.', 'championshipFinal.supportAcknowledgement');
    }
    const chosen = input.supportPlayerIds;
    if (!chosen || chosen.length !== 2 || chosen[0] === chosen[1]) {
      throw new AmericanoRuntimeV3Error('INVALID_FINAL_PARTNERS', 'Choose two different support players, one for each side.', 'championshipFinal.supportPlayerIds');
    }
    const finalistsSet = new Set(leaders.map((leader) => leader.entrantId));
    const eligible = new Set(event.participants.filter((player) => player.active && !finalistsSet.has(player.id)).map((player) => player.id));
    if (!eligible.has(chosen[0]) || !eligible.has(chosen[1])) {
      throw new AmericanoRuntimeV3Error('INVALID_FINAL_PARTNERS', 'Finalists must be supported by two distinct active players who are not finalists.', 'championshipFinal.supportPlayerIds');
    }
    supportPlayerIds = [...chosen];
  } else if (input.supportPlayerIds) {
    throw new AmericanoRuntimeV3Error('INVALID_FINAL_PARTNERS', 'Fixed-pair finals use the intact teams and do not need support players.', 'championshipFinal.supportPlayerIds');
  }
  const final: ChampionshipFinalV3 = {
    id: newId(),
    basisFingerprint: await championshipBasisFingerprintV3(event),
    contenderIds: [leaders[0].entrantId, leaders[1].entrantId],
    courtId,
    supportPlayerIds,
    outcome: null,
  };
  return { ...event, championshipFinal: final };
}

function validTiebreakOutcome(event: AmericanoEventStateV3, outcome: ChampionshipOutcomeV3): boolean {
  if (outcome.kind !== 'tiebreak') return false;
  const target = event.formatConfig.ranking.championship === 'tiebreak-7' ? 7
    : event.formatConfig.ranking.championship === 'tiebreak-10' ? 10 : null;
  if (target === null) return false;
  const { pointsA, pointsB } = outcome;
  if (!Number.isSafeInteger(pointsA) || !Number.isSafeInteger(pointsB) || pointsA < 0 || pointsB < 0) return false;
  const high = Math.max(pointsA, pointsB);
  const low = Math.min(pointsA, pointsB);
  return high >= target && high - low >= 2;
}

function validateFinalOutcome(event: AmericanoEventStateV3, outcome: ChampionshipOutcomeV3): void {
  const policy = event.formatConfig.ranking.championship;
  if (policy === 'golden-point') {
    if (outcome.kind !== 'golden-point' || (outcome.winner !== 'A' && outcome.winner !== 'B')) {
      throw new AmericanoRuntimeV3Error('INVALID_FINAL_RESULT', 'Select which side won the golden point.', 'championshipFinal.outcome');
    }
    return;
  }
  if ((policy === 'tiebreak-7' || policy === 'tiebreak-10') && validTiebreakOutcome(event, outcome)) return;
  throw new AmericanoRuntimeV3Error('INVALID_FINAL_RESULT', 'Enter a valid tiebreak score that reaches the target and wins by two.', 'championshipFinal.outcome');
}

async function assertCurrentEligibleFinal(event: AmericanoEventStateV3, final: ChampionshipFinalV3): Promise<void> {
  const currentBasis = await championshipBasisFingerprintV3(event);
  if (currentBasis !== final.basisFingerprint) throw new AmericanoRuntimeV3Error('FINAL_STALE', 'Regular results changed. Reset and prepare a new final before saving its result.');
  finalists(event);
  const leaders = firstPlaceLeaders(event);
  if (final.contenderIds[0] !== leaders[0]?.entrantId || final.contenderIds[1] !== leaders[1]?.entrantId) {
    throw new AmericanoRuntimeV3Error('FINAL_STALE', 'The prepared finalists no longer match the current standings.');
  }
  if (event.formatConfig.pairingMode === 'rotating') {
    const eligible = new Set(event.participants.filter((player) => player.active && !final.contenderIds.includes(player.id)).map((player) => player.id));
    if (!final.supportPlayerIds || !eligible.has(final.supportPlayerIds[0]) || !eligible.has(final.supportPlayerIds[1]) || final.supportPlayerIds[0] === final.supportPlayerIds[1]) {
      throw new AmericanoRuntimeV3Error('FINAL_STALE', 'The selected support partners are no longer available. Reset and prepare the final again.');
    }
  }
}

export async function confirmChampionshipFinalV3(
  event: AmericanoEventStateV3,
  outcome: ChampionshipOutcomeV3,
): Promise<AmericanoEventStateV3> {
  const final = event.championshipFinal;
  if (!final) throw new AmericanoRuntimeV3Error('FINAL_NOT_ELIGIBLE', 'Prepare the championship final before entering its result.');
  await assertCurrentEligibleFinal(event, final);
  validateFinalOutcome(event, outcome);
  return { ...event, championshipFinal: { ...final, outcome: { ...outcome } } };
}

export async function correctChampionshipFinalV3(
  event: AmericanoEventStateV3,
  outcome: ChampionshipOutcomeV3,
): Promise<AmericanoEventStateV3> {
  return confirmChampionshipFinalV3(event, outcome);
}

export function resetChampionshipFinalV3(event: AmericanoEventStateV3, confirmed: boolean): AmericanoEventStateV3 {
  if (!event.championshipFinal) return event;
  if (!confirmed) throw new AmericanoRuntimeV3Error('FINAL_NOT_ELIGIBLE', 'Confirm that you want to discard the prepared final and its result before resetting it.');
  const next = { ...event };
  delete next.championshipFinal;
  return next;
}

export function applyChampionshipFinalToStandingsV3(
  standings: AmericanoStandingV3[],
  status: ChampionshipStatusV3,
): AmericanoStandingV3[] {
  if (status.kind !== 'current' || !status.final.outcome) return standings;
  const winnerId = status.final.outcome.kind === 'golden-point'
    ? status.final.contenderIds[status.final.outcome.winner === 'A' ? 0 : 1]
    : status.final.outcome.pointsA > status.final.outcome.pointsB
      ? status.final.contenderIds[0]
      : status.final.contenderIds[1];
  const loserId = status.final.contenderIds.find((id) => id !== winnerId)!;
  const copied = standings.map((row) => ({ ...row }));
  const winner = copied.find((row) => row.entrantId === winnerId);
  const loser = copied.find((row) => row.entrantId === loserId);
  if (winner) winner.rank = 1;
  if (loser) loser.rank = 2;
  return copied.sort((a, b) => a.rank - b.rank);
}
