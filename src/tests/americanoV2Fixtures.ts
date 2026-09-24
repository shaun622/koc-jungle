import type { AmericanoEventStateV2, PairingMode } from '@/logic/americanoV2/types';
import { DEFAULT_SETTINGS } from '@/types/domain';

export function americanoV2Fixture(mode: PairingMode = 'rotating'): AmericanoEventStateV2 {
  return {
    schemaVersion: 2,
    protocolVersion: 2,
    revision: '0',
    id: `americano-v2-${mode}`,
    name: `Synthetic ${mode} Americano`,
    createdAt: 1_700_000_000_000,
    status: 'setup',
    settings: {
      ...DEFAULT_SETTINGS,
      qualifierEnabled: false,
      roundsTotal: 0,
      defaultRoundDurationMs: 600_000,
    },
    courts: [
      { id: 'court-1', position: 2, name: 'Centre Court', pointValue: 9 },
      { id: 'court-2', position: 1, name: 'Court 2', pointValue: 8 },
    ],
    teams: mode === 'fixed'
      ? [
          {
            id: 'team-1',
            name: 'First Pair',
            players: [{ id: 'player-1', name: 'One' }, { id: 'player-2', name: 'Two' }],
            createdAt: 1,
            active: true,
          },
          {
            id: 'team-2',
            name: 'Second Pair',
            players: [{ id: 'player-3', name: 'Three' }, { id: 'player-4', name: 'Four' }],
            createdAt: 2,
            active: true,
          },
        ]
      : [],
    participants: mode === 'rotating'
      ? ['One', 'Two', 'Three', 'Four'].map((name, index) => ({
          id: `player-${index + 1}`,
          name,
          active: true,
          createdAt: index + 1,
        }))
      : [],
    rounds: [],
    format: 'americano',
    formatConfig: {
      rulesVersion: 2,
      pairingMode: mode,
      pointsPerMatch: 24,
      scheduleKind: 'full',
      paceMinutes: 10,
      paceClockEnabled: false,
    },
  };
}
