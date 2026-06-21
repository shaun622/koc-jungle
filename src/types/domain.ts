export type ID = string;

export type EventStatus =
  | 'setup'
  | 'qualifier'
  | 'seeding'
  | 'round-in-progress'
  | 'between-rounds'
  | 'complete';

export type MatchStatus = 'scheduled' | 'in-progress' | 'completed';

export type TieRule = 'operator-decides' | 'team-a-wins' | 'split-points' | 'replay';

export interface PlayerAvatar {
  /** Optional uploaded photo as a data URL (typically 128×128 PNG). */
  photoDataUrl?: string;
  /** Optional custom colour (oklch). Falls back to a deterministic hash of the name. */
  color?: string;
}

export interface Player {
  id: ID;
  name: string;
  avatar?: PlayerAvatar;
}

export interface Team {
  id: ID;
  name?: string;
  players: [Player, Player];
  createdAt: number;
  active: boolean;
  /** Operator-set total that overrides the match-derived points on the
   *  standings — used to correct a wrong score after the event. */
  pointsOverride?: number;
}

export interface Court {
  id: ID;
  position: number;
  name: string;
  pointValue: number;
}

export interface Match {
  id: ID;
  courtId: ID;
  teamAId: ID;
  teamBId: ID;
  scoreA: number;
  scoreB: number;
  tieBreakWinnerId?: ID;
  status: MatchStatus;
  pointValueAtTime: number;
  /**
   * Which wave of the round this match plays in (0-based). When a round has
   * more matches than courts, the extra matches run in later waves on the
   * same courts; teams not in the current wave are "resting". Absent means
   * wave 0 — every single-wave round (KoC always, and any round with
   * matches <= courts) leaves this unset and behaves exactly as before.
   */
  wave?: number;
}

export interface TimerState {
  startedAt?: number;
  pausedAt?: number;
  totalPausedMs: number;
  durationMs: number;
}

export interface QualifierRound extends TimerState {
  matches: Match[];
  shuffleSeed: number;
  completedAt?: number;
}

export interface MainRound extends TimerState {
  id: ID;
  index: number;
  matches: Match[];
  completedAt?: number;
  /**
   * The wave currently on court (0-based). Only meaningful when the round
   * spans multiple waves (more matches than courts). Absent means wave 0.
   */
  currentWave?: number;
}

/**
 * How a qualifier match is scored / won:
 *  - 'points': best of N points, scores sum to the target (e.g. 16).
 *  - 'games':  best of N games, scores sum to the target (e.g. 6).
 *  - 'time':   timed match, each team enters its own score, no fixed sum.
 */
export type QualifierUnit = 'points' | 'games' | 'time';

export interface EventSettings {
  defaultRoundDurationMs: number;
  tieRule: TieRule;
  soundOnTimerEnd: boolean;
  warningAtMs: number;
  roundsTotal: number;
  /** When true, the operator's iPad reads "Round X. Centre Court: A and B versus C and D" at round start via the Web Speech API. */
  announceRoundStart: boolean;
  /** Optional Web Speech voiceURI; undefined means auto-pick a sensible voice. */
  announcementVoiceURI?: string;
  /** Whether the KoC qualifier round is used. When false the operator
   *  goes straight to seeding (manual or random). Default true. */
  qualifierEnabled?: boolean;
  /** What the qualifier is scored in. Default 'points'. */
  qualifierUnit?: QualifierUnit;
  /** Target number: points/games to play to, or minutes when unit is
   *  'time'. Default 16 (points). */
  qualifierTarget?: number;
}

export interface PendingAssignment {
  courtId: ID;
  teamAId: ID;
  teamBId: ID;
  /** Wave this assignment plays in (0-based). Absent means wave 0. */
  wave?: number;
}

/**
 * Tournament format identifier. Free-form string so we don't pull the
 * formats registry into the domain layer (avoids an import cycle); the
 * lookup in `src/logic/formats/index.ts` falls back to KoC for any
 * unknown / missing value, so legacy localStorage events keep working.
 */
export type TournamentFormatId =
  | 'koc'
  | 'round-robin'
  | 'americano'
  | 'mexicano'
  | 'bracket';

export interface EventState {
  id: ID;
  name: string;
  venue?: string;
  createdAt: number;
  status: EventStatus;
  settings: EventSettings;
  courts: Court[];
  teams: Team[];
  qualifier?: QualifierRound;
  rounds: MainRound[];
  pendingAssignments?: PendingAssignment[];
  /**
   * Tournament format. Optional + defaults to 'koc' so events created
   * before Stage 2.1 keep working without a migration.
   */
  format?: TournamentFormatId;
  /** Format-specific config (e.g. Round Robin group size). */
  formatConfig?: Record<string, unknown>;
}

export const DEFAULT_SETTINGS: EventSettings = {
  defaultRoundDurationMs: 20 * 60 * 1000,
  tieRule: 'operator-decides',
  soundOnTimerEnd: true,
  warningAtMs: 60 * 1000,
  roundsTotal: 6,
  announceRoundStart: false,
  qualifierEnabled: true,
  qualifierUnit: 'points',
  qualifierTarget: 16,
};

export function isCentreCourt(court: Court, courts: Court[]): boolean {
  const maxPosition = courts.reduce((m, c) => Math.max(m, c.position), 0);
  return court.position === maxPosition;
}
