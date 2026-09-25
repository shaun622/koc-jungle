import { newId } from '@/logic/idGen';
import type { AmericanoEventStateV2, VersionedEventState } from '@/logic/americanoV2/types';
import type { AmericanoEventStateV3 } from '@/logic/americanoV3/types';
import { isAmericanoEventV2, isAmericanoEventV3 } from '@/logic/eventVersions';
import { isLegacyEventState, parseEventState } from '@/utils/eventSchema';

export const EXPORT_VERSION = 3;

export interface ExportPayload {
  version: number;
  exportedAt: number;
  event: VersionedEventState;
}

export function toExportJson(event: VersionedEventState): string {
  const payload: ExportPayload = {
    version: isAmericanoEventV3(event) ? 3 : isAmericanoEventV2(event) ? 2 : 1,
    exportedAt: Date.now(),
    event,
  };
  return JSON.stringify(payload, null, 2);
}

function unlinkImportedV2(event: AmericanoEventStateV2): AmericanoEventStateV2 {
  const settings = { ...event.settings };
  delete settings.publishedSignupId;
  delete settings.publishedStartsAt;
  delete settings.publishedEndsAt;
  delete settings.publishedSignupOpen;
  delete settings.publishedCancelledAt;
  return {
    ...event,
    id: newId(),
    revision: '0',
    settings,
    teams: event.teams.map((team) => {
      const copy = {
        ...team,
        players: [{ ...team.players[0] }, { ...team.players[1] }] as typeof team.players,
      };
      delete copy.signupRegistrationId;
      delete copy.signupPairKey;
      return copy;
    }),
    participants: event.participants.map((participant) => {
      const copy = { ...participant };
      delete copy.signupRegistrationId;
      return copy;
    }),
  };
}

function unlinkImportedV3(event: AmericanoEventStateV3): AmericanoEventStateV3 {
  const settings = { ...event.settings };
  delete settings.publishedSignupId;
  delete settings.publishedStartsAt;
  delete settings.publishedEndsAt;
  delete settings.publishedSignupOpen;
  delete settings.publishedCancelledAt;
  delete settings.ignoredAutoSignupPairKeys;
  delete settings.ignoredAutoSignupRegistrationIds;
  return {
    ...event,
    id: newId(),
    revision: '0',
    settings,
    teams: event.teams.map((team) => {
      const copy = { ...team, players: [{ ...team.players[0] }, { ...team.players[1] }] as typeof team.players };
      delete copy.signupRegistrationId;
      delete copy.signupPairKey;
      delete copy.pointsOverride;
      return copy;
    }),
    participants: event.participants.map((participant) => {
      const copy = { ...participant };
      delete copy.signupRegistrationId;
      return copy;
    }),
  };
}

export function parseImportJson(text: string): VersionedEventState {
  const parsed = JSON.parse(text) as Partial<ExportPayload>;
  if (!parsed || typeof parsed !== 'object' || !parsed.event) {
    throw new Error('Invalid export file: missing event.');
  }
  if (parsed.version !== 1 && parsed.version !== 2 && parsed.version !== 3) {
    if (typeof parsed.version !== 'number') {
      throw new Error('Invalid export file: missing version.');
    }
    throw new Error(`Unsupported export version ${parsed.version}. Update the app to import it.`);
  }
  const event = parseEventState(parsed.event);
  if (parsed.version === 1 && !isLegacyEventState(event)) {
    throw new Error('Invalid export file: version 1 cannot contain an Americano v2 event.');
  }
  if (parsed.version === 2 && !isAmericanoEventV2(event)) {
    throw new Error('Invalid export file: version 2 requires an Americano v2 event.');
  }
  if (parsed.version === 3 && !isAmericanoEventV3(event)) {
    throw new Error('Invalid export file: version 3 requires an Americano v3 event.');
  }
  if (parsed.version === 1) {
    return event;
  }
  if (isAmericanoEventV3(event)) return unlinkImportedV3(event);
  if (!isAmericanoEventV2(event)) {
    throw new Error('Invalid export file: missing version.');
  }
  return unlinkImportedV2(event);
}

export function downloadJsonFile(filename: string, contents: string): void {
  const blob = new Blob([contents], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
