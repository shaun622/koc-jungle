import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  AMERICANO_V3_TRADITIONAL_PRESETS,
  confirmedSummaryV3,
  defaultAmericanoConfigV3,
  standingAwardForSideV3,
  validateAmericanoConfigV3,
  validateAmericanoResultDraftV3,
  validateMatchScoringV3,
} from '@/logic/americanoV3/scoring';
import type { AmericanoResultDraftV3, TraditionalRule } from '@/logic/americanoV3/types';

const vectors = JSON.parse(readFileSync('src/tests/fixtures/americano-v3/scoring-vectors.json', 'utf8')) as Array<{
  id: string;
  rule: keyof typeof AMERICANO_V3_TRADITIONAL_PRESETS;
  sets: Array<Record<string, number | boolean>>;
  complete: true;
  summary: Record<string, unknown>;
  pointsPerGameWon: number;
  matchWinBonus: number;
  standingA: number;
  standingB: number;
}>;

function traditionalDraft(rows: Array<Record<string, number | boolean>>): AmericanoResultDraftV3 {
  return {
    kind: 'traditional',
    sets: rows.map((row) => 'decidingMatchTiebreak' in row
      ? { kind: 'match-tiebreak', pointsA: Number(row.gamesA), pointsB: Number(row.gamesB) }
      : {
        kind: 'set', gamesA: Number(row.gamesA), gamesB: Number(row.gamesB),
        tiebreakPointsA: 'tiebreakPointsA' in row ? Number(row.tiebreakPointsA) : null,
        tiebreakPointsB: 'tiebreakPointsB' in row ? Number(row.tiebreakPointsB) : null,
      }),
  };
}

describe('Americano v3 rule profiles and scoring', () => {
  it.each(vectors)('$id matches the shared traditional scoring contract', (vector) => {
    const preset = AMERICANO_V3_TRADITIONAL_PRESETS[vector.rule];
    const scoring = {
      kind: 'traditional' as const,
      preset: vector.rule,
      rule: preset.rule,
      standings: { pointsPerGameWon: vector.pointsPerGameWon, matchWinBonus: vector.matchWinBonus },
    };
    const summary = confirmedSummaryV3(traditionalDraft(vector.sets), scoring);
    expect(summary).toEqual(vector.summary);
    expect(standingAwardForSideV3(scoring, summary, 'A')).toBe(vector.standingA);
    expect(standingAwardForSideV3(scoring, summary, 'B')).toBe(vector.standingB);
  });

  it('keeps schema 3 defaults on the unchanged rally format', () => {
    const config = defaultAmericanoConfigV3('rotating');
    expect(config).toMatchObject({ rulesVersion: 3, pairingMode: 'rotating', scoring: { kind: 'rally', pointsPerMatch: 24 }, ranking: { tiebreak: 'shared', championship: 'none' }, paceMinutes: 10, paceClockEnabled: false });
    expect(validateAmericanoResultDraftV3({ kind: 'rally', scoreA: 10, scoreB: 14 }, config.scoring, true)).toMatchObject({ valid: true, summary: { gamesA: 10, gamesB: 14 } });
    expect(validateAmericanoResultDraftV3({ kind: 'rally', scoreA: 12, scoreB: 12 }, { kind: 'rally', pointsPerMatch: 24 }, true).valid).toBe(true);
  });

  it('treats an unfinished score as a draft and rejects it as a confirmed result', () => {
    const scoring = { kind: 'traditional' as const, preset: 'first-to-five' as const, rule: AMERICANO_V3_TRADITIONAL_PRESETS['first-to-five'].rule, standings: { pointsPerGameWon: 1, matchWinBonus: 0 } };
    const draft: AmericanoResultDraftV3 = { kind: 'traditional', sets: [{ kind: 'set', gamesA: 3, gamesB: 2, tiebreakPointsA: null, tiebreakPointsB: null }] };
    expect(validateAmericanoResultDraftV3(draft, scoring, false)).toMatchObject({ valid: true, complete: false, summary: { gamesA: 3, gamesB: 2 } });
    expect(validateAmericanoResultDraftV3(draft, scoring, true).valid).toBe(false);
  });

  it('permits an incomplete tiebreak as an unconfirmed row', () => {
    const scoring = { kind: 'traditional' as const, preset: 'standard-set' as const, rule: AMERICANO_V3_TRADITIONAL_PRESETS['standard-set'].rule, standings: { pointsPerGameWon: 1, matchWinBonus: 0 } };
    const draft: AmericanoResultDraftV3 = { kind: 'traditional', sets: [{ kind: 'set', gamesA: 6, gamesB: 6, tiebreakPointsA: null, tiebreakPointsB: null }] };
    expect(validateAmericanoResultDraftV3(draft, scoring, false)).toMatchObject({ valid: true, complete: false, summary: { gamesA: 6, gamesB: 6, terminal: false } });
    expect(validateAmericanoResultDraftV3(draft, scoring, true).valid).toBe(false);
  });

  it('rejects impossible endpoints, extra rows, invalid awards and contradictory preset payloads', () => {
    const standard = AMERICANO_V3_TRADITIONAL_PRESETS['standard-set'].rule;
    const oneSet = { kind: 'traditional' as const, preset: 'standard-set' as const, rule: standard, standings: { pointsPerGameWon: 1, matchWinBonus: 0 } };
    expect(validateAmericanoResultDraftV3({ kind: 'traditional', sets: [{ kind: 'set', gamesA: 7, gamesB: 6, tiebreakPointsA: 7, tiebreakPointsB: 6 }] }, oneSet, true).valid).toBe(false);
    expect(() => validateMatchScoringV3({ ...oneSet, rule: { ...standard, gameEnding: 'golden-point' } as TraditionalRule })).toThrow(/preset does not match/i);
    expect(() => validateMatchScoringV3({ ...oneSet, standings: { pointsPerGameWon: 0, matchWinBonus: 0 } })).toThrow(/Points per game won/);
    expect(() => validateMatchScoringV3({ ...oneSet, standings: { pointsPerGameWon: 1, matchWinBonus: 1.5 } })).toThrow(/Match win bonus/);
    const threeSet = AMERICANO_V3_TRADITIONAL_PRESETS['best-of-three-match-tiebreak'].rule;
    const decider = { kind: 'traditional' as const, preset: 'best-of-three-match-tiebreak' as const, rule: threeSet, standings: { pointsPerGameWon: 1, matchWinBonus: 0 } };
    expect(validateAmericanoResultDraftV3({ kind: 'traditional', sets: [
      { kind: 'set', gamesA: 6, gamesB: 4, tiebreakPointsA: null, tiebreakPointsB: null },
      { kind: 'set', gamesA: 4, gamesB: 6, tiebreakPointsA: null, tiebreakPointsB: null },
      { kind: 'set', gamesA: 10, gamesB: 8, tiebreakPointsA: null, tiebreakPointsB: null },
    ] }, decider, true).valid).toBe(false);
  });

  it('requires head-to-head ranking to use fixed pairs and accepts all supported custom settings', () => {
    expect(() => validateAmericanoConfigV3({ ...defaultAmericanoConfigV3('rotating'), ranking: { tiebreak: 'head-to-head', championship: 'none' } })).toThrow(/only available for fixed pairs/);
    const config = defaultAmericanoConfigV3('fixed');
    config.scoring = { kind: 'traditional', preset: 'custom', rule: { ...AMERICANO_V3_TRADITIONAL_PRESETS['short-set'].rule, gameEnding: 'star-point' }, standings: { pointsPerGameWon: 1000, matchWinBonus: 1000 } };
    config.ranking = { tiebreak: 'head-to-head-then-difference', championship: 'tiebreak-10' };
    expect(() => validateAmericanoConfigV3(config)).not.toThrow();
  });
});
