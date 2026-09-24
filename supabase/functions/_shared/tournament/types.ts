export const TOURNAMENT_PROTOCOL = 'tournament-v1' as const;
export const TOURNAMENT_DATA_VERSION = 2 as const;
export const TOURNAMENT_CONTRACT_VERSION = 2 as const;
export const TOURNAMENT_PROJECTION_VERSION = 2 as const;
export const TOURNAMENT_LIMITS = {
  confirmedEntries: 64,
  waitingEntries: 128,
  courts: 16,
  activeFixtures: 2_048,
} as const;

export type TournamentId = string;
export type TournamentDomainId = string;
export type TournamentLifecycle = 'setup' | 'live' | 'complete' | 'cancelled';
export type EntryAdmission = 'confirmed' | 'waiting' | 'cancelled';
export type EntryReadiness = 'not-checked-in' | 'ready' | 'late' | 'withdrawn';
export type FixtureStatus = 'planned' | 'playing' | 'suspended' | 'completed' | 'voided' | 'resolved-bye';
export type StageKind = 'manual' | 'group' | 'knockout' | 'plate';
export type GameEnding = 'advantage' | 'golden-point' | 'star-point';
export type ResultKind = 'played' | 'walkover' | 'retirement' | 'administrative';
export type MatchFamily = 'games' | 'sets';

export interface TournamentMeta {
  title: string;
  venue: string;
  timeZone: string;
  startsAt: string | null;
  endsAt: string | null;
  notes: string;
  publicSlug: string | null;
  signupOpen: boolean;
}

export interface TournamentDivision {
  id: string;
  name: string;
  capacity: number;
  drawPublishedAt: number | null;
  automaticPromotion: boolean;
}

export interface TournamentPlayer {
  id: string;
  name: string;
}

export interface TournamentEntry {
  id: string;
  divisionId: string;
  teamName: string;
  playerIds: [string, string];
  admission: EntryAdmission;
  readiness: EntryReadiness;
  acceptedAt: number;
  waitRank: number | null;
  activeLineupRevisionId: string;
}

export interface TournamentLineupRevision {
  id: string;
  entryId: string;
  playerIds: [string, string];
  effectiveFixtureIds: string[];
  createdAt: number;
  reason: string;
}

export interface TournamentCourt {
  id: string;
  name: string;
  displayOrder: number;
  available: boolean;
  availabilityWindows: Array<{ startsAt: string; endsAt: string }> | null;
}

export interface RuleProfile {
  id: string;
  version: number;
  name: string;
  family: MatchFamily;
  bestOfSets: 1 | 3;
  gamesToWin: number;
  gameMargin: 1 | 2;
  tiebreakTrigger: null | number;
  tiebreakTarget: number | null;
  decidingMatchTiebreak: null | 7 | 10;
  gameEnding: GameEnding;
  estimatedMinutes: number;
  restMinutes: number;
}

export interface TournamentStandingsPolicy {
  winPoints: number;
  lossPoints: number;
  includeSetDifference: boolean;
  explicitOrder?: string[];
}

export interface TournamentQualificationBand {
  id: string;
  name: string;
  positions: number[];
  destinationStageId: string | null;
}

export interface TournamentQualificationDestination {
  groupId: string;
  position: number;
  destinationStageId: string;
  slotIndex: number;
}

export interface TournamentPlateRuling {
  entryId: string;
  decision: 'include' | 'exclude';
  reason: string;
}

export interface TournamentStage {
  id: string;
  divisionId: string;
  name: string;
  kind: StageKind;
  order: number;
  entryIds: string[];
  groupIds: string[];
  defaultRuleProfileId: string;
  qualificationConfirmedAt: number | null;
  qualificationFingerprint: string | null;
  amended: boolean;
  closedAt: number | null;
  standingsPolicy: TournamentStandingsPolicy;
  seedMode: 'entered' | 'seeded' | 'shuffle';
  seedOrder: string[];
  shuffleSeed: string | null;
  qualificationBands: TournamentQualificationBand[];
  qualificationDestinations: TournamentQualificationDestination[];
  plateSourceStageId: string | null;
  plateDependencyFingerprint: string | null;
  plateRulings: TournamentPlateRuling[];
}

export interface TournamentGroup {
  id: string;
  stageId: string;
  name: string;
  entryIds: string[];
  fixtureIds: string[];
  qualifierOrder: string[] | null;
}

export type FixtureSource =
  | { kind: 'entry'; entryId: string }
  | { kind: 'winner-of-match'; fixtureId: string }
  | { kind: 'loser-of-match'; fixtureId: string }
  | { kind: 'group-position'; groupId: string; position: number }
  | { kind: 'bye' };

export interface TournamentSetScore {
  gamesA: number;
  gamesB: number;
  tiebreakPointsA?: number;
  tiebreakPointsB?: number;
  decidingMatchTiebreak?: boolean;
}

export interface TournamentScore {
  sets: TournamentSetScore[];
}

export interface TournamentResult {
  revision: number;
  kind: ResultKind;
  winnerEntryId: string;
  score: TournamentScore | null;
  reportedScore?: TournamentScore | null;
  reason: string;
  confirmedAt: number;
  retrospective: boolean;
}

export interface TournamentFixture {
  id: string;
  divisionId: string;
  stageId: string;
  groupId: string | null;
  label: string;
  sideA: FixtureSource;
  sideB: FixtureSource;
  resolvedEntryAId: string | null;
  resolvedEntryBId: string | null;
  ruleProfileId: string;
  status: FixtureStatus;
  courtId: string | null;
  queueOrder: number;
  plannedStartAt: string | null;
  pinned: boolean;
  actualStartAt: number | null;
  actualEndAt: number | null;
  actualEntryIds: [string, string] | null;
  actualPlayerIds: [[string, string], [string, string]] | null;
  /** Immutable rules snapshot captured at first Start or retrospective result. */
  actualRuleProfile: RuleProfile | null;
  liveScore: TournamentScore | null;
  result: TournamentResult | null;
  voidReason: string | null;
  sourceFingerprint: string;
  importedInterruption: boolean;
  durationOverrideMinutes: number | null;
  restOverrideMinutes: number | null;
  estimatedReleaseAt: string | null;
}

export interface TournamentScheduleSuggestion {
  fixtureId: string;
  courtId: string | null;
  plannedStartAt: string | null;
  plannedEndAt: string | null;
  reason: string;
  provisional: boolean;
}

export interface TournamentScheduleProposal {
  contractVersion: typeof TOURNAMENT_CONTRACT_VERSION;
  baseRevision: string;
  fingerprint: string;
  suggestions: TournamentScheduleSuggestion[];
}

export interface QualificationDecision {
  id: string;
  stageId: string;
  sourceFingerprint: string;
  orderedEntryIds: string[];
  manual: boolean;
  reason: string;
  createdAt: number;
  policy: TournamentStandingsPolicy;
  destinationRanks: TournamentQualificationDestination[];
  plateRulings: TournamentPlateRuling[];
}

export interface TournamentDrawProposal {
  contractVersion: typeof TOURNAMENT_CONTRACT_VERSION;
  baseRevision: string;
  fingerprint: string;
  stage: TournamentStage;
  groups: TournamentGroup[];
  fixtures: TournamentFixture[];
}

export interface TournamentGroupAmendmentProposal {
  contractVersion: typeof TOURNAMENT_CONTRACT_VERSION;
  baseRevision: string;
  fingerprint: string;
  stageId: string;
  groupId: string;
  entryId: string;
  fixtures: TournamentFixture[];
}

export interface TournamentAuditEntry {
  commandId: string;
  kind: string;
  actorId: string;
  at: number;
  reason: string;
  touchedIds: string[];
  before: Record<string, unknown>;
  after: Record<string, unknown>;
  resultingRevision: string;
  compensatesCommandId?: string;
}

export interface TournamentController {
  deviceId: string | null;
  epoch: string;
  nextSequence: number;
}

export interface TournamentV1 {
  schema: 'tournament-v1';
  dataVersion: typeof TOURNAMENT_DATA_VERSION;
  id: TournamentId;
  revision: string;
  createdAt: number;
  updatedAt: number;
  lifecycle: TournamentLifecycle;
  archivedAt: number | null;
  meta: TournamentMeta;
  controller: TournamentController;
  divisions: TournamentDivision[];
  players: TournamentPlayer[];
  entries: TournamentEntry[];
  lineupRevisions: TournamentLineupRevision[];
  courts: TournamentCourt[];
  ruleProfiles: RuleProfile[];
  stages: TournamentStage[];
  groups: TournamentGroup[];
  fixtures: TournamentFixture[];
  qualificationDecisions: QualificationDecision[];
  audit: TournamentAuditEntry[];
}

export interface TournamentPrivateContacts {
  [entryId: string]: string;
}

export type TournamentCommandKind =
  | 'update-metadata'
  | 'add-division'
  | 'update-division'
  | 'remove-division'
  | 'update-capacity'
  | 'add-entry'
  | 'add-late-entry'
  | 'add-entries'
  | 'edit-entry'
  | 'set-entry-contact'
  | 'cancel-entry'
  | 'promote-entry'
  | 'reorder-waiting'
  | 'set-readiness'
  | 'add-court'
  | 'update-court'
  | 'set-court-availability'
  | 'apply-court-closure'
  | 'add-rule-profile'
  | 'add-stage'
  | 'apply-draw-proposal'
  | 'apply-draw-bundle'
  | 'apply-group-amendment'
  | 'replace-stage-draw'
  | 'publish-draw'
  | 'add-manual-fixture'
  | 'assign-fixture'
  | 'apply-schedule'
  | 'reorder-fixtures'
  | 'assign-rule-profile'
  | 'swap-fixture-sides'
  | 'start-match'
  | 'publish-progress'
  | 'set-match-estimate'
  | 'suspend-match'
  | 'release-court'
  | 'resume-match'
  | 'confirm-result'
  | 'record-result'
  | 'confirm-qualifiers'
  | 'correct-result'
  | 'substitute-player'
  | 'void-match'
  | 'begin-event'
  | 'complete-event'
  | 'reopen-event'
  | 'cancel-event'
  | 'archive-event'
  | 'undo-command';

export interface TournamentCommandEnvelope<K extends TournamentCommandKind = TournamentCommandKind, P = Record<string, unknown>> {
  protocol: typeof TOURNAMENT_PROTOCOL;
  contractVersion: typeof TOURNAMENT_CONTRACT_VERSION;
  tournamentId: string;
  commandId: string;
  baseRevision: string;
  controllerEpoch: string;
  deviceId: string;
  sequence: number;
  kind: K;
  payload: P;
  reason?: string;
  issuedAt: number;
}

export interface TournamentCommandReceipt {
  commandId: string;
  status: 'applied' | 'replayed';
  resultingRevision: string;
  kind?: string;
  acceptedAt?: string;
}

export interface TournamentPublicResultDTO {
  kind: TournamentResult['kind'];
  winnerLabel: string;
  score: TournamentScore | null;
  reportedScore: TournamentScore | null;
  confirmedAt: number;
  retrospective: boolean;
}

export interface TournamentPublicProjection {
  protocol: typeof TOURNAMENT_PROTOCOL;
  projectionVersion: typeof TOURNAMENT_PROJECTION_VERSION;
  tournamentId: string;
  publicSlug: string;
  revision: string;
  lifecycle: TournamentLifecycle;
  title: string;
  venue: string;
  timeZone: string;
  startsAt: string | null;
  endsAt: string | null;
  signupOpen: boolean;
  divisions: Array<{ id: string; name: string; capacity: number; confirmed: number; waiting: number }>;
  entries: Array<{ id: string; divisionId: string; label: string; players: [string, string]; admission: EntryAdmission }>;
  courts: Array<{ id: string; name: string; available: boolean }>;
  fixtures: Array<{
    id: string;
    divisionId: string;
    stageId: string;
    label: string;
    entryA: string | null;
    entryB: string | null;
    playersA: [string, string] | null;
    playersB: [string, string] | null;
    courtId: string | null;
    status: FixtureStatus;
    liveScore: TournamentScore | null;
    result: TournamentPublicResultDTO | null;
    queueOrder: number;
    plannedStartAt: string | null;
    actualStartAt: number | null;
    actualEndAt: number | null;
    estimatedReleaseAt: string | null;
  }>;
  stages: Array<{ id: string; divisionId: string; name: string; kind: StageKind; order: number }>;
  standings: Array<{ groupId: string; stageId: string; name: string; rows: Array<{ position: number; label: string; players: [string, string]; played: number; wins: number; losses: number; matchPoints: number; gamesFor: number; gamesAgainst: number; tied: boolean }> }>;
  updatedAt: number;
}

export interface TournamentCommandEffects {
  clearFixtureDraftIds: string[];
  clearFormDraftKeys: string[];
  scheduleReviewFixtureIds: string[];
}

export interface TournamentReduction {
  state: TournamentV1;
  effects: TournamentCommandEffects;
}
