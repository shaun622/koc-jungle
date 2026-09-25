import { describe, expect, it } from 'vitest';
import {
  confirmAmericanoResult,
  createAmericanoEventV2,
  endAmericanoRound,
  previewAmericanoSchedule,
  setAmericanoResultSide,
  startAmericanoEvent,
  startNextAmericanoRound,
} from '@/logic/americanoV2/runtime';
import { computeAmericanoStandings } from '@/logic/americanoV2/standings';
import {
  addAmericanoFixedTeamV3,
  addAmericanoParticipantV3,
  confirmAmericanoResultV3,
  correctAmericanoResultV3,
  createAmericanoEventV3,
  endAmericanoRoundV3,
  previewAmericanoScheduleV3,
  setAmericanoRallyScoreV3,
  setAmericanoResultDraftV3,
  startAmericanoEventV3,
  startNextAmericanoRoundV3,
  updateAmericanoClockV3,
  updateAmericanoConfigV3,
} from '@/logic/americanoV3/runtime';
import { AMERICANO_V3_TRADITIONAL_PRESETS } from '@/logic/americanoV3/scoring';
import { computeAmericanoStandingsV3 } from '@/logic/americanoV3/standings';
import type { AmericanoEventStateV3, AmericanoResultDraftV3 } from '@/logic/americanoV3/types';

describe('Americano v3 local event-night rehearsals', () => {
  it('plays a full eight-player rally Americano and matches v2 per-player totals', async () => {
    let v3 = createAmericanoEventV3('Synthetic rotating rally', 'rotating', 2);
    for (let index = 1; index <= 8; index += 1) v3 = addAmericanoParticipantV3(v3, `Player ${index}`);
    let v2 = createAmericanoEventV2('Synthetic v2 comparison', 'rotating', 2);
    v2 = {
      ...v2,
      participants: v3.participants.map((player, index) => ({ id: player.id, name: player.name, active: true, createdAt: index + 1 })),
    };
    v3 = startAmericanoEventV3(await previewAmericanoScheduleV3(v3, { seed: 4401 }));
    v2 = startAmericanoEvent(await previewAmericanoSchedule(v2, { seed: 4401 }));
    expect(v3.americanoSchedule?.rounds).toHaveLength(7);
    expect(v2.americanoSchedule?.rounds).toHaveLength(7);

    for (let roundIndex = 0; roundIndex < 7; roundIndex += 1) {
      for (let matchIndex = 0; matchIndex < v3.rounds.at(-1)!.matches.length; matchIndex += 1) {
        const rallyA = (roundIndex + matchIndex) % 3 === 0 ? 12 : 18;
        const v3Match = v3.rounds.at(-1)!.matches[matchIndex];
        const v2Match = v2.rounds.at(-1)!.matches[matchIndex];
        v3 = setAmericanoRallyScoreV3(v3, v3Match.id, 'A', rallyA);
        v3 = confirmAmericanoResultV3(v3, v3Match.id);
        v2 = setAmericanoResultSide(v2, v2Match.id, 'A', rallyA);
        v2 = confirmAmericanoResult(v2, v2Match.id);
      }
      v3 = endAmericanoRoundV3(v3, roundIndex + 1);
      v2 = endAmericanoRound(v2);
      if (roundIndex < 6) {
        v3 = startNextAmericanoRoundV3(v3);
        v2 = startNextAmericanoRound(v2);
      }
    }

    expect(v3.status).toBe('complete');
    expect(v2.status).toBe('complete');
    const oldTotals = new Map(computeAmericanoStandings(v2).map((row) => [row.entrantId, row.total]));
    const newTotals = new Map(computeAmericanoStandingsV3(v3).map((row) => [row.entrantId, row.total]));
    expect([...newTotals].sort(([left], [right]) => left.localeCompare(right)))
      .toEqual([...oldTotals].sort(([left], [right]) => left.localeCompare(right)));
  });

  it('plays fixed first-to-five rounds, applies 2/game + 3 winner bonus, and recalculates a corrected result', async () => {
    let event = createAmericanoEventV3('Synthetic fixed games', 'fixed', 2);
    for (let index = 1; index <= 4; index += 1) event = addAmericanoFixedTeamV3(event, { teamName: `Pair ${index}`, playerOne: `A${index}`, playerTwo: `B${index}` });
    event = updateAmericanoConfigV3(event, {
      ranking: { tiebreak: 'difference', championship: 'none' },
      scoring: { kind: 'traditional', preset: 'first-to-five', rule: AMERICANO_V3_TRADITIONAL_PRESETS['first-to-five'].rule, standings: { pointsPerGameWon: 2, matchWinBonus: 3 } },
    });
    event = startAmericanoEventV3(await previewAmericanoScheduleV3(event, { seed: 310 }));
    expect(() => updateAmericanoConfigV3(event, { paceMinutes: 15 })).toThrow(/cannot change/i);

    const match = event.rounds[0].matches[0];
    const original: AmericanoResultDraftV3 = { kind: 'traditional', sets: [{ kind: 'set', gamesA: 5, gamesB: 3, tiebreakPointsA: null, tiebreakPointsB: null }] };
    event = setAmericanoResultDraftV3(event, match.id, original);
    event = confirmAmericanoResultV3(event, match.id);
    for (const other of event.rounds[0].matches.slice(1)) {
      event = setAmericanoResultDraftV3(event, other.id, original);
      event = confirmAmericanoResultV3(event, other.id);
    }
    event = endAmericanoRoundV3(event, 100);
    const savedRound = event.rounds[0];
    const savedMatch = savedRound.matches.find((row) => row.id === match.id)!;
    const teamA = savedMatch.sideA.kind === 'fixed-team' ? savedMatch.sideA.teamId : '';
    const teamB = savedMatch.sideB.kind === 'fixed-team' ? savedMatch.sideB.teamId : '';
    const before = new Map(computeAmericanoStandingsV3(event).map((row) => [row.entrantId, row.total]));
    expect(before.get(teamA)).toBe(13);
    expect(before.get(teamB)).toBe(6);
    const fixturesBeforeCorrection = JSON.stringify(event.americanoSchedule);

    const corrected: AmericanoResultDraftV3 = { kind: 'traditional', sets: [{ kind: 'set', gamesA: 3, gamesB: 5, tiebreakPointsA: null, tiebreakPointsB: null }] };
    event = correctAmericanoResultV3(event, savedRound.id, match.id, corrected);
    const after = new Map(computeAmericanoStandingsV3(event).map((row) => [row.entrantId, row.total]));
    expect(after.get(teamA)).toBe(6);
    expect(after.get(teamB)).toBe(13);
    expect(JSON.stringify(event.americanoSchedule)).toBe(fixturesBeforeCorrection);
  });

  it('plays rotating standard sets with TB8–6 counted only as a 7–6 set, and clock time does not confirm scores', async () => {
    let event: AmericanoEventStateV3 = createAmericanoEventV3('Synthetic rotating sets', 'rotating', 2);
    for (let index = 1; index <= 8; index += 1) event = addAmericanoParticipantV3(event, `Player ${index}`);
    event = updateAmericanoConfigV3(event, {
      scheduleKind: 'custom', customRounds: 2, paceClockEnabled: true,
      scoring: { kind: 'traditional', preset: 'standard-set', rule: AMERICANO_V3_TRADITIONAL_PRESETS['standard-set'].rule, standings: { pointsPerGameWon: 1, matchWinBonus: 0 } },
    });
    event = startAmericanoEventV3(await previewAmericanoScheduleV3(event, { seed: 702, acknowledgeUnevenAppearances: true }));
    event = updateAmericanoClockV3(event, 'start', 1_000);
    expect(event.rounds[0].matches.every((match) => !match.resultConfirmed)).toBe(true);

    const score: AmericanoResultDraftV3 = { kind: 'traditional', sets: [{ kind: 'set', gamesA: 7, gamesB: 6, tiebreakPointsA: 8, tiebreakPointsB: 6 }] };
    for (const match of event.rounds[0].matches) {
      event = setAmericanoResultDraftV3(event, match.id, score);
      event = confirmAmericanoResultV3(event, match.id);
    }
    event = endAmericanoRoundV3(event, 601_001);
    const rows = computeAmericanoStandingsV3(event);
    expect(rows.every((row) => row.total === row.unitsFor)).toBe(true);
    expect(rows.reduce((sum, row) => sum + row.unitsFor, 0)).toBe(52);
    expect(rows.every((row) => row.setsFor + row.setsAgainst === 1)).toBe(true);
  });

  it('scores fixed best-of-three sets with a deciding match tiebreak as 10–10 games, 2–1 sets', async () => {
    let event = createAmericanoEventV3('Synthetic best of three', 'fixed', 1);
    event = addAmericanoFixedTeamV3(event, { teamName: 'North', playerOne: 'N1', playerTwo: 'N2' });
    event = addAmericanoFixedTeamV3(event, { teamName: 'South', playerOne: 'S1', playerTwo: 'S2' });
    event = updateAmericanoConfigV3(event, {
      scoring: { kind: 'traditional', preset: 'best-of-three-match-tiebreak', rule: AMERICANO_V3_TRADITIONAL_PRESETS['best-of-three-match-tiebreak'].rule, standings: { pointsPerGameWon: 2, matchWinBonus: 3 } },
    });
    event = startAmericanoEventV3(await previewAmericanoScheduleV3(event, { seed: 21 }));
    const match = event.rounds[0].matches[0];
    const score: AmericanoResultDraftV3 = { kind: 'traditional', sets: [
      { kind: 'set', gamesA: 6, gamesB: 4, tiebreakPointsA: null, tiebreakPointsB: null },
      { kind: 'set', gamesA: 4, gamesB: 6, tiebreakPointsA: null, tiebreakPointsB: null },
      { kind: 'match-tiebreak', pointsA: 10, pointsB: 8 },
    ] };
    event = setAmericanoResultDraftV3(event, match.id, score);
    event = confirmAmericanoResultV3(event, match.id);
    event = endAmericanoRoundV3(event, 50);

    const standings = computeAmericanoStandingsV3(event);
    expect(standings.map((row) => [row.total, row.unitsFor, row.setsFor])).toEqual([[23, 10, 2], [20, 10, 1]]);
    expect(event.rounds[0].matches[0].resultConfirmed).toBe(true);
  });
});
