import { invariant } from './errors';
import { cloneTournament, resolveFixtureSources } from './state';
import type { FixtureSource, TournamentFixture, TournamentResult, TournamentV1 } from './types';
import { computeGroupStandings, standingsFingerprint, type StandingsPolicy } from './standings';

export type StartedResolution = { fixtureId: string; action: 'keep-as-played' | 'void-and-replay'; reason: string; replacementFixtureId?: string };
export type QualificationReconfirmation = { stageId: string; orderedByGroup: Record<string, string[]>; policy: StandingsPolicy; reason: string };

export interface CorrectionImpact {
  fixtureId: string;
  oldEntryIds: [string | null, string | null];
  newEntryIds: [string | null, string | null];
  status: TournamentFixture['status'];
  resolutionRequired: boolean;
}

export interface CorrectionPreview {
  baseRevision: string;
  correctedFixtureId: string;
  impacts: CorrectionImpact[];
  invalidatedStageIds: string[];
  requiredResolutionFixtureIds: string[];
  clearFixtureDraftIds: string[];
  scheduleReviewFixtureIds: string[];
  fingerprint: string;
}

export function previewResultCorrection(state: TournamentV1, fixtureId: string, nextResult: TournamentResult): CorrectionPreview {
  const candidate = cloneTournament(state);
  const fixture = candidate.fixtures.find((item) => item.id === fixtureId);
  invariant(fixture?.actualEntryIds, 'FIXTURE_NOT_FOUND', 'Completed fixture not found.');
  invariant(fixture.status === 'completed', 'CORRECTION_STATUS', 'Only a confirmed completed result uses result correction.');
  fixture.result = nextResult;
  const before = new Map(state.fixtures.map((item) => [item.id, [item.resolvedEntryAId, item.resolvedEntryBId] as [string | null, string | null]]));
  const impacts = candidate.fixtures.flatMap((item): CorrectionImpact[] => {
    const oldEntryIds = before.get(item.id) ?? [null, null];
    const newEntryIds: [string | null, string | null] = [projectedSource(candidate,item.sideA),projectedSource(candidate,item.sideB)];
    if (oldEntryIds[0] === newEntryIds[0] && oldEntryIds[1] === newEntryIds[1]) return [];
    return [{ fixtureId: item.id, oldEntryIds, newEntryIds, status: item.status, resolutionRequired: item.status !== 'planned' && item.status !== 'resolved-bye' }];
  });
  const corrected = state.fixtures.find((item) => item.id === fixtureId)!;
  const invalidatedStageIds = state.stages.filter((stage) => stage.qualificationFingerprint && (corrected.stageId === stage.id || stage.groupIds.includes(corrected.groupId ?? ''))).map((stage) => stage.id);
  const requiredResolutionFixtureIds = impacts.filter((impact) => impact.resolutionRequired).map((impact) => impact.fixtureId).sort();
  const clearFixtureDraftIds = impacts.filter((impact) => impact.oldEntryIds[0] !== impact.newEntryIds[0] || impact.oldEntryIds[1] !== impact.newEntryIds[1]).map((impact) => impact.fixtureId).sort();
  const scheduleReviewFixtureIds = [...clearFixtureDraftIds];
  const content = { baseRevision: state.revision, correctedFixtureId: fixtureId, impacts, invalidatedStageIds, requiredResolutionFixtureIds, clearFixtureDraftIds, scheduleReviewFixtureIds };
  return { ...content, fingerprint: correctionFingerprint(content) };
}

function projectedSource(state:TournamentV1,source:FixtureSource):string|null {
  if(source.kind==='entry')return source.entryId;
  if(source.kind==='bye')return null;
  if(source.kind==='group-position')return state.groups.find((group)=>group.id===source.groupId)?.qualifierOrder?.[source.position-1]??null;
  const upstream=state.fixtures.find((fixture)=>fixture.id===source.fixtureId);
  if(!upstream)return null;
  if(upstream.status==='resolved-bye')return upstream.resolvedEntryAId??upstream.resolvedEntryBId;
  if(upstream.status!=='completed'||!upstream.result||!upstream.actualEntryIds)return null;
  if(source.kind==='winner-of-match')return upstream.result.winnerEntryId;
  return upstream.actualEntryIds.find((entryId)=>entryId!==upstream.result!.winnerEntryId)??null;
}

export function applyResultCorrection(input: {
  state: TournamentV1;
  fixtureId: string;
  nextResult: TournamentResult;
  preview: CorrectionPreview;
  resolutions: StartedResolution[];
  now: number;
  reconfirmations?: QualificationReconfirmation[];
}): TournamentV1 {
  invariant(input.preview.baseRevision === input.state.revision, 'STALE_PREVIEW', 'The tournament changed after this correction was reviewed. Preview it again.');
  invariant(input.preview.fingerprint === correctionFingerprint(input.preview), 'CORRECTION_FINGERPRINT', 'The reviewed correction changed before Apply.');
  const fresh = previewResultCorrection(input.state, input.fixtureId, input.nextResult);
  invariant(fresh.fingerprint === input.preview.fingerprint, 'STALE_PREVIEW', 'The correction impact changed. Preview it again.');
  const reconfirmed = [...new Set((input.reconfirmations ?? []).map((item) => item.stageId))].sort();
  invariant(JSON.stringify(reconfirmed) === JSON.stringify([...fresh.invalidatedStageIds].sort()), 'QUALIFICATION_RECONFIRM', 'Every invalidated qualification must be explicitly reconfirmed in this correction.');
  const required = fresh.requiredResolutionFixtureIds;
  invariant(input.resolutions.length === required.length, 'CORRECTION_RESOLUTION_SET', 'Provide exactly one decision for every affected started match.');
  invariant(new Set(input.resolutions.map((resolution) => resolution.fixtureId)).size === input.resolutions.length, 'CORRECTION_RESOLUTION_SET', 'Duplicate descendant decisions are not allowed.');
  invariant(input.resolutions.every((resolution) => required.includes(resolution.fixtureId)), 'CORRECTION_RESOLUTION_SET', 'A descendant decision does not belong to this correction.');
  const resolutionById = new Map(input.resolutions.map((item) => [item.fixtureId, item]));
  for (const impact of fresh.impacts.filter((item) => item.resolutionRequired)) {
    const resolution = resolutionById.get(impact.fixtureId);
    invariant(resolution && resolution.reason.trim(), 'CORRECTION_RESOLUTION', `Choose how to resolve ${impact.fixtureId}.`);
    if (resolution.action === 'void-and-replay') {
      invariant(resolution.replacementFixtureId, 'REPLAY_ID', 'A replacement fixture ID is required.');
      invariant(!input.state.fixtures.some((fixture) => fixture.id === resolution.replacementFixtureId), 'REPLAY_ID_COLLISION', 'Replacement fixture ID already exists.');
    }
  }
  const replacementIds = input.resolutions.flatMap((resolution) => resolution.replacementFixtureId ? [resolution.replacementFixtureId] : []);
  invariant(new Set(replacementIds).size === replacementIds.length, 'REPLAY_ID_COLLISION', 'Replacement fixture IDs must be unique.');

  let next = cloneTournament(input.state);
  const corrected = next.fixtures.find((item) => item.id === input.fixtureId)!;
  corrected.result = input.nextResult;
  next.stages.forEach((stage) => {
    if (fresh.invalidatedStageIds.includes(stage.id)) {
      stage.qualificationConfirmedAt = null;
      stage.qualificationFingerprint = null;
    }
  });
  next = resolveFixtureSources(next);

  for (const impact of fresh.impacts) {
    const fixture = next.fixtures.find((item) => item.id === impact.fixtureId)!;
    if (!impact.resolutionRequired) {
      fixture.liveScore = null;
      continue;
    }
    const resolution = resolutionById.get(impact.fixtureId)!;
    if (resolution.action === 'keep-as-played') {
      fixture.resolvedEntryAId = fixture.actualEntryIds?.[0] ?? impact.oldEntryIds[0];
      fixture.resolvedEntryBId = fixture.actualEntryIds?.[1] ?? impact.oldEntryIds[1];
      next.qualificationDecisions.push({
        id: correctionDecisionId('exception', input.fixtureId, impact.fixtureId, input.now),
        stageId: fixture.stageId,
        sourceFingerprint: fixture.sourceFingerprint,
        orderedEntryIds: fixture.actualEntryIds ? [...fixture.actualEntryIds] : impact.oldEntryIds.filter(Boolean) as string[],
        manual: true,
        reason: resolution.reason.trim(),
        createdAt: input.now,
        policy: { winPoints: 2, lossPoints: 0, includeSetDifference: false },
        destinationRanks: [],
        plateRulings: [],
      });
    } else {
      fixture.status = 'voided';
      fixture.voidReason = resolution.reason.trim();
      const replacement: TournamentFixture = {
        ...cloneTournament(fixture),
        id: resolution.replacementFixtureId!,
        status: 'planned',
        resolvedEntryAId: impact.newEntryIds[0],
        resolvedEntryBId: impact.newEntryIds[1],
        actualEntryIds: null,
        actualPlayerIds: null,
        actualRuleProfile: null,
        actualStartAt: null,
        actualEndAt: null,
        courtId: null,
        pinned: false,
        result: null,
        liveScore: null,
        voidReason: null,
        label: `${fixture.label} replay`,
      };
      next.fixtures.push(replacement);
      retargetFutureSources(next, fixture.id, replacement.id);
    }
  }
  next = resolveFixtureSources(next);
  for (const reconfirmation of input.reconfirmations ?? []) {
    const stage = next.stages.find((item) => item.id === reconfirmation.stageId);
    invariant(stage, 'QUALIFICATION_STAGE', 'Qualification stage no longer exists.');
    let manual = stage.amended;
    for (const groupId of stage.groupIds) {
      const group = next.groups.find((item) => item.id === groupId);
      invariant(group, 'QUALIFICATION_GROUP', 'Qualification group no longer exists.');
      const order = reconfirmation.orderedByGroup[groupId];
      invariant(Array.isArray(order) && order.length === group.entryIds.length && new Set(order).size === order.length && order.every((id) => group.entryIds.includes(id)), 'QUALIFIER_ORDER', 'Reconfirmed qualification must contain a full group permutation.');
      const standings = computeGroupStandings(next, groupId, reconfirmation.policy);
      manual ||= !standings.complete || standings.unresolvedCohorts.length > 0 || JSON.stringify(order) !== JSON.stringify(standings.rows.map((row) => row.entryId));
      group.qualifierOrder = [...order];
    }
    if (manual) invariant(reconfirmation.reason.trim().length > 0, 'QUALIFIER_REASON', 'Manual qualification reconfirmation needs a reason.');
    const fingerprint = standingsFingerprint(next, stage.groupIds);
    stage.qualificationConfirmedAt = input.now;
    stage.qualificationFingerprint = fingerprint;
    stage.standingsPolicy = cloneTournament(reconfirmation.policy);
    next.qualificationDecisions.push({
      id: correctionDecisionId('reconfirm', stage.id, input.fixtureId, input.now),
      stageId: stage.id,
      sourceFingerprint: fingerprint,
      orderedEntryIds: stage.groupIds.flatMap((groupId) => reconfirmation.orderedByGroup[groupId]),
      manual,
      reason: reconfirmation.reason.trim(),
      createdAt: input.now,
      policy: cloneTournament(reconfirmation.policy),
      destinationRanks: cloneTournament(stage.qualificationDestinations),
      plateRulings: cloneTournament(stage.plateRulings),
    });
  }
  return next;
}

function retargetFutureSources(state: TournamentV1, oldId: string, replacementId: string): void {
  for (const fixture of state.fixtures) {
    if (fixture.status !== 'planned' && fixture.status !== 'resolved-bye') continue;
    for (const sideName of ['sideA', 'sideB'] as const) {
      const side = fixture[sideName];
      if ((side.kind === 'winner-of-match' || side.kind === 'loser-of-match') && side.fixtureId === oldId) {
        fixture[sideName] = { ...side, fixtureId: replacementId };
      }
    }
  }
}

function correctionFingerprint(value: Omit<CorrectionPreview, 'fingerprint'> | CorrectionPreview): string {
  const { fingerprint: _ignored, ...content } = value as CorrectionPreview;
  const input = JSON.stringify(content);
  let hash = 2_166_136_261;
  for (let index = 0; index < input.length; index += 1) hash = Math.imul(hash ^ input.charCodeAt(index), 16_777_619);
  return (hash >>> 0).toString(16).padStart(8, '0');
}

function correctionDecisionId(prefix: string, ...parts: Array<string | number>): string {
  const input = parts.join('|');
  let hash = 2_166_136_261;
  for (let index = 0; index < input.length; index += 1) hash = Math.imul(hash ^ input.charCodeAt(index), 16_777_619);
  return `${prefix}-${(hash >>> 0).toString(16).padStart(8, '0')}`;
}
