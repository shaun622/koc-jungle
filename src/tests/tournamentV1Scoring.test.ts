import { describe, expect, it } from 'vitest';
import {
  RULE_PRESETS,
  resultSummary,
  scoreSummary,
  TournamentRuleError,
  validateResult,
  validateRuleProfile,
  type RuleProfile,
  type TournamentResult,
} from '@/logic/tournament';

const result = (patch: Partial<Omit<TournamentResult, 'revision' | 'confirmedAt'>>): Omit<TournamentResult, 'revision' | 'confirmedAt'> => ({
  kind: 'played', winnerEntryId: 'entry-a', score: null, reason: '', retrospective: false, ...patch,
});

describe('tournament v2 scoring', () => {
  it('treats best of nine games as first to five without awarding a set', () => {
    expect(scoreSummary({ sets: [{ gamesA: 5, gamesB: 4 }] }, RULE_PRESETS.firstToFive, true)).toMatchObject({
      winner: 'A', setsA: 0, setsB: 0, gamesA: 5, gamesB: 4, terminal: true,
    });
    expect(() => scoreSummary({ sets: [{ gamesA: 6, gamesB: 4 }] }, RULE_PRESETS.firstToFive, true)).toThrow(TournamentRuleError);
  });

  it.each([
    [7, 0], [7, 5], [8, 6], [10, 8],
  ])('accepts terminal tiebreak endpoint %i-%i', (a, b) => {
    expect(scoreSummary({ sets: [{ gamesA: 7, gamesB: 6, tiebreakPointsA: a, tiebreakPointsB: b }] }, RULE_PRESETS.standardSet, true).winner).toBe('A');
  });

  it.each([
    [7, 6], [8, 5], [11, 8],
  ])('rejects invalid completed tiebreak endpoint %i-%i', (a, b) => {
    expect(() => scoreSummary({ sets: [{ gamesA: 7, gamesB: 6, tiebreakPointsA: a, tiebreakPointsB: b }] }, RULE_PRESETS.standardSet, true)).toThrow(TournamentRuleError);
  });

  it('requires both tiebreak point fields and a matching winner', () => {
    expect(() => scoreSummary({ sets: [{ gamesA: 7, gamesB: 6, tiebreakPointsA: 7 }] }, RULE_PRESETS.standardSet, true)).toThrow(TournamentRuleError);
    expect(() => scoreSummary({ sets: [{ gamesA: 7, gamesB: 6, tiebreakPointsA: 5, tiebreakPointsB: 7 }] }, RULE_PRESETS.standardSet, true)).toThrow(TournamentRuleError);
  });

  it('supports a margin-two tiebreak trigger at target minus one', () => {
    const profile: RuleProfile = { ...RULE_PRESETS.standardSet, id: 'target-minus-one', tiebreakTrigger: 5 };
    validateRuleProfile(profile);
    expect(scoreSummary({ sets: [{ gamesA: 6, gamesB: 5, tiebreakPointsA: 7, tiebreakPointsB: 3 }] }, profile, true).winner).toBe('A');
    expect(() => scoreSummary({ sets: [{ gamesA: 7, gamesB: 5 }] }, profile, true)).toThrow(TournamentRuleError);
  });

  it('counts a deciding match tiebreak as one set and zero games', () => {
    const summary = scoreSummary({ sets: [
      { gamesA: 6, gamesB: 4 },
      { gamesA: 4, gamesB: 6 },
      { gamesA: 10, gamesB: 3, decidingMatchTiebreak: true },
    ] }, RULE_PRESETS.matchTiebreak, true);
    expect(summary).toMatchObject({ winner: 'A', setsA: 2, setsB: 1, gamesA: 10, gamesB: 10 });
    expect(() => scoreSummary({ sets: [
      { gamesA: 6, gamesB: 4 },
      { gamesA: 4, gamesB: 6 },
      { gamesA: 6, gamesB: 0 },
    ] }, RULE_PRESETS.matchTiebreak, true)).toThrow(TournamentRuleError);
  });

  it('uses a real one-short-set preset with the new timing defaults', () => {
    expect(RULE_PRESETS.customShortSet).toMatchObject({ bestOfSets: 1, gamesToWin: 4, estimatedMinutes: 20, restMinutes: 15 });
    expect(scoreSummary({ sets: [{ gamesA: 4, gamesB: 1 }] }, RULE_PRESETS.customShortSet, true).winner).toBe('A');
    expect(() => scoreSummary({ sets: [{ gamesA: 4, gamesB: 1 }, { gamesA: 4, gamesB: 0 }] }, RULE_PRESETS.customShortSet, true)).toThrow(TournamentRuleError);
  });

  it('accepts terminal live progress but does not create a result', () => {
    expect(scoreSummary({ sets: [{ gamesA: 3, gamesB: 2 }] }, RULE_PRESETS.firstToFive, false)).toMatchObject({ terminal: false, winner: null });
    expect(scoreSummary({ sets: [{ gamesA: 5, gamesB: 2 }] }, RULE_PRESETS.firstToFive, false)).toMatchObject({ terminal: true, winner: 'A' });
  });

  it('enforces non-played result shapes and excludes them from statistics', () => {
    const walkover = result({ kind: 'walkover', winnerEntryId: 'entry-a', score: null, reason: 'No show' });
    validateResult(walkover, RULE_PRESETS.firstToFive, 'entry-a', 'entry-b');
    expect(resultSummary({ ...walkover, revision: 1, confirmedAt: 5 }, RULE_PRESETS.firstToFive)).toEqual({ winner: null, setsA: 0, setsB: 0, gamesA: 0, gamesB: 0, terminal: true });
    expect(() => validateResult(result({ kind: 'walkover', score: { sets: [{ gamesA: 5, gamesB: 0 }] }, reason: 'No show' }), RULE_PRESETS.firstToFive, 'entry-a', 'entry-b')).toThrow(TournamentRuleError);
    expect(() => validateResult(result({ kind: 'retirement', score: { sets: [{ gamesA: 5, gamesB: 2 }] }, reason: 'Injury' }), RULE_PRESETS.firstToFive, 'entry-a', 'entry-b')).toThrow(TournamentRuleError);
    validateResult(result({ kind: 'administrative', score: null, reportedScore: { sets: [{ gamesA: 3, gamesB: 2 }] }, reason: 'Referee ruling' }), RULE_PRESETS.firstToFive, 'entry-a', 'entry-b');
  });

  it('accepts the score maximum and rejects max plus one, fractions, negatives and NaN', () => {
    const prefix = [{ gamesA: 6, gamesB: 0 }, { gamesA: 0, gamesB: 6 }];
    expect(scoreSummary({ sets: [...prefix, { gamesA: 2_147_483_647, gamesB: 2_147_483_645, decidingMatchTiebreak: true }] }, RULE_PRESETS.matchTiebreak, true).winner).toBe('A');
    for (const invalid of [2_147_483_648, 1.5, -1, Number.NaN]) {
      expect(() => scoreSummary({ sets: [{ gamesA: invalid, gamesB: 0 }] }, RULE_PRESETS.firstToFive, false)).toThrow(TournamentRuleError);
    }
  });
});
