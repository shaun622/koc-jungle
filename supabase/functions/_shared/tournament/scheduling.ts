import { invariant } from './errors';
import { activeLineup } from './state';
import type {
  FixtureSource,
  TournamentFixture,
  TournamentScheduleProposal,
  TournamentScheduleSuggestion,
  TournamentV1,
} from './types';
import { TOURNAMENT_CONTRACT_VERSION } from './types';

export type ScheduleSuggestion = TournamentScheduleSuggestion;
type Interval = { start: number; end: number; fixtureId: string };

const DAY = 86_400_000;

export interface CourtClosureAction {
  fixtureId: string;
  action: 'suspend-release' | 'terminate' | 'keep-reserved' | 'release' | 'move-resume' | 'keep-warning' | 'reassign' | 'unassign';
  targetCourtId?: string;
  reason: string;
}

export interface CourtClosureProposal {
  contractVersion: typeof TOURNAMENT_CONTRACT_VERSION;
  baseRevision: string;
  fingerprint: string;
  courtId: string;
  actions: CourtClosureAction[];
}

export function createCourtClosureProposal(state: TournamentV1, courtId: string, actions: CourtClosureAction[]): CourtClosureProposal {
  const affected = state.fixtures.filter((fixture) => fixture.courtId === courtId && ['planned', 'playing', 'suspended'].includes(fixture.status)).map((fixture) => fixture.id).sort();
  invariant(actions.length === affected.length && new Set(actions.map((action) => action.fixtureId)).size === actions.length && actions.every((action) => affected.includes(action.fixtureId)), 'COURT_CLOSURE_ACTIONS', 'Review exactly one action for every match assigned to this court.');
  const proposal: CourtClosureProposal = { contractVersion: TOURNAMENT_CONTRACT_VERSION, baseRevision: state.revision, fingerprint: '', courtId, actions: actions.map((action) => ({ ...action })) };
  proposal.fingerprint = courtClosureFingerprint(proposal);
  return proposal;
}

export function validateCourtClosureProposal(proposal: CourtClosureProposal, state: TournamentV1): void {
  invariant(proposal.contractVersion === TOURNAMENT_CONTRACT_VERSION, 'CONTRACT_VERSION', 'This court closure uses an unsupported contract.');
  invariant(proposal.baseRevision === state.revision, 'STALE_PREVIEW', 'The tournament changed after this court closure was reviewed.');
  invariant(proposal.fingerprint === courtClosureFingerprint(proposal), 'PROPOSAL_FINGERPRINT', 'The reviewed court closure changed before Apply.');
  const affected = state.fixtures.filter((fixture) => fixture.courtId === proposal.courtId && ['planned', 'playing', 'suspended'].includes(fixture.status)).map((fixture) => fixture.id).sort();
  const supplied = proposal.actions.map((action) => action.fixtureId).sort();
  invariant(JSON.stringify(affected) === JSON.stringify(supplied), 'COURT_CLOSURE_ACTIONS', 'Court assignments changed; review the closure again.');
}

/** Deterministic interval scheduler. It never mutates the tournament. */
export function suggestSchedule(state: TournamentV1, startsAt: string): ScheduleSuggestion[] {
  const horizon = Date.parse(startsAt);
  invariant(Number.isFinite(horizon), 'SCHEDULE_START', 'Choose a valid schedule start.');
  const limit = state.meta.endsAt ? Date.parse(state.meta.endsAt) : horizon + 7 * DAY;
  const courts = state.courts.filter((court) => court.available).sort((a, b) => a.displayOrder - b.displayOrder || a.id.localeCompare(b.id));
  const courtReservations = new Map(state.courts.map((court) => [court.id, [] as Interval[]]));
  const playerReservations = new Map<string, Interval[]>();
  const plannedEndByFixture = new Map<string, number>();
  const suggestions: ScheduleSuggestion[] = [];

  const reservePlayers = (fixtureId: string, players: string[], start: number, end: number, rest: number) => {
    for (const playerId of players) addInterval(playerReservations, playerId, { start, end: finiteAdd(end, rest), fixtureId });
  };
  const reserveCourt = (fixtureId: string, courtId: string | null, start: number, end: number) => {
    if (courtId) addInterval(courtReservations, courtId, { start, end, fixtureId });
  };

  for (const fixture of state.fixtures) {
    const { duration, rest } = effectiveTiming(state, fixture);
    if (fixture.status === 'completed' && fixture.actualEndAt !== null) {
      reservePlayers(fixture.id, fixture.actualPlayerIds?.flat() ?? [], fixture.actualEndAt, fixture.actualEndAt, rest);
      plannedEndByFixture.set(fixture.id, fixture.actualEndAt);
      continue;
    }
    if (fixture.status === 'playing' || fixture.status === 'suspended') {
      const start = fixture.actualStartAt ?? horizon;
      const estimated = start + duration;
      const explicit = fixture.estimatedReleaseAt ? Date.parse(fixture.estimatedReleaseAt) : Number.NaN;
      const end = Number.isFinite(explicit) && explicit > horizon ? explicit
        : fixture.status === 'playing' && estimated > horizon ? estimated
          : Number.POSITIVE_INFINITY;
      reserveCourt(fixture.id, fixture.courtId, start, end);
      reservePlayers(fixture.id, fixture.actualPlayerIds?.flat() ?? [], start, end, rest);
      if (Number.isFinite(end)) plannedEndByFixture.set(fixture.id, end);
      continue;
    }
    if (fixture.status === 'planned' && fixture.pinned && fixture.courtId && fixture.plannedStartAt) {
      const start = Date.parse(fixture.plannedStartAt);
      const end = start + duration;
      reserveCourt(fixture.id, fixture.courtId, start, end);
      reservePlayers(fixture.id, possiblePlayerIds(state, fixture), start, end, rest);
      plannedEndByFixture.set(fixture.id, end);
    }
  }

  for (const fixture of topologicalCandidates(state)) {
    if (fixture.status !== 'planned') continue;
    const { duration, rest } = effectiveTiming(state, fixture);
    if (fixture.pinned) {
      if (fixture.courtId && fixture.plannedStartAt) {
        const start = Date.parse(fixture.plannedStartAt);
        suggestions.push({ fixtureId: fixture.id, courtId: fixture.courtId, plannedStartAt: fixture.plannedStartAt, plannedEndAt: new Date(start + duration).toISOString(), reason: 'Pinned assignment retained.', provisional: sourceIsProvisional(fixture) });
      } else {
        suggestions.push({ fixtureId: fixture.id, courtId: fixture.courtId, plannedStartAt: fixture.plannedStartAt, plannedEndAt: null, reason: 'Pinned fixture needs court/time.', provisional: true });
      }
      continue;
    }

    const possiblePlayers = possiblePlayerIds(state, fixture);
    if (possiblePlayers.length === 0) {
      suggestions.push({ fixtureId: fixture.id, courtId: null, plannedStartAt: null, plannedEndAt: null, reason: 'Participants unresolved.', provisional: true });
      continue;
    }
    const readinessUnknown = possibleEntryIds(state, fixture).some((entryId) => {
      const readiness = state.entries.find((entry) => entry.id === entryId)?.readiness;
      return readiness === 'late' || readiness === 'withdrawn';
    });
    if (readinessUnknown) {
      suggestions.push({ fixtureId: fixture.id, courtId: null, plannedStartAt: null, plannedEndAt: null, reason: 'Participant readiness unresolved.', provisional: true });
      continue;
    }

    const dependencyBarrier = dependencyEnd(state, fixture, plannedEndByFixture);
    const earliest = Math.max(horizon, dependencyBarrier ?? horizon);
    const preferred = fixture.courtId && fixture.plannedStartAt
      ? [{ court: courts.find((court) => court.id === fixture.courtId), requested: Date.parse(fixture.plannedStartAt) }]
      : [];
    const options = [
      ...preferred,
      ...courts.filter((court) => !preferred.some((item) => item.court?.id === court.id)).map((court) => ({ court, requested: earliest })),
    ].flatMap(({ court, requested }) => {
      if (!court) return [];
      const at = findSlot(court.availabilityWindows, Math.max(earliest, requested), limit, duration, rest, possiblePlayers, courtReservations.get(court.id) ?? [], playerReservations);
      return at === null ? [] : [{ court, at }];
    }).sort((a, b) => a.at - b.at || a.court.displayOrder - b.court.displayOrder || a.court.id.localeCompare(b.court.id));

    const chosen = options[0];
    if (!chosen) {
      const indefinitelyBlocked = possiblePlayers.some((playerId) => (playerReservations.get(playerId) ?? []).some((interval) => !Number.isFinite(interval.end)))
        || courts.length > 0 && courts.every((court) => (courtReservations.get(court.id) ?? []).some((interval) => !Number.isFinite(interval.end)));
      const reason = indefinitelyBlocked
        ? 'Awaiting finish estimate.'
        : courts.length === 0 || courts.every((court) => court.availabilityWindows?.length === 0)
        ? 'No court availability window is open.'
        : 'Unscheduled: no collision-free court and player interval.';
      suggestions.push({ fixtureId: fixture.id, courtId: null, plannedStartAt: null, plannedEndAt: null, reason, provisional: sourceIsProvisional(fixture) });
      continue;
    }

    const end = chosen.at + duration;
    reserveCourt(fixture.id, chosen.court.id, chosen.at, end);
    reservePlayers(fixture.id, possiblePlayers, chosen.at, end, rest);
    plannedEndByFixture.set(fixture.id, end);
    suggestions.push({
      fixtureId: fixture.id,
      courtId: chosen.court.id,
      plannedStartAt: new Date(chosen.at).toISOString(),
      plannedEndAt: new Date(end).toISOString(),
      reason: sourceIsProvisional(fixture) ? 'Provisional: possible participants reserved.' : 'Estimated from court windows, duration and player rest.',
      provisional: sourceIsProvisional(fixture),
    });
  }
  return suggestions;
}

export function createScheduleProposal(state: TournamentV1, startsAt: string): TournamentScheduleProposal {
  return createReviewedScheduleProposal(state, suggestSchedule(state, startsAt));
}

export function createReviewedScheduleProposal(state: TournamentV1, suggestions: TournamentScheduleSuggestion[]): TournamentScheduleProposal {
  const proposal: TournamentScheduleProposal = {
    contractVersion: TOURNAMENT_CONTRACT_VERSION,
    baseRevision: state.revision,
    fingerprint: '',
    suggestions: suggestions.map((suggestion) => ({ ...suggestion })),
  };
  proposal.fingerprint = scheduleProposalFingerprint(proposal);
  return proposal;
}

export function validateScheduleProposal(proposal: TournamentScheduleProposal, revision: string): void {
  invariant(proposal.contractVersion === TOURNAMENT_CONTRACT_VERSION, 'CONTRACT_VERSION', 'This schedule proposal uses an unsupported contract.');
  invariant(proposal.baseRevision === revision, 'STALE_PREVIEW', 'The tournament changed after this schedule was reviewed.');
  invariant(proposal.fingerprint === scheduleProposalFingerprint(proposal), 'PROPOSAL_FINGERPRINT', 'The reviewed schedule changed before Apply.');
}

export function applyScheduleSuggestions(fixtures: TournamentFixture[], suggestions: ScheduleSuggestion[], includePinned = false): TournamentFixture[] {
  const byId = new Map(suggestions.map((item) => [item.fixtureId, item]));
  return fixtures.map((fixture) => {
    const suggestion = byId.get(fixture.id);
    if (!suggestion || fixture.status !== 'planned' || fixture.pinned && !includePinned) return fixture;
    return { ...fixture, courtId: suggestion.courtId, plannedStartAt: suggestion.plannedStartAt };
  });
}

function topologicalCandidates(state: TournamentV1): TournamentFixture[] {
  const output: TournamentFixture[] = [];
  const visited = new Set<string>();
  const visiting = new Set<string>();
  const byId = new Map(state.fixtures.map((fixture) => [fixture.id, fixture]));
  const visit = (fixture: TournamentFixture) => {
    if (visited.has(fixture.id)) return;
    invariant(!visiting.has(fixture.id), 'QUALIFICATION_CYCLE', 'Cannot schedule a cyclic draw.');
    visiting.add(fixture.id);
    for (const source of [fixture.sideA, fixture.sideB]) {
      if (source.kind === 'winner-of-match' || source.kind === 'loser-of-match') {
        const upstream = byId.get(source.fixtureId); if (upstream) visit(upstream);
      } else if (source.kind === 'group-position') {
        const group = state.groups.find((item) => item.id === source.groupId);
        for (const id of group?.fixtureIds ?? []) { const upstream = byId.get(id); if (upstream) visit(upstream); }
      }
    }
    visiting.delete(fixture.id); visited.add(fixture.id); output.push(fixture);
  };
  [...state.fixtures].sort((a, b) => a.queueOrder - b.queueOrder || a.id.localeCompare(b.id)).forEach(visit);
  return output;
}

function dependencyEnd(state: TournamentV1, fixture: TournamentFixture, ends: Map<string, number>): number | null {
  const dependencies: number[] = [];
  for (const source of [fixture.sideA, fixture.sideB]) {
    if (source.kind === 'winner-of-match' || source.kind === 'loser-of-match') {
      const end = ends.get(source.fixtureId); if (end !== undefined) dependencies.push(end);
    } else if (source.kind === 'group-position') {
      const group = state.groups.find((item) => item.id === source.groupId);
      for (const id of group?.fixtureIds ?? []) { const end = ends.get(id); if (end !== undefined) dependencies.push(end); }
    }
  }
  return dependencies.length ? Math.max(...dependencies) : null;
}

function possiblePlayerIds(state: TournamentV1, fixture: TournamentFixture): string[] {
  const entries = possibleEntryIds(state, fixture);
  const players = entries.flatMap((entryId) => {
    try { return activeLineup(state, entryId, fixture.id); } catch { return []; }
  });
  return [...new Set(players)];
}

function possibleEntryIds(state: TournamentV1, fixture: TournamentFixture): string[] {
  return [...new Set([...possibleSourceEntries(state, fixture.sideA, new Set()), ...possibleSourceEntries(state, fixture.sideB, new Set())])];
}

function possibleSourceEntries(state: TournamentV1, source: FixtureSource, visited: Set<string>): string[] {
  if (source.kind === 'entry') return [source.entryId];
  if (source.kind === 'bye') return [];
  if (source.kind === 'group-position') return state.groups.find((group) => group.id === source.groupId)?.entryIds ?? [];
  if (visited.has(source.fixtureId)) return [];
  visited.add(source.fixtureId);
  const upstream = state.fixtures.find((fixture) => fixture.id === source.fixtureId);
  if (!upstream) return [];
  if (upstream.status === 'completed' && upstream.result && upstream.actualEntryIds) {
    if (source.kind === 'winner-of-match') return [upstream.result.winnerEntryId];
    return upstream.actualEntryIds.filter((entryId) => entryId !== upstream.result!.winnerEntryId);
  }
  if (upstream.status === 'resolved-bye') {
    return source.kind === 'winner-of-match' ? [upstream.resolvedEntryAId ?? upstream.resolvedEntryBId].filter((id): id is string => Boolean(id)) : [];
  }
  return [...new Set([...possibleSourceEntries(state, upstream.sideA, visited), ...possibleSourceEntries(state, upstream.sideB, visited)])];
}

function sourceIsProvisional(fixture: TournamentFixture): boolean {
  return !fixture.resolvedEntryAId || !fixture.resolvedEntryBId;
}

function effectiveTiming(state: TournamentV1, fixture: TournamentFixture): { duration: number; rest: number } {
  const profile = fixture.actualRuleProfile ?? state.ruleProfiles.find((item) => item.id === fixture.ruleProfileId);
  return {
    duration: (fixture.durationOverrideMinutes ?? profile?.estimatedMinutes ?? 20) * 60_000,
    rest: (fixture.restOverrideMinutes ?? profile?.restMinutes ?? 15) * 60_000,
  };
}

function findSlot(
  windows: Array<{ startsAt: string; endsAt: string }> | null,
  earliest: number,
  limit: number,
  duration: number,
  rest: number,
  players: string[],
  courtIntervals: Interval[],
  playerReservations: Map<string, Interval[]>,
): number | null {
  const usable = windows === null ? [{ start: earliest, end: limit }] : windows.map((window) => ({ start: Date.parse(window.startsAt), end: Date.parse(window.endsAt) }));
  for (const window of usable) {
    let at = Math.max(earliest, window.start);
    while (at + duration <= Math.min(window.end, limit)) {
      const conflicts = [
        ...courtIntervals.filter((interval) => overlaps(at, at + duration, interval.start, interval.end)),
        ...players.flatMap((playerId) => (playerReservations.get(playerId) ?? []).filter((interval) => overlaps(at, finiteAdd(at + duration, rest), interval.start, interval.end))),
      ];
      if (conflicts.length === 0) return at;
      const shifted = Math.max(...conflicts.map((interval) => interval.end));
      if (!Number.isFinite(shifted) || shifted <= at) break;
      at = shifted;
    }
  }
  return null;
}

function addInterval(map: Map<string, Interval[]>, key: string, interval: Interval): void {
  const values = map.get(key) ?? [];
  values.push(interval); values.sort((a, b) => a.start - b.start || a.fixtureId.localeCompare(b.fixtureId)); map.set(key, values);
}

function overlaps(aStart: number, aEnd: number, bStart: number, bEnd: number): boolean {
  return aStart < bEnd && bStart < aEnd;
}

function finiteAdd(value: number, increment: number): number {
  return Number.isFinite(value) ? value + increment : value;
}

function scheduleProposalFingerprint(proposal: TournamentScheduleProposal): string {
  const input = JSON.stringify({ contractVersion: proposal.contractVersion, baseRevision: proposal.baseRevision, suggestions: proposal.suggestions });
  let hash = 2_166_136_261;
  for (let index = 0; index < input.length; index += 1) hash = Math.imul(hash ^ input.charCodeAt(index), 16_777_619);
  return (hash >>> 0).toString(16).padStart(8, '0');
}

function courtClosureFingerprint(proposal: CourtClosureProposal): string {
  const input = JSON.stringify({ contractVersion: proposal.contractVersion, baseRevision: proposal.baseRevision, courtId: proposal.courtId, actions: proposal.actions });
  let hash = 2_166_136_261;
  for (let index = 0; index < input.length; index += 1) hash = Math.imul(hash ^ input.charCodeAt(index), 16_777_619);
  return (hash >>> 0).toString(16).padStart(8, '0');
}
