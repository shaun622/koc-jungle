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
} from '@/types/domain';
import { DEFAULT_SETTINGS } from '@/types/domain';
import { newId } from '@/logic/idGen';
import { newSeed } from '@/logic/shuffle';
import { buildQualifierRound, rankTeamsByQualifier, assignRankedTeamsToCourts } from '@/logic/seeding';
import { unresolvedTies } from '@/logic/rotation';
import { validateAssignments, validateQualifierScore } from '@/logic/validation';
import { getFormat } from '@/logic/formats';

export const STORAGE_KEY = 'koc-event-v1';

interface State {
  event: EventState | null;
  hydrated: boolean;
  lastError: string | null;
}

interface Actions {
  setHydrated: (v: boolean) => void;
  clearError: () => void;

  createEvent: (name: string) => void;
  resetEvent: () => void;
  loadEvent: (event: EventState) => void;

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
  endRound: () => void;
  overrideNextAssignments: (assignments: PendingAssignment[]) => void;
  startNextRound: (overrideDurationMs?: number) => void;
  undoLastRound: () => void;
  endEvent: () => void;
  finishEventNow: () => void;
}

export type EventStore = State & Actions;

function defaultCourts(): Court[] {
  return Array.from({ length: 7 }, (_, i) => {
    const position = i + 1;
    const isCentre = position === 7;
    return {
      id: newId(),
      position,
      name: isCentre ? 'Centre Court' : `Court ${position}`,
      pointValue: position + 2,
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
    };
  });
}

export const useEventStore = create<EventStore>()(
  persist(
    (set, get) => ({
      event: null,
      hydrated: false,
      lastError: null,

      setHydrated: (v) => set({ hydrated: v }),
      clearError: () => set({ lastError: null }),

      createEvent: (name) => {
        const event: EventState = {
          id: newId(),
          name: name || 'KOC Night',
          venue: '',
          createdAt: Date.now(),
          status: 'setup',
          settings: { ...DEFAULT_SETTINGS },
          courts: defaultCourts(),
          teams: [],
          rounds: [],
        };
        set({ event, lastError: null });
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
        set({ event: { ...event, teams: [...event.teams, team] }, lastError: null });
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
        const top = event.courts.reduce((m, c) => Math.max(m, c.pointValue), 2);
        const court: Court = {
          id: newId(),
          position: next,
          name: `Court ${next}`,
          pointValue: top + 1,
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
        const qualifier = buildQualifierRound(
          event.teams,
          event.courts,
          seed,
          event.settings.defaultRoundDurationMs,
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
        for (const m of event.qualifier.matches) {
          const issue = validateQualifierScore(m.scoreA, m.scoreB);
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
        const ties = unresolvedTies(round, event.settings.tieRule);
        if (ties.length) {
          set({ lastError: `Resolve ${ties.length} tied match(es) before ending the round.` });
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
        const last = event.rounds[event.rounds.length - 1];
        if (last.completedAt && event.status === 'between-rounds') {
          const previous = event.rounds.slice(0, -1);
          const restored: MainRound = {
            ...last,
            completedAt: undefined,
          };
          previous.push(restored);
          set({
            event: {
              ...event,
              rounds: previous,
              pendingAssignments: undefined,
              status: 'round-in-progress',
            },
            lastError: null,
          });
        } else if (event.status === 'round-in-progress' && event.rounds.length >= 2) {
          const prev = event.rounds[event.rounds.length - 2];
          const restored: MainRound = { ...prev, completedAt: undefined };
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
