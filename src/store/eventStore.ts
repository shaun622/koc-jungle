import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import type {
  Court,
  EventState,
  MainRound,
  Match,
  PendingAssignment,
  Player,
  PlayerAvatar,
  Team,
  EventSettings,
  TournamentFormatId,
} from '@/types/domain';
import { DEFAULT_SETTINGS } from '@/types/domain';
import { bergerRoundCount, splitTeamsIntoGroups } from '@/logic/formats/roundRobin';
import {
  bracketRoundCount,
  buildBracketSlots,
  nextPowerOf2,
} from '@/logic/formats/bracket';
import { newId } from '@/logic/idGen';
import { newSeed } from '@/logic/shuffle';
import { buildQualifierRound, rankTeamsByQualifier, assignRankedTeamsToCourts } from '@/logic/seeding';
import { unresolvedTies } from '@/logic/rotation';
import { validateAssignments, validateQualifierScore } from '@/logic/validation';
import { getFormat } from '@/logic/formats';
import { hapticTick } from '@/lib/haptics';

export const STORAGE_KEY = 'koc-event-v1';

interface State {
  event: EventState | null;
  hydrated: boolean;
  lastError: string | null;
}

interface Actions {
  setHydrated: (v: boolean) => void;
  clearError: () => void;

  createEvent: (name: string, format?: TournamentFormatId) => void;
  resetEvent: () => void;
  loadEvent: (event: EventState) => void;
  setFormatConfig: (patch: Record<string, unknown>) => void;
  /** Start a non-qualifier format (e.g. Round Robin) directly into round 1. */
  startTournament: () => void;

  addTeam: (input: { name?: string; player1: string; player2: string }) => void;
  updateTeam: (id: string, patch: { name?: string; player1?: string; player2?: string }) => void;
  removeTeam: (id: string) => void;
  setPlayerAvatar: (teamId: string, playerIndex: 0 | 1, avatar: PlayerAvatar | undefined) => void;
  setPointsOverride: (teamId: string, value: number | undefined) => void;

  setCourts: (courts: Court[]) => void;
  renameCourt: (id: string, name: string) => void;
  setCourtPoints: (id: string, pointValue: number) => void;
  addCourt: () => void;
  removeCourt: (id: string) => void;
  reorderCourts: (orderedIdsTopFirst: string[]) => void;

  updateSettings: (patch: Partial<EventSettings>) => void;
  setEventName: (name: string) => void;
  setEventVenue: (venue: string) => void;

  startQualifier: () => void;
  skipQualifierToSeeding: () => void;
  /** Toggle whether the KoC qualifier is used. Flipping it mid-flow (from
   *  'qualifier'/'seeding') resets the event back to 'setup' for consistency. */
  setQualifierEnabled: (enabled: boolean) => void;
  setQualifierScore: (matchId: string, scoreA: number, scoreB: number) => void;
  startQualifierTimer: () => void;
  pauseQualifierTimer: () => void;
  resetQualifierTimer: () => void;
  adjustQualifierTimer: (deltaMs: number) => void;
  confirmQualifierResults: () => void;
  reopenFromSeeding: () => void;
  reorderSeeding: (orderedTeamIds: string[]) => void;
  lockSeedingAndStartRound1: () => void;

  startRoundTimer: () => void;
  pauseRoundTimer: () => void;
  resetRoundTimer: () => void;
  adjustTimer: (deltaMs: number) => void;
  setRoundDuration: (ms: number) => void;
  setMatchScore: (matchId: string, scoreA: number, scoreB: number) => void;
  incrementScore: (matchId: string, side: 'A' | 'B', delta: number) => void;
  nominateTieWinner: (matchId: string, winnerId: string) => void;
  /** Swap the teams occupying two match slots in the current round (drag to
   *  re-assign courts). Each slot is a match id + side ('A' | 'B'). */
  swapMatchSlots: (
    a: { matchId: string; side: 'A' | 'B' },
    b: { matchId: string; side: 'A' | 'B' },
  ) => void;
  endRound: () => void;
  overrideNextAssignments: (assignments: PendingAssignment[]) => void;
  startNextRound: (overrideDurationMs?: number) => void;
  undoLastRound: () => void;
  endEvent: () => void;
  finishEventNow: () => void;
}

export type EventStore = State & Actions;

function defaultCourts(ladder: boolean): Court[] {
  return Array.from({ length: 7 }, (_, i) => {
    const position = i + 1;
    const isCentre = position === 7;
    return {
      id: newId(),
      position,
      name: isCentre ? 'Centre Court' : `Court ${position}`,
      // KoC (and Mexicano, where the top pair meet on the top court) use a
      // laddered value so the top court is worth more. For Americano / Round
      // Robin / Bracket, court assignment is just scheduling — equal points
      // keep it fair. The operator can still edit any value in Setup.
      pointValue: ladder ? position + 2 : 5,
    };
  });
}

function buildPlayer(name: string): Player {
  return { id: newId(), name: name.trim() };
}

function getCurrentRound(event: EventState): MainRound | null {
  if (event.rounds.length === 0) return null;
  return event.rounds[event.rounds.length - 1];
}

function buildMatchesFromAssignments(
  assignments: PendingAssignment[],
  courts: Court[],
): Match[] {
  return assignments.map((a) => {
    const court = courts.find((c) => c.id === a.courtId);
    if (!court) throw new Error(`Unknown court ${a.courtId}`);
    return {
      id: newId(),
      courtId: a.courtId,
      teamAId: a.teamAId,
      teamBId: a.teamBId,
      scoreA: 0,
      scoreB: 0,
      status: 'in-progress',
      pointValueAtTime: court.pointValue,
      ...(a.wave ? { wave: a.wave } : {}),
    };
  });
}

/**
 * Americano builds its fixtures from the active roster. When the operator
 * corrects the roster after starting the event, keep any not-yet-played
 * schedule in sync so spare courts are filled instead of showing valid teams
 * as resting.
 *
 * A live round is only rebuilt before its timer has ever started and while all
 * scores are still untouched. Once play begins, the current round is kept
 * stable and the new team joins from the following round.
 */
function refreshAmericanoSchedule(
  event: EventState,
  teams: Team[],
  formatConfig: Record<string, unknown>,
): EventState {
  const nextEvent: EventState = { ...event, teams, formatConfig };
  if (event.format !== 'americano') return nextEvent;

  const format = getFormat('americano');

  if (event.status === 'between-rounds') {
    const assignments = format.computeNextRound({
      rounds: event.rounds,
      teams,
      courts: event.courts,
      tieRule: event.settings.tieRule,
      config: formatConfig,
    });
    return { ...nextEvent, pendingAssignments: assignments };
  }

  if (event.status !== 'round-in-progress') return nextEvent;
  const current = getCurrentRound(event);
  const canRebuildCurrent =
    current !== null &&
    current.startedAt === undefined &&
    (current.currentWave ?? 0) === 0 &&
    current.matches.every(
      (match) =>
        match.scoreA === 0 &&
        match.scoreB === 0 &&
        match.tieBreakWinnerId === undefined,
    );
  if (!canRebuildCurrent || !current) return nextEvent;

  const completedRounds = event.rounds.slice(0, -1);
  const activeTeams = teams.filter((team) => team.active);
  const assignments =
    completedRounds.length === 0
      ? format.buildFirstRound({
          rankedTeamIds: activeTeams.map((team) => team.id),
          teams: activeTeams,
          courts: event.courts,
          config: formatConfig,
        })
      : format.computeNextRound({
          rounds: completedRounds,
          teams,
          courts: event.courts,
          tieRule: event.settings.tieRule,
          config: formatConfig,
        });

  const refreshedRound: MainRound = {
    ...current,
    matches: buildMatchesFromAssignments(assignments, event.courts),
    currentWave: undefined,
  };
  return { ...nextEvent, rounds: [...completedRounds, refreshedRound] };
}

export const useEventStore = create<EventStore>()(
  persist(
    (set, get) => ({
      event: null,
      hydrated: false,
      lastError: null,

      setHydrated: (v) => set({ hydrated: v }),
      clearError: () => set({ lastError: null }),

      createEvent: (name, format) => {
        const fmt: TournamentFormatId = format ?? 'koc';
        const event: EventState = {
          id: newId(),
          name: name || 'Padel Night',
          venue: '',
          createdAt: Date.now(),
          status: 'setup',
          settings: { ...DEFAULT_SETTINGS },
          courts: defaultCourts(fmt === 'koc' || fmt === 'mexicano'),
          teams: [],
          rounds: [],
          format: fmt,
          // Round Robin gets a default group size so the setup picker
          // has somewhere to land. Other formats start with no config.
          formatConfig: fmt === 'round-robin' ? { groupSize: 4 } : {},
        };
        set({ event, lastError: null });
      },

      setFormatConfig: (patch) => {
        const event = get().event;
        if (!event) return;
        set({
          event: {
            ...event,
            formatConfig: { ...(event.formatConfig ?? {}), ...patch },
          },
        });
      },

      resetEvent: () => set({ event: null, lastError: null }),

      loadEvent: (event) => set({ event, lastError: null }),

      addTeam: ({ name, player1, player2 }) => {
        const event = get().event;
        if (!event) return;
        if (!player1.trim() || !player2.trim()) {
          set({ lastError: 'Both player names are required.' });
          return;
        }
        const team: Team = {
          id: newId(),
          name: name?.trim() || undefined,
          players: [buildPlayer(player1), buildPlayer(player2)],
          createdAt: Date.now(),
          active: true,
        };
        // Americano/Mexicano freeze their team pool in formatConfig.teams at
        // start. If the operator adds a team mid-event, append it to that pool
        // so it actually joins the next round's schedule (KoC reads the live
        // roster and needs no help; RR/Bracket lock the draw — see Setup copy).
        const cfg = event.formatConfig as { teams?: string[] };
        const joinsPool =
          (event.format === 'americano' || event.format === 'mexicano') &&
          event.status !== 'setup' &&
          Array.isArray(cfg.teams);
        const formatConfig = joinsPool
          ? { ...event.formatConfig, teams: [...(cfg.teams as string[]), team.id] }
          : event.formatConfig;
        const teams = [...event.teams, team];
        set({
          event: refreshAmericanoSchedule(
            event,
            teams,
            formatConfig as Record<string, unknown>,
          ),
          lastError: null,
        });
      },

      updateTeam: (id, patch) => {
        const event = get().event;
        if (!event) return;
        const teams = event.teams.map((t) => {
          if (t.id !== id) return t;
          const updated: Team = {
            ...t,
            name: patch.name === undefined ? t.name : patch.name.trim() || undefined,
            players: [
              patch.player1 !== undefined ? { ...t.players[0], name: patch.player1.trim() } : t.players[0],
              patch.player2 !== undefined ? { ...t.players[1], name: patch.player2.trim() } : t.players[1],
            ],
          };
          return updated;
        });
        set({ event: { ...event, teams } });
      },

      removeTeam: (id) => {
        const event = get().event;
        if (!event) return;
        if (event.status === 'setup') {
          set({ event: { ...event, teams: event.teams.filter((t) => t.id !== id) } });
        } else {
          set({
            event: {
              ...event,
              teams: event.teams.map((t) => (t.id === id ? { ...t, active: false } : t)),
            },
          });
        }
      },

      setPlayerAvatar: (teamId, playerIndex, avatar) => {
        const event = get().event;
        if (!event) return;
        const teams = event.teams.map((t) => {
          if (t.id !== teamId) return t;
          const players: [Player, Player] = [
            { ...t.players[0] },
            { ...t.players[1] },
          ];
          const next: Player = { ...players[playerIndex] };
          if (avatar === undefined) {
            delete next.avatar;
          } else {
            next.avatar = avatar;
          }
          players[playerIndex] = next;
          return { ...t, players };
        });
        set({ event: { ...event, teams } });
      },

      setPointsOverride: (teamId, value) => {
        const event = get().event;
        if (!event) return;
        const teams = event.teams.map((t) => {
          if (t.id !== teamId) return t;
          const next: Team = { ...t };
          if (value === undefined || Number.isNaN(value)) {
            delete next.pointsOverride;
          } else {
            next.pointsOverride = Math.max(0, Math.round(value));
          }
          return next;
        });
        set({ event: { ...event, teams } });
      },

      setCourts: (courts) => {
        const event = get().event;
        if (!event) return;
        const sorted = courts.slice().sort((a, b) => a.position - b.position);
        set({ event: { ...event, courts: sorted } });
      },

      reorderCourts: (orderedIdsTopFirst) => {
        const event = get().event;
        if (!event) return;
        if (orderedIdsTopFirst.length !== event.courts.length) {
          set({ lastError: 'Court reorder skipped: missing or extra courts.' });
          return;
        }
        const seen = new Set<string>();
        const courts: Court[] = [];
        const N = orderedIdsTopFirst.length;
        for (let i = 0; i < N; i++) {
          const id = orderedIdsTopFirst[i];
          if (seen.has(id)) {
            set({ lastError: 'Court reorder skipped: duplicate court id.' });
            return;
          }
          seen.add(id);
          const court = event.courts.find((c) => c.id === id);
          if (!court) {
            set({ lastError: 'Court reorder skipped: unknown court id.' });
            return;
          }
          // Top of list (i=0) gets the highest position (N), bottom (i=N-1) gets 1.
          courts.push({ ...court, position: N - i });
        }
        set({ event: { ...event, courts }, lastError: null });
      },

      renameCourt: (id, name) => {
        const event = get().event;
        if (!event) return;
        set({
          event: {
            ...event,
            courts: event.courts.map((c) => (c.id === id ? { ...c, name } : c)),
          },
        });
      },

      setCourtPoints: (id, pointValue) => {
        const event = get().event;
        if (!event) return;
        const value = Math.max(0, Math.round(pointValue));
        set({
          event: {
            ...event,
            courts: event.courts.map((c) => (c.id === id ? { ...c, pointValue: value } : c)),
          },
        });
      },

      addCourt: () => {
        const event = get().event;
        if (!event) return;
        const next = event.courts.length + 1;
        const values = event.courts.map((c) => c.pointValue);
        // If the courts all share one value (equal-points formats), keep it
        // uniform; if they're laddered (KoC), continue the ladder at max+1.
        const uniform = values.length > 0 && values.every((v) => v === values[0]);
        const pointValue = uniform
          ? values[0]
          : values.reduce((m, v) => Math.max(m, v), 2) + 1;
        const court: Court = {
          id: newId(),
          position: next,
          name: `Court ${next}`,
          pointValue,
        };
        set({ event: { ...event, courts: [...event.courts, court] } });
      },

      removeCourt: (id) => {
        const event = get().event;
        if (!event) return;
        const filtered = event.courts.filter((c) => c.id !== id);
        const renumbered = filtered
          .sort((a, b) => a.position - b.position)
          .map((c, i) => ({ ...c, position: i + 1 }));
        set({ event: { ...event, courts: renumbered } });
      },

      updateSettings: (patch) => {
        const event = get().event;
        if (!event) return;
        set({ event: { ...event, settings: { ...event.settings, ...patch } } });
      },

      setEventName: (name) => {
        const event = get().event;
        if (!event) return;
        set({ event: { ...event, name } });
      },

      setEventVenue: (venue) => {
        const event = get().event;
        if (!event) return;
        set({ event: { ...event, venue } });
      },

      startQualifier: () => {
        const event = get().event;
        if (!event) return;
        const active = event.teams.filter((t) => t.active);
        if (active.length !== event.courts.length * 2) {
          set({
            lastError: `Need exactly ${event.courts.length * 2} teams (got ${active.length}).`,
          });
          return;
        }
        const seed = newSeed();
        // When the qualifier is timed, the target is in minutes and drives
        // the qualifier clock; otherwise fall back to the default round length.
        const qualifierDurationMs =
          event.settings.qualifierUnit === 'time'
            ? Math.max(1, event.settings.qualifierTarget ?? 10) * 60_000
            : event.settings.defaultRoundDurationMs;
        const qualifier = buildQualifierRound(
          event.teams,
          event.courts,
          seed,
          qualifierDurationMs,
        );
        set({
          event: { ...event, qualifier, status: 'qualifier' },
          lastError: null,
        });
      },

      skipQualifierToSeeding: () => {
        const event = get().event;
        if (!event) return;
        const active = event.teams.filter((t) => t.active);
        if (active.length !== event.courts.length * 2) {
          set({
            lastError: `Need exactly ${event.courts.length * 2} teams (got ${active.length}).`,
          });
          return;
        }
        // Pair teams in their current order onto courts (descending position).
        // The operator can drag them around on the seeding screen before locking.
        const assignments = assignRankedTeamsToCourts(
          active.map((t) => t.id),
          event.courts,
        );
        set({
          event: {
            ...event,
            qualifier: undefined,
            pendingAssignments: assignments,
            status: 'seeding',
          },
          lastError: null,
        });
      },

      startQualifierTimer: () => {
        const event = get().event;
        if (!event?.qualifier) return;
        const q = event.qualifier;
        const now = Date.now();
        let next = q;
        if (!q.startedAt) {
          next = { ...q, startedAt: now, pausedAt: undefined };
        } else if (q.pausedAt !== undefined) {
          const pausedFor = now - q.pausedAt;
          next = { ...q, totalPausedMs: q.totalPausedMs + pausedFor, pausedAt: undefined };
        } else {
          return;
        }
        set({ event: { ...event, qualifier: next } });
      },

      pauseQualifierTimer: () => {
        const event = get().event;
        if (!event?.qualifier) return;
        const q = event.qualifier;
        if (!q.startedAt || q.pausedAt !== undefined) return;
        set({ event: { ...event, qualifier: { ...q, pausedAt: Date.now() } } });
      },

      resetQualifierTimer: () => {
        const event = get().event;
        if (!event?.qualifier) return;
        set({
          event: {
            ...event,
            qualifier: {
              ...event.qualifier,
              startedAt: undefined,
              pausedAt: undefined,
              totalPausedMs: 0,
            },
          },
        });
      },

      adjustQualifierTimer: (deltaMs) => {
        const event = get().event;
        if (!event?.qualifier) return;
        const next = Math.max(0, event.qualifier.durationMs + deltaMs);
        set({
          event: { ...event, qualifier: { ...event.qualifier, durationMs: next } },
        });
      },

      setQualifierEnabled: (enabled) => {
        const event = get().event;
        if (!event) return;
        const settings = { ...event.settings, qualifierEnabled: enabled };
        // Whether the KoC qualifier is used can only be meaningfully changed
        // before it has produced results. If the operator flips it after
        // starting (they navigated back to Setup while a qualifier/seeding was
        // in progress), snap the event back to 'setup' so the flow stays
        // consistent and the Setup start button works again. Any provisional
        // qualifier + assignments are discarded.
        if (event.status === 'qualifier' || event.status === 'seeding') {
          set({
            event: {
              ...event,
              settings,
              status: 'setup',
              qualifier: undefined,
              pendingAssignments: undefined,
            },
            lastError: null,
          });
        } else {
          set({ event: { ...event, settings } });
        }
      },

      setQualifierScore: (matchId, scoreA, scoreB) => {
        const event = get().event;
        if (!event?.qualifier) return;
        const matches = event.qualifier.matches.map((m) =>
          m.id === matchId ? { ...m, scoreA, scoreB } : m,
        );
        set({ event: { ...event, qualifier: { ...event.qualifier, matches } } });
      },

      confirmQualifierResults: () => {
        const event = get().event;
        if (!event?.qualifier) return;
        const rule = {
          unit: event.settings.qualifierUnit ?? 'points',
          target: event.settings.qualifierTarget ?? 16,
        };
        for (const m of event.qualifier.matches) {
          const issue = validateQualifierScore(m.scoreA, m.scoreB, rule);
          if (issue) {
            set({ lastError: issue.message });
            return;
          }
        }
        const teamNameFor = (id: string) => {
          const t = event.teams.find((tt) => tt.id === id);
          if (!t) return id;
          return t.name ?? `${t.players[0].name} & ${t.players[1].name}`;
        };
        const ranked = rankTeamsByQualifier(event.qualifier, event.teams, teamNameFor);
        const assignments = assignRankedTeamsToCourts(
          ranked.map((r) => r.teamId),
          event.courts,
        );
        set({
          event: {
            ...event,
            qualifier: { ...event.qualifier, completedAt: Date.now() },
            pendingAssignments: assignments,
            status: 'seeding',
          },
          lastError: null,
        });
      },

      reopenFromSeeding: () => {
        // The seeding "← Back" button. Reverts the event status so RouteGate
        // lets the operator return — either to the qualifier (to edit scores)
        // or to setup (if the qualifier was skipped).
        const event = get().event;
        if (!event || event.status !== 'seeding') return;
        if (event.qualifier) {
          set({
            event: {
              ...event,
              status: 'qualifier',
              pendingAssignments: undefined,
              // No longer "complete" while being edited; scores are kept.
              qualifier: { ...event.qualifier, completedAt: undefined },
            },
            lastError: null,
          });
        } else {
          set({
            event: { ...event, status: 'setup', pendingAssignments: undefined },
            lastError: null,
          });
        }
      },

      reorderSeeding: (orderedTeamIds) => {
        const event = get().event;
        if (!event) return;
        const assignments = assignRankedTeamsToCourts(orderedTeamIds, event.courts);
        set({ event: { ...event, pendingAssignments: assignments } });
      },

      lockSeedingAndStartRound1: () => {
        const event = get().event;
        if (!event?.pendingAssignments) return;
        const issues = validateAssignments(event.pendingAssignments, event.courts, event.teams);
        if (issues.length) {
          set({ lastError: issues.map((i) => i.message).join(' ') });
          return;
        }
        const matches = buildMatchesFromAssignments(event.pendingAssignments, event.courts);
        const round: MainRound = {
          id: newId(),
          index: 1,
          matches,
          durationMs: event.settings.defaultRoundDurationMs,
          totalPausedMs: 0,
        };
        set({
          event: {
            ...event,
            rounds: [...event.rounds, round],
            pendingAssignments: undefined,
            status: 'round-in-progress',
          },
          lastError: null,
        });
      },

      /**
       * Start a non-qualifier-style format (Round Robin today; Americano /
       * Mexicano / Bracket later) directly from setup into round 1. Skips
       * the qualifier + seeding flow entirely.
       */
      startTournament: () => {
        const event = get().event;
        if (!event) return;
        if (event.status !== 'setup') {
          set({ lastError: 'Tournament already started.' });
          return;
        }
        const format = getFormat(event.format);
        if (format.usesQualifier) {
          set({
            lastError:
              'This format needs a qualifier — use Start qualifier round.',
          });
          return;
        }
        const activeTeams = event.teams.filter((t) => t.active);
        if (activeTeams.length < 2) {
          set({ lastError: 'Need at least 2 teams to start.' });
          return;
        }

        // Round-Robin-specific: split teams into groups using the operator's
        // chosen groupSize, then derive the total rounds from the largest
        // group. Settings.roundsTotal gets overwritten so the DisplayScreen's
        // "Round X of Y" reads correctly without further format-awareness.
        let formatConfig = event.formatConfig ?? {};
        let roundsTotal = event.settings.roundsTotal;
        if (format.id === 'round-robin') {
          const groupSize = Number(
            (formatConfig as { groupSize?: number }).groupSize ?? 4,
          );
          if (groupSize < 2) {
            set({ lastError: 'Group size must be at least 2.' });
            return;
          }
          const groups = splitTeamsIntoGroups(
            activeTeams.map((t) => t.id),
            groupSize,
          );
          if (groups.some((g) => g.length < 2)) {
            const smallest = Math.min(...groups.map((g) => g.length));
            set({
              lastError: `${activeTeams.length} teams with a group size of ${groupSize} leaves a group of ${smallest} — that team would play no matches. Adjust the group size or the number of teams.`,
            });
            return;
          }
          formatConfig = { groupSize, groups };
          roundsTotal = Math.max(
            1,
            ...groups.map((g) => bergerRoundCount(g.length)),
          );
        } else if (format.id === 'americano' || format.id === 'mexicano') {
          // Freeze the team pool so the rotation (Americano) or running
          // ranking (Mexicano) sees a stable set of teams across all
          // rounds, even if teams get deactivated mid-event.
          formatConfig = {
            ...formatConfig,
            teams: activeTeams.map((t) => t.id),
          };
          // Keep the operator's chosen settings.roundsTotal — that's the
          // distinguishing feature of Americano/Mexicano vs. Round Robin.
        } else if (format.id === 'bracket') {
          // Bracket: order the teams per the operator's chosen seeding, then
          // size = next power of 2 ≥ count. Seed 1 (first in the ordered
          // list) gets the first bye when the field isn't a power of 2.
          // Total rounds is log2(bracketSize); we overwrite settings.roundsTotal
          // so the round counter reads "Round X of Y" correctly.
          const bcfg = formatConfig as {
            seedingSource?: 'entered' | 'random' | 'manual';
            seedOrder?: string[];
          };
          const activeIds = activeTeams.map((t) => t.id);
          let seeded: string[];
          if (bcfg.seedingSource === 'random') {
            seeded = activeIds.slice();
            for (let i = seeded.length - 1; i > 0; i--) {
              const j = Math.floor(Math.random() * (i + 1));
              [seeded[i], seeded[j]] = [seeded[j], seeded[i]];
            }
          } else if (bcfg.seedingSource === 'manual' && Array.isArray(bcfg.seedOrder)) {
            // Honour the manual order; reconcile against the current roster so
            // a team added/removed after seeding still ends up in the draw.
            const inOrder = bcfg.seedOrder.filter((id) => activeIds.includes(id));
            const missing = activeIds.filter((id) => !inOrder.includes(id));
            seeded = [...inOrder, ...missing];
          } else {
            seeded = activeIds; // 'entered' (default): roster order
          }
          const bracketSize = nextPowerOf2(seeded.length);
          const slots = buildBracketSlots(seeded, bracketSize);
          formatConfig = {
            bracketSize,
            slots,
            seedingSource: bcfg.seedingSource ?? 'entered',
          };
          roundsTotal = Math.max(1, bracketRoundCount(bracketSize));
        }

        try {
          const assignments = format.buildFirstRound({
            rankedTeamIds: activeTeams.map((t) => t.id),
            teams: activeTeams,
            courts: event.courts,
            config: formatConfig,
          });
          const matches = buildMatchesFromAssignments(assignments, event.courts);
          const round: MainRound = {
            id: newId(),
            index: 1,
            matches,
            durationMs: event.settings.defaultRoundDurationMs,
            totalPausedMs: 0,
          };
          set({
            event: {
              ...event,
              formatConfig,
              settings: { ...event.settings, roundsTotal },
              rounds: [round],
              pendingAssignments: undefined,
              status: 'round-in-progress',
            },
            lastError: null,
          });
        } catch (err) {
          set({
            lastError:
              err instanceof Error
                ? err.message
                : 'Could not start tournament.',
          });
        }
      },

      startRoundTimer: () => {
        const event = get().event;
        if (!event) return;
        const round = getCurrentRound(event);
        if (!round) return;
        const now = Date.now();
        let next: MainRound;
        if (!round.startedAt) {
          next = { ...round, startedAt: now, pausedAt: undefined };
        } else if (round.pausedAt !== undefined) {
          const pausedFor = now - round.pausedAt;
          next = {
            ...round,
            totalPausedMs: round.totalPausedMs + pausedFor,
            pausedAt: undefined,
          };
        } else {
          return;
        }
        const rounds = event.rounds.slice(0, -1).concat(next);
        set({ event: { ...event, rounds } });
      },

      pauseRoundTimer: () => {
        const event = get().event;
        if (!event) return;
        const round = getCurrentRound(event);
        if (!round?.startedAt || round.pausedAt !== undefined) return;
        const next: MainRound = { ...round, pausedAt: Date.now() };
        const rounds = event.rounds.slice(0, -1).concat(next);
        set({ event: { ...event, rounds } });
      },

      resetRoundTimer: () => {
        const event = get().event;
        if (!event) return;
        const round = getCurrentRound(event);
        if (!round) return;
        const next: MainRound = {
          ...round,
          startedAt: undefined,
          pausedAt: undefined,
          totalPausedMs: 0,
        };
        const rounds = event.rounds.slice(0, -1).concat(next);
        set({ event: { ...event, rounds } });
      },

      adjustTimer: (deltaMs) => {
        const event = get().event;
        if (!event) return;
        const round = getCurrentRound(event);
        if (!round) return;
        const next: MainRound = {
          ...round,
          durationMs: Math.max(0, round.durationMs + deltaMs),
        };
        const rounds = event.rounds.slice(0, -1).concat(next);
        set({ event: { ...event, rounds } });
      },

      setRoundDuration: (ms) => {
        const event = get().event;
        if (!event) return;
        const round = getCurrentRound(event);
        const clamped = Math.max(0, Math.round(ms));
        if (round) {
          const next: MainRound = { ...round, durationMs: clamped };
          const rounds = event.rounds.slice(0, -1).concat(next);
          set({
            event: {
              ...event,
              settings: { ...event.settings, defaultRoundDurationMs: clamped },
              rounds,
            },
          });
        } else {
          set({
            event: {
              ...event,
              settings: { ...event.settings, defaultRoundDurationMs: clamped },
            },
          });
        }
      },

      setMatchScore: (matchId, scoreA, scoreB) => {
        const event = get().event;
        if (!event) return;
        const round = getCurrentRound(event);
        if (!round) return;
        const matches = round.matches.map((m) =>
          m.id === matchId
            ? {
                ...m,
                scoreA: Math.max(0, Math.round(scoreA)),
                scoreB: Math.max(0, Math.round(scoreB)),
              }
            : m,
        );
        const next = { ...round, matches };
        const rounds = event.rounds.slice(0, -1).concat(next);
        set({ event: { ...event, rounds } });
      },

      incrementScore: (matchId, side, delta) => {
        const event = get().event;
        if (!event) return;
        const round = getCurrentRound(event);
        if (!round) return;
        const matches = round.matches.map((m) => {
          if (m.id !== matchId) return m;
          const key = side === 'A' ? 'scoreA' : 'scoreB';
          const updated = Math.max(0, m[key] + delta);
          return { ...m, [key]: updated };
        });
        const next = { ...round, matches };
        const rounds = event.rounds.slice(0, -1).concat(next);
        set({ event: { ...event, rounds } });
        hapticTick();
      },

      nominateTieWinner: (matchId, winnerId) => {
        const event = get().event;
        if (!event) return;
        const round = getCurrentRound(event);
        if (!round) return;
        const matches = round.matches.map((m) =>
          m.id === matchId ? { ...m, tieBreakWinnerId: winnerId } : m,
        );
        const next = { ...round, matches };
        const rounds = event.rounds.slice(0, -1).concat(next);
        set({ event: { ...event, rounds } });
      },

      endRound: () => {
        const event = get().event;
        if (!event) return;
        const round = getCurrentRound(event);
        if (!round) return;
        // Only the wave currently on court must be resolved — later waves are
        // still 0-0 (which reads as a tie) and earlier waves are already done.
        const currentWave = round.currentWave ?? 0;
        const maxWave = round.matches.reduce((mx, m) => Math.max(mx, m.wave ?? 0), 0);
        const waveMatches = round.matches.filter((m) => (m.wave ?? 0) === currentWave);
        const ties = unresolvedTies({ ...round, matches: waveMatches }, event.settings.tieRule);
        if (ties.length) {
          set({ lastError: `Resolve ${ties.length} tied match(es) before ending the round.` });
          return;
        }
        // More waves to play in this round → advance to the next wave on the
        // same courts with a fresh, unstarted timer. The round stays open.
        if (currentWave < maxWave) {
          const advanced: MainRound = {
            ...round,
            currentWave: currentWave + 1,
            startedAt: undefined,
            pausedAt: undefined,
            totalPausedMs: 0,
          };
          set({
            event: { ...event, rounds: event.rounds.slice(0, -1).concat(advanced) },
            lastError: null,
          });
          return;
        }
        const completed: MainRound = { ...round, completedAt: Date.now() };
        const rounds = event.rounds.slice(0, -1).concat(completed);
        // Route through the format so other modes (Round Robin, Bracket,
        // …) can plug in. KoC behaviour is identical to the pre-refactor
        // codepath; getFormat falls back to KoC for legacy events with
        // no `format` field.
        const format = getFormat(event.format);
        const formatConfig = event.formatConfig ?? {};
        if (format.isComplete({ rounds, settings: event.settings, config: formatConfig })) {
          set({
            event: {
              ...event,
              rounds,
              pendingAssignments: undefined,
              status: 'complete',
            },
            lastError: null,
          });
          return;
        }
        const assignments = format.computeNextRound({
          rounds,
          teams: event.teams,
          courts: event.courts,
          tieRule: event.settings.tieRule,
          config: formatConfig,
        });
        set({
          event: {
            ...event,
            rounds,
            pendingAssignments: assignments,
            status: 'between-rounds',
          },
          lastError: null,
        });
      },

      overrideNextAssignments: (assignments) => {
        const event = get().event;
        if (!event) return;
        const issues = validateAssignments(assignments, event.courts, event.teams);
        if (issues.length) {
          set({ lastError: issues.map((i) => i.message).join(' ') });
          return;
        }
        set({ event: { ...event, pendingAssignments: assignments }, lastError: null });
      },

      startNextRound: (overrideDurationMs?: number) => {
        const event = get().event;
        if (!event?.pendingAssignments) return;
        const issues = validateAssignments(event.pendingAssignments, event.courts, event.teams);
        if (issues.length) {
          set({ lastError: issues.map((i) => i.message).join(' ') });
          return;
        }
        const matches = buildMatchesFromAssignments(event.pendingAssignments, event.courts);
        const prev = event.rounds[event.rounds.length - 1];
        const durationMs =
          overrideDurationMs ??
          prev?.durationMs ??
          event.settings.defaultRoundDurationMs;
        const round: MainRound = {
          id: newId(),
          index: prev ? prev.index + 1 : 1,
          matches,
          durationMs: Math.max(0, Math.round(durationMs)),
          totalPausedMs: 0,
        };
        set({
          event: {
            ...event,
            rounds: [...event.rounds, round],
            pendingAssignments: undefined,
            status: 'round-in-progress',
          },
          lastError: null,
        });
      },

      undoLastRound: () => {
        const event = get().event;
        if (!event) return;
        if (event.rounds.length === 0) return;
        // Reopen on the round's LAST wave so a multi-wave round shows the
        // final set of matches (all scored) ready for correction.
        const lastWaveOf = (r: MainRound) =>
          r.matches.reduce((mx, m) => Math.max(mx, m.wave ?? 0), 0);
        const last = event.rounds[event.rounds.length - 1];
        if (last.completedAt && event.status === 'between-rounds') {
          const restored: MainRound = {
            ...last,
            completedAt: undefined,
            currentWave: lastWaveOf(last),
          };
          const rounds = event.rounds.slice(0, -1).concat(restored);
          set({
            event: {
              ...event,
              rounds,
              pendingAssignments: undefined,
              status: 'round-in-progress',
            },
            lastError: null,
          });
        } else if (event.status === 'round-in-progress' && event.rounds.length >= 2) {
          const prev = event.rounds[event.rounds.length - 2];
          const restored: MainRound = {
            ...prev,
            completedAt: undefined,
            currentWave: lastWaveOf(prev),
          };
          const rounds = event.rounds.slice(0, -2).concat(restored);
          set({
            event: {
              ...event,
              rounds,
              pendingAssignments: undefined,
              status: 'round-in-progress',
            },
            lastError: null,
          });
        }
      },

      swapMatchSlots: (a, b) => {
        const event = get().event;
        if (!event) return;
        const round = getCurrentRound(event);
        if (!round) return;
        const teamAt = (matchId: string, side: 'A' | 'B'): string | undefined => {
          const m = round.matches.find((mm) => mm.id === matchId);
          return m ? (side === 'A' ? m.teamAId : m.teamBId) : undefined;
        };
        const teamFromA = teamAt(a.matchId, a.side);
        const teamFromB = teamAt(b.matchId, b.side);
        if (teamFromA === undefined || teamFromB === undefined) return;
        if (teamFromA === teamFromB) return; // dropped on itself — no-op
        const setSlot = (m: Match, side: 'A' | 'B', teamId: string): Match => {
          const next: Match = { ...m, [side === 'A' ? 'teamAId' : 'teamBId']: teamId };
          // A nominated tie-break winner that's no longer one of the two
          // teams on this court is meaningless — clear it.
          if (
            next.tieBreakWinnerId &&
            next.tieBreakWinnerId !== next.teamAId &&
            next.tieBreakWinnerId !== next.teamBId
          ) {
            next.tieBreakWinnerId = undefined;
          }
          return next;
        };
        const matches = round.matches.map((m) => {
          let next = m;
          if (m.id === a.matchId) next = setSlot(next, a.side, teamFromB);
          if (m.id === b.matchId) next = setSlot(next, b.side, teamFromA);
          return next;
        });
        const nextRound = { ...round, matches };
        const rounds = event.rounds.slice(0, -1).concat(nextRound);
        set({ event: { ...event, rounds }, lastError: null });
      },

      endEvent: () => {
        const event = get().event;
        if (!event) return;
        set({ event: { ...event, status: 'complete' } });
      },

      finishEventNow: () => {
        // Force-finish escape hatch — jumps straight to the podium. Used
        // when the operator is stuck (e.g. roundsTotal was lowered below
        // the current round, leaving an unscored phantom round with the
        // End Round button disabled).
        const event = get().event;
        if (!event) return;
        const round = getCurrentRound(event);
        let rounds = event.rounds;
        if (round && !round.completedAt) {
          const anyScored = round.matches.some(
            (m) => m.scoreA > 0 || m.scoreB > 0,
          );
          rounds = anyScored
            ? // Has scores — keep it, mark complete so it counts.
              event.rounds.slice(0, -1).concat({ ...round, completedAt: Date.now() })
            : // Unscored phantom round — drop it entirely.
              event.rounds.slice(0, -1);
        }
        set({
          event: {
            ...event,
            rounds,
            pendingAssignments: undefined,
            status: 'complete',
          },
          lastError: null,
        });
      },
    }),
    {
      name: STORAGE_KEY,
      version: 1,
      storage: createJSONStorage(() => localStorage),
      onRehydrateStorage: () => (state) => {
        // Mark hydrated whether or not load succeeded.
        if (state) state.hydrated = true;
      },
      partialize: (state) => ({ event: state.event }),
    },
  ),
);
