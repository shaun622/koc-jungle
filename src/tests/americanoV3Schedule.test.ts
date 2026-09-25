import { describe, expect, it } from 'vitest';
import { generateAmericanoSchedule } from '@/logic/americanoV2/scheduleCore';
import { defaultAmericanoConfig, createAmericanoEventV2 } from '@/logic/americanoV2/runtime';
import { addAmericanoParticipantV3, addAmericanoFixedTeamV3, createAmericanoEventV3 } from '@/logic/americanoV3/runtime';
import { AMERICANO_V3_TRADITIONAL_PRESETS } from '@/logic/americanoV3/scoring';
import type { AmericanoEventStateV3 } from '@/logic/americanoV3/types';
import { generateAmericanoScheduleV3 } from '@/logic/americanoV3/schedule';
import type { AmericanoConfigV3 } from '@/logic/americanoV3/types';
import scheduleVector from './fixtures/americano-v3/schedule-fingerprint.json';

describe('Americano v3 deterministic schedule wrapper', () => {
  it('matches the shared TypeScript/PostgreSQL fingerprint vector exactly', async () => {
    const schedule = await generateAmericanoScheduleV3({
      config: scheduleVector.config as AmericanoConfigV3,
      orderedEntrantIds: scheduleVector.orderedEntrantIds,
      courtIds: scheduleVector.courtIds,
      seed: scheduleVector.seed,
      rosterRevision: scheduleVector.rosterRevision,
    });
    expect(schedule.inputFingerprint).toBe(scheduleVector.expectedFingerprint);
    expect(schedule.metrics).toEqual(scheduleVector.metrics);
    expect(schedule.rounds.map((round) => ({
      matches: round.matches.map(({ courtId, sideA, sideB }) => ({ courtId, sideA, sideB })),
      rests: round.restingEntrantIds,
    }))).toEqual(scheduleVector.fixtures);
  });
  it('shares v2 fixture assignments while versioning the full v3 rules fingerprint', async () => {
    let v2 = createAmericanoEventV2('v2', 'rotating', 2);
    let v3: AmericanoEventStateV3 = createAmericanoEventV3('v3', 'rotating', 2);
    for (let i = 0; i < 8; i += 1) v3 = addAmericanoParticipantV3(v3, `Player ${i + 1}`);
    for (let i = 0; i < 8; i += 1) {
      v2 = { ...v2, participants: [...v2.participants, { id: v3.participants[i].id, name: v3.participants[i].name, active: true, createdAt: i }] };
    }
    const v2Schedule = await generateAmericanoSchedule({ config: defaultAmericanoConfig('rotating'), orderedEntrantIds: v2.participants.map((p) => p.id), courtIds: v2.courts.map((c) => c.id), seed: 77 });
    const config = {
      ...v3.formatConfig,
      scoring: {
        kind: 'traditional' as const,
        preset: 'first-to-five' as const,
        rule: AMERICANO_V3_TRADITIONAL_PRESETS['first-to-five'].rule,
        standings: { pointsPerGameWon: 1, matchWinBonus: 0 },
      },
    };
    const v3Schedule = await generateAmericanoScheduleV3({ config, orderedEntrantIds: v3.participants.map((p) => p.id), courtIds: v3.courts.map((c) => c.id), seed: 77 });
    expect(v3Schedule.fingerprintVersion).toBe(3);
    expect(v3Schedule.inputFingerprint).not.toBe(v2Schedule.inputFingerprint);
    expect(v3Schedule.rounds.map((round) => round.matches.map((match) => [match.sideA.playerIds, match.sideB.playerIds, v3Schedule.courtIds.indexOf(match.courtId)])))
      .toEqual(v2Schedule.rounds.map((round) => round.matches.map((match) => [match.sideA.playerIds, match.sideB.playerIds, v2Schedule.courtIds.indexOf(match.courtId)])));
  });

  it('generates stable fixed-pair rounds with both player identities preserved', async () => {
    let event: AmericanoEventStateV3 = createAmericanoEventV3('fixed v3', 'fixed', 2);
    for (let i = 0; i < 4; i += 1) event = addAmericanoFixedTeamV3(event, { teamName: `Team ${i + 1}`, playerOne: `A${i + 1}`, playerTwo: `B${i + 1}` });
    const schedule = await generateAmericanoScheduleV3({
      config: event.formatConfig,
      orderedEntrantIds: event.teams.map((team) => team.id),
      fixedEntrants: event.teams.map((team) => ({ teamId: team.id, playerIds: [team.players[0].id, team.players[1].id] })),
      courtIds: event.courts.map((court) => court.id),
      seed: 9,
    });
    expect(schedule.rounds).toHaveLength(3);
    expect(schedule.rounds[0].matches[0].sideA.kind).toBe('fixed-team');
    if (schedule.rounds[0].matches[0].sideA.kind !== 'fixed-team') throw new Error('Expected a fixed-team side.');
    expect(schedule.rounds[0].matches[0].sideA.playerIds).toHaveLength(2);
  });
});
