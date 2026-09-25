import { DEFAULT_SETTINGS, type Court, type Team } from '@/types/domain';
import { newId } from '@/logic/idGen';
import { newSeed } from '@/logic/shuffle';
import { isValidAmericanoPoints } from '@/logic/americanoV2/types';
import type { PairingMode } from '@/logic/americanoV2/types';
import { generateAmericanoScheduleV3WithWatchdog } from './scheduleClient';
import {
  createTraditionalResultDraftV3,
  defaultAmericanoConfigV3,
  validateAmericanoConfigV3,
  validateAmericanoResultDraftV3,
} from './scoring';
import type {
  AmericanoConfigV3,
  AmericanoEventStateV3,
  AmericanoMatchV3,
  AmericanoRoundV3,
  AmericanoScheduleV3,
  AmericanoResultDraftV3,
} from './types';

export type AmericanoV3StatusErrorCode =
  | 'ROSTER_LOCKED' | 'MODE_LOCKED' | 'MODE_MISMATCH' | 'INVALID_NAME' | 'INVALID_COURTS'
  | 'INVALID_ROSTER_ORDER' | 'PREVIEW_STALE' | 'ACKNOWLEDGEMENT_REQUIRED' | 'INVALID_RESULT'
  | 'INVALID_STATE' | 'NOT_FOUND' | 'FINAL_NOT_ELIGIBLE' | 'INVALID_FINAL_PARTNERS'
  | 'INVALID_FINAL_RESULT' | 'FINAL_STALE';

export class AmericanoRuntimeV3Error extends Error {
  constructor(readonly code: AmericanoV3StatusErrorCode, message: string, readonly field?: string) {
    super(message);
    this.name = 'AmericanoRuntimeV3Error';
  }
}

function courtsWithIds(courts: Court[]): Court[] {
  return courts.map((court, index) => ({ ...court, id: newId(), position: index + 1, pointValue: 1 }));
}

export function createAmericanoEventV3(name = 'Americano', pairingMode: PairingMode = 'rotating', courtCount = 2): AmericanoEventStateV3 {
  if (!Number.isInteger(courtCount) || courtCount < 1 || courtCount > 16) throw new AmericanoRuntimeV3Error('INVALID_COURTS', 'Americano supports 1–16 courts.', 'courts');
  const courts: Court[] = Array.from({ length: courtCount }, (_, index) => ({
    id: newId(), position: index + 1, name: `Court ${index + 1}`, pointValue: 1,
  }));
  return {
    schemaVersion: 3,
    protocolVersion: 2,
    revision: '0',
    id: newId(),
    name: name.trim() || 'Americano',
    venue: '',
    createdAt: Date.now(),
    status: 'setup',
    settings: { ...DEFAULT_SETTINGS, qualifierEnabled: false, roundsTotal: 0, defaultRoundDurationMs: 10 * 60_000, soundOnTimerEnd: false },
    courts,
    teams: [],
    participants: [],
    rounds: [],
    format: 'americano',
    formatConfig: defaultAmericanoConfigV3(pairingMode),
  };
}

export function invalidateAmericanoV3Preview(event: AmericanoEventStateV3): AmericanoEventStateV3 {
  if (event.status !== 'setup') throw new AmericanoRuntimeV3Error('ROSTER_LOCKED', 'Players, teams, courts and rules cannot change after the event starts.');
  const next = { ...event, rounds: [], pendingAssignments: undefined };
  delete next.americanoSchedule;
  return next;
}

function requireUnpublishedEmptyModeChange(event: AmericanoEventStateV3): void {
  if (event.status !== 'setup' || event.settings.publishedSignupId) throw new AmericanoRuntimeV3Error('MODE_LOCKED', 'Pairing mode is fixed after publishing. Create a new event to use another mode.');
  if (event.teams.length || event.participants.length) throw new AmericanoRuntimeV3Error('MODE_LOCKED', 'Remove every entrant before changing pairing mode, or create a new event.');
}

export function updateAmericanoConfigV3(event: AmericanoEventStateV3, patch: Partial<AmericanoConfigV3>): AmericanoEventStateV3 {
  if (patch.pairingMode && patch.pairingMode !== event.formatConfig.pairingMode) requireUnpublishedEmptyModeChange(event);
  const formatConfig = { ...event.formatConfig, ...patch, ranking: patch.ranking ? { ...event.formatConfig.ranking, ...patch.ranking } : event.formatConfig.ranking };
  if (formatConfig.scheduleKind === 'custom') formatConfig.customRounds ??= 1;
  else delete formatConfig.customRounds;
  if (formatConfig.pairingMode === 'rotating' && formatConfig.ranking.tiebreak.startsWith('head-to-head')) formatConfig.ranking = { ...formatConfig.ranking, tiebreak: 'shared' };
  validateAmericanoConfigV3(formatConfig);
  return invalidateAmericanoV3Preview({ ...event, formatConfig, settings: { ...event.settings, defaultRoundDurationMs: formatConfig.paceMinutes * 60_000 } });
}

export function replaceAmericanoCourtsV3(event: AmericanoEventStateV3, courts: Court[]): AmericanoEventStateV3 {
  if (courts.length < 1 || courts.length > 16 || new Set(courts.map((court) => court.id)).size !== courts.length) throw new AmericanoRuntimeV3Error('INVALID_COURTS', 'Use 1–16 courts with unique IDs.', 'courts');
  return invalidateAmericanoV3Preview({ ...event, courts: courts.map((court, index) => ({ ...court, position: index + 1, pointValue: 1 })) });
}

export function addAmericanoParticipantV3(event: AmericanoEventStateV3, name: string, signupRegistrationId?: string): AmericanoEventStateV3 {
  if (event.formatConfig.pairingMode !== 'rotating') throw new AmericanoRuntimeV3Error('MODE_MISMATCH', 'This event accepts fixed pairs.');
  if (!name.trim()) throw new AmericanoRuntimeV3Error('INVALID_NAME', 'Enter a player name.', 'playerOne');
  const participant = { id: signupRegistrationId ? `registration:${signupRegistrationId}` : newId(), name: name.trim(), active: true, createdAt: Date.now(), ...(signupRegistrationId ? { signupRegistrationId } : {}) };
  return invalidateAmericanoV3Preview({ ...event, participants: [...event.participants, participant] });
}

export function updateAmericanoParticipantV3(event: AmericanoEventStateV3, id: string, name: string): AmericanoEventStateV3 {
  if (!name.trim()) throw new AmericanoRuntimeV3Error('INVALID_NAME', 'Enter a player name.', 'playerOne');
  const participants = event.participants.map((p) => p.id === id ? { ...p, name: name.trim() } : p);
  return event.status === 'setup' ? invalidateAmericanoV3Preview({ ...event, participants }) : { ...event, participants };
}

export function removeAmericanoParticipantV3(event: AmericanoEventStateV3, id: string): AmericanoEventStateV3 {
  return invalidateAmericanoV3Preview({ ...event, participants: event.participants.filter((p) => p.id !== id) });
}

function reorderIds<T extends { id: string }>(items: T[], orderedIds: string[], label: string): T[] {
  if (orderedIds.length !== items.length || new Set(orderedIds).size !== orderedIds.length) throw new AmericanoRuntimeV3Error('INVALID_ROSTER_ORDER', `${label} order must include every entrant exactly once.`);
  const byId = new Map(items.map((item) => [item.id, item]));
  const result = orderedIds.map((id) => byId.get(id));
  if (result.some((item) => !item)) throw new AmericanoRuntimeV3Error('INVALID_ROSTER_ORDER', `${label} order contains an unknown entrant.`);
  return result as T[];
}

export function reorderAmericanoParticipantsV3(event: AmericanoEventStateV3, orderedIds: string[]): AmericanoEventStateV3 {
  return invalidateAmericanoV3Preview({ ...event, participants: reorderIds(event.participants, orderedIds, 'Player') });
}

export function addAmericanoFixedTeamV3(event: AmericanoEventStateV3, input: { teamName?: string; playerOne: string; playerTwo: string; signupRegistrationId?: string }): AmericanoEventStateV3 {
  if (event.formatConfig.pairingMode !== 'fixed') throw new AmericanoRuntimeV3Error('MODE_MISMATCH', 'This event accepts individual players.');
  if (!input.playerOne.trim() || !input.playerTwo.trim()) throw new AmericanoRuntimeV3Error('INVALID_NAME', 'Enter both player names.');
  const teamId = input.signupRegistrationId ? `registration:${input.signupRegistrationId}` : newId();
  const team: Team = {
    id: teamId, name: input.teamName?.trim() || undefined,
    players: [
      { id: input.signupRegistrationId ? `${teamId}:1` : newId(), name: input.playerOne.trim() },
      { id: input.signupRegistrationId ? `${teamId}:2` : newId(), name: input.playerTwo.trim() },
    ],
    createdAt: Date.now(), active: true,
    ...(input.signupRegistrationId ? { signupRegistrationId: input.signupRegistrationId } : {}),
  };
  return invalidateAmericanoV3Preview({ ...event, teams: [...event.teams, team] });
}

export function updateAmericanoFixedTeamV3(event: AmericanoEventStateV3, id: string, input: { teamName?: string; playerOne: string; playerTwo: string }): AmericanoEventStateV3 {
  if (!input.playerOne.trim() || !input.playerTwo.trim()) throw new AmericanoRuntimeV3Error('INVALID_NAME', 'Enter both player names.');
  const teams = event.teams.map((team) => team.id === id ? { ...team, name: input.teamName?.trim() || undefined, players: [{ ...team.players[0], name: input.playerOne.trim() }, { ...team.players[1], name: input.playerTwo.trim() }] as Team['players'] } : team);
  return event.status === 'setup' ? invalidateAmericanoV3Preview({ ...event, teams }) : { ...event, teams };
}

export function removeAmericanoFixedTeamV3(event: AmericanoEventStateV3, id: string): AmericanoEventStateV3 {
  return invalidateAmericanoV3Preview({ ...event, teams: event.teams.filter((team) => team.id !== id) });
}

export function reorderAmericanoFixedTeamsV3(event: AmericanoEventStateV3, orderedIds: string[]): AmericanoEventStateV3 {
  return invalidateAmericanoV3Preview({ ...event, teams: reorderIds(event.teams, orderedIds, 'Team') });
}

function activeEntrants(event: AmericanoEventStateV3): string[] {
  return event.formatConfig.pairingMode === 'fixed'
    ? event.teams.filter((team) => team.active).map((team) => team.id)
    : event.participants.filter((player) => player.active).map((player) => player.id);
}

export async function previewAmericanoScheduleV3(event: AmericanoEventStateV3, options: {
  seed?: number; reshuffle?: boolean; acknowledgeUnevenAppearances?: boolean; acknowledgeRepeatedCycle?: boolean; rosterRevision?: string;
} = {}): Promise<AmericanoEventStateV3> {
  if (event.status !== 'setup') throw new AmericanoRuntimeV3Error('MODE_LOCKED', 'Schedules can only be generated during setup.');
  validateAmericanoConfigV3(event.formatConfig);
  const fixed = event.formatConfig.pairingMode === 'fixed';
  const entrants = activeEntrants(event);
  const schedule = await generateAmericanoScheduleV3WithWatchdog({
    config: event.formatConfig,
    orderedEntrantIds: entrants,
    fixedEntrants: fixed ? event.teams.filter((team) => team.active).map((team) => ({ teamId: team.id, playerIds: [team.players[0].id, team.players[1].id] })) : undefined,
    courtIds: event.courts.map((court) => court.id),
    seed: options.reshuffle ? newSeed() : options.seed ?? event.americanoSchedule?.seed ?? newSeed(),
    rosterRevision: options.rosterRevision ?? event.americanoSchedule?.rosterRevision ?? '0',
    acknowledgeUnevenAppearances: options.acknowledgeUnevenAppearances,
    acknowledgeRepeatedCycle: options.acknowledgeRepeatedCycle,
  });
  return { ...event, americanoSchedule: schedule, rounds: [], pendingAssignments: undefined };
}

function initialResult(config: AmericanoConfigV3): AmericanoResultDraftV3 {
  return config.scoring.kind === 'rally' ? { kind: 'rally', scoreA: null, scoreB: null } : createTraditionalResultDraftV3();
}

function roundFromFixture(event: AmericanoEventStateV3, fixture: AmericanoScheduleV3['rounds'][number]): AmericanoRoundV3 {
  return {
    id: fixture.id, fixtureRoundId: fixture.id, index: fixture.index,
    matches: fixture.matches.map((match): AmericanoMatchV3 => ({ ...match, result: initialResult(event.formatConfig), resultConfirmed: false })),
    durationMs: event.formatConfig.paceMinutes * 60_000, totalPausedMs: 0,
  };
}

export function startAmericanoEventV3(event: AmericanoEventStateV3): AmericanoEventStateV3 {
  validateAmericanoConfigV3(event.formatConfig);
  const schedule = event.americanoSchedule;
  if (!schedule || !schedule.rounds.length || schedule.fingerprintVersion !== 3 || schedule.acknowledgements.fingerprint !== schedule.inputFingerprint) throw new AmericanoRuntimeV3Error('PREVIEW_STALE', 'Preview the latest schedule before starting.');
  if (schedule.metrics.maximumAppearanceSpread > 0 && !schedule.acknowledgements.unevenAppearances) throw new AmericanoRuntimeV3Error('ACKNOWLEDGEMENT_REQUIRED', 'Acknowledge the uneven number of matches before starting.');
  const exactCycleRounds = event.formatConfig.pairingMode === 'rotating'
    ? schedule.orderedEntrantIds.length % 4 === 0 ? schedule.orderedEntrantIds.length - 1 : schedule.orderedEntrantIds.length
    : schedule.orderedEntrantIds.length % 2 === 0 ? schedule.orderedEntrantIds.length - 1 : schedule.orderedEntrantIds.length;
  if (event.formatConfig.scheduleKind === 'custom' && schedule.rounds.length > exactCycleRounds && !schedule.acknowledgements.repeatedCycle) throw new AmericanoRuntimeV3Error('ACKNOWLEDGEMENT_REQUIRED', 'Acknowledge the repeated schedule cycle before starting.');
  if (JSON.stringify(schedule.orderedEntrantIds) !== JSON.stringify(activeEntrants(event)) || JSON.stringify(schedule.courtIds) !== JSON.stringify(event.courts.map((court) => court.id))) throw new AmericanoRuntimeV3Error('PREVIEW_STALE', 'Roster or courts changed after preview.');
  return { ...event, status: 'round-in-progress', settings: { ...event.settings, roundsTotal: schedule.rounds.length, defaultRoundDurationMs: event.formatConfig.paceMinutes * 60_000 }, rounds: [roundFromFixture(event, schedule.rounds[0])], pendingAssignments: undefined };
}

function currentRound(event: AmericanoEventStateV3): AmericanoRoundV3 {
  const round = event.rounds.at(-1);
  if (!round) throw new AmericanoRuntimeV3Error('INVALID_STATE', 'No Americano round is active.');
  return round;
}

function replaceCurrentRound(event: AmericanoEventStateV3, next: AmericanoRoundV3): AmericanoEventStateV3 {
  return { ...event, rounds: [...event.rounds.slice(0, -1), next] };
}

export function setAmericanoResultDraftV3(event: AmericanoEventStateV3, matchId: string, result: AmericanoResultDraftV3): AmericanoEventStateV3 {
  if (event.status !== 'round-in-progress') throw new AmericanoRuntimeV3Error('INVALID_STATE', 'Results can only be entered during an active round.');
  const validation = validateAmericanoResultDraftV3(result, event.formatConfig.scoring, false, event.formatConfig.paceMinutes);
  if (!validation.valid) throw new AmericanoRuntimeV3Error('INVALID_RESULT', validation.error!.message, validation.error!.field);
  const round = currentRound(event);
  if (!round.matches.some((match) => match.id === matchId)) throw new AmericanoRuntimeV3Error('NOT_FOUND', 'This match could not be found.');
  return replaceCurrentRound(event, { ...round, matches: round.matches.map((match) => match.id === matchId ? { ...match, result, resultConfirmed: false } : match) });
}

export function setAmericanoRallyScoreV3(event: AmericanoEventStateV3, matchId: string, side: 'A' | 'B', value: number | null): AmericanoEventStateV3 {
  if (event.formatConfig.scoring.kind !== 'rally') throw new AmericanoRuntimeV3Error('INVALID_RESULT', 'This match uses games or sets.');
  if (value !== null && !isValidAmericanoPoints(value)) throw new AmericanoRuntimeV3Error('INVALID_RESULT', 'Use a non-negative whole-number rally score.');
  const match = currentRound(event).matches.find((candidate) => candidate.id === matchId);
  if (!match || match.result.kind !== 'rally') throw new AmericanoRuntimeV3Error('NOT_FOUND', 'This match could not be found.');
  const target = event.formatConfig.scoring.pointsPerMatch;
  const complement = value === null ? null : target - value;
  return setAmericanoResultDraftV3(event, matchId, { kind: 'rally', scoreA: side === 'A' ? value : complement, scoreB: side === 'B' ? value : complement });
}

export function confirmAmericanoResultV3(event: AmericanoEventStateV3, matchId: string): AmericanoEventStateV3 {
  if (event.status !== 'round-in-progress') throw new AmericanoRuntimeV3Error('INVALID_STATE', 'Results can only be confirmed during an active round.');
  const round = currentRound(event);
  const match = round.matches.find((candidate) => candidate.id === matchId);
  if (!match) throw new AmericanoRuntimeV3Error('NOT_FOUND', 'This match could not be found.');
  const validation = validateAmericanoResultDraftV3(match.result, event.formatConfig.scoring, true, event.formatConfig.paceMinutes);
  if (!validation.valid) throw new AmericanoRuntimeV3Error('INVALID_RESULT', validation.error!.message, validation.error!.field);
  return replaceCurrentRound(event, { ...round, matches: round.matches.map((candidate) => candidate.id === matchId ? { ...candidate, resultConfirmed: true } : candidate) });
}

export function endAmericanoRoundV3(event: AmericanoEventStateV3, now = Date.now()): AmericanoEventStateV3 {
  if (event.status !== 'round-in-progress') return event;
  const round = currentRound(event);
  const incomplete = round.matches.find((match) => !match.resultConfirmed);
  if (incomplete) throw new AmericanoRuntimeV3Error('INVALID_RESULT', 'Confirm every court result before ending the round.', `matches.${incomplete.id}`);
  const rounds = [...event.rounds.slice(0, -1), { ...round, completedAt: now }];
  const schedule = event.americanoSchedule!;
  if (round.index >= schedule.rounds.length) return { ...event, rounds, pendingAssignments: undefined, status: 'complete', completionReason: 'scheduled' };
  const fixture = schedule.rounds[round.index];
  return { ...event, rounds, pendingAssignments: fixture.matches.map((match) => ({ fixtureId: match.id, courtId: match.courtId, sideA: match.sideA, sideB: match.sideB })), status: 'between-rounds' };
}

export function startNextAmericanoRoundV3(event: AmericanoEventStateV3): AmericanoEventStateV3 {
  if (event.status !== 'between-rounds' || !event.pendingAssignments) return event;
  const fixture = event.americanoSchedule?.rounds[event.rounds.length];
  if (!fixture) throw new AmericanoRuntimeV3Error('INVALID_STATE', 'The next saved fixture could not be found.');
  return { ...event, status: 'round-in-progress', rounds: [...event.rounds, roundFromFixture(event, fixture)], pendingAssignments: undefined };
}

export function correctAmericanoResultV3(event: AmericanoEventStateV3, roundId: string, matchId: string, result: AmericanoResultDraftV3): AmericanoEventStateV3 {
  const validation = validateAmericanoResultDraftV3(result, event.formatConfig.scoring, true, event.formatConfig.paceMinutes);
  if (!validation.valid) throw new AmericanoRuntimeV3Error('INVALID_RESULT', validation.error!.message, validation.error!.field);
  const round = event.rounds.find((candidate) => candidate.id === roundId && candidate.completedAt !== undefined && !candidate.excludedReason);
  if (!round || !round.matches.some((match) => match.id === matchId)) throw new AmericanoRuntimeV3Error('NOT_FOUND', 'This completed match could not be found.');
  return { ...event, rounds: event.rounds.map((candidate) => candidate.id === roundId ? { ...candidate, matches: candidate.matches.map((match) => match.id === matchId ? { ...match, result, resultConfirmed: true } : match) } : candidate) };
}

export function updateAmericanoClockV3(event: AmericanoEventStateV3, operation: 'start' | 'pause' | 'reset', now = Date.now()): AmericanoEventStateV3 {
  if (!event.formatConfig.paceClockEnabled || event.status !== 'round-in-progress') return event;
  const round = currentRound(event);
  let next = round;
  if (operation === 'reset') next = { ...round, startedAt: undefined, pausedAt: undefined, totalPausedMs: 0, durationMs: event.formatConfig.paceMinutes * 60_000 };
  else if (operation === 'start' && !round.startedAt) next = { ...round, startedAt: now, pausedAt: undefined };
  else if (operation === 'start' && round.pausedAt !== undefined) next = { ...round, pausedAt: undefined, totalPausedMs: round.totalPausedMs + now - round.pausedAt };
  else if (operation === 'pause' && round.startedAt && round.pausedAt === undefined) next = { ...round, pausedAt: now };
  return replaceCurrentRound(event, next);
}

export function finishAmericanoEarlyV3(event: AmericanoEventStateV3): AmericanoEventStateV3 {
  if (event.status === 'complete') return event;
  const rounds = event.rounds.map((round, index) => index === event.rounds.length - 1 && !round.completedAt ? { ...round, excludedReason: 'ended-early' as const } : round);
  return { ...event, rounds, pendingAssignments: undefined, status: 'complete', completionReason: 'early' };
}

export function freshAmericanoCopyV3(event: AmericanoEventStateV3): AmericanoEventStateV3 {
  const copy = createAmericanoEventV3(`Copy of ${event.name}`, event.formatConfig.pairingMode, event.courts.length);
  const teams = event.teams.filter((team) => team.active).map((source) => {
    const team: Team = {
      ...source,
      id: newId(),
      createdAt: Date.now(),
      active: true,
      players: [{ ...source.players[0], id: newId() }, { ...source.players[1], id: newId() }],
    };
    delete team.signupRegistrationId;
    delete team.signupPairKey;
    delete team.pointsOverride;
    return team;
  });
  const participants = event.participants.filter((player) => player.active).map((source) => {
    const participant = { ...source, id: newId(), createdAt: Date.now(), active: true };
    delete participant.signupRegistrationId;
    return participant;
  });
  return {
    ...copy,
    venue: event.venue,
    courts: courtsWithIds(event.courts),
    teams,
    participants,
    formatConfig: JSON.parse(JSON.stringify(event.formatConfig)) as AmericanoConfigV3,
    settings: { ...copy.settings, roundsTotal: 0, defaultRoundDurationMs: event.formatConfig.paceMinutes * 60_000 },
  };
}
