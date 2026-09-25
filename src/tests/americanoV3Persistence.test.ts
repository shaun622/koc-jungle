import { beforeEach, describe, expect, it } from 'vitest';
import { addAmericanoFixedTeamV3, createAmericanoEventV3 } from '@/logic/americanoV3/runtime';
import { isAmericanoEventV2 } from '@/logic/americanoV2/types';
import { isAmericanoEventV3 } from '@/logic/eventVersions';
import { createAmericanoEventV2 } from '@/logic/americanoV2/runtime';
import { listTemplates, saveTemplate, templateToEventState } from '@/store/templates';
import { parseImportJson, toExportJson } from '@/utils/exportImport';

describe('Americano v3 persistence boundaries', () => {
  beforeEach(() => localStorage.clear());

  it('round-trips a v3 export without reinterpreting its rules or retaining signup linkage', () => {
    let event = createAmericanoEventV3('Export fixture', 'fixed', 2);
    event = addAmericanoFixedTeamV3(event, { teamName: 'Team One', playerOne: 'Ari', playerTwo: 'Bo' });
    event.formatConfig = {
      ...event.formatConfig,
      scoring: {
        kind: 'traditional', preset: 'custom',
        rule: { family: 'games', bestOfSets: 1, gamesToWin: 5, gameMargin: 1, tiebreakTrigger: null, tiebreakTarget: null, decidingMatchTiebreak: null, gameEnding: 'golden-point' },
        standings: { pointsPerGameWon: 3, matchWinBonus: 2 },
      },
    };
    event.settings.publishedSignupId = 'published-signup-fixture';

    const restored = parseImportJson(toExportJson(event));

    expect(isAmericanoEventV3(restored)).toBe(true);
    expect(isAmericanoEventV2(restored)).toBe(false);
    if (!isAmericanoEventV3(restored)) throw new Error('Expected schema-3 import.');
    expect(restored.id).not.toBe(event.id);
    expect(restored.formatConfig).toEqual(event.formatConfig);
    expect(restored.teams[0].name).toBe('Team One');
    expect(restored.settings.publishedSignupId).toBeUndefined();
  });

  it('keeps v2 and v3 templates together and creates an independent v3 setup copy', () => {
    const v2 = createAmericanoEventV2('Legacy template', 'rotating', 1);
    saveTemplate('Legacy template', v2);
    let v3 = createAmericanoEventV3('Fixed v3 template', 'fixed', 2);
    v3 = addAmericanoFixedTeamV3(v3, { teamName: 'Pair Alpha', playerOne: 'Alex', playerTwo: 'Sam' });
    v3.teams[0].signupRegistrationId = 'private-registration';
    v3.settings.publishedSignupId = 'published-signup-fixture';
    saveTemplate('Fixed v3 template', v3);

    const all = listTemplates();
    expect(all).toHaveLength(2);
    const v2Template = all.find((template) => template.name === 'Legacy template');
    const v3Template = all.find((template) => template.name === 'Fixed v3 template');
    expect(v2Template?.version).toBe(2);
    expect(v3Template?.version).toBe(3);
    expect(v2Template && isAmericanoEventV2(templateToEventState(v2Template))).toBe(true);

    if (!v3Template || v3Template.version !== 3) throw new Error('Expected schema-3 template.');
    const copy = templateToEventState(v3Template);
    expect(isAmericanoEventV3(copy)).toBe(true);
    if (!isAmericanoEventV3(copy)) throw new Error('Expected schema-3 template copy.');
    expect(copy.id).not.toBe(v3.id);
    expect(copy.teams[0].id).not.toBe(v3.teams[0].id);
    expect(copy.teams[0].players.map((player) => player.name)).toEqual(['Alex', 'Sam']);
    expect(copy.teams[0].signupRegistrationId).toBeUndefined();
    expect(copy.settings.publishedSignupId).toBeUndefined();
    expect(copy.formatConfig).toEqual(v3.formatConfig);
    expect(copy.status).toBe('setup');
    expect(copy.americanoSchedule).toBeUndefined();
    expect(copy.championshipFinal).toBeUndefined();
    expect(copy.rounds).toEqual([]);
  });
});
