import { describe, expect, it } from 'vitest';
import {
  addAmericanoFixedTeamV3,
  addAmericanoParticipantV3,
  confirmAmericanoResultV3,
  createAmericanoEventV3,
  endAmericanoRoundV3,
  finishAmericanoEarlyV3,
  previewAmericanoScheduleV3,
  setAmericanoRallyScoreV3,
  setAmericanoResultDraftV3,
  startAmericanoEventV3,
  startNextAmericanoRoundV3,
  updateAmericanoClockV3,
  updateAmericanoConfigV3,
} from '@/logic/americanoV3/runtime';
import { AMERICANO_V3_TRADITIONAL_PRESETS } from '@/logic/americanoV3/scoring';
import type { AmericanoEventStateV3, AmericanoResultDraftV3 } from '@/logic/americanoV3/types';

describe('Americano v3 lifecycle', () => {
  it('keeps the rally defaults, invalidates previews and locks rules at start', async () => {
    let event = createAmericanoEventV3('Rally V3', 'rotating', 2);
    for (let i = 0; i < 8; i += 1) event = addAmericanoParticipantV3(event, `Player ${i + 1}`);
    event = await previewAmericanoScheduleV3(event, { seed: 12 });
    expect(event.americanoSchedule?.fingerprintVersion).toBe(3);
    event = updateAmericanoConfigV3(event, { paceMinutes: 15 });
    expect(event.americanoSchedule).toBeUndefined();
    event = await previewAmericanoScheduleV3(event, { seed: 12 });
    event = startAmericanoEventV3(event);
    expect(() => updateAmericanoConfigV3(event, { paceMinutes: 20 })).toThrow(/cannot change/i);
  });

  it('complements rally scores, separates confirm from end, and never auto-ends on clock expiry', async () => {
    let event = createAmericanoEventV3('Rally V3');
    for (let i = 0; i < 4; i += 1) event = addAmericanoParticipantV3(event, `Player ${i + 1}`);
    event = updateAmericanoConfigV3(event, { paceClockEnabled: true });
    event = startAmericanoEventV3(await previewAmericanoScheduleV3(event, { seed: 8 }));
    const match = event.rounds[0].matches[0];
    event = setAmericanoRallyScoreV3(event, match.id, 'A', 10);
    expect(event.rounds[0].matches[0].result).toEqual({ kind: 'rally', scoreA: 10, scoreB: 14 });
    event = confirmAmericanoResultV3(event, match.id);
    expect(event.rounds[0].completedAt).toBeUndefined();
    const expired = updateAmericanoClockV3(event, 'start', 1000);
    expect(expired.rounds[0].matches[0].resultConfirmed).toBe(true);
    expect(expired.status).toBe('round-in-progress');
  });

  it('confirms completed traditional games and lets an ended round advance on frozen fixtures', async () => {
    let event = createAmericanoEventV3('Games V3', 'fixed', 2);
    for (let i = 0; i < 4; i += 1) event = addAmericanoFixedTeamV3(event, { teamName: `Pair ${i + 1}`, playerOne: `A${i + 1}`, playerTwo: `B${i + 1}` });
    const rule = AMERICANO_V3_TRADITIONAL_PRESETS['first-to-five'].rule;
    event = updateAmericanoConfigV3(event, { scoring: { kind: 'traditional', preset: 'first-to-five', rule, standings: { pointsPerGameWon: 2, matchWinBonus: 3 } } });
    event = startAmericanoEventV3(await previewAmericanoScheduleV3(event, { seed: 2 }));
    for (const match of event.rounds[0].matches) {
      const incomplete: AmericanoResultDraftV3 = { kind: 'traditional', sets: [{ kind: 'set', gamesA: 3, gamesB: 2, tiebreakPointsA: null, tiebreakPointsB: null }] };
      event = setAmericanoResultDraftV3(event, match.id, incomplete);
      expect(() => confirmAmericanoResultV3(event, match.id)).toThrow(/valid finishing point/i);
      const complete: AmericanoResultDraftV3 = { kind: 'traditional', sets: [{ kind: 'set', gamesA: 5, gamesB: 3, tiebreakPointsA: null, tiebreakPointsB: null }] };
      event = setAmericanoResultDraftV3(event, match.id, complete);
      event = confirmAmericanoResultV3(event, match.id);
    }
    event = endAmericanoRoundV3(event, 100);
    expect(event.status).toBe('between-rounds');
    event = startNextAmericanoRoundV3(event);
    expect(event.status).toBe('round-in-progress');
    expect(event.rounds[1].matches).toHaveLength(2);
  });

  it('finish early excludes the active incomplete round and a correction rejects impossible results', async () => {
    let event: AmericanoEventStateV3 = createAmericanoEventV3('Early V3');
    for (let i = 0; i < 4; i += 1) event = addAmericanoParticipantV3(event, `Player ${i + 1}`);
    event = startAmericanoEventV3(await previewAmericanoScheduleV3(event, { seed: 1 }));
    event = finishAmericanoEarlyV3(event);
    expect(event.status).toBe('complete');
    expect(event.rounds[0].excludedReason).toBe('ended-early');
  });
});
