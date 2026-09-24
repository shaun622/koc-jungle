import { newId } from '@/logic/idGen';
import { isValidAmericanoPoints } from '@/logic/americanoV2/types';
import { newSeed } from '@/logic/shuffle';
import { generateAmericanoScheduleWithWatchdog } from '@/logic/americanoV2/scheduleClient';
import {
  complementaryAmericanoScore,
  validateAmericanoResult,
} from '@/logic/americanoV2/validation';
import type {
  AmericanoConfigV2,
  AmericanoEventStateV2,
  AmericanoMatchV2,
  AmericanoRoundV2,
  AmericanoScheduleRoundV2,
  IndividualEntrant,
  PairingMode,
} from '@/logic/americanoV2/types';
import { DEFAULT_SETTINGS, type Court, type Team } from '@/types/domain';

export class AmericanoRuntimeError extends Error {
  constructor(readonly code: string, message: string, readonly field?: string) {
    super(message);
    this.name = 'AmericanoRuntimeError';
  }
}

export function defaultAmericanoConfig(pairingMode: PairingMode): AmericanoConfigV2 {
  return {
    rulesVersion: 2,
    pairingMode,
    pointsPerMatch: 24,
    scheduleKind: 'full',
    paceMinutes: 10,
    paceClockEnabled: false,
  };
}

export function createAmericanoEventV2(
  name = 'Americano',
  pairingMode: PairingMode = 'rotating',
  courtCount = 2,
): AmericanoEventStateV2 {
  const courts: Court[] = Array.from({ length: courtCount }, (_, index) => ({
    id: newId(),
    position: index + 1,
    name: `Court ${index + 1}`,
    pointValue: 1,
  }));
  return {
    schemaVersion: 2,
    protocolVersion: 2,
    revision: '0',
    id: newId(),
    name: name.trim() || 'Americano',
    venue: '',
    createdAt: Date.now(),
    status: 'setup',
    settings: {
      ...DEFAULT_SETTINGS,
      qualifierEnabled: false,
      roundsTotal: 0,
      defaultRoundDurationMs: 10 * 60_000,
      soundOnTimerEnd: false,
    },
    courts,
    teams: [],
    participants: [],
    rounds: [],
    format: 'americano',
    formatConfig: defaultAmericanoConfig(pairingMode),
  };
}

export function invalidateAmericanoPreview(event: AmericanoEventStateV2): AmericanoEventStateV2 {
  if (event.status !== 'setup') {
    throw new AmericanoRuntimeError('ROSTER_LOCKED', 'Players, teams, courts and rules cannot change after the event starts.');
  }
  const next = { ...event, rounds: [], pendingAssignments: undefined };
  delete next.americanoSchedule;
  return next;
}

function requireUnpublishedEmptyModeChange(event: AmericanoEventStateV2): void {
  if (event.status !== 'setup' || event.settings.publishedSignupId) {
    throw new AmericanoRuntimeError('MODE_LOCKED', 'Pairing mode is fixed after publishing. Create a new event to use another mode.');
  }
  if (event.teams.length || event.participants.length) {
    throw new AmericanoRuntimeError('MODE_LOCKED', 'Remove every entrant before changing pairing mode, or create a new event.');
  }
}

export function updateAmericanoConfig(
  event: AmericanoEventStateV2,
  patch: Partial<AmericanoConfigV2>,
): AmericanoEventStateV2 {
  if (patch.pairingMode && patch.pairingMode !== event.formatConfig.pairingMode) {
    requireUnpublishedEmptyModeChange(event);
  }
  const formatConfig = { ...event.formatConfig, ...patch };
  if (!isValidAmericanoPoints(formatConfig.pointsPerMatch)) {
    throw new AmericanoRuntimeError('INVALID_POINTS', 'Enter a positive whole number for points per match.', 'formatConfig.pointsPerMatch');
  }
  if (formatConfig.scheduleKind === 'custom') {
    formatConfig.customRounds ??= 1;
  } else {
    delete formatConfig.customRounds;
  }
  return invalidateAmericanoPreview({
    ...event,
    formatConfig,
    settings: {
      ...event.settings,
      defaultRoundDurationMs: formatConfig.paceMinutes * 60_000,
    },
  });
}

export function replaceAmericanoCourts(
  event: AmericanoEventStateV2,
  courts: Court[],
): AmericanoEventStateV2 {
  if (courts.length < 1 || courts.length > 16) {
    throw new AmericanoRuntimeError('INVALID_COURTS', 'Americano supports 1–16 courts.', 'courts');
  }
  if (new Set(courts.map((court) => court.id)).size !== courts.length) {
    throw new AmericanoRuntimeError('INVALID_COURTS', 'Every court must have a unique identity.', 'courts');
  }
  return invalidateAmericanoPreview({
    ...event,
    courts: courts.map((court, index) => ({ ...court, position: index + 1, pointValue: 1 })),
  });
}

export function addAmericanoParticipant(
  event: AmericanoEventStateV2,
  name: string,
  signupRegistrationId?: string,
): AmericanoEventStateV2 {
  if (event.formatConfig.pairingMode !== 'rotating') throw new AmericanoRuntimeError('MODE_MISMATCH', 'This event accepts fixed pairs.');
  if (!name.trim()) throw new AmericanoRuntimeError('INVALID_NAME', 'Enter a player name.', 'playerOne');
  const participant: IndividualEntrant = {
    id: signupRegistrationId ? `registration:${signupRegistrationId}` : newId(),
    name: name.trim(),
    active: true,
    createdAt: Date.now(),
    ...(signupRegistrationId ? { signupRegistrationId } : {}),
  };
  return invalidateAmericanoPreview({ ...event, participants: [...event.participants, participant] });
}

export function updateAmericanoParticipant(
  event: AmericanoEventStateV2,
  id: string,
  name: string,
): AmericanoEventStateV2 {
  if (!name.trim()) throw new AmericanoRuntimeError('INVALID_NAME', 'Enter a player name.', 'playerOne');
  const participants = event.participants.map((participant) => participant.id === id
    ? { ...participant, name: name.trim() }
    : participant);
  return event.status === 'setup'
    ? invalidateAmericanoPreview({ ...event, participants })
    : { ...event, participants };
}

export function removeAmericanoParticipant(event: AmericanoEventStateV2, id: string): AmericanoEventStateV2 {
  return invalidateAmericanoPreview({ ...event, participants: event.participants.filter((participant) => participant.id !== id) });
}

export function reorderAmericanoParticipants(event: AmericanoEventStateV2, orderedIds: string[]): AmericanoEventStateV2 {
  if (orderedIds.length !== event.participants.length || new Set(orderedIds).size !== orderedIds.length) {
    throw new AmericanoRuntimeError('INVALID_ROSTER_ORDER', 'Player order must include every player exactly once.');
  }
  const byId = new Map(event.participants.map((participant) => [participant.id, participant]));
  const participants = orderedIds.map((id) => byId.get(id));
  if (participants.some((participant) => !participant)) throw new AmericanoRuntimeError('INVALID_ROSTER_ORDER', 'Player order contains an unknown player.');
  return invalidateAmericanoPreview({ ...event, participants: participants as IndividualEntrant[] });
}

export function addAmericanoFixedTeam(
  event: AmericanoEventStateV2,
  input: { teamName?: string; playerOne: string; playerTwo: string; signupRegistrationId?: string },
): AmericanoEventStateV2 {
  if (event.formatConfig.pairingMode !== 'fixed') throw new AmericanoRuntimeError('MODE_MISMATCH', 'This event accepts individual players.');
  if (!input.playerOne.trim() || !input.playerTwo.trim()) throw new AmericanoRuntimeError('INVALID_NAME', 'Enter both player names.');
  const teamId = input.signupRegistrationId ? `registration:${input.signupRegistrationId}` : newId();
  const team: Team = {
    id: teamId,
    name: input.teamName?.trim() || undefined,
    players: [
      { id: input.signupRegistrationId ? `${teamId}:1` : newId(), name: input.playerOne.trim() },
      { id: input.signupRegistrationId ? `${teamId}:2` : newId(), name: input.playerTwo.trim() },
    ],
    createdAt: Date.now(),
    active: true,
    ...(input.signupRegistrationId ? { signupRegistrationId: input.signupRegistrationId } : {}),
  };
  return invalidateAmericanoPreview({ ...event, teams: [...event.teams, team] });
}

export function updateAmericanoFixedTeam(
  event: AmericanoEventStateV2,
  id: string,
  input: { teamName?: string; playerOne: string; playerTwo: string },
): AmericanoEventStateV2 {
  if (!input.playerOne.trim() || !input.playerTwo.trim()) throw new AmericanoRuntimeError('INVALID_NAME', 'Enter both player names.');
  const teams = event.teams.map((team): Team => team.id === id ? {
    ...team,
    name: input.teamName?.trim() || undefined,
    players: [
      { ...team.players[0], name: input.playerOne.trim() },
      { ...team.players[1], name: input.playerTwo.trim() },
    ],
  } : team);
  return event.status === 'setup' ? invalidateAmericanoPreview({ ...event, teams }) : { ...event, teams };
}

export function removeAmericanoFixedTeam(event: AmericanoEventStateV2, id: string): AmericanoEventStateV2 {
  return invalidateAmericanoPreview({ ...event, teams: event.teams.filter((team) => team.id !== id) });
}

export function reorderAmericanoFixedTeams(event: AmericanoEventStateV2, orderedIds: string[]): AmericanoEventStateV2 {
  if (orderedIds.length !== event.teams.length || new Set(orderedIds).size !== orderedIds.length) {
    throw new AmericanoRuntimeError('INVALID_ROSTER_ORDER', 'Team order must include every team exactly once.');
  }
  const byId = new Map(event.teams.map((team) => [team.id, team]));
  const teams = orderedIds.map((id) => byId.get(id));
  if (teams.some((team) => !team)) throw new AmericanoRuntimeError('INVALID_ROSTER_ORDER', 'Team order contains an unknown team.');
  return invalidateAmericanoPreview({ ...event, teams: teams as Team[] });
}

export async function previewAmericanoSchedule(
  event: AmericanoEventStateV2,
  options: {
    seed?: number;
    reshuffle?: boolean;
    acknowledgeUnevenAppearances?: boolean;
    acknowledgeRepeatedCycle?: boolean;
    rosterRevision?: string;
  } = {},
): Promise<AmericanoEventStateV2> {
  if (event.status !== 'setup') throw new AmericanoRuntimeError('MODE_LOCKED', 'Schedules can only be generated during setup.');
  const fixed = event.formatConfig.pairingMode === 'fixed';
  const entrants = fixed
    ? event.teams.filter((team) => team.active).map((team) => team.id)
    : event.participants.filter((participant) => participant.active).map((participant) => participant.id);
  const schedule = await generateAmericanoScheduleWithWatchdog({
    config: event.formatConfig,
    orderedEntrantIds: entrants,
    fixedEntrants: fixed ? event.teams.filter((team) => team.active).map((team) => ({
      teamId: team.id,
      playerIds: [team.players[0].id, team.players[1].id],
    })) : undefined,
    courtIds: event.courts.map((court) => court.id),
    seed: options.reshuffle ? newSeed() : options.seed ?? event.americanoSchedule?.seed ?? newSeed(),
    rosterRevision: options.rosterRevision ?? event.americanoSchedule?.rosterRevision ?? '0',
    acknowledgeUnevenAppearances: options.acknowledgeUnevenAppearances,
    acknowledgeRepeatedCycle: options.acknowledgeRepeatedCycle,
  });
  return { ...event, americanoSchedule: schedule, rounds: [], pendingAssignments: undefined };
}

function runtimeRoundFromFixture(event: AmericanoEventStateV2, fixture: AmericanoScheduleRoundV2): AmericanoRoundV2 {
  return {
    id: fixture.id,
    fixtureRoundId: fixture.id,
    index: fixture.index,
    matches: fixture.matches.map((match): AmericanoMatchV2 => ({
      ...match,
      scoreA: null,
      scoreB: null,
      resultConfirmed: false,
    })),
    durationMs: event.formatConfig.paceMinutes * 60_000,
    totalPausedMs: 0,
  };
}

export function startAmericanoEvent(event: AmericanoEventStateV2): AmericanoEventStateV2 {
  const schedule = event.americanoSchedule;
  if (!schedule || schedule.rounds.length === 0) throw new AmericanoRuntimeError('PREVIEW_STALE', 'Preview the latest schedule before starting.');
  if (schedule.metrics.maximumAppearanceSpread > 0 && !schedule.acknowledgements.unevenAppearances) {
    throw new AmericanoRuntimeError('ACKNOWLEDGEMENT_REQUIRED', 'Acknowledge the uneven number of matches before starting.');
  }
  const exactCycleRounds = event.formatConfig.pairingMode === 'rotating'
    ? schedule.orderedEntrantIds.length % 4 === 0 ? schedule.orderedEntrantIds.length - 1 : schedule.orderedEntrantIds.length
    : schedule.orderedEntrantIds.length % 2 === 0 ? schedule.orderedEntrantIds.length - 1 : schedule.orderedEntrantIds.length;
  if (event.formatConfig.scheduleKind === 'custom' && schedule.rounds.length > exactCycleRounds && !schedule.acknowledgements.repeatedCycle) {
    throw new AmericanoRuntimeError('ACKNOWLEDGEMENT_REQUIRED', 'Acknowledge the repeated schedule cycle before starting.');
  }
  return {
    ...event,
    status: 'round-in-progress',
    settings: {
      ...event.settings,
      roundsTotal: schedule.rounds.length,
      defaultRoundDurationMs: event.formatConfig.paceMinutes * 60_000,
    },
    rounds: [runtimeRoundFromFixture(event, schedule.rounds[0])],
    pendingAssignments: undefined,
  };
}

function currentRound(event: AmericanoEventStateV2): AmericanoRoundV2 {
  const round = event.rounds.at(-1);
  if (!round) throw new AmericanoRuntimeError('INVALID_STATE', 'No Americano round is active.');
  return round;
}

function replaceCurrentRound(event: AmericanoEventStateV2, round: AmericanoRoundV2): AmericanoEventStateV2 {
  return { ...event, rounds: [...event.rounds.slice(0, -1), round] };
}

export function setAmericanoResultSide(
  event: AmericanoEventStateV2,
  matchId: string,
  side: 'A' | 'B',
  value: number | null,
): AmericanoEventStateV2 {
  if (event.status !== 'round-in-progress') throw new AmericanoRuntimeError('INVALID_STATE', 'Results can only be entered during an active round.');
  const target = event.formatConfig.pointsPerMatch;
  const complement = value === null ? null : complementaryAmericanoScore(value, target);
  const round = currentRound(event);
  const matches = round.matches.map((match) => match.id === matchId ? {
    ...match,
    scoreA: side === 'A' ? value : complement,
    scoreB: side === 'B' ? value : complement,
    resultConfirmed: false,
  } : match);
  return replaceCurrentRound(event, { ...round, matches });
}

export function confirmAmericanoResult(event: AmericanoEventStateV2, matchId: string): AmericanoEventStateV2 {
  const round = currentRound(event);
  const match = round.matches.find((candidate) => candidate.id === matchId);
  if (!match) throw new AmericanoRuntimeError('NOT_FOUND', 'This match could not be found.');
  const errors = validateAmericanoResult(match.scoreA, match.scoreB, event.formatConfig.pointsPerMatch);
  if (errors.scoreA || errors.scoreB) {
    throw new AmericanoRuntimeError('INVALID_RESULT', errors.scoreA ?? errors.scoreB!, errors.scoreA ? 'scoreA' : 'scoreB');
  }
  return replaceCurrentRound(event, {
    ...round,
    matches: round.matches.map((candidate) => candidate.id === matchId ? { ...candidate, resultConfirmed: true } : candidate),
  });
}

export function endAmericanoRound(event: AmericanoEventStateV2): AmericanoEventStateV2 {
  if (event.status !== 'round-in-progress') return event;
  const round = currentRound(event);
  const incomplete = round.matches.find((match) => !match.resultConfirmed);
  if (incomplete) throw new AmericanoRuntimeError('INVALID_RESULT', 'Confirm every court result before ending the round.', `matches.${incomplete.id}`);
  const completed = { ...round, completedAt: Date.now() };
  const rounds = [...event.rounds.slice(0, -1), completed];
  const schedule = event.americanoSchedule!;
  if (round.index >= schedule.rounds.length) {
    return { ...event, rounds, pendingAssignments: undefined, status: 'complete', completionReason: 'scheduled' };
  }
  const fixture = schedule.rounds[round.index];
  return {
    ...event,
    rounds,
    pendingAssignments: fixture.matches.map((match) => ({
      fixtureId: match.id,
      courtId: match.courtId,
      sideA: match.sideA,
      sideB: match.sideB,
    })),
    status: 'between-rounds',
  };
}

export function startNextAmericanoRound(event: AmericanoEventStateV2): AmericanoEventStateV2 {
  if (event.status !== 'between-rounds' || !event.pendingAssignments) return event;
  const nextIndex = event.rounds.length + 1;
  const fixture = event.americanoSchedule?.rounds[nextIndex - 1];
  if (!fixture) throw new AmericanoRuntimeError('INVALID_STATE', 'The next saved fixture could not be found.');
  return {
    ...event,
    status: 'round-in-progress',
    rounds: [...event.rounds, runtimeRoundFromFixture(event, fixture)],
    pendingAssignments: undefined,
  };
}

export function correctAmericanoResult(
  event: AmericanoEventStateV2,
  roundId: string,
  matchId: string,
  scoreA: number,
  scoreB: number,
): AmericanoEventStateV2 {
  const errors = validateAmericanoResult(scoreA, scoreB, event.formatConfig.pointsPerMatch);
  if (errors.scoreA || errors.scoreB) throw new AmericanoRuntimeError('INVALID_RESULT', errors.scoreA ?? errors.scoreB!);
  return {
    ...event,
    rounds: event.rounds.map((round) => round.id === roundId && round.completedAt && !round.excludedReason ? {
      ...round,
      matches: round.matches.map((match) => match.id === matchId ? { ...match, scoreA, scoreB, resultConfirmed: true } : match),
    } : round),
  };
}

export function updateAmericanoClock(
  event: AmericanoEventStateV2,
  operation: 'start' | 'pause' | 'reset',
  now = Date.now(),
): AmericanoEventStateV2 {
  if (!event.formatConfig.paceClockEnabled || event.status !== 'round-in-progress') return event;
  const round = currentRound(event);
  let next = round;
  if (operation === 'reset') {
    next = { ...round, startedAt: undefined, pausedAt: undefined, totalPausedMs: 0, durationMs: event.formatConfig.paceMinutes * 60_000 };
  } else if (operation === 'start' && !round.startedAt) {
    next = { ...round, startedAt: now, pausedAt: undefined };
  } else if (operation === 'start' && round.pausedAt !== undefined) {
    next = { ...round, pausedAt: undefined, totalPausedMs: round.totalPausedMs + now - round.pausedAt };
  } else if (operation === 'pause' && round.startedAt && round.pausedAt === undefined) {
    next = { ...round, pausedAt: now };
  }
  return replaceCurrentRound(event, next);
}

export function finishAmericanoEarly(event: AmericanoEventStateV2): AmericanoEventStateV2 {
  if (event.status === 'complete') return event;
  const rounds = event.rounds.map((round, index) => index === event.rounds.length - 1 && !round.completedAt
    ? { ...round, excludedReason: 'ended-early' as const }
    : round);
  return { ...event, rounds, pendingAssignments: undefined, status: 'complete', completionReason: 'early' };
}

export function freshAmericanoCopy(event: AmericanoEventStateV2): AmericanoEventStateV2 {
  const copy = createAmericanoEventV2(`Copy of ${event.name}`, event.formatConfig.pairingMode, event.courts.length);
  return {
    ...copy,
    venue: event.venue,
    courts: event.courts.map((court, index) => ({ ...court, id: newId(), position: index + 1, pointValue: 1 })),
    formatConfig: { ...event.formatConfig },
    settings: {
      ...copy.settings,
      roundsTotal: 0,
      defaultRoundDurationMs: event.formatConfig.paceMinutes * 60_000,
    },
  };
}
