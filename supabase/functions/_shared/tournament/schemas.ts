import { invariant } from './errors';
import {
  TOURNAMENT_CONTRACT_VERSION,
  TOURNAMENT_PROTOCOL,
  type TournamentCommandEnvelope,
  type TournamentCommandKind,
} from './types';
import { validateDecimal, validateDomainId, validateEpochMillis, validateIsoInstant, validateUuid } from './protocol';

const commandKinds: readonly TournamentCommandKind[] = [
  'update-metadata', 'add-division', 'update-division', 'remove-division', 'update-capacity',
  'add-entry', 'add-late-entry', 'add-entries', 'edit-entry', 'set-entry-contact', 'cancel-entry', 'promote-entry',
  'reorder-waiting', 'set-readiness', 'add-court', 'update-court', 'set-court-availability', 'apply-court-closure',
  'add-rule-profile', 'add-stage', 'replace-stage-draw', 'publish-draw', 'add-manual-fixture',
  'apply-draw-proposal', 'apply-draw-bundle',
  'apply-group-amendment',
  'assign-fixture', 'apply-schedule', 'reorder-fixtures', 'assign-rule-profile', 'swap-fixture-sides', 'start-match',
  'publish-progress', 'set-match-estimate', 'suspend-match', 'release-court', 'resume-match', 'confirm-result',
  'record-result', 'confirm-qualifiers', 'correct-result', 'substitute-player', 'void-match',
  'begin-event', 'complete-event', 'reopen-event', 'cancel-event', 'archive-event', 'undo-command',
] as const;

const payloadKeys: Record<TournamentCommandKind, readonly string[]> = {
  'update-metadata': ['patch'],
  'add-division': ['division'],
  'update-division': ['divisionId', 'name'],
  'remove-division': ['divisionId'],
  'update-capacity': ['divisionId', 'capacity'],
  'add-entry': ['divisionId', 'teamName', 'playerNames', 'ids', 'allowDuplicate', 'existingPlayerIds'],
  'add-late-entry': ['divisionId', 'teamName', 'playerNames', 'ids', 'allowDuplicate', 'existingPlayerIds'],
  'add-entries': ['entries'],
  'edit-entry': ['entryId', 'teamName', 'playerNames'],
  'set-entry-contact': ['entryId', 'action'],
  'cancel-entry': ['entryId'],
  'promote-entry': ['entryId'],
  'reorder-waiting': ['divisionId', 'entryIds'],
  'set-readiness': ['entryId', 'readiness'],
  'add-court': ['court'],
  'update-court': ['courtId', 'name', 'displayOrder', 'availabilityWindows'],
  'set-court-availability': ['courtId', 'available'],
  'apply-court-closure': ['proposal'],
  'add-rule-profile': ['profile'],
  'add-stage': ['stage'],
  'apply-draw-proposal': ['proposal'],
  'apply-draw-bundle': ['proposals'],
  'apply-group-amendment': ['proposal'],
  'replace-stage-draw': ['stageId', 'includePinned', 'groups', 'fixtures', 'entryIds'],
  'publish-draw': ['divisionId'],
  'add-manual-fixture': ['fixture'],
  'assign-fixture': ['fixtureId', 'courtId', 'plannedStartAt', 'queueOrder', 'pinned', 'durationOverrideMinutes', 'restOverrideMinutes', 'estimatedReleaseAt'],
  'apply-schedule': ['proposal', 'includePinned'],
  'reorder-fixtures': ['fixtureIds'],
  'assign-rule-profile': ['fixtureIds', 'ruleProfileId'],
  'swap-fixture-sides': ['fixtureId'],
  'start-match': ['fixtureId', 'courtId', 'acknowledgeRest'],
  'publish-progress': ['fixtureId', 'score'],
  'set-match-estimate': ['fixtureId', 'estimatedReleaseAt'],
  'suspend-match': ['fixtureId'],
  'release-court': ['fixtureId'],
  'resume-match': ['fixtureId', 'courtId', 'acknowledgeRest'],
  'confirm-result': ['fixtureId', 'result'],
  'record-result': ['fixtureId', 'result'],
  'confirm-qualifiers': ['stageId', 'policy', 'manual', 'reason', 'orderedByGroup', 'decisionId', 'destinationRanks', 'plateRulings'],
  'correct-result': ['fixtureId', 'result', 'preview', 'resolutions', 'reconfirmations'],
  'substitute-player': ['entryId', 'outgoingPlayerId', 'incomingPlayer', 'fixtureIds', 'lineupRevisionId', 'reason'],
  'void-match': ['fixtureId'],
  'begin-event': [],
  'complete-event': [],
  'reopen-event': [],
  'cancel-event': [],
  'archive-event': ['archived'],
  'undo-command': ['commandId'],
};

const requiredPayloadKeys: Partial<Record<TournamentCommandKind, readonly string[]>> = {
  'update-metadata': ['patch'], 'add-division': ['division'], 'update-division': ['divisionId'],
  'remove-division': ['divisionId'], 'update-capacity': ['divisionId', 'capacity'],
  'add-entry': ['divisionId', 'teamName', 'playerNames', 'ids'],
  'add-late-entry': ['divisionId', 'teamName', 'playerNames', 'ids'], 'add-entries': ['entries'],
  'edit-entry': ['entryId'], 'set-entry-contact': ['entryId', 'action'], 'cancel-entry': ['entryId'], 'promote-entry': ['entryId'],
  'reorder-waiting': ['divisionId', 'entryIds'], 'set-readiness': ['entryId', 'readiness'],
  'add-court': ['court'], 'update-court': ['courtId'],
  'set-court-availability': ['courtId', 'available'], 'apply-court-closure': ['proposal'], 'add-rule-profile': ['profile'],
  'add-stage': ['stage'], 'replace-stage-draw': ['stageId', 'fixtures'], 'publish-draw': ['divisionId'],
  'apply-draw-proposal': ['proposal'],
  'apply-draw-bundle': ['proposals'],
  'apply-group-amendment': ['proposal'],
  'add-manual-fixture': ['fixture'], 'assign-fixture': ['fixtureId'],
  'apply-schedule': ['proposal'], 'reorder-fixtures': ['fixtureIds'], 'assign-rule-profile': ['fixtureIds', 'ruleProfileId'],
  'swap-fixture-sides': ['fixtureId'], 'start-match': ['fixtureId'],
  'publish-progress': ['fixtureId', 'score'], 'set-match-estimate': ['fixtureId', 'estimatedReleaseAt'], 'suspend-match': ['fixtureId'],
  'release-court': ['fixtureId'], 'resume-match': ['fixtureId', 'courtId'],
  'confirm-result': ['fixtureId', 'result'], 'record-result': ['fixtureId', 'result'],
  'confirm-qualifiers': ['stageId', 'policy', 'manual', 'orderedByGroup', 'decisionId'],
  'correct-result': ['fixtureId', 'result', 'preview', 'resolutions'],
  'substitute-player': ['entryId', 'outgoingPlayerId', 'incomingPlayer', 'fixtureIds', 'lineupRevisionId', 'reason'],
  'void-match': ['fixtureId'], 'archive-event': ['archived'], 'undo-command': ['commandId'],
};

export function parseTournamentCommandEnvelope(value: unknown): TournamentCommandEnvelope {
  const command = validateTournamentCommandEnvelope(value, { requireUuidKeys: true });
  return command;
}

export function validateTournamentCommandEnvelope(
  value: unknown,
  options: { requireUuidKeys?: boolean } = {},
): TournamentCommandEnvelope {
  const command = object(value, 'command');
  exact(command, ['protocol', 'contractVersion', 'tournamentId', 'commandId', 'baseRevision', 'controllerEpoch', 'deviceId', 'sequence', 'kind', 'payload', 'reason', 'issuedAt'], 'command');
  invariant(command.protocol === TOURNAMENT_PROTOCOL, 'PROTOCOL', 'Unsupported tournament protocol.', 'protocol');
  invariant(command.contractVersion === TOURNAMENT_CONTRACT_VERSION, 'CONTRACT_VERSION', `Tournament contract version ${TOURNAMENT_CONTRACT_VERSION} is required.`, 'contractVersion');
  if (options.requireUuidKeys) {
    validateUuid(command.tournamentId, 'tournamentId');
    validateUuid(command.commandId, 'commandId');
  } else {
    validateDomainId(command.tournamentId, 'tournamentId');
    validateDomainId(command.commandId, 'commandId');
  }
  validateDecimal(command.baseRevision, 'baseRevision');
  validateDecimal(command.controllerEpoch, 'controllerEpoch');
  validateDomainId(command.deviceId, 'deviceId');
  invariant(Number.isSafeInteger(command.sequence) && Number(command.sequence) >= 0, 'COMMAND_SEQUENCE', 'Command sequence must be a non-negative safe integer.', 'sequence');
  invariant(typeof command.kind === 'string' && commandKinds.includes(command.kind as TournamentCommandKind), 'COMMAND_KIND', 'Unsupported tournament command.', 'kind');
  validateEpochMillis(command.issuedAt, 'issuedAt');
  invariant(command.reason === undefined || typeof command.reason === 'string' && command.reason.length <= 500, 'REASON_LENGTH', 'Reason must be at most 500 characters.', 'reason');
  validatePayload(command.kind as TournamentCommandKind, command.payload);
  return command as unknown as TournamentCommandEnvelope;
}

function validatePayload(kind: TournamentCommandKind, value: unknown): void {
  const payload = object(value, 'payload');
  exact(payload, payloadKeys[kind], 'payload');
  for (const key of requiredPayloadKeys[kind] ?? []) invariant(key in payload, 'PAYLOAD_REQUIRED', `payload.${key} is required.`, `payload.${key}`);
  for (const key of ['divisionId', 'entryId', 'courtId', 'stageId', 'fixtureId', 'ruleProfileId', 'outgoingPlayerId', 'lineupRevisionId', 'decisionId', 'commandId']) {
    if (payload[key] !== undefined && payload[key] !== null) validateDomainId(payload[key], `payload.${key}`);
  }
  for (const key of ['entryIds', 'fixtureIds']) if (payload[key] !== undefined) validateIdArray(payload[key], `payload.${key}`);
  if (payload.playerNames !== undefined) stringPair(payload.playerNames, 'payload.playerNames');
  if (kind === 'set-entry-contact') invariant(payload.action === 'set' || payload.action === 'clear', 'CONTACT_ACTION', 'Contact action must be set or clear.', 'payload.action');
  if (payload.readiness !== undefined) invariant(['not-checked-in', 'ready', 'late', 'withdrawn'].includes(String(payload.readiness)), 'READINESS', 'Unsupported readiness.', 'payload.readiness');
  if (payload.plannedStartAt !== undefined && payload.plannedStartAt !== null) validateIsoInstant(payload.plannedStartAt, 'payload.plannedStartAt');
  if (payload.score !== undefined) validateScore(payload.score, 'payload.score');
  if (payload.result !== undefined) validateResultShape(payload.result, 'payload.result');
  if (payload.profile !== undefined) validateRuleProfileShape(payload.profile, 'payload.profile');
  if (payload.stage !== undefined) validateStageShape(payload.stage, 'payload.stage');
  if (payload.proposal !== undefined) {
    const proposal = object(payload.proposal, 'payload.proposal');
    const proposalKeys = 'stage' in proposal
      ? ['contractVersion', 'baseRevision', 'fingerprint', 'stage', 'groups', 'fixtures']
      : 'entryId' in proposal && 'groupId' in proposal
        ? ['contractVersion', 'baseRevision', 'fingerprint', 'stageId', 'groupId', 'entryId', 'fixtures']
      : 'suggestions' in proposal
        ? ['contractVersion', 'baseRevision', 'fingerprint', 'suggestions']
        : ['contractVersion', 'baseRevision', 'fingerprint', 'courtId', 'actions'];
    exact(proposal, proposalKeys, 'payload.proposal');
    validateDecimal(proposal.baseRevision, 'payload.proposal.baseRevision');
    if ('stage' in proposal) {
      validateStageShape(proposal.stage, 'payload.proposal.stage');
      validateObjectArray(proposal.groups, 'payload.proposal.groups', ['id', 'stageId', 'name', 'entryIds', 'fixtureIds', 'qualifierOrder']);
      invariant(Array.isArray(proposal.fixtures), 'PAYLOAD_TYPE', 'payload.proposal.fixtures must be an array.');
      proposal.fixtures.forEach((fixture, index) => validateFixtureShape(fixture, `payload.proposal.fixtures.${index}`));
    }
    if ('entryId' in proposal && 'groupId' in proposal) {
      validateDomainId(proposal.stageId, 'payload.proposal.stageId');
      validateDomainId(proposal.groupId, 'payload.proposal.groupId');
      validateDomainId(proposal.entryId, 'payload.proposal.entryId');
      invariant(Array.isArray(proposal.fixtures), 'PAYLOAD_TYPE', 'payload.proposal.fixtures must be an array.');
      proposal.fixtures.forEach((fixture, index) => validateFixtureShape(fixture, `payload.proposal.fixtures.${index}`));
    }
    if ('suggestions' in proposal) validateObjectArray(proposal.suggestions, 'payload.proposal.suggestions', ['fixtureId', 'courtId', 'plannedStartAt', 'plannedEndAt', 'reason', 'provisional']);
    if ('actions' in proposal) validateObjectArray(proposal.actions, 'payload.proposal.actions', ['fixtureId', 'action', 'targetCourtId', 'reason']);
  }
  if (payload.fixture !== undefined) validateFixtureShape(payload.fixture, 'payload.fixture');
  if (payload.division !== undefined) exact(object(payload.division, 'payload.division'), ['id', 'name', 'capacity', 'drawPublishedAt', 'automaticPromotion'], 'payload.division');
  if (payload.court !== undefined) exact(object(payload.court, 'payload.court'), ['id', 'name', 'displayOrder', 'available', 'availabilityWindows'], 'payload.court');
  if (payload.patch !== undefined) exact(object(payload.patch, 'payload.patch'), ['title', 'venue', 'timeZone', 'startsAt', 'endsAt', 'notes', 'publicSlug', 'signupOpen'], 'payload.patch');
  if (payload.ids !== undefined) validateEntryIds(payload.ids, 'payload.ids');
  if (payload.entries !== undefined) {
    invariant(Array.isArray(payload.entries), 'PAYLOAD_TYPE', 'payload.entries must be an array.', 'payload.entries');
    payload.entries.forEach((entry, index) => validateEntryIntent(entry, `payload.entries.${index}`));
  }
  if (payload.groups !== undefined) validateObjectArray(payload.groups, 'payload.groups', ['id', 'stageId', 'name', 'entryIds', 'fixtureIds', 'qualifierOrder']);
  if (payload.fixtures !== undefined) {
    invariant(Array.isArray(payload.fixtures), 'PAYLOAD_TYPE', 'payload.fixtures must be an array.', 'payload.fixtures');
    payload.fixtures.forEach((fixture, index) => validateFixtureShape(fixture, `payload.fixtures.${index}`));
  }
  if (payload.suggestions !== undefined) validateObjectArray(payload.suggestions, 'payload.suggestions', ['fixtureId', 'courtId', 'plannedStartAt', 'plannedEndAt', 'reason', 'provisional']);
  if (payload.incomingPlayer !== undefined) exact(object(payload.incomingPlayer, 'payload.incomingPlayer'), ['id', 'name'], 'payload.incomingPlayer');
  if (payload.policy !== undefined) exact(object(payload.policy, 'payload.policy'), ['winPoints', 'lossPoints', 'includeSetDifference'], 'payload.policy');
  if (payload.preview !== undefined) exact(object(payload.preview, 'payload.preview'), ['baseRevision', 'correctedFixtureId', 'impacts', 'invalidatedStageIds', 'requiredResolutionFixtureIds', 'clearFixtureDraftIds', 'scheduleReviewFixtureIds', 'fingerprint'], 'payload.preview');
  if (payload.resolutions !== undefined) validateObjectArray(payload.resolutions, 'payload.resolutions', ['fixtureId', 'action', 'reason', 'replacementFixtureId']);
  if (payload.reconfirmations !== undefined) validateObjectArray(payload.reconfirmations, 'payload.reconfirmations', ['stageId', 'orderedByGroup', 'policy', 'reason']);
}

function validateEntryIntent(value: unknown, field: string): void {
  const entry = object(value, field);
  exact(entry, ['divisionId', 'teamName', 'playerNames', 'ids', 'allowDuplicate'], field);
  validateDomainId(entry.divisionId, `${field}.divisionId`);
  stringPair(entry.playerNames, `${field}.playerNames`);
  validateEntryIds(entry.ids, `${field}.ids`);
}

function validateEntryIds(value: unknown, field: string): void {
  const ids = object(value, field);
  exact(ids, ['entryId', 'playerIds', 'lineupRevisionId'], field);
  validateDomainId(ids.entryId, `${field}.entryId`);
  validateDomainId(ids.lineupRevisionId, `${field}.lineupRevisionId`);
  idPair(ids.playerIds, `${field}.playerIds`);
}

function validateScore(value: unknown, field: string): void {
  const score = object(value, field);
  exact(score, ['sets'], field);
  invariant(Array.isArray(score.sets) && score.sets.length > 0 && score.sets.length <= 3, 'SCORE_SHAPE', `${field}.sets must contain one to three rows.`, `${field}.sets`);
  score.sets.forEach((row, index) => {
    const set = object(row, `${field}.sets.${index}`);
    exact(set, ['gamesA', 'gamesB', 'tiebreakPointsA', 'tiebreakPointsB', 'decidingMatchTiebreak'], `${field}.sets.${index}`);
    for (const key of ['gamesA', 'gamesB']) invariant(Number.isInteger(set[key]), 'SCORE_NUMBER', `${field}.${key} must be a whole number.`, `${field}.${key}`);
    for (const key of ['tiebreakPointsA', 'tiebreakPointsB']) if (set[key] !== undefined) invariant(Number.isInteger(set[key]), 'SCORE_NUMBER', `${field}.${key} must be a whole number.`, `${field}.${key}`);
    if (set.decidingMatchTiebreak !== undefined) invariant(typeof set.decidingMatchTiebreak === 'boolean', 'PAYLOAD_TYPE', `${field}.decidingMatchTiebreak must be boolean.`);
  });
}

function validateResultShape(value: unknown, field: string): void {
  const result = object(value, field);
  exact(result, ['revision', 'kind', 'winnerEntryId', 'score', 'reportedScore', 'reason', 'confirmedAt', 'retrospective'], field);
  for (const key of ['kind', 'winnerEntryId', 'score', 'reason', 'retrospective']) invariant(key in result, 'PAYLOAD_REQUIRED', `${field}.${key} is required.`, `${field}.${key}`);
  invariant(['played', 'walkover', 'retirement', 'administrative'].includes(String(result.kind)), 'RESULT_KIND', 'Unsupported result kind.', `${field}.kind`);
  validateDomainId(result.winnerEntryId, `${field}.winnerEntryId`);
  if (result.score !== null) validateScore(result.score, `${field}.score`);
  if (result.reportedScore !== undefined && result.reportedScore !== null) validateScore(result.reportedScore, `${field}.reportedScore`);
  invariant(typeof result.reason === 'string' && result.reason.length <= 500, 'RESULT_REASON_LENGTH', 'Result reason must be 500 characters or fewer.', `${field}.reason`);
  if (result.revision !== undefined) invariant(Number.isSafeInteger(result.revision) && Number(result.revision) >= 0, 'RESULT_REVISION', 'Result revision must be a non-negative safe integer.');
  if (result.confirmedAt !== undefined) validateEpochMillis(result.confirmedAt, `${field}.confirmedAt`);
  if (result.retrospective !== undefined) invariant(typeof result.retrospective === 'boolean', 'PAYLOAD_TYPE', `${field}.retrospective must be boolean.`);
}

function validateRuleProfileShape(value: unknown, field: string): void {
  const profile = object(value, field);
  exact(profile, ['id', 'version', 'name', 'family', 'bestOfSets', 'gamesToWin', 'gameMargin', 'tiebreakTrigger', 'tiebreakTarget', 'decidingMatchTiebreak', 'gameEnding', 'estimatedMinutes', 'restMinutes'], field);
  validateDomainId(profile.id, `${field}.id`);
}

function validateStageShape(value: unknown, field: string): void {
  const stage = object(value, field);
  exact(stage, ['id', 'divisionId', 'name', 'kind', 'order', 'entryIds', 'groupIds', 'defaultRuleProfileId', 'qualificationConfirmedAt', 'qualificationFingerprint', 'amended', 'closedAt', 'standingsPolicy', 'seedMode', 'seedOrder', 'shuffleSeed', 'qualificationBands', 'qualificationDestinations', 'plateSourceStageId', 'plateDependencyFingerprint', 'plateRulings'], field);
  for (const key of ['id', 'divisionId', 'defaultRuleProfileId']) validateDomainId(stage[key], `${field}.${key}`);
  validateIdArray(stage.entryIds, `${field}.entryIds`);
  validateIdArray(stage.groupIds, `${field}.groupIds`);
  invariant(['manual', 'group', 'knockout', 'plate'].includes(String(stage.kind)), 'STAGE_KIND', 'Unsupported stage kind.', `${field}.kind`);
  invariant(['entered', 'seeded', 'shuffle'].includes(String(stage.seedMode)), 'SEED_MODE', 'Unsupported seed mode.', `${field}.seedMode`);
  validateIdArray(stage.seedOrder, `${field}.seedOrder`);
  exact(object(stage.standingsPolicy, `${field}.standingsPolicy`), ['winPoints', 'lossPoints', 'includeSetDifference', 'explicitOrder'], `${field}.standingsPolicy`);
  validateObjectArray(stage.qualificationBands, `${field}.qualificationBands`, ['id', 'name', 'positions', 'destinationStageId']);
  validateObjectArray(stage.qualificationDestinations, `${field}.qualificationDestinations`, ['groupId', 'position', 'destinationStageId', 'slotIndex']);
  validateObjectArray(stage.plateRulings, `${field}.plateRulings`, ['entryId', 'decision', 'reason']);
}

function validateFixtureShape(value: unknown, field: string): void {
  const fixture = object(value, field);
  exact(fixture, ['id', 'divisionId', 'stageId', 'groupId', 'label', 'sideA', 'sideB', 'resolvedEntryAId', 'resolvedEntryBId', 'ruleProfileId', 'status', 'courtId', 'queueOrder', 'plannedStartAt', 'pinned', 'actualStartAt', 'actualEndAt', 'actualEntryIds', 'actualPlayerIds', 'actualRuleProfile', 'liveScore', 'result', 'voidReason', 'sourceFingerprint', 'importedInterruption', 'durationOverrideMinutes', 'restOverrideMinutes', 'estimatedReleaseAt'], field);
  for (const key of ['id', 'divisionId', 'stageId', 'ruleProfileId']) validateDomainId(fixture[key], `${field}.${key}`);
  validateSource(fixture.sideA, `${field}.sideA`);
  validateSource(fixture.sideB, `${field}.sideB`);
  invariant(['planned', 'playing', 'suspended', 'completed', 'voided', 'resolved-bye'].includes(String(fixture.status)), 'FIXTURE_STATUS', 'Unsupported fixture status.', `${field}.status`);
  if (fixture.actualRuleProfile !== null) validateRuleProfileShape(fixture.actualRuleProfile, `${field}.actualRuleProfile`);
  if (fixture.liveScore !== null) validateScore(fixture.liveScore, `${field}.liveScore`);
  if (fixture.result !== null) validateResultShape(fixture.result, `${field}.result`);
}

function validateSource(value: unknown, field: string): void {
  const source = object(value, field);
  invariant(['entry', 'winner-of-match', 'loser-of-match', 'group-position', 'bye'].includes(String(source.kind)), 'SOURCE_KIND', 'Unsupported fixture source.', `${field}.kind`);
  const keys = source.kind === 'entry' ? ['kind', 'entryId']
    : source.kind === 'group-position' ? ['kind', 'groupId', 'position']
      : source.kind === 'bye' ? ['kind'] : ['kind', 'fixtureId'];
  exact(source, keys, field);
  if (source.kind === 'entry') validateDomainId(source.entryId, `${field}.entryId`);
  if (source.kind === 'group-position') validateDomainId(source.groupId, `${field}.groupId`);
  if (source.kind === 'winner-of-match' || source.kind === 'loser-of-match') validateDomainId(source.fixtureId, `${field}.fixtureId`);
}

function validateObjectArray(value: unknown, field: string, keys: readonly string[]): void {
  invariant(Array.isArray(value), 'PAYLOAD_TYPE', `${field} must be an array.`, field);
  value.forEach((item, index) => exact(object(item, `${field}.${index}`), keys, `${field}.${index}`));
}

function validateIdArray(value: unknown, field: string): void {
  invariant(Array.isArray(value), 'PAYLOAD_TYPE', `${field} must be an array.`, field);
  value.forEach((id, index) => validateDomainId(id, `${field}.${index}`));
}

function idPair(value: unknown, field: string): void {
  invariant(Array.isArray(value) && value.length === 2, 'PAYLOAD_TYPE', `${field} must contain two IDs.`, field);
  value.forEach((id, index) => validateDomainId(id, `${field}.${index}`));
}

function stringPair(value: unknown, field: string): void {
  invariant(Array.isArray(value) && value.length === 2 && value.every((item) => typeof item === 'string'), 'PAYLOAD_TYPE', `${field} must contain two strings.`, field);
}

function object(value: unknown, field: string): Record<string, unknown> {
  invariant(Boolean(value) && typeof value === 'object' && !Array.isArray(value), 'PAYLOAD_TYPE', `${field} must be an object.`, field);
  return value as Record<string, unknown>;
}

function exact(value: Record<string, unknown>, allowed: readonly string[], field: string): void {
  const extras = Object.keys(value).filter((key) => !allowed.includes(key));
  invariant(extras.length === 0, 'UNKNOWN_KEY', `${field} contains unknown field ${extras[0]}.`, `${field}.${extras[0] ?? ''}`);
}
