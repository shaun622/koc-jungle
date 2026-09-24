import { invariant } from './errors';
import { validateDecimal, validateDomainId, validateUuid } from './protocol';
import { cloneTournament, validateTournament } from './state';
import { TOURNAMENT_CONTRACT_VERSION, type TournamentV1 } from './types';

export type TournamentGrantAction = 'begin' | 'claim' | 'takeover' | 'reopen';

export interface TournamentGrantRequest {
  contractVersion: typeof TOURNAMENT_CONTRACT_VERSION;
  action: TournamentGrantAction;
  operationId: string;
  tournamentId: string;
  baseRevision: string;
  expectedEpoch: string;
  deviceId: string;
  nonce: string;
  reason: string | null;
  acknowledgeInaccessibleWork: boolean;
}

export interface TournamentReleaseRequest {
  contractVersion: typeof TOURNAMENT_CONTRACT_VERSION;
  action: 'release';
  operationId: string;
  tournamentId: string;
  baseRevision: string;
  expectedEpoch: string;
  expectedSequence: number;
  deviceId: string;
  reason: string | null;
}

export function createGrantNonce(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return btoa(String.fromCharCode(...bytes)).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/g, '');
}

export function validateGrantRequest(value: TournamentGrantRequest): TournamentGrantRequest {
  invariant(value.contractVersion === TOURNAMENT_CONTRACT_VERSION, 'CONTRACT_VERSION', 'Tournament contract version 2 is required.', 'contractVersion');
  invariant(['begin','claim','takeover','reopen'].includes(value.action), 'GRANT_ACTION', 'Unsupported controller grant action.', 'action');
  validateUuid(value.operationId, 'operationId'); validateUuid(value.tournamentId, 'tournamentId');
  validateDecimal(value.baseRevision, 'baseRevision'); validateDecimal(value.expectedEpoch, 'expectedEpoch');
  validateDomainId(value.deviceId, 'deviceId');
  invariant(/^[A-Za-z0-9_-]{43}$/.test(value.nonce), 'GRANT_NONCE', 'Controller nonce must contain 256 random bits.', 'nonce');
  invariant(value.reason === null || typeof value.reason === 'string' && value.reason.trim().length > 0 && value.reason.length <= 500, 'GRANT_REASON', 'Reason must be 500 characters or fewer.', 'reason');
  invariant(typeof value.acknowledgeInaccessibleWork === 'boolean', 'GRANT_ACK', 'Takeover acknowledgement is required.', 'acknowledgeInaccessibleWork');
  if (value.action === 'takeover') {
    invariant(value.acknowledgeInaccessibleWork, 'GRANT_ACK', 'Acknowledge that another device may have inaccessible work.', 'acknowledgeInaccessibleWork');
    invariant(Boolean(value.reason?.trim()), 'REASON_REQUIRED', 'Enter a reason for forced takeover.', 'reason');
  }
  if (value.action === 'reopen') invariant(Boolean(value.reason?.trim()), 'REASON_REQUIRED', 'Enter a reason for reopening.', 'reason');
  return value;
}

export function validateReleaseRequest(value: TournamentReleaseRequest): TournamentReleaseRequest {
  invariant(value.contractVersion === TOURNAMENT_CONTRACT_VERSION && value.action === 'release', 'RELEASE_ACTION', 'Invalid controller release.', 'action');
  validateUuid(value.operationId, 'operationId'); validateUuid(value.tournamentId, 'tournamentId');
  validateDecimal(value.baseRevision, 'baseRevision'); validateDecimal(value.expectedEpoch, 'expectedEpoch'); validateDomainId(value.deviceId, 'deviceId');
  invariant(Number.isSafeInteger(value.expectedSequence) && value.expectedSequence >= 1, 'COMMAND_SEQUENCE', 'Release sequence is invalid.', 'expectedSequence');
  invariant(value.reason === null || typeof value.reason === 'string' && value.reason.length <= 500, 'REASON_LENGTH', 'Reason must be 500 characters or fewer.', 'reason');
  return value;
}

export function applyAuthorityGrantState(state: TournamentV1, request: TournamentGrantRequest, actorId: string, acceptedAt: number): TournamentV1 {
  validateTournament(state); validateGrantRequest(request);
  invariant(state.id === request.tournamentId, 'COMMAND_SCOPE', 'Grant belongs to another tournament.');
  invariant(state.revision === request.baseRevision, 'REVISION_CONFLICT', 'Tournament changed before controller grant.');
  invariant(state.controller.epoch === request.expectedEpoch, 'CONTROLLER_EPOCH', 'Controller authority changed.');
  if (request.action === 'begin') invariant(state.lifecycle === 'setup', 'LIFECYCLE', 'Only setup tournaments can begin.');
  if (request.action === 'claim') {
    invariant(state.lifecycle === 'live', 'LIFECYCLE', 'Only a live released tournament can be claimed.');
    invariant(state.controller.deviceId === null, 'AUTHORITY_ACTIVE', 'Another device currently controls this tournament.');
  }
  if (request.action === 'takeover') invariant(state.lifecycle === 'live', 'LIFECYCLE', 'Only a live tournament can be taken over.');
  if (request.action === 'reopen') invariant(state.lifecycle === 'complete' || state.lifecycle === 'cancelled', 'LIFECYCLE', 'Only a closed tournament can be reopened.');
  const next = cloneTournament(state); const nextRevision = String(BigInt(state.revision) + 1n); const nextEpoch = String(BigInt(state.controller.epoch) + 1n);
  const before = { lifecycle: state.lifecycle, controller: state.controller, signupOpen: state.meta.signupOpen };
  next.lifecycle = 'live'; next.meta.signupOpen = false; next.controller = { deviceId: request.deviceId, epoch: nextEpoch, nextSequence: 1 };
  next.revision = nextRevision; next.updatedAt = acceptedAt;
  next.audit.push({ commandId: request.operationId, kind: `authority-${request.action}`, actorId, at: acceptedAt, reason: request.reason?.trim() ?? '', touchedIds: [state.id], before, after: { lifecycle: next.lifecycle, controller: next.controller, signupOpen: next.meta.signupOpen }, resultingRevision: nextRevision });
  return validateTournament(next);
}

export function applyAuthorityReleaseState(state: TournamentV1, request: TournamentReleaseRequest, actorId: string, acceptedAt: number): TournamentV1 {
  validateTournament(state); validateReleaseRequest(request);
  invariant(state.id === request.tournamentId && state.revision === request.baseRevision, 'REVISION_CONFLICT', 'Tournament changed before release.');
  invariant(state.lifecycle === 'live' && state.controller.deviceId === request.deviceId && state.controller.epoch === request.expectedEpoch && state.controller.nextSequence === request.expectedSequence, 'AUTHORITY_CHANGED', 'Controller authority changed.');
  const next = cloneTournament(state); const nextRevision = String(BigInt(state.revision) + 1n); const nextEpoch = String(BigInt(state.controller.epoch) + 1n);
  const before = { controller: state.controller };
  next.controller = { deviceId: null, epoch: nextEpoch, nextSequence: 0 }; next.revision = nextRevision; next.updatedAt = acceptedAt;
  next.audit.push({ commandId: request.operationId, kind: 'authority-release', actorId, at: acceptedAt, reason: request.reason?.trim() ?? '', touchedIds: [state.id], before, after: { controller: next.controller }, resultingRevision: nextRevision });
  return validateTournament(next);
}
