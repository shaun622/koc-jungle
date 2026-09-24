import { describe, expect, it } from 'vitest';
import { americano } from '@/logic/formats/americano';
import { computeStandings } from '@/logic/scoring';
import type { EventState } from '@/types/domain';
import kocSetup from '@/tests/fixtures/legacy-events/koc-setup.json';
import kocQualifier from '@/tests/fixtures/legacy-events/koc-qualifier.json';
import kocInProgress from '@/tests/fixtures/legacy-events/koc-in-progress.json';
import kocComplete from '@/tests/fixtures/legacy-events/koc-complete.json';
import americanoV1 from '@/tests/fixtures/legacy-events/americano-v1.json';
import signupV1 from '@/tests/fixtures/legacy-events/signup-v1.json';

const FIXTURES: Record<string, unknown> = {
  'koc-setup.json': kocSetup,
  'koc-qualifier.json': kocQualifier,
  'koc-in-progress.json': kocInProgress,
  'koc-complete.json': kocComplete,
  'americano-v1.json': americanoV1,
};

function readEvent(name: string): { event: EventState; raw: string } {
  const raw = JSON.stringify(FIXTURES[name]);
  return { event: JSON.parse(raw) as EventState, raw };
}

describe('pre-v2 legacy characterization', () => {
  it.each([
    'koc-setup.json',
    'koc-qualifier.json',
    'koc-in-progress.json',
    'koc-complete.json',
    'americano-v1.json',
  ])('round-trips %s without rewriting its event body', (name) => {
    const { event } = readEvent(name);
    expect(JSON.stringify(JSON.parse(JSON.stringify(event)))).toBe(JSON.stringify(event));
    expect(event.schemaVersion).toBeUndefined();
  });

  it('preserves KoC court-award standings for an in-progress legacy event', () => {
    const { event } = readEvent('koc-in-progress.json');
    const byTeam = new Map(computeStandings(event).map((row) => [row.teamId, row]));
    expect(byTeam.get('team-a')).toMatchObject({ total: 9, wins: 1, matchesPlayed: 1 });
    expect(byTeam.get('team-b')).toMatchObject({ total: 0, losses: 1, matchesPlayed: 1 });
  });

  it('preserves the existing legacy Americano Berger continuation', () => {
    const { event } = readEvent('americano-v1.json');
    const next = americano.computeNextRound({
      rounds: event.rounds,
      teams: event.teams,
      courts: event.courts,
      tieRule: event.settings.tieRule,
      config: event.formatConfig,
    });
    expect(next.map(({ teamAId, teamBId }) => [teamAId, teamBId])).toEqual([
      ['team-a', 'team-c'],
      ['team-d', 'team-b'],
    ]);
  });

  it('keeps the synthetic signup fixture split across confirmed, looking and waiting', () => {
    expect(signupV1.registrations.map(({ status }) => status)).toEqual([
      'confirmed',
      'looking',
      'waitlisted',
    ]);
  });
});
