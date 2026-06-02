/**
 * Tournament-format abstraction (Stage 2.1).
 *
 * The app started as King of the Court only. To support Round Robin,
 * Americano, Mexicano and Single-elimination bracket we lift the
 * format-specific rules behind a `TournamentFormat` interface and look
 * up the active implementation by `event.format`.
 *
 * For Stage 2.1.1 only KoC is implemented. The interface is shaped to
 * accommodate the other four formats without further refactoring:
 *
 *  - `usesQualifier` lets a format opt in to the KoC-style qualifier
 *    seeding flow. Round Robin / Americano / Mexicano set this to
 *    `false` and start from the bare active team list. Bracket can
 *    opt in for ranked seeding or skip for random.
 *  - `buildFirstRound` produces the initial PendingAssignment[] given
 *    the ranked team list (or active list) and the courts.
 *  - `computeNextRound` is called after a round ends and returns the
 *    next round's PendingAssignment[]. Always returns assignments —
 *    end-of-tournament is signalled separately via `isComplete`.
 *  - `isComplete` lets a format own its own end condition. KoC: total
 *    rounds reached. Bracket: only one team remaining. Round Robin:
 *    every fixture played.
 */

import type {
  Court,
  EventSettings,
  MainRound,
  PendingAssignment,
  Team,
  TieRule,
} from '@/types/domain';
import { koc } from './koc';

export type TournamentFormatId =
  | 'koc'
  | 'round-robin'
  | 'americano'
  | 'mexicano'
  | 'bracket';

export interface BuildFirstRoundCtx {
  /** Teams in seeding order (top to bottom). For formats without a
   *  qualifier this is just the active team list in their stored order. */
  rankedTeamIds: string[];
  teams: Team[];
  courts: Court[];
  config: unknown;
}

export interface NextRoundCtx {
  /** All completed rounds, chronological. The last entry is the round
   *  that just ended. */
  rounds: MainRound[];
  teams: Team[];
  courts: Court[];
  tieRule: TieRule;
  config: unknown;
}

export interface CompleteCtx {
  rounds: MainRound[];
  settings: EventSettings;
  config: unknown;
}

export interface TournamentFormat {
  id: TournamentFormatId;
  /** Human-readable name for setup pickers. */
  name: string;
  /** Brief one-line description for the mode picker. */
  blurb: string;
  /** Whether this format uses the KoC-style qualifier for seeding. */
  usesQualifier: boolean;

  buildFirstRound(ctx: BuildFirstRoundCtx): PendingAssignment[];
  computeNextRound(ctx: NextRoundCtx): PendingAssignment[];
  isComplete(ctx: CompleteCtx): boolean;
}

const REGISTRY: Record<TournamentFormatId, TournamentFormat | undefined> = {
  koc,
  'round-robin': undefined,
  americano: undefined,
  mexicano: undefined,
  bracket: undefined,
};

/**
 * Look up the format implementation. Falls back to KoC for any
 * unknown / missing id — keeps old localStorage events (which have
 * no `format` field) working.
 */
export function getFormat(id: TournamentFormatId | undefined): TournamentFormat {
  if (id) {
    const f = REGISTRY[id];
    if (f) return f;
  }
  return koc;
}

/** Every format with an implementation registered — for setup pickers. */
export function listAvailableFormats(): TournamentFormat[] {
  return Object.values(REGISTRY).filter((f): f is TournamentFormat => !!f);
}
