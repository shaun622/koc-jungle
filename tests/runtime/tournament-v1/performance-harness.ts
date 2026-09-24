import {
  cloneTournament,
  createTournamentV1,
  makeFixture,
  publicProjection,
  stagePlanningDefaults,
  validateTournament,
  type TournamentEntry,
  type TournamentFixture,
  type TournamentStage,
  type TournamentV1,
} from '/src/logic/tournament/index.ts';
import { startTournamentPlanning } from '/src/logic/tournament/planningClient.ts';
import { createTournamentRecord } from '/src/store/tournamentRepository.ts';
import { restoreTournamentBackup, tournamentBackup } from '/src/utils/tournamentExport.ts';

type Metric = { name: string; durationMs: number };
type V8Result = {
  pass: boolean;
  counts: ReturnType<typeof counts>;
  restoredCounts: ReturnType<typeof counts>;
  semanticHash: string;
  restoredSemanticHash: string;
  publicFixtureCount: number;
  scheduleSuggestions: number;
  correctionImpacts: number;
  cancellation: string;
  progressEvents: number;
  metrics: Metric[];
  maxLongTaskMs: number;
  maxAnimationFrameGapMs: number;
  errors: string[];
};

declare global { interface Window { tournamentPerformanceHarness: { ready: boolean; run: () => Promise<V8Result> } } }

const now = 1_800_000_000_000;
const profileId = 'first-to-five';

function buildMaximumState(): TournamentV1 {
  const state = createTournamentV1({ id: 'performance-tournament', title: 'Maximum Tournament', now, divisionId: 'division-1', courtIds: Array.from({ length: 16 }, (_, index) => `court-${index + 1}`) });
  state.meta.startsAt = '2027-01-01T08:00:00.000Z';
  state.meta.endsAt = '2027-01-08T08:00:00.000Z';
  state.divisions = Array.from({ length: 4 }, (_, index) => ({ id: `division-${index + 1}`, name: `Division ${index + 1}`, capacity: 16, drawPublishedAt: null, automaticPromotion: true }));
  const confirmedByDivision: string[][] = [[], [], [], []];
  for (let divisionIndex = 0; divisionIndex < 4; divisionIndex += 1) {
    for (let entryIndex = 0; entryIndex < 48; entryIndex += 1) {
      const serial = divisionIndex * 48 + entryIndex + 1;
      const entryId = `entry-${serial}`; const playerA = `player-${serial}-a`; const playerB = `player-${serial}-b`; const lineupId = `lineup-${serial}`;
      state.players.push({ id: playerA, name: `Player ${serial} A` }, { id: playerB, name: `Player ${serial} B` });
      const confirmed = entryIndex < 16;
      const entry: TournamentEntry = { id: entryId, divisionId: `division-${divisionIndex + 1}`, teamName: `Pair ${serial}`, playerIds: [playerA, playerB], admission: confirmed ? 'confirmed' : 'waiting', readiness: 'ready', acceptedAt: now + serial, waitRank: confirmed ? null : entryIndex - 15, activeLineupRevisionId: lineupId };
      state.entries.push(entry);
      state.lineupRevisions.push({ id: lineupId, entryId, playerIds: [playerA, playerB], effectiveFixtureIds: [], createdAt: now + serial, reason: 'Maximum-size fixture' });
      if (confirmed) confirmedByDivision[divisionIndex].push(entryId);
    }
  }
  for (let divisionIndex = 0; divisionIndex < 4; divisionIndex += 1) {
    const stage: TournamentStage = { id: `stage-${divisionIndex + 1}`, divisionId: `division-${divisionIndex + 1}`, name: `Division ${divisionIndex + 1} schedule`, kind: 'manual', order: divisionIndex + 1, entryIds: confirmedByDivision[divisionIndex], groupIds: [], defaultRuleProfileId: profileId, qualificationConfirmedAt: null, qualificationFingerprint: null, amended: false, closedAt: null, ...stagePlanningDefaults() };
    state.stages.push(stage);
  }
  for (let index = 0; index < 2_048; index += 1) {
    const divisionIndex = index % 4; const entries = confirmedByDivision[divisionIndex];
    const entryA = entries[index % entries.length]; const entryB = entries[(index * 5 + 1) % entries.length];
    state.fixtures.push(makeFixture({ id: `fixture-${index + 1}`, divisionId: `division-${divisionIndex + 1}`, stageId: `stage-${divisionIndex + 1}`, label: `Match ${index + 1}`, sideA: { kind: 'entry', entryId: entryA }, sideB: { kind: 'entry', entryId: entryB }, ruleProfileId: profileId, queueOrder: index + 1 }));
  }
  const completed = state.fixtures[0];
  completeFixture(state, completed, now + 10_000, { gamesA: 5, gamesB: 3 });
  for (let index = 0; index < 64; index += 1) {
    const source = state.fixtures[index + 1]; const fixture = cloneTournament(source);
    fixture.id = `voided-${index + 1}`; fixture.label = `Voided history ${index + 1}`; fixture.queueOrder = 3_000 + index;
    fixture.status = 'voided'; fixture.actualStartAt = now + 20_000 + index; fixture.actualEndAt = now + 21_000 + index;
    fixture.actualEntryIds = [fixture.resolvedEntryAId!, fixture.resolvedEntryBId!];
    fixture.actualPlayerIds = fixture.actualEntryIds.map((entryId) => state.entries.find((entry) => entry.id === entryId)!.playerIds) as [[string, string], [string, string]];
    fixture.actualRuleProfile = cloneTournament(state.ruleProfiles.find((profile) => profile.id === profileId)!);
    fixture.voidReason = 'Synthetic retained history';
    state.fixtures.push(fixture);
  }
  return validateTournament(state);
}

function completeFixture(state: TournamentV1, fixture: TournamentFixture, at: number, set: { gamesA: number; gamesB: number }) {
  fixture.status = 'completed'; fixture.actualStartAt = at - 1_000; fixture.actualEndAt = at;
  fixture.actualEntryIds = [fixture.resolvedEntryAId!, fixture.resolvedEntryBId!];
  fixture.actualPlayerIds = fixture.actualEntryIds.map((entryId) => state.entries.find((entry) => entry.id === entryId)!.playerIds) as [[string, string], [string, string]];
  fixture.actualRuleProfile = cloneTournament(state.ruleProfiles.find((profile) => profile.id === profileId)!);
  fixture.liveScore = { sets: [set] };
  fixture.result = { revision: 1, kind: 'played', winnerEntryId: set.gamesA > set.gamesB ? fixture.actualEntryIds[0] : fixture.actualEntryIds[1], score: { sets: [set] }, reportedScore: null, reason: '', confirmedAt: at, retrospective: true };
}

function counts(state: TournamentV1) {
  return { divisions: state.divisions.length, confirmed: state.entries.filter((entry) => entry.admission === 'confirmed').length, waiting: state.entries.filter((entry) => entry.admission === 'waiting').length, courts: state.courts.length, nonvoidedFixtures: state.fixtures.filter((fixture) => fixture.status !== 'voided').length, voidedFixtures: state.fixtures.filter((fixture) => fixture.status === 'voided').length, totalFixtures: state.fixtures.length };
}

function semanticHash(state: TournamentV1) {
  const value = JSON.stringify({ counts: counts(state), entries: state.entries.map((entry) => [entry.teamName, entry.admission, entry.waitRank]), fixtures: state.fixtures.map((fixture) => [fixture.label, fixture.status, fixture.queueOrder, fixture.result?.score ?? null]) });
  let hash = 2166136261; for (let index = 0; index < value.length; index += 1) hash = Math.imul(hash ^ value.charCodeAt(index), 16777619) >>> 0;
  return hash.toString(16).padStart(8, '0');
}

async function run(): Promise<V8Result> {
  const errors: string[] = []; const metrics: Metric[] = [];
  const state = buildMaximumState();
  const longTasks: number[] = [];
  if (PerformanceObserver.supportedEntryTypes.includes('longtask')) {
    const observer = new PerformanceObserver((list) => list.getEntries().forEach((entry) => longTasks.push(entry.duration)));
    observer.observe({ type: 'longtask', buffered: true });
  }
  let active = true; let previousFrame = performance.now(); let maxAnimationFrameGapMs = 0;
  const tick = (time: number) => { maxAnimationFrameGapMs = Math.max(maxAnimationFrameGapMs, time - previousFrame); previousFrame = time; if (active) requestAnimationFrame(tick); };
  requestAnimationFrame(tick);
  const measure = async <T,>(name: string, operation: () => Promise<T> | T) => { const start = performance.now(); const result = await operation(); metrics.push({ name, durationMs: performance.now() - start }); return result; };
  let progressEvents = 0;
  const cancelled = startTournamentPlanning({ kind: 'schedule', state, startsAt: state.meta.startsAt!, baseRevision: state.revision }, { onProgress: () => { progressEvents += 1; } });
  const cancellationPromise = cancelled.promise.then(() => 'unexpected-result', (error) => error instanceof DOMException && error.name === 'AbortError' ? 'cancelled' : `wrong-error:${String(error)}`);
  cancelled.cancel();
  const cancellation = await cancellationPromise;
  if (cancellation !== 'cancelled') errors.push(`Cancelled worker returned ${cancellation}.`);
  const schedule = await measure('worker schedule 2048 fixtures', async () => {
    const job = startTournamentPlanning({ kind: 'schedule', state, startsAt: state.meta.startsAt!, baseRevision: state.revision }, { onProgress: () => { progressEvents += 1; } });
    return job.promise;
  });
  const correctedResult = { ...state.fixtures[0].result!, score: { sets: [{ gamesA: 5, gamesB: 2 }] }, reportedScore: null };
  const correction = await measure('worker correction preview', async () => startTournamentPlanning({ kind: 'correction', state, fixtureId: state.fixtures[0].id, result: correctedResult, baseRevision: state.revision }).promise);
  const record = createTournamentRecord('performance-owner', state, now);
  const backup = await measure('rich backup', () => tournamentBackup(record, true, true));
  const serialized = await measure('backup stringify and parse', () => JSON.parse(JSON.stringify(backup)) as typeof backup);
  const restored = await measure('full ID-remapped restore', () => restoreTournamentBackup(serialized).state);
  const projection = await measure('public projection', () => publicProjection(state));
  await measure('representative render commit', async () => {
    const root = document.querySelector('#root')!;
    root.innerHTML = `<section>${projection.entries.slice(0,64).map((entry) => `<article>${entry.label}: ${entry.players.join(' & ')}</article>`).join('')}</section><section>${projection.courts.map((court) => `<article>${court.name}</article>`).join('')}</section>`;
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
  });
  active = false;
  const originalCounts = counts(state); const restoredCounts = counts(restored); const originalHash = semanticHash(state); const restoredHash = semanticHash(restored);
  if (JSON.stringify(originalCounts) !== JSON.stringify(restoredCounts)) errors.push('Entity counts changed after backup/restore.');
  if (originalHash !== restoredHash) errors.push('Semantic hash changed after backup/restore.');
  if (schedule.kind !== 'schedule' || schedule.proposal.suggestions.length !== 2_047) errors.push('Schedule worker dropped or added planned fixtures.');
  if (correction.kind !== 'correction') errors.push('Correction worker returned the wrong result kind.');
  const maxLongTaskMs = Math.max(0, ...longTasks);
  if (maxLongTaskMs > 200) errors.push(`Main-thread long task exceeded 200ms (${maxLongTaskMs.toFixed(1)}ms).`);
  return { pass: errors.length === 0, counts: originalCounts, restoredCounts, semanticHash: originalHash, restoredSemanticHash: restoredHash, publicFixtureCount: projection.fixtures.length, scheduleSuggestions: schedule.kind === 'schedule' ? schedule.proposal.suggestions.length : 0, correctionImpacts: correction.kind === 'correction' ? correction.preview.impacts.length : 0, cancellation, progressEvents, metrics, maxLongTaskMs, maxAnimationFrameGapMs, errors };
}

window.tournamentPerformanceHarness = { ready: true, run };
document.querySelector('#root')!.textContent = 'Tournament V8 ready.';

