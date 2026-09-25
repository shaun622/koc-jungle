import type { EventState } from '@/types/domain';
import type { AmericanoEventStateV2 } from '@/logic/americanoV2/types';
import type { AmericanoEventStateV3 } from '@/logic/americanoV3/types';

export type VersionedEventState = EventState | AmericanoEventStateV2 | AmericanoEventStateV3;

export function isAmericanoEventV2(event: VersionedEventState): event is AmericanoEventStateV2 {
  return event.schemaVersion === 2;
}

export function isAmericanoEventV3(event: VersionedEventState): event is AmericanoEventStateV3 {
  return event.schemaVersion === 3;
}

export function isAmericanoEvent(event: VersionedEventState): event is AmericanoEventStateV2 | AmericanoEventStateV3 {
  return isAmericanoEventV2(event) || isAmericanoEventV3(event);
}
