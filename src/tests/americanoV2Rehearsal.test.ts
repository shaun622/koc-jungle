import { describe, expect, it } from 'vitest';
import {
  confirmAmericanoResult,
  endAmericanoRound,
  previewAmericanoSchedule,
  setAmericanoResultSide,
  startAmericanoEvent,
  startNextAmericanoRound,
  updateAmericanoConfig,
} from '@/logic/americanoV2/runtime';
import { computeAmericanoStandings } from '@/logic/americanoV2/standings';
import type { AmericanoEventStateV2, PairingMode, ScheduleKind } from '@/logic/americanoV2/types';
import { americanoV2Fixture } from '@/tests/americanoV2Fixtures';

function rehearsalFixture(mode: PairingMode, entrants: number, courts: number): AmericanoEventStateV2 {
  const event = americanoV2Fixture(mode);
  event.courts = Array.from({ length: courts }, (_, index) => ({
    id: `court-${index + 1}`, name: index ? `Court ${index + 1}` : 'Centre Court', position: courts - index, pointValue: 1,
  }));
  if (mode === 'rotating') {
    event.participants = Array.from({ length: entrants }, (_, index) => ({
      id: `player-${index + 1}`, name: `Player ${index + 1}`, active: true, createdAt: index + 1,
    }));
    event.teams = [];
  } else {
    event.participants = [];
    event.teams = Array.from({ length: entrants }, (_, index) => ({
      id: `team-${index + 1}`, name: `Team ${index + 1}`, active: true, createdAt: index + 1,
      players: [
        { id: `team-${index + 1}-a`, name: `Player ${index + 1}A` },
        { id: `team-${index + 1}-b`, name: `Player ${index + 1}B` },
      ],
    }));
  }
  return event;
}

async function playCompleteRehearsal(input: { mode: PairingMode; entrants: number; courts: number; schedule: ScheduleKind; rounds?: number }) {
  let event = rehearsalFixture(input.mode, input.entrants, input.courts);
  event = updateAmericanoConfig(event, {
    scheduleKind: input.schedule,
    customRounds: input.schedule === 'custom' ? input.rounds : undefined,
  });
  event = await previewAmericanoSchedule(event, {
    seed: 20260911,
    acknowledgeUnevenAppearances: true,
    acknowledgeRepeatedCycle: true,
  });
  const expectedRounds = event.americanoSchedule!.rounds.length;
  const expectedMatches = event.americanoSchedule!.rounds.reduce((sum, round) => sum + round.matches.length, 0);
  event = startAmericanoEvent(event);

  while (event.status !== 'complete') {
    const liveRound = event.rounds.at(-1)!;
    for (let index = 0; index < liveRound.matches.length; index += 1) {
      const match = liveRound.matches[index];
      const sideA = (liveRound.index * 3 + index * 5) % (event.formatConfig.pointsPerMatch + 1);
      event = setAmericanoResultSide(event, match.id, 'A', sideA);
      event = confirmAmericanoResult(event, match.id);
    }
    event = endAmericanoRound(event);
    if (event.status === 'between-rounds') event = startNextAmericanoRound(event);
  }

  expect(event.rounds).toHaveLength(expectedRounds);
  expect(event.rounds.every((round) => Boolean(round.completedAt) && round.matches.every((match) => match.resultConfirmed))).toBe(true);
  expect(event.rounds.reduce((sum, round) => sum + round.matches.length, 0)).toBe(expectedMatches);
  expect(computeAmericanoStandings(event)).toHaveLength(input.entrants);
  expect(event.completionReason).toBe('scheduled');
}

describe('Americano v2 complete event rehearsals', () => {
  it.each([
    { mode: 'rotating', entrants: 8, courts: 2, schedule: 'full' },
    { mode: 'fixed', entrants: 4, courts: 2, schedule: 'full' },
    { mode: 'rotating', entrants: 7, courts: 2, schedule: 'balanced' },
    { mode: 'rotating', entrants: 5, courts: 2, schedule: 'custom', rounds: 6 },
  ] as const)('runs $mode/$schedule with $entrants entrants through every round', async (scenario) => {
    await playCompleteRehearsal(scenario);
  });
});
