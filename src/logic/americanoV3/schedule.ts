import {
  generateAmericanoSchedule,
  type FixedEntrantInput,
} from '@/logic/americanoV2/scheduleCore';
import type { AmericanoConfigV3, AmericanoScheduleV3 } from './types';

export interface GenerateAmericanoScheduleV3Input {
  config: AmericanoConfigV3;
  orderedEntrantIds: string[];
  fixedEntrants?: FixedEntrantInput[];
  courtIds: string[];
  seed: number;
  rosterRevision?: string;
  acknowledgeUnevenAppearances?: boolean;
  acknowledgeRepeatedCycle?: boolean;
}

export async function generateAmericanoScheduleV3(input: GenerateAmericanoScheduleV3Input): Promise<AmericanoScheduleV3> {
  const schedule = await generateAmericanoSchedule({
    config: input.config,
    orderedEntrantIds: input.orderedEntrantIds,
    fixedEntrants: input.fixedEntrants,
    courtIds: input.courtIds,
    seed: input.seed,
    rosterRevision: input.rosterRevision,
    acknowledgeUnevenAppearances: input.acknowledgeUnevenAppearances,
    acknowledgeRepeatedCycle: input.acknowledgeRepeatedCycle,
    fingerprintVersion: 3,
    fingerprintConfig: input.config,
  });
  return schedule as AmericanoScheduleV3;
}
