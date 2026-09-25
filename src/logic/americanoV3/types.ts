import type {
  Court,
  EventSettings,
  EventStatus,
  Team,
  TimerState,
} from '@/types/domain';
import type {
  AmericanoCoverageMetricsV2,
  AmericanoScheduleV2,
  AmericanoSide,
  AmericanoSideView,
  IndividualEntrant,
  PairingMode,
} from '@/logic/americanoV2/types';
import type { RuleProfile } from '../../../supabase/functions/_shared/tournament/types';

export type TraditionalPresetKey =
  | 'first-to-five'
  | 'short-set'
  | 'standard-set'
  | 'best-of-three'
  | 'best-of-three-match-tiebreak'
  | 'custom';

export type TraditionalRule = Pick<RuleProfile,
  'family' | 'bestOfSets' | 'gamesToWin' | 'gameMargin' |
  'tiebreakTrigger' | 'tiebreakTarget' | 'decidingMatchTiebreak' | 'gameEnding'>;

export type MatchScoringV3 =
  | { kind: 'rally'; pointsPerMatch: number }
  | {
    kind: 'traditional';
    preset: TraditionalPresetKey;
    rule: TraditionalRule;
    standings: { pointsPerGameWon: number; matchWinBonus: number };
  };

export type RankingTiebreakV3 = 'shared' | 'difference' | 'head-to-head' | 'head-to-head-then-difference';
export type ChampionshipPolicyV3 = 'none' | 'golden-point' | 'tiebreak-7' | 'tiebreak-10';

export interface AmericanoConfigV3 {
  rulesVersion: 3;
  pairingMode: PairingMode;
  scoring: MatchScoringV3;
  ranking: {
    tiebreak: RankingTiebreakV3;
    championship: ChampionshipPolicyV3;
  };
  scheduleKind: 'full' | 'balanced' | 'custom';
  customRounds?: number;
  paceMinutes: 5 | 10 | 15 | 20 | 25 | 30;
  paceClockEnabled: boolean;
}

export interface AmericanoScheduleV3 extends Omit<AmericanoScheduleV2, 'algorithmVersion'> {
  algorithmVersion: AmericanoScheduleV2['algorithmVersion'];
  fingerprintVersion: 3;
}

export interface SetDraftV3 {
  kind: 'set';
  gamesA: number | null;
  gamesB: number | null;
  tiebreakPointsA: number | null;
  tiebreakPointsB: number | null;
}

export interface MatchTiebreakDraftV3 {
  kind: 'match-tiebreak';
  pointsA: number | null;
  pointsB: number | null;
}

export type TraditionalRowDraftV3 = SetDraftV3 | MatchTiebreakDraftV3;

export type AmericanoResultDraftV3 =
  | { kind: 'rally'; scoreA: number | null; scoreB: number | null }
  | { kind: 'traditional'; sets: TraditionalRowDraftV3[] };

export interface AmericanoMatchV3 {
  id: string;
  courtId: string;
  sideA: AmericanoSide;
  sideB: AmericanoSide;
  result: AmericanoResultDraftV3;
  resultConfirmed: boolean;
}

export interface AmericanoRoundV3 extends TimerState {
  id: string;
  index: number;
  fixtureRoundId: string;
  matches: AmericanoMatchV3[];
  completedAt?: number;
  excludedReason?: 'ended-early';
}

export type ChampionshipOutcomeV3 =
  | { kind: 'golden-point'; winner: 'A' | 'B'; confirmedAt: number }
  | { kind: 'tiebreak'; pointsA: number; pointsB: number; confirmedAt: number };

export interface ChampionshipFinalV3 {
  id: string;
  basisFingerprint: string;
  contenderIds: [string, string];
  courtId: string;
  supportPlayerIds: [string, string] | null;
  outcome: ChampionshipOutcomeV3 | null;
}

export interface AmericanoEventStateV3 {
  schemaVersion: 3;
  protocolVersion: 2;
  revision: string;
  id: string;
  name: string;
  venue?: string;
  createdAt: number;
  status: EventStatus;
  settings: EventSettings;
  courts: Court[];
  teams: Team[];
  participants: IndividualEntrant[];
  rounds: AmericanoRoundV3[];
  pendingAssignments?: import('@/logic/americanoV2/types').AmericanoPendingAssignmentV2[];
  format: 'americano';
  formatConfig: AmericanoConfigV3;
  americanoSchedule?: AmericanoScheduleV3;
  completionReason?: 'scheduled' | 'early';
  championshipFinal?: ChampionshipFinalV3;
}

export interface AmericanoStandingV3 {
  entrantId: string;
  rank: number;
  total: number;
  matchesPlayed: number;
  unitsFor: number;
  unitsAgainst: number;
  wins: number;
  draws: number;
  losses: number;
  setsFor: number;
  setsAgainst: number;
}

export type ScheduleMetricsV3 = AmericanoCoverageMetricsV2;
export type SideViewV3 = AmericanoSideView;
