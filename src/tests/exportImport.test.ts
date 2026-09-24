import { describe, expect, it } from 'vitest';
import { americanoV2Fixture } from '@/tests/americanoV2Fixtures';
import { parseImportJson, toExportJson } from '@/utils/exportImport';
import { isAmericanoEventV2 } from '@/logic/americanoV2/types';
import { DEFAULT_SETTINGS, type EventState } from '@/types/domain';

const legacy: EventState = {
  id: 'legacy-export',
  name: 'Legacy export',
  createdAt: 1,
  status: 'setup',
  settings: { ...DEFAULT_SETTINGS },
  courts: [],
  teams: [],
  rounds: [],
};

describe('versioned event export/import', () => {
  it('continues to emit and accept version 1 for legacy events', () => {
    const json = toExportJson(legacy);
    expect(JSON.parse(json).version).toBe(1);
    expect(parseImportJson(json)).toEqual(legacy);
  });

  it('emits version 2 and imports an unlinked v2 copy with a fresh event id', () => {
    const original = americanoV2Fixture();
    original.settings.publishedSignupId = 'private-linkage';
    original.participants[0].signupRegistrationId = 'registration-1';
    const json = toExportJson(original);
    expect(JSON.parse(json).version).toBe(2);
    const imported = parseImportJson(json);
    expect(isAmericanoEventV2(imported)).toBe(true);
    if (!isAmericanoEventV2(imported)) throw new Error('Expected v2 import.');
    expect(imported.id).not.toBe(original.id);
    expect(imported.revision).toBe('0');
    expect(imported.settings.publishedSignupId).toBeUndefined();
    expect(imported.participants[0].signupRegistrationId).toBeUndefined();
    expect(imported.participants.map(({ id }) => id)).toEqual(original.participants.map(({ id }) => id));
  });

  it('rejects unknown export versions and version/schema mismatches', () => {
    expect(() => parseImportJson(JSON.stringify({ version: 99, event: legacy }))).toThrow(/unsupported export version/i);
    expect(() => parseImportJson(JSON.stringify({ version: 1, event: americanoV2Fixture() }))).toThrow(/version 1/i);
    expect(() => parseImportJson(JSON.stringify({ version: 2, event: legacy }))).toThrow(/version 2/i);
  });
});
