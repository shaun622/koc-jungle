import type { Court, EventSettings, EventState, Team, TournamentFormatId } from '@/types/domain';
import type {
  AmericanoConfigV2,
  AmericanoEventStateV2,
  IndividualEntrant,
  VersionedEventState,
} from '@/logic/americanoV2/types';
import type { AmericanoConfigV3, AmericanoEventStateV3 } from '@/logic/americanoV3/types';
import { isAmericanoEventV3 } from '@/logic/eventVersions';
import { createAmericanoEventV3 } from '@/logic/americanoV3/runtime';
import { isAmericanoEventV2 } from '@/logic/americanoV2/types';
import { newId } from '@/logic/idGen';
import { safeGet, safeSet } from '@/utils/storage';

const KEY = 'koc-templates-v1';

interface TemplateBase {
  id: string;
  name: string;
  savedAt: number;
  courts: Court[];
  teams: Team[];
  settings: EventSettings;
}

export interface LegacyTemplate extends TemplateBase {
  version?: 1;
  format?: TournamentFormatId;
  formatConfig?: Record<string, unknown>;
}

export interface AmericanoTemplateV2 extends TemplateBase {
  version: 2;
  format: 'americano';
  formatConfig: AmericanoConfigV2;
  participants: IndividualEntrant[];
}

export interface AmericanoTemplateV3 extends TemplateBase {
  version: 3;
  format: 'americano';
  formatConfig: AmericanoConfigV3;
  participants: IndividualEntrant[];
}

export type Template = LegacyTemplate | AmericanoTemplateV2 | AmericanoTemplateV3;

function independentSettings(settings: EventSettings): EventSettings {
  const clean = { ...settings };
  delete clean.publishedSignupId;
  delete clean.publishedStartsAt;
  delete clean.publishedEndsAt;
  delete clean.publishedSignupOpen;
  delete clean.publishedCancelledAt;
  delete clean.ignoredAutoSignupPairKeys;
  delete clean.ignoredAutoSignupRegistrationIds;
  return clean;
}

function independentTeam(team: Team): Team {
  const clean: Team = {
    ...team,
    players: [{ ...team.players[0] }, { ...team.players[1] }],
  };
  delete clean.signupRegistrationId;
  delete clean.signupPairKey;
  delete clean.pointsOverride;
  return clean;
}

function independentParticipant(participant: IndividualEntrant): IndividualEntrant {
  const clean = { ...participant };
  delete clean.signupRegistrationId;
  return clean;
}

function isTemplate(value: unknown): value is Template {
  if (!value || typeof value !== 'object') return false;
  const template = value as Partial<TemplateBase> & {
    version?: number;
    format?: string;
    formatConfig?: Partial<AmericanoConfigV2> | Partial<AmericanoConfigV3>;
    participants?: unknown;
  };
  if (
    typeof template.id !== 'string'
    || typeof template.name !== 'string'
    || typeof template.savedAt !== 'number'
    || !Array.isArray(template.courts)
    || !Array.isArray(template.teams)
    || !template.settings
  ) return false;
  if (template.version === undefined || template.version === 1) return true;
  return (template.version === 2
    && template.format === 'americano'
    && template.formatConfig?.rulesVersion === 2
    && Array.isArray(template.participants))
    || (template.version === 3
      && template.format === 'americano'
      && template.formatConfig?.rulesVersion === 3
      && Array.isArray(template.participants));
}

export function listTemplates(): Template[] {
  const raw = safeGet(KEY);
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isTemplate);
  } catch {
    return [];
  }
}

export function saveTemplate(name: string, event: VersionedEventState): Template {
  const all = listTemplates();
  const normalizedName = name.trim();
  const filtered = all.filter((template) => template.name.toLowerCase() !== normalizedName.toLowerCase());
  const base: TemplateBase = {
    id: newId(),
    name: normalizedName,
    savedAt: Date.now(),
    courts: event.courts.map((court) => ({ ...court })),
    teams: event.teams.filter((team) => team.active).map(independentTeam),
    settings: independentSettings(event.settings),
  };
  const template: Template = isAmericanoEventV3(event)
    ? {
        ...base,
        version: 3,
        format: 'americano',
        formatConfig: JSON.parse(JSON.stringify(event.formatConfig)) as AmericanoConfigV3,
        participants: event.participants.filter((participant) => participant.active).map(independentParticipant),
      }
    : isAmericanoEventV2(event)
      ? {
        ...base,
        version: 2,
        format: 'americano',
        formatConfig: { ...event.formatConfig },
        participants: event.participants.filter((participant) => participant.active).map(independentParticipant),
      }
      : {
        ...base,
        version: 1,
        format: event.format,
        formatConfig: event.formatConfig ? { ...event.formatConfig } : undefined,
      };
  filtered.push(template);
  filtered.sort((a, b) => b.savedAt - a.savedAt);
  safeSet(KEY, JSON.stringify(filtered));
  return template;
}

export function deleteTemplate(id: string): void {
  const all = listTemplates().filter((template) => template.id !== id);
  safeSet(KEY, JSON.stringify(all));
}

function freshTeams(teams: Team[]): Team[] {
  return teams.map((storedTeam) => {
    const team = independentTeam(storedTeam);
    return {
      ...team,
      id: newId(),
      createdAt: Date.now(),
      active: true,
      players: [
        { ...team.players[0], id: newId() },
        { ...team.players[1], id: newId() },
      ],
    };
  });
}

export function templateToEventState(template: LegacyTemplate): EventState;
export function templateToEventState(template: AmericanoTemplateV2): AmericanoEventStateV2;
export function templateToEventState(template: AmericanoTemplateV3): AmericanoEventStateV3;
export function templateToEventState(template: Template): VersionedEventState;
export function templateToEventState(template: Template): VersionedEventState {
  const createdAt = Date.now();
  const courts = template.courts.map((court) => ({ ...court, id: newId() }));
  const settings = independentSettings(template.settings);
  if (template.version === 3) {
    const event = createAmericanoEventV3(template.name, template.formatConfig.pairingMode, courts.length);
    return {
      ...event,
      venue: '',
      courts,
      teams: freshTeams(template.teams),
      participants: template.participants.map((participant) => ({
        ...independentParticipant(participant),
        id: newId(),
        createdAt,
        active: true,
      })),
      settings: { ...settings, roundsTotal: 0, defaultRoundDurationMs: template.formatConfig.paceMinutes * 60_000 },
      formatConfig: JSON.parse(JSON.stringify(template.formatConfig)) as AmericanoConfigV3,
      rounds: [],
      americanoSchedule: undefined,
      championshipFinal: undefined,
    };
  }
  if (template.version === 2) {
    return {
      schemaVersion: 2,
      protocolVersion: 2,
      revision: '0',
      id: newId(),
      name: template.name,
      createdAt,
      status: 'setup',
      settings: {
        ...settings,
        roundsTotal: 0,
        defaultRoundDurationMs: template.formatConfig.paceMinutes * 60_000,
      },
      courts,
      teams: freshTeams(template.teams),
      participants: template.participants.map((participant) => ({
        ...independentParticipant(participant),
        id: newId(),
        createdAt,
        active: true,
      })),
      rounds: [],
      format: 'americano',
      formatConfig: { ...template.formatConfig },
    };
  }
  return {
    id: newId(),
    name: template.name,
    createdAt,
    status: 'setup',
    settings,
    courts,
    teams: freshTeams(template.teams),
    rounds: [],
    format: template.format,
    formatConfig: template.formatConfig ? { ...template.formatConfig } : undefined,
  };
}
