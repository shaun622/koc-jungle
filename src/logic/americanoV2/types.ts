import type {
  Court,
  EventSettings,
  EventStatus,
  ID,
  PlayerAvatar,
  Team,
  TimerState,
} from '@/types/domain';

export const AMERICANO_V2_ALGORITHM_VERSION = 'americano-v2.1' as const;

export type PairingMode = 'rotating' | 'fixed';
export type ScheduleKind = 'full' | 'balanced' | 'custom';
export type AmericanoPointsPerMatch = number;
// Matches PostgreSQL's integer range and keeps 64-round totals exact in JS.
export const MAX_AMERICANO_POINTS = 2_147_483_647;
export function isValidAmericanoPoints(value: unknown): value is AmericanoPointsPerMatch {
  return typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= MAX_AMERICANO_POINTS;
}
export type AmericanoPaceMinutes = 5 | 10 | 15 | 20 | 25 | 30;

export interface AmericanoConfigV2 {
  rulesVersion: 2;
  pairingMode: PairingMode;
  pointsPerMatch: AmericanoPointsPerMatch;
  scheduleKind: ScheduleKind;
  customRounds?: number;
  paceMinutes: AmericanoPaceMinutes;
  paceClockEnabled: boolean;
}

export interface IndividualEntrant {
  id: ID;
  name: string;
  avatar?: PlayerAvatar;
  active: boolean;
  createdAt: number;
  signupRegistrationId?: string;
}

export type AmericanoSide =
  | { kind: 'fixed-team'; teamId: string; playerIds: [string, string] }
  | { kind: 'rotating-pair'; playerIds: [string, string] };

export interface AmericanoMatchV2 {
  id: string;
  courtId: string;
  sideA: AmericanoSide;
  sideB: AmericanoSide;
  scoreA: number | null;
  scoreB: number | null;
  resultConfirmed: boolean;
}

export interface AmericanoRoundV2 extends TimerState {
  id: string;
  index: number;
  fixtureRoundId: string;
  matches: AmericanoMatchV2[];
  completedAt?: number;
  excludedReason?: 'ended-early';
}

export interface AmericanoScheduleMatchV2 {
  id: string;
  courtId: string;
  sideA: AmericanoSide;
  sideB: AmericanoSide;
}

export interface AmericanoScheduleRoundV2 {
  id: string;
  index: number;
  matches: AmericanoScheduleMatchV2[];
  restingEntrantIds: string[];
  unusedCourtIds: string[];
}

export interface AmericanoCoverageMetricsV2 {
  appearances: Record<string, number>;
  rests: Record<string, number>;
  uniquePartners: Record<string, number>;
  uniqueOpponents: Record<string, number>;
  minimumPartnerFrequency: number;
  maximumPartnerFrequency: number;
  minimumOpponentFrequency: number;
  maximumOpponentFrequency: number;
  repeatedCompleteMatchups: number;
  appearancesEqual: boolean;
  maximumAppearanceSpread: number;
}

export interface AmericanoScheduleAcknowledgementsV2 {
  fingerprint: string;
  unevenAppearances: boolean;
  repeatedCycle: boolean;
}

export interface AmericanoScheduleV2 {
  id: string;
  algorithmVersion: typeof AMERICANO_V2_ALGORITHM_VERSION;
  seed: number;
  inputFingerprint: string;
  orderedEntrantIds: string[];
  courtIds: string[];
  rounds: AmericanoScheduleRoundV2[];
  metrics: AmericanoCoverageMetricsV2;
  acknowledgements: AmericanoScheduleAcknowledgementsV2;
  rosterRevision: string;
}

export interface AmericanoPendingAssignmentV2 {
  fixtureId: string;
  courtId: string;
  sideA: AmericanoSide;
  sideB: AmericanoSide;
}

export interface AmericanoEventStateV2 {
  schemaVersion: 2;
  protocolVersion: 2;
  revision: string;
  id: ID;
  name: string;
  venue?: string;
  createdAt: number;
  status: EventStatus;
  settings: EventSettings;
  courts: Court[];
  teams: Team[];
  participants: IndividualEntrant[];
  rounds: AmericanoRoundV2[];
  pendingAssignments?: AmericanoPendingAssignmentV2[];
  format: 'americano';
  formatConfig: AmericanoConfigV2;
  americanoSchedule?: AmericanoScheduleV2;
  completionReason?: 'scheduled' | 'early';
}

export interface AmericanoEntrantView {
  id: string;
  primaryLabel: string;
  secondaryLabel?: string;
  playerIds: string[];
}

export interface AmericanoSideView {
  key: string;
  primaryLabel: string;
  secondaryLabel: string;
  entrantIds: string[];
  playerIds: [string, string];
}

export type VersionedEventState = import('@/logic/eventVersions').VersionedEventState;

export function isAmericanoEventV2(event: VersionedEventState): event is AmericanoEventStateV2 {
  return event.schemaVersion === 2;
}
