import { invariant } from './errors';
import { defaultRuleProfiles, RULE_PRESETS } from './presets';
import { assertTournamentDependencyAcyclic, sourceFingerprint, stagePlanningDefaults } from './draws';
import { validateResult, validateRuleProfile } from './scoring';
import { computeGroupStandings } from './standings';
import type {
  FixtureSource,
  TournamentPrivateContacts,
  TournamentPublicProjection,
  TournamentV1,
} from './types';
import {
  TOURNAMENT_DATA_VERSION,
  TOURNAMENT_LIMITS,
  TOURNAMENT_PROJECTION_VERSION,
  TOURNAMENT_PROTOCOL,
} from './types';

const MAX_INT64_DECIMAL = 9_223_372_036_854_775_807n;
const DOMAIN_ID = /^[A-Za-z0-9_-]{1,160}$/;
const ISO_INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/;

export function createTournamentV1(input: { id: string; title: string; now: number; divisionId: string; courtIds: string[] }): TournamentV1 {
  invariant(input.title.trim().length > 0, 'TITLE_REQUIRED', 'Enter a tournament title.', 'title');
  invariant(input.courtIds.length >= 1 && input.courtIds.length <= TOURNAMENT_LIMITS.courts, 'COURT_LIMIT', `Use between 1 and ${TOURNAMENT_LIMITS.courts} courts.`, 'courts');
  return {
    schema: TOURNAMENT_PROTOCOL,
    dataVersion: TOURNAMENT_DATA_VERSION,
    id: input.id,
    revision: '0',
    createdAt: input.now,
    updatedAt: input.now,
    lifecycle: 'setup',
    archivedAt: null,
    meta: { title: input.title.trim(), venue: '', timeZone: 'UTC', startsAt: null, endsAt: null, notes: '', publicSlug: null, signupOpen: false },
    controller: { deviceId: null, epoch: '0', nextSequence: 0 },
    divisions: [{ id: input.divisionId, name: 'Open', capacity: 16, drawPublishedAt: null, automaticPromotion: true }],
    players: [], entries: [], lineupRevisions: [],
    courts: input.courtIds.map((id, index) => ({ id, name: `Court ${index + 1}`, displayOrder: index + 1, available: true, availabilityWindows: null })),
    ruleProfiles: defaultRuleProfiles(), stages: [], groups: [], fixtures: [], qualificationDecisions: [], audit: [],
  };
}

export function cloneTournament<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

export function validateTournament(state: TournamentV1): TournamentV1 {
  invariant(state.schema === TOURNAMENT_PROTOCOL, 'SCHEMA', 'Unsupported tournament schema.', 'schema');
  invariant(state.dataVersion === TOURNAMENT_DATA_VERSION, 'DATA_VERSION', `Tournament data version ${TOURNAMENT_DATA_VERSION} is required.`, 'dataVersion');
  domainId(state.id, 'id');
  invariant(['setup', 'live', 'complete', 'cancelled'].includes(state.lifecycle), 'LIFECYCLE', 'Tournament lifecycle is invalid.', 'lifecycle');
  bigintString(state.revision, 'revision');
  bigintString(state.controller.epoch, 'controller.epoch');
  if (state.controller.deviceId !== null) domainId(state.controller.deviceId, 'controller.deviceId');
  invariant(Number.isSafeInteger(state.controller.nextSequence) && state.controller.nextSequence >= 0, 'COMMAND_SEQUENCE', 'Controller sequence must be a non-negative safe integer.', 'controller.nextSequence');
  epochMillis(state.createdAt, 'createdAt');
  epochMillis(state.updatedAt, 'updatedAt');
  if (state.archivedAt !== null) epochMillis(state.archivedAt, 'archivedAt');
  if (state.meta.startsAt !== null) isoInstant(state.meta.startsAt, 'meta.startsAt');
  if (state.meta.endsAt !== null) isoInstant(state.meta.endsAt, 'meta.endsAt');
  if (state.meta.startsAt !== null && state.meta.endsAt !== null) {
    invariant(Date.parse(state.meta.endsAt) > Date.parse(state.meta.startsAt), 'EVENT_TIME_ORDER', 'Tournament end must be after its start.', 'meta.endsAt');
  }
  try { new Intl.DateTimeFormat('en', { timeZone: state.meta.timeZone }).format(); } catch { invariant(false, 'TIME_ZONE', 'Choose a valid IANA time zone.', 'meta.timeZone'); }
  invariant(state.divisions.length >= 1 && state.divisions.length <= 4, 'DIVISION_LIMIT', 'Use between one and four divisions.', 'divisions');
  invariant(state.courts.length >= 1 && state.courts.length <= TOURNAMENT_LIMITS.courts, 'COURT_LIMIT', `Use between one and ${TOURNAMENT_LIMITS.courts} courts.`, 'courts');
  invariant(state.entries.filter((entry) => entry.admission === 'confirmed').length <= TOURNAMENT_LIMITS.confirmedEntries, 'ENTRY_LIMIT', 'Confirmed-entry limit reached.', 'entries');
  invariant(state.entries.filter((entry) => entry.admission === 'waiting').length <= TOURNAMENT_LIMITS.waitingEntries, 'WAIT_LIMIT', 'Waiting-list limit reached.', 'entries');
  invariant(state.fixtures.filter((fixture) => fixture.status !== 'voided').length <= TOURNAMENT_LIMITS.activeFixtures, 'FIXTURE_LIMIT', 'Active-fixture limit reached.', 'fixtures');
  unique(state.divisions.map((item) => item.id), 'division');
  unique(state.players.map((item) => item.id), 'player');
  unique(state.entries.map((item) => item.id), 'entry');
  unique(state.courts.map((item) => item.id), 'court');
  unique(state.ruleProfiles.map((item) => item.id), 'rule profile');
  unique(state.stages.map((item) => item.id), 'stage');
  unique(state.groups.map((item) => item.id), 'group');
  unique(state.fixtures.map((item) => item.id), 'fixture');
  [
    ...state.divisions.map((item) => item.id),
    ...state.players.map((item) => item.id),
    ...state.entries.map((item) => item.id),
    ...state.lineupRevisions.map((item) => item.id),
    ...state.courts.map((item) => item.id),
    ...state.ruleProfiles.map((item) => item.id),
    ...state.stages.map((item) => item.id),
    ...state.groups.map((item) => item.id),
    ...state.fixtures.map((item) => item.id),
    ...state.qualificationDecisions.map((item) => item.id),
  ].forEach((id) => domainId(id, 'domainId'));
  state.ruleProfiles.forEach(validateRuleProfile);

  const divisions = new Set(state.divisions.map((item) => item.id));
  const players = new Set(state.players.map((item) => item.id));
  const entries = new Set(state.entries.map((item) => item.id));
  const stages = new Set(state.stages.map((item) => item.id));
  const groups = new Set(state.groups.map((item) => item.id));
  const profiles = new Set(state.ruleProfiles.map((item) => item.id));
  const courts = new Set(state.courts.map((item) => item.id));
  state.divisions.forEach((division) => {
    boundedText(division.name, 40, 'division.name');
    if (division.drawPublishedAt !== null) epochMillis(division.drawPublishedAt, 'division.drawPublishedAt');
    const confirmed = state.entries.filter((entry) => entry.divisionId === division.id && entry.admission === 'confirmed').length;
    invariant(Number.isInteger(division.capacity) && division.capacity >= confirmed && division.capacity <= TOURNAMENT_LIMITS.confirmedEntries, 'CAPACITY', 'Division capacity cannot be below confirmed entries.', 'capacity');
  });
  state.players.forEach((player) => boundedText(player.name, 80, 'player.name', true));
  state.entries.forEach((entry) => {
    invariant(divisions.has(entry.divisionId), 'ENTRY_DIVISION', 'Entry division does not exist.');
    invariant(['confirmed', 'waiting', 'cancelled'].includes(entry.admission), 'ENTRY_ADMISSION', 'Entry admission is invalid.', 'entry.admission');
    invariant(['not-checked-in', 'ready', 'late', 'withdrawn'].includes(entry.readiness), 'ENTRY_READINESS', 'Entry readiness is invalid.', 'entry.readiness');
    invariant(entry.playerIds[0] !== entry.playerIds[1] && entry.playerIds.every((id) => players.has(id)), 'ENTRY_PLAYERS', 'Entry must contain two different valid players.');
    boundedText(entry.teamName, 80, 'entry.teamName');
    epochMillis(entry.acceptedAt, 'entry.acceptedAt');
  });
  state.lineupRevisions.forEach((revision) => epochMillis(revision.createdAt, 'lineupRevision.createdAt'));
  state.courts.forEach((court) => {
    boundedText(court.name, 40, 'court.name', true);
    let previousEnd = -Infinity;
    for (const window of court.availabilityWindows ?? []) {
      isoInstant(window.startsAt, 'court.availabilityWindows.startsAt');
      isoInstant(window.endsAt, 'court.availabilityWindows.endsAt');
      const start = Date.parse(window.startsAt); const end = Date.parse(window.endsAt);
      invariant(start < end && start >= previousEnd, 'COURT_WINDOWS', 'Court windows must be positive, ascending and non-overlapping.', 'court.availabilityWindows');
      previousEnd = end;
    }
  });
  state.stages.forEach((stage) => {
    invariant(divisions.has(stage.divisionId), 'STAGE_DIVISION', 'Stage division does not exist.');
    invariant(profiles.has(stage.defaultRuleProfileId), 'STAGE_RULE', 'Stage default rules do not exist.');
    invariant(stage.entryIds.every((id) => entries.has(id)), 'STAGE_ENTRY', 'Stage references an unknown entry.');
    invariant(stage.groupIds.every((id) => groups.has(id)), 'STAGE_GROUP', 'Stage references an unknown group.');
    if (stage.qualificationConfirmedAt !== null) epochMillis(stage.qualificationConfirmedAt, 'stage.qualificationConfirmedAt');
    if (stage.closedAt !== null) epochMillis(stage.closedAt, 'stage.closedAt');
    validateStandingsPolicy(stage.standingsPolicy);
    invariant(['entered', 'seeded', 'shuffle'].includes(stage.seedMode), 'SEED_MODE', 'Stage seed mode is invalid.', 'stage.seedMode');
    invariant(new Set(stage.seedOrder).size === stage.seedOrder.length && stage.seedOrder.every((id) => entries.has(id)), 'SEED_ORDER', 'Stage seed order must contain unique tournament entries.', 'stage.seedOrder');
    if (stage.shuffleSeed !== null) boundedText(stage.shuffleSeed, 160, 'stage.shuffleSeed', true);
    stage.qualificationBands.forEach((band) => {
      domainId(band.id, 'qualificationBand.id');
      boundedText(band.name, 40, 'qualificationBand.name', true);
      invariant(band.positions.length > 0 && new Set(band.positions).size === band.positions.length && band.positions.every((position) => Number.isInteger(position) && position >= 1), 'QUALIFICATION_BAND', 'Qualification band positions must be unique positive integers.');
    });
    stage.qualificationDestinations.forEach((destination) => {
      invariant(groups.has(destination.groupId), 'QUALIFICATION_GROUP', 'Qualification destination group does not exist.');
      invariant(Number.isInteger(destination.position) && destination.position >= 1 && Number.isInteger(destination.slotIndex) && destination.slotIndex >= 0, 'QUALIFICATION_DESTINATION', 'Qualification destination rank is invalid.');
    });
    if (stage.plateSourceStageId !== null) invariant(stages.has(stage.plateSourceStageId), 'PLATE_SOURCE', 'Plate source stage does not exist.');
    stage.plateRulings.forEach((ruling) => {
      invariant(entries.has(ruling.entryId) && (ruling.decision === 'include' || ruling.decision === 'exclude') && ruling.reason.trim().length > 0, 'PLATE_RULING', 'Plate rulings require a valid entry, decision and reason.');
    });
  });
  state.groups.forEach((group) => {
    invariant(stages.has(group.stageId), 'GROUP_STAGE', 'Group stage does not exist.');
    invariant(group.entryIds.every((id) => entries.has(id)), 'GROUP_ENTRY', 'Group references an unknown entry.');
    invariant(group.fixtureIds.every((id) => state.fixtures.some((fixture) => fixture.id === id && fixture.groupId === group.id)), 'GROUP_FIXTURE', 'Group references a fixture outside the group.');
    if (group.qualifierOrder !== null) invariant(group.qualifierOrder.length === group.entryIds.length && new Set(group.qualifierOrder).size === group.entryIds.length && group.qualifierOrder.every((id) => group.entryIds.includes(id)), 'QUALIFIER_ORDER', 'Stored qualifier order must be a full group permutation.');
  });
  state.fixtures.forEach((fixture) => {
    invariant(divisions.has(fixture.divisionId) && stages.has(fixture.stageId), 'FIXTURE_SCOPE', 'Fixture scope is invalid.');
    invariant(!fixture.groupId || groups.has(fixture.groupId), 'FIXTURE_GROUP', 'Fixture group does not exist.');
    invariant(profiles.has(fixture.ruleProfileId), 'FIXTURE_RULE', 'Fixture rules do not exist.');
    invariant(!fixture.courtId || courts.has(fixture.courtId), 'FIXTURE_COURT', 'Fixture court does not exist.');
    invariant(['planned', 'playing', 'suspended', 'completed', 'voided', 'resolved-bye'].includes(fixture.status), 'FIXTURE_STATUS', 'Fixture status is invalid.', 'fixture.status');
    if (fixture.plannedStartAt !== null) isoInstant(fixture.plannedStartAt, 'fixture.plannedStartAt');
    if (fixture.estimatedReleaseAt !== null) isoInstant(fixture.estimatedReleaseAt, 'fixture.estimatedReleaseAt');
    if (fixture.durationOverrideMinutes !== null) invariant(Number.isInteger(fixture.durationOverrideMinutes) && fixture.durationOverrideMinutes >= 1 && fixture.durationOverrideMinutes <= 240, 'DURATION_OVERRIDE', 'Duration override must be from 1 to 240 minutes.');
    if (fixture.restOverrideMinutes !== null) invariant(Number.isInteger(fixture.restOverrideMinutes) && fixture.restOverrideMinutes >= 0 && fixture.restOverrideMinutes <= 240, 'REST_OVERRIDE', 'Rest override must be from 0 to 240 minutes.');
    if (fixture.actualStartAt !== null) epochMillis(fixture.actualStartAt, 'fixture.actualStartAt');
    if (fixture.actualEndAt !== null) epochMillis(fixture.actualEndAt, 'fixture.actualEndAt');
    if (fixture.actualStartAt !== null && fixture.actualEndAt !== null) invariant(fixture.actualEndAt >= fixture.actualStartAt, 'ACTUAL_TIME_ORDER', 'Actual match end cannot precede its start.', 'fixture.actualEndAt');
    validateSource(fixture.sideA, fixture.divisionId, state, entries, groups);
    validateSource(fixture.sideB, fixture.divisionId, state, entries, groups);
    invariant(!(fixture.sideA.kind === 'entry' && fixture.sideB.kind === 'entry' && fixture.sideA.entryId === fixture.sideB.entryId), 'SAME_ENTRY', 'An entry cannot play itself.');
    if (fixture.actualRuleProfile) validateRuleProfile(fixture.actualRuleProfile);
    if (fixture.actualEntryIds) invariant(fixture.actualEntryIds[0] !== fixture.actualEntryIds[1] && fixture.actualEntryIds.every((id) => entries.has(id)), 'ACTUAL_ENTRIES', 'Actual fixture entries must be distinct entries in this tournament.', 'fixture.actualEntryIds');
    if (fixture.actualPlayerIds) invariant(new Set(fixture.actualPlayerIds.flat()).size === 4 && fixture.actualPlayerIds.flat().every((id) => players.has(id)), 'ACTUAL_PLAYERS', 'Actual fixture players must be four distinct tournament players.', 'fixture.actualPlayerIds');
    if (fixture.status === 'planned' || fixture.status === 'resolved-bye') {
      invariant(fixture.actualEntryIds === null && fixture.actualPlayerIds === null && fixture.actualRuleProfile === null && fixture.actualStartAt === null && fixture.actualEndAt === null && fixture.result === null, 'PLANNED_ACTUALS', 'An unstarted fixture cannot contain actual participants, rules, timestamps or a result.', 'fixture');
    }
    if (fixture.status === 'playing' || fixture.status === 'suspended' || fixture.status === 'completed' || fixture.status === 'voided') {
      invariant(fixture.actualRuleProfile !== null, 'ACTUAL_RULES_REQUIRED', 'A started fixture must retain its immutable rule snapshot.', 'fixture.actualRuleProfile');
    }
    if (fixture.result && fixture.actualEntryIds) {
      invariant(Number.isSafeInteger(fixture.result.revision) && fixture.result.revision >= 1, 'RESULT_REVISION', 'Result revision must be a positive safe integer.', 'fixture.result.revision');
      epochMillis(fixture.result.confirmedAt, 'fixture.result.confirmedAt');
      const profile = fixture.actualRuleProfile ?? state.ruleProfiles.find((item) => item.id === fixture.ruleProfileId)!;
      validateResult(fixture.result, profile, fixture.actualEntryIds[0], fixture.actualEntryIds[1]);
    }
  });
  state.qualificationDecisions.forEach((decision) => {
    epochMillis(decision.createdAt, 'qualificationDecision.createdAt');
    invariant(stages.has(decision.stageId), 'QUALIFICATION_STAGE', 'Qualification decision stage does not exist.');
    validateStandingsPolicy(decision.policy);
    decision.plateRulings.forEach((ruling) => invariant(entries.has(ruling.entryId) && ruling.reason.trim().length > 0, 'PLATE_RULING', 'Qualification plate ruling is invalid.'));
  });
  state.audit.forEach((entry) => {
    epochMillis(entry.at, 'audit.at');
    bigintString(entry.resultingRevision, 'audit.resultingRevision');
  });
  assertTournamentDependencyAcyclic(state.fixtures, state.groups);
  validateActiveResources(state);
  return state;
}

function validateActiveResources(state: TournamentV1): void {
  const active = state.fixtures.filter((fixture) => fixture.status === 'playing' || fixture.status === 'suspended');
  const occupiedCourts = new Set<string>();
  const playingPlayers = new Set<string>();
  for (const fixture of active) {
    if (fixture.courtId) {
      invariant(!occupiedCourts.has(fixture.courtId), 'COURT_OCCUPIED', 'A court cannot host two active matches.');
      occupiedCourts.add(fixture.courtId);
    }
    for (const playerId of fixture.actualPlayerIds?.flat() ?? []) {
      invariant(!playingPlayers.has(playerId), 'PLAYER_OCCUPIED', 'A player cannot be active in two matches.');
      playingPlayers.add(playerId);
    }
  }
}

function validateSource(source: FixtureSource, divisionId: string, state: TournamentV1, entries: Set<string>, groups: Set<string>): void {
  if (source.kind === 'entry') {
    invariant(entries.has(source.entryId), 'SOURCE_ENTRY', 'Fixture source entry does not exist.');
    invariant(state.entries.find((entry) => entry.id === source.entryId)?.divisionId === divisionId, 'SOURCE_DIVISION', 'Fixture entry belongs to another division.');
  }
  if (source.kind === 'group-position') {
    invariant(groups.has(source.groupId) && source.position >= 1 && Number.isInteger(source.position), 'SOURCE_GROUP', 'Fixture group-position source is invalid.');
    const group = state.groups.find((item) => item.id === source.groupId);
    const stage = state.stages.find((item) => item.id === group?.stageId);
    invariant(stage?.divisionId === divisionId, 'SOURCE_DIVISION', 'Fixture group belongs to another division.');
  }
  if (source.kind === 'winner-of-match' || source.kind === 'loser-of-match') {
    const upstream = state.fixtures.find((item) => item.id === source.fixtureId);
    invariant(upstream, 'SOURCE_FIXTURE', 'Fixture source match does not exist.');
    invariant(upstream.divisionId === divisionId, 'SOURCE_DIVISION', 'Fixture source match belongs to another division.');
  }
}

export function resolveFixtureSources(state: TournamentV1): TournamentV1 {
  const next = cloneTournament(state);
  let changed = true;
  let passes = 0;
  while (changed && passes <= next.fixtures.length + 1) {
    changed = false;
    passes += 1;
    for (const fixture of next.fixtures) {
      const a = resolveSource(next, fixture.sideA);
      const b = resolveSource(next, fixture.sideB);
      if (fixture.status === 'planned' || fixture.status === 'resolved-bye') {
        if (a !== fixture.resolvedEntryAId || b !== fixture.resolvedEntryBId) {
          fixture.resolvedEntryAId = a;
          fixture.resolvedEntryBId = b;
          fixture.liveScore = null;
          changed = true;
        }
        const aBye = fixture.sideA.kind === 'bye' || sourceSettledEmpty(next, fixture.sideA);
        const bBye = fixture.sideB.kind === 'bye' || sourceSettledEmpty(next, fixture.sideB);
        const resolvedBye = Boolean((a && bBye) || (b && aBye) || aBye && bBye);
        const resolvedStatus = resolvedBye ? 'resolved-bye' : 'planned';
        if (fixture.status !== resolvedStatus) {
          fixture.status = resolvedStatus;
          changed = true;
        }
      }
      fixture.sourceFingerprint = sourceFingerprint(fixture.sideA, fixture.sideB);
    }
  }
  return next;
}

function resolveSource(state: TournamentV1, source: FixtureSource): string | null {
  if (source.kind === 'entry') return source.entryId;
  if (source.kind === 'bye') return null;
  if (source.kind === 'group-position') {
    const group = state.groups.find((item) => item.id === source.groupId);
    return group?.qualifierOrder?.[source.position - 1] ?? null;
  }
  const upstream = state.fixtures.find((item) => item.id === source.fixtureId);
  if (!upstream) return null;
  if (upstream.status === 'resolved-bye') {
    if (source.kind === 'loser-of-match') return null;
    return upstream.resolvedEntryAId ?? upstream.resolvedEntryBId;
  }
  if (upstream.status !== 'completed' || !upstream.result || !upstream.actualEntryIds) return null;
  if (source.kind === 'winner-of-match') return upstream.result.winnerEntryId;
  return upstream.actualEntryIds.find((id) => id !== upstream.result!.winnerEntryId) ?? null;
}

function sourceSettledEmpty(state: TournamentV1, source: FixtureSource): boolean {
  if (source.kind === 'bye') return true;
  if (source.kind === 'group-position') {
    const group = state.groups.find((item) => item.id === source.groupId);
    return Boolean(group?.qualifierOrder && !group.qualifierOrder[source.position - 1]);
  }
  if (source.kind === 'winner-of-match' || source.kind === 'loser-of-match') {
    const upstream = state.fixtures.find((item) => item.id === source.fixtureId);
    return upstream?.status === 'resolved-bye' && !resolveSource(state, source);
  }
  return false;
}

export function entryLabel(state: TournamentV1, entryId: string): string {
  const entry = state.entries.find((item) => item.id === entryId);
  if (!entry) return 'Unknown entry';
  if (entry.teamName.trim()) return entry.teamName.trim();
  const names = entry.playerIds.map((id) => state.players.find((player) => player.id === id)?.name ?? 'Unknown');
  return names.join(' & ');
}

export function publicProjection(state: TournamentV1): TournamentPublicProjection {
  const names = (playerIds: [string,string] | null): [string,string] | null => playerIds ? playerIds.map((id) => state.players.find((player) => player.id === id)?.name ?? 'Unknown') as [string,string] : null;
  const entryPlayers = (entryId: string | null): [string,string] | null => {
    const entry = state.entries.find((item) => item.id === entryId);
    return entry ? names(entry.playerIds) : null;
  };
  return {
    protocol: TOURNAMENT_PROTOCOL,
    projectionVersion: TOURNAMENT_PROJECTION_VERSION,
    tournamentId: state.id,
    publicSlug: state.meta.publicSlug ?? '',
    revision: state.revision,
    lifecycle: state.lifecycle,
    title: state.meta.title,
    venue: state.meta.venue,
    timeZone: state.meta.timeZone,
    startsAt: state.meta.startsAt,
    endsAt: state.meta.endsAt,
    signupOpen: state.meta.signupOpen && state.lifecycle === 'setup',
    divisions: state.divisions.map((division) => ({
      id: division.id, name: division.name, capacity: division.capacity,
      confirmed: state.entries.filter((entry) => entry.divisionId === division.id && entry.admission === 'confirmed').length,
      waiting: state.entries.filter((entry) => entry.divisionId === division.id && entry.admission === 'waiting').length,
    })),
    entries: state.entries.filter((entry) => entry.admission !== 'cancelled').map((entry) => ({
      id: entry.id, divisionId: entry.divisionId, label: entryLabel(state, entry.id),
      players: entry.playerIds.map((id) => state.players.find((player) => player.id === id)?.name ?? 'Unknown') as [string, string],
      admission: entry.admission,
    })),
    courts: state.courts.map(({ id, name, available }) => ({ id, name, available })),
    fixtures: state.fixtures.filter((fixture) => fixture.status !== 'voided').map((fixture) => ({
      id: fixture.id, divisionId: fixture.divisionId, stageId: fixture.stageId, label: fixture.label,
      entryA: fixture.resolvedEntryAId ? entryLabel(state, fixture.resolvedEntryAId) : null,
      entryB: fixture.resolvedEntryBId ? entryLabel(state, fixture.resolvedEntryBId) : null,
      playersA: fixture.actualPlayerIds ? names(fixture.actualPlayerIds[0]) : entryPlayers(fixture.resolvedEntryAId),
      playersB: fixture.actualPlayerIds ? names(fixture.actualPlayerIds[1]) : entryPlayers(fixture.resolvedEntryBId),
      courtId: fixture.courtId, status: fixture.status, liveScore: fixture.liveScore,
      result: fixture.result ? {
        kind: fixture.result.kind,
        winnerLabel: entryLabel(state, fixture.result.winnerEntryId),
        score: fixture.result.score,
        reportedScore: fixture.result.reportedScore ?? null,
        confirmedAt: fixture.result.confirmedAt,
        retrospective: fixture.result.retrospective,
      } : null,
      queueOrder: fixture.queueOrder, plannedStartAt: fixture.plannedStartAt,
      actualStartAt: fixture.actualStartAt, actualEndAt: fixture.actualEndAt,
      estimatedReleaseAt: fixture.estimatedReleaseAt,
    })),
    stages: state.stages.map(({ id, divisionId, name, kind, order }) => ({ id, divisionId, name, kind, order })),
    standings: state.groups.map((group) => ({
      groupId: group.id, stageId: group.stageId, name: group.name,
      rows: computeGroupStandings(state,group.id).rows.map((row) => ({
        position: row.position, label: entryLabel(state,row.entryId), players: entryPlayers(row.entryId) ?? ['Unknown','Unknown'],
        played: row.played, wins: row.wins, losses: row.losses, matchPoints: row.matchPoints,
        gamesFor: row.gamesFor, gamesAgainst: row.gamesAgainst, tied: row.tied,
      })),
    })),
    updatedAt: state.updatedAt,
  };
}

export function activeLineup(state: TournamentV1, entryId: string, fixtureId: string): [string, string] {
  const entry = state.entries.find((item) => item.id === entryId);
  invariant(entry, 'ENTRY_NOT_FOUND', 'Entry not found.');
  const matching = state.lineupRevisions.filter((item) => item.entryId === entryId && item.effectiveFixtureIds.includes(fixtureId)).at(-1);
  return matching?.playerIds ?? entry.playerIds;
}

export function normalizedPairKey(playerA: string, playerB: string): string {
  return [normalizeName(playerA), normalizeName(playerB)].sort().join('|');
}

export function normalizeName(value: string): string {
  return value.trim().replace(/\s+/g, ' ').toLocaleLowerCase('en');
}

export function validateContactMap(state: TournamentV1, contacts: TournamentPrivateContacts): void {
  Object.entries(contacts).forEach(([entryId, contact]) => {
    invariant(state.entries.some((entry) => entry.id === entryId), 'CONTACT_ENTRY', 'Contact entry does not exist.');
    boundedText(contact, 100, 'contact');
  });
}

function boundedText(value: string, max: number, field: string, required = false): void {
  invariant(typeof value === 'string' && value.trim().length <= max && (!required || value.trim().length > 0), 'TEXT_LENGTH', `${field} must be ${required ? 'between 1 and' : 'at most'} ${max} characters.`, field);
}

function bigintString(value: string, field: string): void {
  invariant(/^(?:0|[1-9]\d*)$/.test(value), 'BIGINT', `${field} must be a canonical non-negative decimal string.`, field);
  invariant(BigInt(value) <= MAX_INT64_DECIMAL, 'BIGINT_RANGE', `${field} exceeds signed bigint range.`, field);
}

function domainId(value: string, field: string): void {
  invariant(typeof value === 'string' && DOMAIN_ID.test(value), 'DOMAIN_ID', `${field} must contain only letters, numbers, underscore or hyphen and be at most 160 characters.`, field);
}

function epochMillis(value: number, field: string): void {
  invariant(Number.isSafeInteger(value) && value >= 0, 'EPOCH_MILLIS', `${field} must be a non-negative safe epoch-millisecond integer.`, field);
}

function isoInstant(value: string, field: string): void {
  invariant(typeof value === 'string' && ISO_INSTANT.test(value) && Number.isFinite(Date.parse(value)), 'ISO_INSTANT', `${field} must be an ISO-8601 instant with Z or an explicit offset.`, field);
}

function unique(values: string[], label: string): void {
  invariant(new Set(values).size === values.length, 'DUPLICATE_ID', `Duplicate ${label} ID.`, label);
}

function validateStandingsPolicy(policy: TournamentV1['stages'][number]['standingsPolicy']): void {
  invariant(Number.isInteger(policy.winPoints) && policy.winPoints >= 0 && policy.winPoints <= 10, 'STANDINGS_WIN_POINTS', 'Win points must be from 0 to 10.', 'standingsPolicy.winPoints');
  invariant(Number.isInteger(policy.lossPoints) && policy.lossPoints >= 0 && policy.lossPoints <= 10 && policy.winPoints > policy.lossPoints, 'STANDINGS_LOSS_POINTS', 'Loss points must be from 0 to 10 and below win points.', 'standingsPolicy.lossPoints');
  invariant(typeof policy.includeSetDifference === 'boolean', 'STANDINGS_SET_DIFFERENCE', 'Set-difference setting must be boolean.', 'standingsPolicy.includeSetDifference');
  if (policy.explicitOrder) invariant(new Set(policy.explicitOrder).size === policy.explicitOrder.length, 'STANDINGS_EXPLICIT_ORDER', 'Explicit tied order cannot contain duplicates.');
}

export function defaultGroupRuleId(): string { return RULE_PRESETS.firstToFive.id; }
export function defaultKnockoutRuleId(): string { return RULE_PRESETS.standardSet.id; }
export function defaultFinalRuleId(): string { return RULE_PRESETS.bestOfThree.id; }

/**
 * Upcasts a stored v1 snapshot without changing historic rule profiles or
 * results. Invalid originals are rejected so their bytes can be quarantined
 * and exported by the repository layer.
 */
export function upgradeTournamentV1(value: unknown): TournamentV1 {
  invariant(Boolean(value) && typeof value === 'object' && !Array.isArray(value), 'STATE_OBJECT', 'Tournament data must be an object.');
  const next = cloneTournament(value as Record<string, unknown>) as unknown as TournamentV1 & { dataVersion?: number };
  invariant(next.schema === TOURNAMENT_PROTOCOL, 'SCHEMA', 'Unsupported tournament schema.', 'schema');
  const sourceVersion = next.dataVersion ?? 1;
  invariant(Number.isInteger(sourceVersion) && sourceVersion >= 1 && sourceVersion <= TOURNAMENT_DATA_VERSION, 'DATA_VERSION', 'This tournament was created by a newer unsupported version.', 'dataVersion');
  if (sourceVersion < 2) {
    next.courts.forEach((court) => { court.availabilityWindows ??= null; });
    next.stages.forEach((stage) => Object.assign(stage, {
      ...stagePlanningDefaults(),
      standingsPolicy: stage.standingsPolicy ?? stagePlanningDefaults().standingsPolicy,
      seedMode: stage.seedMode ?? 'entered',
      seedOrder: stage.seedOrder ?? [...stage.entryIds],
      shuffleSeed: stage.shuffleSeed ?? null,
      qualificationBands: stage.qualificationBands ?? [],
      qualificationDestinations: stage.qualificationDestinations ?? [],
      plateSourceStageId: stage.plateSourceStageId ?? null,
      plateDependencyFingerprint: stage.plateDependencyFingerprint ?? null,
      plateRulings: stage.plateRulings ?? [],
    }));
    next.qualificationDecisions.forEach((decision) => Object.assign(decision, {
      policy: decision.policy ?? { winPoints: 2, lossPoints: 0, includeSetDifference: false },
      destinationRanks: decision.destinationRanks ?? [],
      plateRulings: decision.plateRulings ?? [],
    }));
    next.fixtures.forEach((fixture) => {
      fixture.durationOverrideMinutes ??= null;
      fixture.restOverrideMinutes ??= null;
      fixture.estimatedReleaseAt ??= null;
      if (fixture.actualRuleProfile === undefined) {
        const profile = next.ruleProfiles.find((candidate) => candidate.id === fixture.ruleProfileId);
        fixture.actualRuleProfile = fixture.status === 'playing' || fixture.status === 'suspended' || fixture.status === 'completed' || fixture.status === 'voided'
          ? cloneTournament(profile ?? null)
          : null;
      }
    });
    next.dataVersion = TOURNAMENT_DATA_VERSION;
  }
  return validateTournament(next);
}
