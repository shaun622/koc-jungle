import { invariant } from './errors';
import { computeGroupStandings, standingsFingerprint, type StandingsPolicy } from './standings';
import { activeLineup, cloneTournament, normalizeName, normalizedPairKey, resolveFixtureSources, validateTournament } from './state';
import { scoreSummary, validateResult } from './scoring';
import type {
  QualificationDecision,
  RuleProfile,
  TournamentAuditEntry,
  TournamentCommandEnvelope,
  TournamentEntry,
  TournamentFixture,
  TournamentGroup,
  TournamentLineupRevision,
  TournamentPlayer,
  TournamentResult,
  TournamentScore,
  TournamentStage,
  TournamentV1,
} from './types';
import { TOURNAMENT_LIMITS } from './types';
import { applyResultCorrection, type CorrectionPreview, type QualificationReconfirmation, type StartedResolution } from './corrections';
import { validateDrawProposal, validateGroupAmendmentProposal } from './draws';
import { applyScheduleSuggestions, validateCourtClosureProposal, validateScheduleProposal, type CourtClosureProposal } from './scheduling';
import { validateTournamentCommandEnvelope } from './schemas';
import type { TournamentCommandEffects, TournamentDrawProposal, TournamentGroupAmendmentProposal, TournamentReduction, TournamentScheduleProposal } from './types';
import { TOURNAMENT_CONTRACT_VERSION, TOURNAMENT_PROTOCOL } from './types';

export interface ReduceContext { actorId: string; now: number }

export function reduceTournament(state: TournamentV1, command: TournamentCommandEnvelope, context: ReduceContext): TournamentV1 {
  return reduceTournamentWithEffects(state, command, context).state;
}

export function reduceTournamentWithEffects(state: TournamentV1, command: TournamentCommandEnvelope, context: ReduceContext): TournamentReduction {
  validateTournamentCommandEnvelope(command);
  validateTournament(state);
  invariant(command.tournamentId === state.id, 'COMMAND_SCOPE', 'Command belongs to another tournament.');
  invariant(command.baseRevision === state.revision, 'REVISION_CONFLICT', 'Tournament changed. Refresh and review this edit.');
  invariant(command.reason === undefined || command.reason.trim().length <= 500, 'REASON_LENGTH', 'Reason must be at most 500 characters.', 'reason');
  const closedAllowed = command.kind === 'archive-event' || command.kind === 'reopen-event';
  invariant(state.lifecycle === 'setup' || state.lifecycle === 'live' || closedAllowed, 'EVENT_CLOSED', 'This tournament is closed. Reopen it before making changes.');
  if (state.lifecycle === 'live') {
    invariant(command.deviceId === state.controller.deviceId, 'WRONG_CONTROLLER', 'This device does not control the tournament.');
    invariant(command.controllerEpoch === state.controller.epoch, 'CONTROLLER_EPOCH', 'Controller authority changed.');
    invariant(command.sequence === state.controller.nextSequence, 'COMMAND_SEQUENCE', `Expected command sequence ${state.controller.nextSequence}.`);
  }
  const before = cloneTournament(state);
  let next = cloneTournament(state);
  const p = command.payload as Record<string, unknown>;
  const now = command.issuedAt;
  const effects: TournamentCommandEffects = { clearFixtureDraftIds: [], clearFormDraftKeys: [], scheduleReviewFixtureIds: [] };

  switch (command.kind) {
    case 'update-metadata': {
      requireSetup(next);
      const patch = p.patch as Partial<TournamentV1['meta']>;
      next.meta = { ...next.meta, ...patch };
      validateMetadata(next);
      break;
    }
    case 'add-division': {
      requireSetup(next);
      invariant(next.divisions.length < 4, 'DIVISION_LIMIT', 'Release 1 supports up to four divisions.');
      next.divisions.push(p.division as TournamentV1['divisions'][number]);
      break;
    }
    case 'update-division': {
      requireSetup(next);
      const division = find(next.divisions, String(p.divisionId), 'Division');
      if (typeof p.name === 'string') division.name = p.name.trim();
      break;
    }
    case 'remove-division': {
      requireSetup(next);
      invariant(next.divisions.length > 1, 'DIVISION_REQUIRED', 'A tournament needs at least one division.');
      const divisionId = String(p.divisionId);
      invariant(!next.entries.some((entry) => entry.divisionId === divisionId) && !next.stages.some((stage) => stage.divisionId === divisionId), 'DIVISION_IN_USE', 'Move or remove this division’s entries and stages first.');
      next.divisions = next.divisions.filter((division) => division.id !== divisionId);
      break;
    }
    case 'update-capacity': {
      requireSetup(next);
      const division = find(next.divisions, String(p.divisionId), 'Division');
      const capacity = Number(p.capacity);
      const confirmed = next.entries.filter((entry) => entry.divisionId === division.id && entry.admission === 'confirmed').length;
      invariant(Number.isInteger(capacity) && capacity >= confirmed && capacity <= TOURNAMENT_LIMITS.confirmedEntries, 'CAPACITY', `Capacity must be from ${confirmed} to ${TOURNAMENT_LIMITS.confirmedEntries}.`, 'capacity');
      division.capacity = capacity;
      break;
    }
    case 'add-entry': {
      addEntry(next, p, now, false, command.reason);
      break;
    }
    case 'add-late-entry': {
      invariant(next.lifecycle === 'live', 'EVENT_NOT_LIVE', 'Late entry is available during a live tournament.');
      requireReason(command.reason);
      addEntry(next, p, now, true, command.reason);
      break;
    }
    case 'add-entries': {
      const entries = p.entries as Array<Record<string, unknown>>;
      invariant(Array.isArray(entries) && entries.length > 0, 'IMPORT_EMPTY', 'Paste at least one valid entry row.');
      entries.forEach((entry) => addEntry(next, entry, now, false, command.reason));
      break;
    }
    case 'edit-entry': {
      const entry = find(next.entries, String(p.entryId), 'Entry');
      invariant(entry.admission !== 'cancelled', 'ENTRY_CANCELLED', 'Cancelled entries cannot be edited.');
      if (typeof p.teamName === 'string') entry.teamName = p.teamName.trim();
      if (Array.isArray(p.playerNames)) {
        (p.playerNames as string[]).forEach((name, index) => {
          const player = find(next.players, entry.playerIds[index], 'Player');
          player.name = name.trim();
        });
      }
      break;
    }
    case 'set-entry-contact': {
      find(next.entries, String(p.entryId), 'Entry');
      invariant(p.action === 'set' || p.action === 'clear', 'CONTACT_ACTION', 'Contact action must be set or clear.', 'action');
      // Contact contents travel beside this redacted command and are committed
      // atomically by the private persistence boundary. They never enter the
      // canonical state, audit values or public projection.
      break;
    }
    case 'cancel-entry': {
      const entry = find(next.entries, String(p.entryId), 'Entry');
      const wasConfirmed = entry.admission === 'confirmed';
      entry.admission = 'cancelled';
      entry.readiness = 'withdrawn';
      entry.waitRank = null;
      const division = find(next.divisions, entry.divisionId, 'Division');
      if (wasConfirmed && division.automaticPromotion && division.drawPublishedAt === null) promoteOldestWaiting(next, division.id);
      compactWaitRanks(next, division.id);
      break;
    }
    case 'promote-entry': {
      const entry = find(next.entries, String(p.entryId), 'Entry');
      invariant(entry.admission === 'waiting', 'NOT_WAITING', 'Only a waiting entry can be promoted.');
      const division = find(next.divisions, entry.divisionId, 'Division');
      const confirmed = next.entries.filter((item) => item.divisionId === division.id && item.admission === 'confirmed').length;
      invariant(confirmed < division.capacity, 'CAPACITY_FULL', 'This division is at capacity.');
      entry.admission = 'confirmed'; entry.waitRank = null;
      compactWaitRanks(next, division.id);
      break;
    }
    case 'reorder-waiting': {
      const ordered = p.entryIds as string[];
      const divisionId = String(p.divisionId);
      const waiting = next.entries.filter((item) => item.divisionId === divisionId && item.admission === 'waiting');
      invariant(ordered.length === waiting.length && new Set(ordered).size === ordered.length && ordered.every((id) => waiting.some((item) => item.id === id)), 'WAIT_ORDER', 'Waiting order must contain every waiting entry exactly once.');
      ordered.forEach((id, index) => { find(next.entries, id, 'Entry').waitRank = index + 1; });
      break;
    }
    case 'set-readiness': {
      find(next.entries, String(p.entryId), 'Entry').readiness = p.readiness as TournamentEntry['readiness'];
      break;
    }
    case 'add-court': {
      invariant(next.courts.length < TOURNAMENT_LIMITS.courts, 'COURT_LIMIT', `Use at most ${TOURNAMENT_LIMITS.courts} courts.`);
      next.courts.push(p.court as TournamentV1['courts'][number]);
      break;
    }
    case 'update-court': {
      const court = find(next.courts, String(p.courtId), 'Court');
      if (typeof p.name === 'string') court.name = p.name.trim();
      if (typeof p.displayOrder === 'number') court.displayOrder = p.displayOrder;
      if (p.availabilityWindows !== undefined) court.availabilityWindows = cloneTournament(p.availabilityWindows as TournamentV1['courts'][number]['availabilityWindows']);
      break;
    }
    case 'set-court-availability': {
      const court = find(next.courts, String(p.courtId), 'Court');
      const available = Boolean(p.available);
      if (!available) {
        const occupied = next.fixtures.find((fixture) => fixture.courtId === court.id && (fixture.status === 'playing' || fixture.status === 'suspended'));
        invariant(!occupied, 'COURT_OCCUPIED', `Review how to handle ${occupied?.label ?? 'the active match'} before closing this court.`);
      }
      court.available = available;
      break;
    }
    case 'apply-court-closure': {
      const proposal = p.proposal as CourtClosureProposal;
      validateCourtClosureProposal(proposal, next);
      const court = find(next.courts, proposal.courtId, 'Court');
      for (const action of proposal.actions) {
        const fixture = find(next.fixtures, action.fixtureId, 'Fixture');
        if (fixture.status === 'playing') {
          invariant(action.action === 'suspend-release' || action.action === 'terminate', 'COURT_CLOSURE_ACTION', 'Choose suspend and release or terminate for the playing match.');
          invariant(action.reason.trim().length > 0, 'REASON_REQUIRED', 'Court closure actions require a reason.');
          if (action.action === 'suspend-release') { fixture.status = 'suspended'; fixture.courtId = null; }
          else { fixture.status = 'voided'; fixture.voidReason = action.reason.trim(); fixture.actualEndAt = now; effects.clearFixtureDraftIds.push(fixture.id); }
        } else if (fixture.status === 'suspended') {
          invariant(['keep-reserved', 'release', 'move-resume'].includes(action.action), 'COURT_CLOSURE_ACTION', 'Choose how to handle the suspended match.');
          if (action.action === 'release') fixture.courtId = null;
          if (action.action === 'move-resume') {
            fixture.courtId = action.targetCourtId ?? null;
            ensureCourtAndPlayersFree(next, fixture, now, false, action.reason);
            fixture.status = 'playing';
          }
        } else {
          invariant(fixture.status === 'planned' && ['keep-warning', 'reassign', 'unassign'].includes(action.action), 'COURT_CLOSURE_ACTION', 'Choose how to handle each queued match.');
          if (action.action === 'reassign') fixture.courtId = action.targetCourtId ?? null;
          if (action.action === 'unassign') fixture.courtId = null;
        }
      }
      court.available = false;
      break;
    }
    case 'add-rule-profile': {
      invariant(next.lifecycle === 'setup' || next.lifecycle === 'live', 'EVENT_CLOSED', 'Rules cannot be added to a completed or cancelled tournament.');
      next.ruleProfiles.push(p.profile as RuleProfile);
      break;
    }
    case 'add-stage': {
      invariant(next.lifecycle === 'setup' || next.lifecycle === 'live', 'EVENT_CLOSED', 'Stages cannot be added to a completed or cancelled tournament.');
      const stage = cloneTournament(p.stage as TournamentStage);
      if (stage.seedOrder.length === 0) stage.seedOrder = [...stage.entryIds];
      next.stages.push(stage);
      break;
    }
    case 'apply-draw-proposal': {
      invariant(next.lifecycle === 'setup' || next.lifecycle === 'live', 'EVENT_CLOSED', 'Draws cannot be changed on a closed tournament.');
      const proposal = p.proposal as TournamentDrawProposal;
      applyDrawProposalState(next, proposal, next.revision);
      break;
    }
    case 'apply-draw-bundle': {
      invariant(next.lifecycle === 'setup' || next.lifecycle === 'live', 'EVENT_CLOSED', 'Draws cannot be changed on a closed tournament.');
      const proposals = p.proposals as TournamentDrawProposal[];
      invariant(Array.isArray(proposals) && proposals.length > 0 && proposals.length <= 4, 'PROPOSAL_BUNDLE', 'A draw bundle must contain from one to four stages.');
      invariant(new Set(proposals.map((proposal) => proposal.stage.id)).size === proposals.length, 'PROPOSAL_BUNDLE', 'A draw bundle cannot repeat a stage.');
      proposals.forEach((proposal) => validateDrawProposal(proposal, next.revision));
      proposals.forEach((proposal) => applyDrawProposalState(next, proposal, next.revision));
      break;
    }
    case 'apply-group-amendment': {
      invariant(next.lifecycle === 'setup' || next.lifecycle === 'live', 'EVENT_CLOSED', 'Groups cannot be amended on a closed tournament.');
      requireReason(command.reason);
      const proposal = p.proposal as TournamentGroupAmendmentProposal;
      validateGroupAmendmentProposal(next, proposal);
      const stage = find(next.stages, proposal.stageId, 'Stage');
      const group = find(next.groups, proposal.groupId, 'Group');
      group.entryIds.push(proposal.entryId);
      group.fixtureIds.push(...proposal.fixtures.map((fixture) => fixture.id));
      group.qualifierOrder = null;
      stage.entryIds.push(proposal.entryId);
      stage.amended = true;
      stage.qualificationConfirmedAt = null;
      stage.qualificationFingerprint = null;
      next.fixtures.push(...cloneTournament(proposal.fixtures));
      break;
    }
    case 'replace-stage-draw': {
      const stage = find(next.stages, String(p.stageId), 'Stage');
      const existing = next.fixtures.filter((fixture) => fixture.stageId === stage.id);
      invariant(existing.every((fixture) => fixture.status === 'planned' || fixture.status === 'resolved-bye'), 'STAGE_STARTED', 'A stage that has started cannot be regenerated.');
      const includePinned = Boolean(p.includePinned);
      next.fixtures = next.fixtures.filter((fixture) => fixture.stageId !== stage.id || fixture.pinned && !includePinned);
      next.groups = next.groups.filter((group) => group.stageId !== stage.id);
      const groups = (p.groups ?? []) as TournamentGroup[];
      const fixtures = p.fixtures as TournamentFixture[];
      invariant(fixtures.every((fixture) => fixture.status === 'planned' || fixture.status === 'resolved-bye'), 'PROPOSAL_ACTUALS', 'A draw proposal may contain only unstarted fixtures.');
      next.groups.push(...groups);
      next.fixtures.push(...fixtures);
      stage.groupIds = groups.map((group) => group.id);
      stage.entryIds = [...new Set(groups.flatMap((group) => group.entryIds).concat((p.entryIds as string[] | undefined) ?? []))];
      stage.qualificationConfirmedAt = null; stage.qualificationFingerprint = null;
      break;
    }
    case 'publish-draw': {
      requireSetup(next);
      const division = find(next.divisions, String(p.divisionId), 'Division');
      division.drawPublishedAt = now;
      division.automaticPromotion = false;
      break;
    }
    case 'add-manual-fixture': {
      const fixture = p.fixture as TournamentFixture;
      invariant(fixture.status === 'planned' && fixture.actualEntryIds === null && fixture.actualPlayerIds === null && fixture.actualRuleProfile === null && fixture.result === null, 'PROPOSAL_ACTUALS', 'A new manual fixture must be unstarted.');
      next.fixtures.push(fixture);
      break;
    }
    case 'assign-fixture': {
      const fixture = plannedFixture(next, String(p.fixtureId));
      if (p.courtId !== undefined) fixture.courtId = p.courtId ? String(p.courtId) : null;
      if (p.plannedStartAt !== undefined) fixture.plannedStartAt = p.plannedStartAt ? String(p.plannedStartAt) : null;
      if (p.queueOrder !== undefined) fixture.queueOrder = Number(p.queueOrder);
      if (p.pinned !== undefined) fixture.pinned = Boolean(p.pinned);
      if (p.durationOverrideMinutes !== undefined) fixture.durationOverrideMinutes = p.durationOverrideMinutes === null ? null : Number(p.durationOverrideMinutes);
      if (p.restOverrideMinutes !== undefined) fixture.restOverrideMinutes = p.restOverrideMinutes === null ? null : Number(p.restOverrideMinutes);
      if (p.estimatedReleaseAt !== undefined) fixture.estimatedReleaseAt = p.estimatedReleaseAt ? String(p.estimatedReleaseAt) : null;
      break;
    }
    case 'apply-schedule': {
      const proposal = p.proposal as TournamentScheduleProposal;
      validateScheduleProposal(proposal, next.revision);
      invariant(new Set(proposal.suggestions.map((suggestion) => suggestion.fixtureId)).size === proposal.suggestions.length, 'SCHEDULE_SHAPE', 'Schedule proposal contains duplicate fixtures.');
      next.fixtures = applyScheduleSuggestions(next.fixtures, proposal.suggestions, Boolean(p.includePinned));
      break;
    }
    case 'reorder-fixtures': {
      const fixtureIds = p.fixtureIds as string[];
      const plannedIds = next.fixtures.filter((fixture) => fixture.status === 'planned').map((fixture) => fixture.id).sort();
      invariant(Array.isArray(fixtureIds) && fixtureIds.length === plannedIds.length && new Set(fixtureIds).size === fixtureIds.length && JSON.stringify([...fixtureIds].sort()) === JSON.stringify(plannedIds), 'FIXTURE_ORDER', 'Reviewed queue order must contain every planned fixture exactly once.');
      const order = new Map(fixtureIds.map((fixtureId, index) => [fixtureId, index + 1]));
      next.fixtures.forEach((fixture) => { if (fixture.status === 'planned') fixture.queueOrder = order.get(fixture.id)!; });
      break;
    }
    case 'assign-rule-profile': {
      const profileId = String(p.ruleProfileId);
      find(next.ruleProfiles, profileId, 'Rule profile');
      (p.fixtureIds as string[]).forEach((id) => { plannedFixture(next, id).ruleProfileId = profileId; });
      break;
    }
    case 'swap-fixture-sides': {
      const fixture = plannedFixture(next, String(p.fixtureId));
      [fixture.sideA, fixture.sideB] = [fixture.sideB, fixture.sideA];
      [fixture.resolvedEntryAId, fixture.resolvedEntryBId] = [fixture.resolvedEntryBId, fixture.resolvedEntryAId];
      fixture.liveScore = null;
      break;
    }
    case 'start-match': {
      startMatch(next, String(p.fixtureId), p.courtId ? String(p.courtId) : null, now, Boolean(p.acknowledgeRest), command.reason);
      break;
    }
    case 'publish-progress': {
      const fixture = find(next.fixtures, String(p.fixtureId), 'Fixture');
      invariant(fixture.status === 'playing' || fixture.status === 'suspended', 'MATCH_NOT_ACTIVE', 'Only an active match can publish progress.');
      const profile = fixture.actualRuleProfile ?? find(next.ruleProfiles, fixture.ruleProfileId, 'Rule profile');
      scoreSummary(p.score as TournamentScore, profile, false);
      fixture.liveScore = p.score as TournamentFixture['liveScore'];
      break;
    }
    case 'set-match-estimate': {
      const fixture = find(next.fixtures, String(p.fixtureId), 'Fixture');
      invariant(fixture.status === 'playing' || fixture.status === 'suspended', 'MATCH_NOT_ACTIVE', 'Only an active match can have a release estimate.');
      fixture.estimatedReleaseAt = p.estimatedReleaseAt ? String(p.estimatedReleaseAt) : null;
      break;
    }
    case 'suspend-match': {
      const fixture = find(next.fixtures, String(p.fixtureId), 'Fixture');
      invariant(fixture.status === 'playing', 'MATCH_NOT_PLAYING', 'Only a playing match can be suspended.');
      fixture.status = 'suspended';
      break;
    }
    case 'release-court': {
      const fixture = find(next.fixtures, String(p.fixtureId), 'Fixture');
      invariant(fixture.status === 'suspended', 'MATCH_NOT_SUSPENDED', 'Suspend the match before releasing its court.');
      fixture.courtId = null;
      break;
    }
    case 'resume-match': {
      const fixture = find(next.fixtures, String(p.fixtureId), 'Fixture');
      invariant(fixture.status === 'suspended', 'MATCH_NOT_SUSPENDED', 'Only a suspended match can resume.');
      fixture.courtId = String(p.courtId);
      ensureCourtAndPlayersFree(next, fixture, now, Boolean(p.acknowledgeRest), command.reason);
      fixture.status = 'playing';
      break;
    }
    case 'confirm-result':
    case 'record-result': {
      completeMatch(next, String(p.fixtureId), p.result as Omit<TournamentResult, 'revision' | 'confirmedAt'>, now, command.kind === 'record-result');
      effects.clearFixtureDraftIds.push(String(p.fixtureId));
      next = resolveFixtureSources(next);
      break;
    }
    case 'confirm-qualifiers': {
      confirmQualifiers(next, p, now);
      next = resolveFixtureSources(next);
      break;
    }
    case 'correct-result': {
      const fixture = find(next.fixtures, String(p.fixtureId), 'Fixture');
      invariant(fixture.result && fixture.actualEntryIds, 'CORRECTION_STATUS', 'Only a completed result can be corrected.');
      const nextResult: TournamentResult = {
        ...(p.result as TournamentResult),
        revision: fixture.result.revision + 1,
        confirmedAt: now,
      };
      validateResult(nextResult, fixture.actualRuleProfile ?? find(next.ruleProfiles, fixture.ruleProfileId, 'Rule profile'), fixture.actualEntryIds[0], fixture.actualEntryIds[1]);
      next = applyResultCorrection({
        state: next,
        fixtureId: String(p.fixtureId),
        nextResult,
        preview: p.preview as CorrectionPreview,
        resolutions: p.resolutions as StartedResolution[],
        now,
        reconfirmations: (p.reconfirmations ?? []) as QualificationReconfirmation[],
      });
      effects.clearFixtureDraftIds.push(String(p.fixtureId), ...(p.preview as CorrectionPreview).clearFixtureDraftIds);
      effects.scheduleReviewFixtureIds.push(...(p.preview as CorrectionPreview).scheduleReviewFixtureIds);
      break;
    }
    case 'substitute-player': {
      substitute(next, p, now);
      break;
    }
    case 'void-match': {
      const fixture = find(next.fixtures, String(p.fixtureId), 'Fixture');
      requireReason(command.reason);
      if (!fixture.actualRuleProfile) fixture.actualRuleProfile = cloneTournament(find(next.ruleProfiles, fixture.ruleProfileId, 'Rule profile'));
      if (!fixture.actualEntryIds && fixture.resolvedEntryAId && fixture.resolvedEntryBId) {
        fixture.actualEntryIds = [fixture.resolvedEntryAId, fixture.resolvedEntryBId];
        fixture.actualPlayerIds = [activeLineup(next, fixture.resolvedEntryAId, fixture.id), activeLineup(next, fixture.resolvedEntryBId, fixture.id)];
      }
      fixture.status = 'voided'; fixture.voidReason = command.reason!.trim(); fixture.actualEndAt = now;
      effects.clearFixtureDraftIds.push(fixture.id);
      break;
    }
    case 'begin-event': {
      requireSetup(next);
      invariant(!next.meta.signupOpen, 'SIGNUP_OPEN', 'Close signup before beginning the tournament.');
      next.lifecycle = 'live';
      next.controller = { deviceId: command.deviceId, epoch: String(BigInt(next.controller.epoch) + 1n), nextSequence: 1 };
      break;
    }
    case 'complete-event': {
      invariant(next.lifecycle === 'live', 'EVENT_NOT_LIVE', 'Only a live tournament can be completed.');
      invariant(next.fixtures.every((fixture) => fixture.status === 'completed' || fixture.status === 'voided' || fixture.status === 'resolved-bye'), 'EVENT_INCOMPLETE', 'Complete or void every published fixture first.');
      invariant(next.stages.every((stage) => stage.kind === 'manual' || stage.kind === 'knockout' || stage.closedAt || stage.qualificationConfirmedAt), 'QUALIFICATION_UNRESOLVED', 'Resolve every group and plate qualification first.');
      next.lifecycle = 'complete'; next.controller = { deviceId: null, epoch: next.controller.epoch, nextSequence: 0 };
      break;
    }
    case 'reopen-event': {
      invariant(next.lifecycle === 'complete', 'EVENT_NOT_COMPLETE', 'Only a completed tournament can be reopened.');
      requireReason(command.reason); next.lifecycle = 'setup'; next.meta.signupOpen = false; break;
    }
    case 'cancel-event': {
      invariant(!next.fixtures.some((fixture) => fixture.status === 'playing' || fixture.status === 'suspended'), 'ACTIVE_MATCHES', 'Resolve active matches before cancellation.');
      requireReason(command.reason); next.lifecycle = 'cancelled'; next.meta.signupOpen = false; break;
    }
    case 'archive-event': next.archivedAt = Boolean(p.archived) ? now : null; break;
    case 'undo-command': {
      next = undoCommand(next, String(p.commandId), command.reason ?? '', now);
      break;
    }
    default:
      invariant(false, 'COMMAND_KIND', `Unsupported tournament command: ${String(command.kind)}`);
  }

  if (state.lifecycle === 'live' && command.kind !== 'complete-event') next.controller.nextSequence += 1;
  next.updatedAt = now;
  next.revision = String(BigInt(state.revision) + 1n);
  validateTournament(next);
  const diff = auditDiff(before, next);
  next.audit.push({
    commandId: command.commandId, kind: command.kind, actorId: context.actorId, at: now,
    reason: command.reason?.trim() ?? '', touchedIds: diff.touchedIds, before: diff.before, after: diff.after,
    resultingRevision: next.revision,
    ...(command.kind === 'undo-command' ? { compensatesCommandId: String(p.commandId) } : {}),
  });
  validateTournament(next);
  return { state: next, effects: {
    clearFixtureDraftIds: [...new Set(effects.clearFixtureDraftIds)],
    clearFormDraftKeys: [...new Set(effects.clearFormDraftKeys)],
    scheduleReviewFixtureIds: [...new Set(effects.scheduleReviewFixtureIds)],
  } };
}

function applyDrawProposalState(state: TournamentV1, proposal: TournamentDrawProposal, revision: string): void {
  validateDrawProposal(proposal, revision);
  const existingStage = state.stages.find((stage) => stage.id === proposal.stage.id);
  const existingFixtures = state.fixtures.filter((fixture) => fixture.stageId === proposal.stage.id);
  invariant(existingFixtures.every((fixture) => fixture.status === 'planned' || fixture.status === 'resolved-bye'), 'STAGE_STARTED', 'A stage that has started cannot be regenerated.');
  const outsideFixtureIds = new Set(state.fixtures.filter((fixture) => fixture.stageId !== proposal.stage.id).map((fixture) => fixture.id));
  const outsideGroupIds = new Set(state.groups.filter((group) => group.stageId !== proposal.stage.id).map((group) => group.id));
  invariant(proposal.fixtures.every((fixture) => !outsideFixtureIds.has(fixture.id)), 'PROPOSAL_ID_COLLISION', 'A proposed fixture ID already exists outside this stage.');
  invariant(proposal.groups.every((group) => !outsideGroupIds.has(group.id)), 'PROPOSAL_ID_COLLISION', 'A proposed group ID already exists outside this stage.');
  state.stages = existingStage ? state.stages.map((stage) => stage.id === proposal.stage.id ? cloneTournament(proposal.stage) : stage) : [...state.stages, cloneTournament(proposal.stage)];
  state.groups = [...state.groups.filter((group) => group.stageId !== proposal.stage.id), ...cloneTournament(proposal.groups)];
  state.fixtures = [...state.fixtures.filter((fixture) => fixture.stageId !== proposal.stage.id), ...cloneTournament(proposal.fixtures)];
}

function addEntry(state: TournamentV1, payload: Record<string, unknown>, now: number, allowLive = false, reason?: string): void {
  invariant(state.lifecycle === 'setup' || allowLive && state.lifecycle === 'live', 'ADMISSIONS_CLOSED', 'Entries can only be admitted during setup or as an explicit late entry.');
  const division = find(state.divisions, String(payload.divisionId), 'Division');
  const playerNames = payload.playerNames as [string, string];
  invariant(Array.isArray(playerNames) && playerNames.length === 2 && playerNames.every((name) => typeof name === 'string' && name.trim()), 'PLAYER_NAMES', 'Enter both player names.');
  const pairKey = normalizedPairKey(playerNames[0], playerNames[1]);
  const duplicate = state.entries.find((entry) => entry.divisionId === division.id && entry.admission !== 'cancelled' && normalizedPairKey(...entry.playerIds.map((id) => find(state.players, id, 'Player').name) as [string, string]) === pairKey);
  invariant(!duplicate || Boolean(payload.allowDuplicate), 'POSSIBLE_DUPLICATE', 'This pair may already be entered.');
  if (duplicate) requireReason(reason);
  const ids = payload.ids as { entryId: string; playerIds: [string, string]; lineupRevisionId: string };
  const confirmedCount = state.entries.filter((entry) => entry.divisionId === division.id && entry.admission === 'confirmed').length;
  const admission: TournamentEntry['admission'] = (allowLive || division.drawPublishedAt === null) && confirmedCount < division.capacity ? 'confirmed' : 'waiting';
  const waiting = state.entries.filter((entry) => entry.divisionId === division.id && entry.admission === 'waiting');
  const existingPlayerIds = Array.isArray(payload.existingPlayerIds) ? payload.existingPlayerIds as Array<string | null> : [null, null];
  invariant(existingPlayerIds.length === 2, 'PLAYER_LINKS', 'Existing-player selection must contain two players.');
  const selectedPlayerIds = ids.playerIds.map((candidateId, index) => {
    const existingId = existingPlayerIds[index];
    if (!existingId) { state.players.push({ id: candidateId, name: playerNames[index].trim() }); return candidateId; }
    const existing = find(state.players, existingId, 'Player');
    invariant(normalizeName(existing.name) === normalizeName(playerNames[index]), 'PLAYER_LINK_NAME', 'Linked player name must match the selected existing player.');
    return existing.id;
  }) as [string, string];
  invariant(selectedPlayerIds[0] !== selectedPlayerIds[1], 'DUPLICATE_PLAYER', 'A pair must contain two different players.');
  const entry: TournamentEntry = {
    id: ids.entryId, divisionId: division.id, teamName: String(payload.teamName ?? '').trim(), playerIds: selectedPlayerIds,
    admission, readiness: 'not-checked-in', acceptedAt: now, waitRank: admission === 'waiting' ? waiting.length + 1 : null,
    activeLineupRevisionId: ids.lineupRevisionId,
  };
  state.entries.push(entry);
  state.lineupRevisions.push({ id: ids.lineupRevisionId, entryId: entry.id, playerIds: selectedPlayerIds, effectiveFixtureIds: [], createdAt: now, reason: 'Initial entry' });
}

function startMatch(state: TournamentV1, fixtureId: string, requestedCourtId: string | null, now: number, acknowledgeRest = false, reason?: string): void {
  invariant(state.lifecycle === 'live', 'EVENT_NOT_LIVE', 'Begin the tournament before starting matches.');
  const fixture = plannedFixture(state, fixtureId);
  fixture.courtId = requestedCourtId ?? fixture.courtId;
  invariant(fixture.resolvedEntryAId && fixture.resolvedEntryBId, 'UNRESOLVED_ENTRANTS', 'Both match entrants must be resolved.');
  const entryA = find(state.entries, fixture.resolvedEntryAId, 'Entry');
  const entryB = find(state.entries, fixture.resolvedEntryBId, 'Entry');
  invariant(entryA.id !== entryB.id, 'SAME_ENTRY', 'An entry cannot play itself.');
  fixture.actualEntryIds = [entryA.id, entryB.id];
  fixture.actualPlayerIds = [activeLineup(state, entryA.id, fixture.id), activeLineup(state, entryB.id, fixture.id)];
  fixture.actualRuleProfile = cloneTournament(find(state.ruleProfiles, fixture.ruleProfileId, 'Rule profile'));
  invariant(new Set(fixture.actualPlayerIds.flat()).size === 4, 'DUPLICATE_PLAYER', 'The same player cannot appear on both sides.');
  ensureCourtAndPlayersFree(state, fixture, now, acknowledgeRest, reason);
  fixture.status = 'playing'; fixture.actualStartAt = now;
}

function ensureCourtAndPlayersFree(state: TournamentV1, fixture: TournamentFixture, now: number, acknowledgeRest = false, reason?: string): void {
  invariant(fixture.courtId, 'COURT_REQUIRED', 'Assign an available court.');
  const court = find(state.courts, fixture.courtId, 'Court');
  invariant(court.available, 'COURT_UNAVAILABLE', `${court.name} is unavailable.`);
  invariant(court.availabilityWindows === null || court.availabilityWindows.some((window) => Date.parse(window.startsAt) <= now && now < Date.parse(window.endsAt)), 'COURT_WINDOW', `${court.name} is outside its availability window.`);
  for (const other of state.fixtures) {
    if (other.id === fixture.id || other.status !== 'playing' && other.status !== 'suspended') continue;
    invariant(other.courtId !== fixture.courtId, 'COURT_OCCUPIED', 'That court is occupied.');
    const used = new Set(other.actualPlayerIds?.flat() ?? []);
    invariant(!(fixture.actualPlayerIds?.flat() ?? []).some((id) => used.has(id)), 'PLAYER_OCCUPIED', 'A player is active in another match.');
  }
  const players = new Set(fixture.actualPlayerIds?.flat() ?? []);
  const restConflicts = state.fixtures.filter((other) => other.id !== fixture.id && other.status === 'completed' && other.actualEndAt !== null && (other.actualPlayerIds?.flat() ?? []).some((id) => players.has(id))).filter((other) => {
    const profile = other.actualRuleProfile ?? state.ruleProfiles.find((item) => item.id === other.ruleProfileId);
    const rest = (other.restOverrideMinutes ?? profile?.restMinutes ?? 15) * 60_000;
    return now < other.actualEndAt! + rest;
  });
  if (restConflicts.length) invariant(acknowledgeRest && Boolean(reason?.trim()), 'PLAYER_REST', 'A player is still inside the planned rest period. Acknowledge it with a reason to start early.');
}

function completeMatch(state: TournamentV1, fixtureId: string, result: Omit<TournamentResult, 'revision' | 'confirmedAt'>, now: number, retrospective: boolean): void {
  const fixture = find(state.fixtures, fixtureId, 'Fixture');
  if (retrospective) {
    invariant(fixture.status === 'planned', 'MATCH_STATUS', 'Only a planned match can be entered retrospectively.');
    invariant(fixture.resolvedEntryAId && fixture.resolvedEntryBId, 'UNRESOLVED_ENTRANTS', 'Resolve both entrants first.');
    fixture.actualEntryIds = [fixture.resolvedEntryAId, fixture.resolvedEntryBId];
    fixture.actualPlayerIds = [activeLineup(state, fixture.resolvedEntryAId, fixture.id), activeLineup(state, fixture.resolvedEntryBId, fixture.id)];
    fixture.actualRuleProfile = cloneTournament(find(state.ruleProfiles, fixture.ruleProfileId, 'Rule profile'));
  } else {
    invariant(fixture.status === 'playing' || fixture.status === 'suspended', 'MATCH_STATUS', 'Start the match before confirming its result.');
  }
  const [entryA, entryB] = fixture.actualEntryIds!;
  const profile = fixture.actualRuleProfile ?? find(state.ruleProfiles, fixture.ruleProfileId, 'Rule profile');
  validateResult(result, profile, entryA, entryB);
  fixture.result = { ...result, retrospective, revision: (fixture.result?.revision ?? 0) + 1, confirmedAt: now };
  fixture.status = 'completed'; fixture.actualEndAt = now; fixture.liveScore = result.score;
}

function confirmQualifiers(state: TournamentV1, payload: Record<string, unknown>, now: number): void {
  const stage = find(state.stages, String(payload.stageId), 'Stage');
  const policy = payload.policy as StandingsPolicy;
  const manual = Boolean(payload.manual);
  const reason = String(payload.reason ?? '').trim();
  const orderedByGroup = payload.orderedByGroup as Record<string, string[]>;
  if (manual) invariant(reason.length > 0, 'QUALIFIER_REASON', 'Manual qualification needs a reason.');
  invariant(!stage.amended || manual, 'AMENDED_MANUAL_ONLY', 'An amended group requires manual qualification with a reason.');
  for (const groupId of stage.groupIds) {
    const standings = computeGroupStandings(state, groupId, policy);
    const ordered = orderedByGroup[groupId];
    const group = find(state.groups, groupId, 'Group');
    invariant(Array.isArray(ordered) && ordered.length === group.entryIds.length && new Set(ordered).size === ordered.length && ordered.every((id) => group.entryIds.includes(id)), 'QUALIFIER_ORDER', 'Every group needs a full unique permutation of its entries.');
    if (!manual) {
      invariant(standings.complete, 'GROUP_INCOMPLETE', 'Complete every group match before confirming qualifiers.');
      invariant(standings.unresolvedCohorts.length === 0, 'GROUP_TIED', 'Resolve tied qualifying positions before confirmation.');
      invariant(JSON.stringify(ordered) === JSON.stringify(standings.rows.map((row) => row.entryId)), 'QUALIFIER_ORDER', 'Qualifier order does not match calculated standings.');
    }
    find(state.groups, groupId, 'Group').qualifierOrder = ordered;
  }
  stage.standingsPolicy = cloneTournament(policy);
  const fingerprint = standingsFingerprint(state, stage.groupIds);
  stage.qualificationConfirmedAt = now; stage.qualificationFingerprint = fingerprint;
  const destinationRanks = cloneTournament((payload.destinationRanks ?? stage.qualificationDestinations) as TournamentStage['qualificationDestinations']);
  const plateRulings = cloneTournament((payload.plateRulings ?? stage.plateRulings) as TournamentStage['plateRulings']);
  stage.qualificationDestinations = destinationRanks; stage.plateRulings = plateRulings;
  const decision: QualificationDecision = {
    id: String(payload.decisionId), stageId: stage.id, sourceFingerprint: fingerprint,
    orderedEntryIds: stage.groupIds.flatMap((id) => orderedByGroup[id]), manual, reason, createdAt: now,
    policy: cloneTournament(policy), destinationRanks, plateRulings,
  };
  state.qualificationDecisions.push(decision);
}

function substitute(state: TournamentV1, payload: Record<string, unknown>, now: number): void {
  const entry = find(state.entries, String(payload.entryId), 'Entry');
  const fixtureIds = payload.fixtureIds as string[];
  invariant(fixtureIds.every((id) => {
    const fixture = find(state.fixtures, id, 'Fixture');
    return fixture.status === 'planned';
  }), 'HISTORICAL_SUBSTITUTION', 'Substitutions apply only to unstarted fixtures.');
  const outgoingId = String(payload.outgoingPlayerId);
  invariant(entry.playerIds.includes(outgoingId), 'PLAYER_NOT_IN_ENTRY', 'Outgoing player is not in this entry.');
  const incoming = payload.incomingPlayer as TournamentPlayer;
  invariant(!state.players.some((player) => player.id === incoming.id), 'PLAYER_EXISTS', 'Incoming player ID already exists.');
  state.players.push(incoming);
  const playerIds = entry.playerIds.map((id) => id === outgoingId ? incoming.id : id) as [string, string];
  const revision: TournamentLineupRevision = { id: String(payload.lineupRevisionId), entryId: entry.id, playerIds, effectiveFixtureIds: fixtureIds, createdAt: now, reason: String(payload.reason ?? '') };
  state.lineupRevisions.push(revision); entry.activeLineupRevisionId = revision.id;
}

function undoCommand(state: TournamentV1, commandId: string, reason: string, now: number): TournamentV1 {
  const audit = state.audit.find((item) => item.commandId === commandId);
  invariant(audit, 'AUDIT_NOT_FOUND', 'Change not found in history.');
  requireReason(reason);
  const current = auditSnapshot(state, Object.keys(audit.after));
  invariant(JSON.stringify(current) === JSON.stringify(audit.after), 'UNDO_DEPENDENCY', 'This change has subsequent activity. Use the correction workflow.');
  const next = cloneTournament(state);
  applyAuditSnapshot(next, audit.before, Object.keys(audit.after));
  next.updatedAt = now;
  return next;
}

function auditDiff(before: TournamentV1, after: TournamentV1): { before: Record<string, unknown>; after: Record<string, unknown>; touchedIds: string[] } {
  const oldValues = flattenAudit(before);
  const newValues = flattenAudit(after);
  const keys = [...new Set([...Object.keys(oldValues), ...Object.keys(newValues)])].filter((key) => JSON.stringify(oldValues[key]) !== JSON.stringify(newValues[key]) && key !== 'revision' && key !== 'updatedAt' && key !== 'audit');
  return {
    before: Object.fromEntries(keys.map((key) => [key, oldValues[key] ?? null])),
    after: Object.fromEntries(keys.map((key) => [key, newValues[key] ?? null])),
    touchedIds: keys.map((key) => key.split(':')[1]).filter((value): value is string => Boolean(value)),
  };
}

const collections = ['divisions', 'players', 'entries', 'lineupRevisions', 'courts', 'ruleProfiles', 'stages', 'groups', 'fixtures', 'qualificationDecisions'] as const;

function flattenAudit(state: TournamentV1): Record<string, unknown> {
  const result: Record<string, unknown> = { lifecycle: state.lifecycle, archivedAt: state.archivedAt, meta: state.meta, controller: state.controller };
  for (const collection of collections) for (const item of state[collection]) result[`${collection}:${item.id}`] = item;
  return result;
}

function auditSnapshot(state: TournamentV1, keys: string[]): Record<string, unknown> {
  const flat = flattenAudit(state);
  return Object.fromEntries(keys.map((key) => [key, flat[key] ?? null]));
}

function applyAuditSnapshot(state: TournamentV1, values: Record<string, unknown>, keys: string[]): void {
  for (const key of keys) {
    if (key === 'lifecycle') state.lifecycle = values[key] as TournamentV1['lifecycle'];
    else if (key === 'archivedAt') state.archivedAt = values[key] as number | null;
    else if (key === 'meta') state.meta = cloneTournament(values[key]) as TournamentV1['meta'];
    else if (key === 'controller') state.controller = cloneTournament(values[key]) as TournamentV1['controller'];
    else {
      const [collection, id] = key.split(':') as [typeof collections[number], string];
      const list = state[collection] as unknown as Array<{ id: string }>;
      const index = list.findIndex((item) => item.id === id);
      const value = values[key];
      if (value === null && index >= 0) list.splice(index, 1);
      else if (index >= 0) list[index] = cloneTournament(value) as { id: string };
      else if (value !== null) list.push(cloneTournament(value) as { id: string });
    }
  }
}

function validateMetadata(state: TournamentV1): void {
  invariant(state.meta.title.trim().length > 0 && state.meta.title.trim().length <= 80, 'TITLE', 'Title must be from 1 to 80 characters.', 'title');
  if (state.meta.endsAt && state.meta.startsAt) invariant(Date.parse(state.meta.endsAt) > Date.parse(state.meta.startsAt), 'END_TIME', 'End must be after start.', 'endsAt');
  try { new Intl.DateTimeFormat('en', { timeZone: state.meta.timeZone }).format(); } catch { throw new Error('Choose a valid IANA time zone.'); }
}

function promoteOldestWaiting(state: TournamentV1, divisionId: string): void {
  const next = state.entries.filter((entry) => entry.divisionId === divisionId && entry.admission === 'waiting').sort((a, b) => (a.waitRank ?? 0) - (b.waitRank ?? 0) || a.acceptedAt - b.acceptedAt)[0];
  if (next) { next.admission = 'confirmed'; next.waitRank = null; }
}

function compactWaitRanks(state: TournamentV1, divisionId: string): void {
  state.entries.filter((entry) => entry.divisionId === divisionId && entry.admission === 'waiting').sort((a, b) => (a.waitRank ?? 0) - (b.waitRank ?? 0) || a.acceptedAt - b.acceptedAt).forEach((entry, index) => { entry.waitRank = index + 1; });
}

function plannedFixture(state: TournamentV1, id: string): TournamentFixture {
  const fixture = find(state.fixtures, id, 'Fixture');
  invariant(fixture.status === 'planned', 'MATCH_STARTED', 'Only an unstarted match can be changed this way.');
  return fixture;
}

function requireSetup(state: TournamentV1): void { invariant(state.lifecycle === 'setup', 'SETUP_LOCKED', 'This setting is available before the tournament begins.'); }
function requireReason(reason: string | undefined): void { invariant(Boolean(reason?.trim()), 'REASON_REQUIRED', 'Enter a reason for this change.', 'reason'); }
function find<T extends { id: string }>(items: T[], id: string, label: string): T { const item = items.find((value) => value.id === id); invariant(item, 'NOT_FOUND', `${label} not found.`); return item; }

export function nextOwnerCommand(
  state: TournamentV1,
  input: Omit<TournamentCommandEnvelope, 'protocol' | 'contractVersion' | 'tournamentId' | 'baseRevision' | 'controllerEpoch' | 'sequence'>,
): TournamentCommandEnvelope {
  return {
    ...input,
    protocol: TOURNAMENT_PROTOCOL,
    contractVersion: TOURNAMENT_CONTRACT_VERSION,
    tournamentId: state.id,
    baseRevision: state.revision,
    controllerEpoch: state.controller.epoch,
    sequence: state.lifecycle === 'live' ? state.controller.nextSequence : 0,
  };
}

export function normalizedPublicSignupIntent(input: { tournamentId: string; divisionId: string; playerOne: string; playerTwo: string; teamName: string }): string {
  return JSON.stringify({ tournamentId: input.tournamentId, divisionId: input.divisionId, pair: normalizedPairKey(input.playerOne, input.playerTwo), teamName: normalizeName(input.teamName) });
}

export type { TournamentAuditEntry };
