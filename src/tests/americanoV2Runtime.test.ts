import { describe, expect, it } from 'vitest';
import {
  addAmericanoParticipant,
  confirmAmericanoResult,
  correctAmericanoResult,
  endAmericanoRound,
  finishAmericanoEarly,
  freshAmericanoCopy,
  previewAmericanoSchedule,
  reorderAmericanoParticipants,
  replaceAmericanoCourts,
  setAmericanoResultSide,
  startAmericanoEvent,
  startNextAmericanoRound,
  updateAmericanoClock,
  updateAmericanoConfig,
} from '@/logic/americanoV2/runtime';
import { computeAmericanoStandings } from '@/logic/americanoV2/standings';
import type { AmericanoEventStateV2 } from '@/logic/americanoV2/types';
import { parseEventState } from '@/utils/eventSchema';
import { americanoV2Fixture } from '@/tests/americanoV2Fixtures';

async function startedRotating(count = 4, options: { rounds?: number; clock?: boolean } = {}) {
  let event = americanoV2Fixture('rotating');
  while (event.participants.length < count) event = addAmericanoParticipant(event, `Player ${event.participants.length + 1}`);
  if (options.rounds) event = updateAmericanoConfig(event, { scheduleKind: 'custom', customRounds: options.rounds });
  if (options.clock) event = updateAmericanoConfig(event, { paceClockEnabled: true });
  event = await previewAmericanoSchedule(event, {
    seed: 123,
    acknowledgeUnevenAppearances: true,
    acknowledgeRepeatedCycle: true,
  });
  return startAmericanoEvent(event);
}

function confirmCurrent(event: AmericanoEventStateV2, scoreA = 10) {
  const match = event.rounds.at(-1)!.matches[0];
  return confirmAmericanoResult(setAmericanoResultSide(event, match.id, 'A', scoreA), match.id);
}

describe('Americano v2 lifecycle', () => {
  it.each(['rotating', 'fixed'] as const)('saves a valid default when switching %s events to custom rounds', (mode) => {
    let event = updateAmericanoConfig(americanoV2Fixture(mode), { scheduleKind: 'custom' });
    expect(event.formatConfig.customRounds).toBe(1);
    expect(() => parseEventState(JSON.parse(JSON.stringify(event)))).not.toThrow();
    event = updateAmericanoConfig(event, { customRounds: 7 });
    expect(event.formatConfig.customRounds).toBe(7);
    event = updateAmericanoConfig(event, { scheduleKind: 'full' });
    expect(event.formatConfig.customRounds).toBeUndefined();
    event = updateAmericanoConfig(event, { scheduleKind: 'custom' });
    expect(event.formatConfig.customRounds).toBe(1);
    expect(() => parseEventState(JSON.parse(JSON.stringify(event)))).not.toThrow();
  });

  it.each([1, 21, 40, 100, 2147483647])('saves and scores a custom %i-point match', async (points) => {
    let event = updateAmericanoConfig(americanoV2Fixture(), { pointsPerMatch: points, scheduleKind: 'custom', customRounds: 1 });
    event = await previewAmericanoSchedule(event, { seed: 123 });
    event = startAmericanoEvent(event);
    const match = event.rounds[0].matches[0];
    const scoreA = Math.floor(points / 2);
    event = confirmAmericanoResult(setAmericanoResultSide(event, match.id, 'A', scoreA), match.id);
    event = endAmericanoRound(event);
    const restored = parseEventState(JSON.parse(JSON.stringify(event))) as AmericanoEventStateV2;
    expect(restored.formatConfig.pointsPerMatch).toBe(points);
    expect(restored.rounds[0].matches[0]).toMatchObject({ scoreA, scoreB: points - scoreA, resultConfirmed: true });
    expect(computeAmericanoStandings(restored).map((row) => row.total).sort((a, b) => a - b))
      .toEqual([scoreA, scoreA, points - scoreA, points - scoreA]);
  });

  it('persists an explicit 0–24 while an untouched result remains incomplete', async () => {
    let event = await startedRotating(8, { rounds: 1 });
    const [first, second] = event.rounds[0].matches;
    event = confirmAmericanoResult(setAmericanoResultSide(event, first.id, 'A', 0), first.id);
    const restored = parseEventState(JSON.parse(JSON.stringify(event))) as AmericanoEventStateV2;
    expect(restored.rounds[0].matches[0]).toMatchObject({ scoreA: 0, scoreB: 24, resultConfirmed: true });
    expect(restored.rounds[0].matches[1]).toMatchObject({ scoreA: null, scoreB: null, resultConfirmed: false });
    expect(() => endAmericanoRound(restored)).toThrow(/Confirm every court/);
    expect(second.resultConfirmed).toBe(false);
  });

  it('makes Confirm, End and Next idempotent and never duplicates a round', async () => {
    let event = await startedRotating(4, { rounds: 2 });
    event = confirmCurrent(event, 12);
    const confirmedAgain = confirmAmericanoResult(event, event.rounds[0].matches[0].id);
    expect(computeAmericanoStandings(confirmedAgain).every((row) => row.matchesPlayed === 0)).toBe(true);
    const ended = endAmericanoRound(confirmedAgain);
    expect(endAmericanoRound(ended)).toBe(ended);
    const next = startNextAmericanoRound(ended);
    expect(next.rounds).toHaveLength(2);
    expect(startNextAmericanoRound(next)).toBe(next);
  });

  it('requires acknowledgement for uneven and repeated custom schedules', async () => {
    let seven = americanoV2Fixture('rotating');
    while (seven.participants.length < 7) seven = addAmericanoParticipant(seven, `Player ${seven.participants.length + 1}`);
    seven = updateAmericanoConfig(seven, { scheduleKind: 'custom', customRounds: 6 });
    seven = await previewAmericanoSchedule(seven, { seed: 77 });
    expect(seven.americanoSchedule!.metrics.maximumAppearanceSpread).toBeGreaterThan(0);
    expect(() => startAmericanoEvent(seven)).toThrow(/uneven/i);
    seven = await previewAmericanoSchedule(seven, { seed: 77, acknowledgeUnevenAppearances: true });
    expect(() => startAmericanoEvent(seven)).not.toThrow();

    let repeated = americanoV2Fixture('rotating');
    repeated = updateAmericanoConfig(repeated, { scheduleKind: 'custom', customRounds: 5 });
    repeated = await previewAmericanoSchedule(repeated, { seed: 88 });
    expect(() => startAmericanoEvent(repeated)).toThrow(/repeated/i);
    repeated = await previewAmericanoSchedule(repeated, { seed: 88, acknowledgeRepeatedCycle: true });
    expect(() => startAmericanoEvent(repeated)).not.toThrow();
  });

  it('keeps fixtures deterministic through serialization and historical correction', async () => {
    let event = await startedRotating(4, { rounds: 2 });
    const fixtures = JSON.stringify(event.americanoSchedule!.rounds);
    event = endAmericanoRound(confirmCurrent(event, 10));
    event = startNextAmericanoRound(event);
    const futureFixture = JSON.stringify(event.rounds[1].matches.map(({ sideA, sideB }) => ({ sideA, sideB })));
    const first = event.rounds[0].matches[0];
    event = correctAmericanoResult(event, event.rounds[0].id, first.id, 11, 13);
    expect(JSON.stringify(event.americanoSchedule!.rounds)).toBe(fixtures);
    expect(JSON.stringify(event.rounds[1].matches.map(({ sideA, sideB }) => ({ sideA, sideB })))).toBe(futureFixture);
    expect(JSON.stringify((parseEventState(JSON.parse(JSON.stringify(event))) as AmericanoEventStateV2).americanoSchedule!.rounds)).toBe(fixtures);
  });

  it('invalidates previews for roster, order, courts and rule changes', async () => {
    const preview = await previewAmericanoSchedule(americanoV2Fixture('rotating'), { seed: 9 });
    expect(addAmericanoParticipant(preview, 'Extra').americanoSchedule).toBeUndefined();
    expect(reorderAmericanoParticipants(preview, preview.participants.map((row) => row.id).reverse()).americanoSchedule).toBeUndefined();
    expect(replaceAmericanoCourts(preview, preview.courts.slice(0, 1)).americanoSchedule).toBeUndefined();
    expect(updateAmericanoConfig(preview, { pointsPerMatch: 16 }).americanoSchedule).toBeUndefined();
  });

  it('keeps a confirmed current result separate from committing the round', async () => {
    const event = confirmCurrent(await startedRotating(4, { rounds: 1 }), 12);
    expect(event.status).toBe('round-in-progress');
    expect(computeAmericanoStandings(event).every((row) => row.matchesPlayed === 0)).toBe(true);
    const complete = endAmericanoRound(event);
    expect(complete.status).toBe('complete');
    expect(complete.completionReason).toBe('scheduled');
    expect(computeAmericanoStandings(complete).every((row) => row.matchesPlayed === 1)).toBe(true);
  });

  it('unconfirms an edited current result and cancel-style history reads do not mutate official scores', async () => {
    let event = confirmCurrent(await startedRotating(4, { rounds: 2 }), 10);
    const edited = setAmericanoResultSide(event, event.rounds[0].matches[0].id, 'A', 11);
    expect(edited.rounds[0].matches[0]).toMatchObject({ scoreA: 11, scoreB: 13, resultConfirmed: false });
    event = endAmericanoRound(confirmAmericanoResult(edited, edited.rounds[0].matches[0].id));
    const beforeCancel = JSON.stringify(event.rounds[0].matches[0]);
    expect(JSON.stringify(event.rounds[0].matches[0])).toBe(beforeCancel);
  });

  it('runs the advisory clock without changing match or event state at expiry and resets each round paused', async () => {
    let event = await startedRotating(4, { rounds: 2, clock: true });
    const originalMatch = JSON.stringify(event.rounds[0].matches[0]);
    event = updateAmericanoClock(event, 'start', 1_000);
    event = updateAmericanoClock(event, 'pause', 700_000);
    expect(event.status).toBe('round-in-progress');
    expect(JSON.stringify(event.rounds[0].matches[0])).toBe(originalMatch);
    event = updateAmericanoClock(event, 'reset', 800_000);
    expect(event.rounds[0]).toMatchObject({ startedAt: undefined, pausedAt: undefined, totalPausedMs: 0, durationMs: 600_000 });
    event = startNextAmericanoRound(endAmericanoRound(confirmCurrent(event, 12)));
    expect(event.rounds[1]).toMatchObject({ totalPausedMs: 0, durationMs: 600_000 });
    expect(event.rounds[1]).not.toHaveProperty('startedAt');
    expect(event.rounds[1]).not.toHaveProperty('pausedAt');
  });

  it('ends early by excluding the whole unfinished round and keeps it excluded after reload', async () => {
    let event = await startedRotating(8, { rounds: 2 });
    const first = event.rounds[0].matches[0];
    event = confirmAmericanoResult(setAmericanoResultSide(event, first.id, 'A', 10), first.id);
    const early = finishAmericanoEarly(event);
    expect(early).toMatchObject({ status: 'complete', completionReason: 'early' });
    expect(early.rounds[0].excludedReason).toBe('ended-early');
    expect(computeAmericanoStandings(early).every((row) => row.matchesPlayed === 0)).toBe(true);
    const restored = parseEventState(JSON.parse(JSON.stringify(early))) as AmericanoEventStateV2;
    const unchanged = correctAmericanoResult(restored, restored.rounds[0].id, first.id, 11, 13);
    expect(unchanged.rounds[0]).toEqual(restored.rounds[0]);
  });

  it('creates a completely unlinked fresh event without changing the original', async () => {
    const original = await previewAmericanoSchedule(americanoV2Fixture('rotating'), { seed: 19 });
    original.settings.publishedSignupId = 'signup-id';
    original.settings.publishedStartsAt = '2030-01-01T00:00:00.000Z';
    const snapshot = JSON.stringify(original);
    const copy = freshAmericanoCopy(original);
    expect(JSON.stringify(original)).toBe(snapshot);
    expect(copy.id).not.toBe(original.id);
    expect(copy.courts.map((court) => court.id)).not.toEqual(original.courts.map((court) => court.id));
    expect(copy).toMatchObject({ status: 'setup', rounds: [], participants: [], teams: [] });
    expect(copy.americanoSchedule).toBeUndefined();
    expect(copy.settings.publishedSignupId).toBeUndefined();
    expect(copy.settings.publishedStartsAt).toBeUndefined();
  });
});
