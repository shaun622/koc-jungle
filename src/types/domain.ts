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
}

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
}

export interface PendingAssignment {
  courtId: ID;
  teamAId: ID;
  teamBId: ID;
}

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
}

export const DEFAULT_SETTINGS: EventSettings = {
  defaultRoundDurationMs: 20 * 60 * 1000,
  tieRule: 'operator-decides',
  soundOnTimerEnd: true,
  warningAtMs: 60 * 1000,
  roundsTotal: 6,
  announceRoundStart: false,
};

export function isCentreCourt(court: Court, courts: Court[]): boolean {
  const maxPosition = courts.reduce((m, c) => Math.max(m, c.position), 0);
  return court.position === maxPosition;
}
