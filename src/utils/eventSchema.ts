import type {
  Court,
  EventSettings,
  EventState,
  MainRound,
  Match,
  Player,
  Team,
} from '@/types/domain';
import {
  AMERICANO_V2_ALGORITHM_VERSION,
  isValidAmericanoPoints,
  type AmericanoConfigV2,
  type AmericanoEventStateV2,
  type AmericanoMatchV2,
  type AmericanoRoundV2,
  type AmericanoScheduleV2,
  type AmericanoSide,
  type IndividualEntrant,
  type VersionedEventState,
} from '@/logic/americanoV2/types';

export class InvalidEventSchemaError extends Error {
  constructor(message: string, readonly field?: string) {
    super(message);
    this.name = 'InvalidEventSchemaError';
  }
}

export class UnsupportedEventSchemaError extends Error {
  constructor(readonly schemaVersion: number) {
    super(`This event uses unsupported schema version ${schemaVersion}. Update the app to open it.`);
    this.name = 'UnsupportedEventSchemaError';
  }
}

type ObjectValue = Record<string, unknown>;

function objectAt(value: unknown, field: string): ObjectValue {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new InvalidEventSchemaError(`${field} must be an object.`, field);
  }
  return value as ObjectValue;
}

function arrayAt(value: unknown, field: string): unknown[] {
  if (!Array.isArray(value)) throw new InvalidEventSchemaError(`${field} must be an array.`, field);
  return value;
}

function stringAt(value: unknown, field: string, allowEmpty = false): string {
  if (typeof value !== 'string' || (!allowEmpty && value.length === 0)) {
    throw new InvalidEventSchemaError(`${field} must be a string.`, field);
  }
  return value;
}

function finiteAt(value: unknown, field: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new InvalidEventSchemaError(`${field} must be a finite number.`, field);
  }
  return value;
}

function integerAt(value: unknown, field: string): number {
  const number = finiteAt(value, field);
  if (!Number.isInteger(number)) throw new InvalidEventSchemaError(`${field} must be an integer.`, field);
  return number;
}

function booleanAt(value: unknown, field: string): boolean {
  if (typeof value !== 'boolean') throw new InvalidEventSchemaError(`${field} must be a boolean.`, field);
  return value;
}

function optionalString(value: unknown, field: string): void {
  if (value !== undefined && typeof value !== 'string') {
    throw new InvalidEventSchemaError(`${field} must be a string when present.`, field);
  }
}

const EVENT_STATUSES = new Set(['setup', 'qualifier', 'seeding', 'round-in-progress', 'between-rounds', 'complete']);
const TIE_RULES = new Set(['operator-decides', 'team-a-wins', 'split-points', 'replay']);

function validatePlayer(value: unknown, field: string): Player {
  const player = objectAt(value, field);
  stringAt(player.id, `${field}.id`);
  stringAt(player.name, `${field}.name`, true);
  return value as Player;
}

function validateTeam(value: unknown, field: string): Team {
  const team = objectAt(value, field);
  stringAt(team.id, `${field}.id`);
  optionalString(team.name, `${field}.name`);
  const players = arrayAt(team.players, `${field}.players`);
  if (players.length !== 2) throw new InvalidEventSchemaError(`${field}.players must contain two players.`, `${field}.players`);
  validatePlayer(players[0], `${field}.players.0`);
  validatePlayer(players[1], `${field}.players.1`);
  finiteAt(team.createdAt, `${field}.createdAt`);
  booleanAt(team.active, `${field}.active`);
  return value as Team;
}

function validateCourt(value: unknown, field: string): Court {
  const court = objectAt(value, field);
  stringAt(court.id, `${field}.id`);
  stringAt(court.name, `${field}.name`, true);
  integerAt(court.position, `${field}.position`);
  finiteAt(court.pointValue, `${field}.pointValue`);
  return value as Court;
}

function validateSettings(value: unknown, field: string, strict: boolean): EventSettings {
  const settings = objectAt(value, field);
  if (strict || settings.defaultRoundDurationMs !== undefined) finiteAt(settings.defaultRoundDurationMs, `${field}.defaultRoundDurationMs`);
  if ((strict || settings.tieRule !== undefined) && !TIE_RULES.has(String(settings.tieRule))) {
    throw new InvalidEventSchemaError(`${field}.tieRule is unsupported.`, `${field}.tieRule`);
  }
  if (strict || settings.soundOnTimerEnd !== undefined) booleanAt(settings.soundOnTimerEnd, `${field}.soundOnTimerEnd`);
  if (strict || settings.warningAtMs !== undefined) finiteAt(settings.warningAtMs, `${field}.warningAtMs`);
  if (strict || settings.roundsTotal !== undefined) integerAt(settings.roundsTotal, `${field}.roundsTotal`);
  if (strict || settings.announceRoundStart !== undefined) booleanAt(settings.announceRoundStart, `${field}.announceRoundStart`);
  return value as unknown as EventSettings;
}

function validateMatch(value: unknown, field: string): Match {
  const match = objectAt(value, field);
  stringAt(match.id, `${field}.id`);
  stringAt(match.courtId, `${field}.courtId`);
  stringAt(match.teamAId, `${field}.teamAId`);
  stringAt(match.teamBId, `${field}.teamBId`);
  finiteAt(match.scoreA, `${field}.scoreA`);
  finiteAt(match.scoreB, `${field}.scoreB`);
  if (!new Set(['scheduled', 'in-progress', 'completed']).has(String(match.status))) {
    throw new InvalidEventSchemaError(`${field}.status is unsupported.`, `${field}.status`);
  }
  finiteAt(match.pointValueAtTime, `${field}.pointValueAtTime`);
  return value as Match;
}

function validateLegacyRound(value: unknown, field: string): MainRound {
  const round = objectAt(value, field);
  stringAt(round.id, `${field}.id`);
  integerAt(round.index, `${field}.index`);
  finiteAt(round.durationMs, `${field}.durationMs`);
  finiteAt(round.totalPausedMs, `${field}.totalPausedMs`);
  arrayAt(round.matches, `${field}.matches`).forEach((match, index) => validateMatch(match, `${field}.matches.${index}`));
  return value as MainRound;
}

function validateCommon(value: ObjectValue, strictSettings: boolean): void {
  stringAt(value.id, 'event.id');
  stringAt(value.name, 'event.name', true);
  finiteAt(value.createdAt, 'event.createdAt');
  if (!EVENT_STATUSES.has(String(value.status))) {
    throw new InvalidEventSchemaError('event.status is unsupported.', 'event.status');
  }
  validateSettings(value.settings, 'event.settings', strictSettings);
  const courtIds = new Set<string>();
  arrayAt(value.courts, 'event.courts').forEach((court, index) => {
    const parsed = validateCourt(court, `event.courts.${index}`);
    if (courtIds.has(parsed.id)) throw new InvalidEventSchemaError('Court IDs must be unique.', `event.courts.${index}.id`);
    courtIds.add(parsed.id);
  });
}

function validateLegacy(value: ObjectValue): EventState {
  const teamIds = new Set<string>();
  arrayAt(value.teams, 'event.teams').forEach((team, index) => {
    const parsed = validateTeam(team, `event.teams.${index}`);
    if (teamIds.has(parsed.id)) throw new InvalidEventSchemaError('Team IDs must be unique.', `event.teams.${index}.id`);
    teamIds.add(parsed.id);
  });
  arrayAt(value.rounds, 'event.rounds').forEach((round, index) => validateLegacyRound(round, `event.rounds.${index}`));
  if (value.qualifier !== undefined) {
    const qualifier = objectAt(value.qualifier, 'event.qualifier');
    finiteAt(qualifier.durationMs, 'event.qualifier.durationMs');
    finiteAt(qualifier.totalPausedMs, 'event.qualifier.totalPausedMs');
    integerAt(qualifier.shuffleSeed, 'event.qualifier.shuffleSeed');
    arrayAt(qualifier.matches, 'event.qualifier.matches').forEach((match, index) => validateMatch(match, `event.qualifier.matches.${index}`));
  }
  return value as unknown as EventState;
}

function validateConfig(value: unknown): AmericanoConfigV2 {
  const config = objectAt(value, 'event.formatConfig');
  if (config.rulesVersion !== 2) throw new InvalidEventSchemaError('Americano v2 requires rulesVersion 2.', 'event.formatConfig.rulesVersion');
  if (config.pairingMode !== 'rotating' && config.pairingMode !== 'fixed') {
    throw new InvalidEventSchemaError('Pairing mode must be rotating or fixed.', 'event.formatConfig.pairingMode');
  }
  if (!isValidAmericanoPoints(config.pointsPerMatch)) {
    throw new InvalidEventSchemaError('Enter a positive whole number for points per match.', 'event.formatConfig.pointsPerMatch');
  }
  if (config.scheduleKind !== 'full' && config.scheduleKind !== 'balanced' && config.scheduleKind !== 'custom') {
    throw new InvalidEventSchemaError('Schedule kind is unsupported.', 'event.formatConfig.scheduleKind');
  }
  if (![5, 10, 15, 20, 25, 30].includes(Number(config.paceMinutes))) {
    throw new InvalidEventSchemaError('Pace must be 5–30 minutes in five-minute steps.', 'event.formatConfig.paceMinutes');
  }
  booleanAt(config.paceClockEnabled, 'event.formatConfig.paceClockEnabled');
  if (config.scheduleKind === 'custom') {
    const rounds = integerAt(config.customRounds, 'event.formatConfig.customRounds');
    if (rounds < 1 || rounds > 64) throw new InvalidEventSchemaError('Custom rounds must be between 1 and 64.', 'event.formatConfig.customRounds');
  } else if (config.customRounds !== undefined) {
    throw new InvalidEventSchemaError('customRounds is only valid for a custom schedule.', 'event.formatConfig.customRounds');
  }
  return value as AmericanoConfigV2;
}

function validateEntrant(value: unknown, field: string): IndividualEntrant {
  const entrant = objectAt(value, field);
  stringAt(entrant.id, `${field}.id`);
  stringAt(entrant.name, `${field}.name`, true);
  booleanAt(entrant.active, `${field}.active`);
  finiteAt(entrant.createdAt, `${field}.createdAt`);
  optionalString(entrant.signupRegistrationId, `${field}.signupRegistrationId`);
  return value as IndividualEntrant;
}

function validateSide(value: unknown, field: string): AmericanoSide {
  const side = objectAt(value, field);
  if (side.kind !== 'fixed-team' && side.kind !== 'rotating-pair') {
    throw new InvalidEventSchemaError(`${field}.kind is unsupported.`, `${field}.kind`);
  }
  const playerIds = arrayAt(side.playerIds, `${field}.playerIds`);
  if (playerIds.length !== 2 || playerIds.some((id) => typeof id !== 'string' || id.length === 0) || playerIds[0] === playerIds[1]) {
    throw new InvalidEventSchemaError(`${field}.playerIds must contain two distinct IDs.`, `${field}.playerIds`);
  }
  if (side.kind === 'fixed-team') stringAt(side.teamId, `${field}.teamId`);
  else if (side.teamId !== undefined) throw new InvalidEventSchemaError(`${field}.teamId is not valid for a rotating pair.`, `${field}.teamId`);
  return value as AmericanoSide;
}

function validateV2Match(value: unknown, field: string): AmericanoMatchV2 {
  const match = objectAt(value, field);
  stringAt(match.id, `${field}.id`);
  stringAt(match.courtId, `${field}.courtId`);
  validateSide(match.sideA, `${field}.sideA`);
  validateSide(match.sideB, `${field}.sideB`);
  if (match.scoreA !== null) integerAt(match.scoreA, `${field}.scoreA`);
  if (match.scoreB !== null) integerAt(match.scoreB, `${field}.scoreB`);
  booleanAt(match.resultConfirmed, `${field}.resultConfirmed`);
  return value as AmericanoMatchV2;
}

function validateV2Round(value: unknown, field: string): AmericanoRoundV2 {
  const round = objectAt(value, field);
  stringAt(round.id, `${field}.id`);
  integerAt(round.index, `${field}.index`);
  stringAt(round.fixtureRoundId, `${field}.fixtureRoundId`);
  finiteAt(round.durationMs, `${field}.durationMs`);
  finiteAt(round.totalPausedMs, `${field}.totalPausedMs`);
  arrayAt(round.matches, `${field}.matches`).forEach((match, index) => validateV2Match(match, `${field}.matches.${index}`));
  return value as unknown as AmericanoRoundV2;
}

function validateSchedule(value: unknown): AmericanoScheduleV2 {
  const schedule = objectAt(value, 'event.americanoSchedule');
  stringAt(schedule.id, 'event.americanoSchedule.id');
  if (schedule.algorithmVersion !== AMERICANO_V2_ALGORITHM_VERSION) {
    throw new InvalidEventSchemaError('The Americano schedule algorithm is unsupported.', 'event.americanoSchedule.algorithmVersion');
  }
  integerAt(schedule.seed, 'event.americanoSchedule.seed');
  stringAt(schedule.inputFingerprint, 'event.americanoSchedule.inputFingerprint');
  arrayAt(schedule.orderedEntrantIds, 'event.americanoSchedule.orderedEntrantIds').forEach((id, index) => stringAt(id, `event.americanoSchedule.orderedEntrantIds.${index}`));
  arrayAt(schedule.courtIds, 'event.americanoSchedule.courtIds').forEach((id, index) => stringAt(id, `event.americanoSchedule.courtIds.${index}`));
  arrayAt(schedule.rounds, 'event.americanoSchedule.rounds').forEach((roundValue, roundIndex) => {
    const round = objectAt(roundValue, `event.americanoSchedule.rounds.${roundIndex}`);
    stringAt(round.id, `event.americanoSchedule.rounds.${roundIndex}.id`);
    integerAt(round.index, `event.americanoSchedule.rounds.${roundIndex}.index`);
    arrayAt(round.restingEntrantIds, `event.americanoSchedule.rounds.${roundIndex}.restingEntrantIds`);
    arrayAt(round.unusedCourtIds, `event.americanoSchedule.rounds.${roundIndex}.unusedCourtIds`);
    arrayAt(round.matches, `event.americanoSchedule.rounds.${roundIndex}.matches`).forEach((matchValue, matchIndex) => {
      const match = objectAt(matchValue, `event.americanoSchedule.rounds.${roundIndex}.matches.${matchIndex}`);
      stringAt(match.id, `event.americanoSchedule.rounds.${roundIndex}.matches.${matchIndex}.id`);
      stringAt(match.courtId, `event.americanoSchedule.rounds.${roundIndex}.matches.${matchIndex}.courtId`);
      validateSide(match.sideA, `event.americanoSchedule.rounds.${roundIndex}.matches.${matchIndex}.sideA`);
      validateSide(match.sideB, `event.americanoSchedule.rounds.${roundIndex}.matches.${matchIndex}.sideB`);
    });
  });
  objectAt(schedule.metrics, 'event.americanoSchedule.metrics');
  const acknowledgements = objectAt(schedule.acknowledgements, 'event.americanoSchedule.acknowledgements');
  stringAt(acknowledgements.fingerprint, 'event.americanoSchedule.acknowledgements.fingerprint', true);
  booleanAt(acknowledgements.unevenAppearances, 'event.americanoSchedule.acknowledgements.unevenAppearances');
  booleanAt(acknowledgements.repeatedCycle, 'event.americanoSchedule.acknowledgements.repeatedCycle');
  stringAt(schedule.rosterRevision, 'event.americanoSchedule.rosterRevision', true);
  return value as unknown as AmericanoScheduleV2;
}

function validateV2(value: ObjectValue): AmericanoEventStateV2 {
  if (value.protocolVersion !== 2) throw new InvalidEventSchemaError('Schema 2 requires protocolVersion 2.', 'event.protocolVersion');
  stringAt(value.revision, 'event.revision', true);
  if (value.format !== 'americano') throw new InvalidEventSchemaError('Schema 2 is only supported for Americano.', 'event.format');
  const config = validateConfig(value.formatConfig);
  const teams = arrayAt(value.teams, 'event.teams').map((team, index) => validateTeam(team, `event.teams.${index}`));
  const participants = arrayAt(value.participants, 'event.participants').map((entrant, index) => validateEntrant(entrant, `event.participants.${index}`));
  if (config.pairingMode === 'rotating' && teams.length !== 0) {
    throw new InvalidEventSchemaError('Rotating Americano cannot contain fixed teams.', 'event.teams');
  }
  if (config.pairingMode === 'fixed' && participants.length !== 0) {
    throw new InvalidEventSchemaError('Fixed Americano cannot contain individual participants.', 'event.participants');
  }
  arrayAt(value.rounds, 'event.rounds').forEach((round, index) => validateV2Round(round, `event.rounds.${index}`));
  if (value.americanoSchedule !== undefined) validateSchedule(value.americanoSchedule);
  return value as unknown as AmericanoEventStateV2;
}

export function parseEventState(value: unknown): VersionedEventState {
  const event = objectAt(value, 'event');
  const version = event.schemaVersion;
  if (version !== undefined && version !== 1 && version !== 2) {
    if (typeof version === 'number' && Number.isInteger(version) && version > 2) {
      throw new UnsupportedEventSchemaError(version);
    }
    throw new InvalidEventSchemaError('event.schemaVersion must be 1 or 2.', 'event.schemaVersion');
  }
  validateCommon(event, version === 2);
  return version === 2 ? validateV2(event) : validateLegacy(event);
}

export function isLegacyEventState(event: VersionedEventState): event is EventState {
  return event.schemaVersion === undefined || event.schemaVersion === 1;
}
