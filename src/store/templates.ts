import type { Court, EventSettings, EventState, Team } from '@/types/domain';
import { newId } from '@/logic/idGen';
import { safeGet, safeSet } from '@/utils/storage';

const KEY = 'koc-templates-v1';

export interface Template {
  id: string;
  name: string;
  savedAt: number;
  courts: Court[];
  teams: Team[];
  settings: EventSettings;
}

function independentSettings(settings: EventSettings): EventSettings {
  const clean = { ...settings };
  delete clean.publishedSignupId;
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

export function listTemplates(): Template[] {
  const raw = safeGet(KEY);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed as Template[];
  } catch {
    return [];
  }
}

export function saveTemplate(name: string, event: EventState): Template {
  const all = listTemplates();
  // If a template with the same name exists, replace it (idempotent save)
  const filtered = all.filter((t) => t.name.toLowerCase() !== name.toLowerCase().trim());
  const template: Template = {
    id: newId(),
    name: name.trim(),
    savedAt: Date.now(),
    courts: event.courts.map((court) => ({ ...court })),
    teams: event.teams.filter((team) => team.active).map(independentTeam),
    settings: independentSettings(event.settings),
  };
  filtered.push(template);
  filtered.sort((a, b) => b.savedAt - a.savedAt);
  safeSet(KEY, JSON.stringify(filtered));
  return template;
}

export function deleteTemplate(id: string): void {
  const all = listTemplates().filter((t) => t.id !== id);
  safeSet(KEY, JSON.stringify(all));
}

export function templateToEventState(template: Template): EventState {
  // Generate fresh IDs so the new event is independent of the saved template.
  return {
    id: newId(),
    name: template.name,
    createdAt: Date.now(),
    status: 'setup',
    settings: independentSettings(template.settings),
    courts: template.courts.map((c) => ({ ...c, id: newId() })),
    teams: template.teams.map((storedTeam) => {
      const t = independentTeam(storedTeam);
      return {
        ...t,
        id: newId(),
        createdAt: Date.now(),
        active: true,
        players: [
          { ...t.players[0], id: newId() },
          { ...t.players[1], id: newId() },
        ] as [{ id: string; name: string }, { id: string; name: string }],
      };
    }),
    rounds: [],
  };
}
