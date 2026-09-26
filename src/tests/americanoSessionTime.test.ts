import { describe, expect, it } from 'vitest';
import { applySessionPlan, suggestSessionPlan } from '@/logic/americanoV3/sessionPlan';
import { defaultAmericanoConfigV3, AMERICANO_V3_TRADITIONAL_PRESETS, validateAmericanoResultDraftV3, standingAwardForSideV3 } from '@/logic/americanoV3/scoring';
import { addAmericanoFixedTeamV3, addAmericanoParticipantV3, createAmericanoEventV3, previewAmericanoScheduleV3, startAmericanoEventV3, setAmericanoResultDraftV3, confirmAmericanoResultV3, endAmericanoRoundV3 } from '@/logic/americanoV3/runtime';
import { parseEventState } from '@/utils/eventSchema';
import type { MatchScoringV3, SessionPlanV3, TraditionalPresetKey, AmericanoResultDraftV3 } from '@/logic/americanoV3/types';

const plan: SessionPlanV3 = { totalMinutes: 120, preference: 'round-length', roundMinutes: 10, changeoverMinutes: 2 };
const traditional = (preset: Exclude<TraditionalPresetKey, 'custom'> = 'first-to-five'): MatchScoringV3 => ({ kind: 'traditional', preset, rule: AMERICANO_V3_TRADITIONAL_PRESETS[preset].rule, standings: { pointsPerGameWon: 2, matchWinBonus: 3 }, allowUnfinished: true });
const set = (a: number, b: number) => ({ kind: 'set' as const, gamesA: a, gamesB: b, tiebreakPointsA: null, tiebreakPointsB: null });
const stopped = (...sets: ReturnType<typeof set>[]): AmericanoResultDraftV3 => ({ kind: 'traditional', endedEarly: true, sets });

describe('session planner', () => {
  it('fits rounds including changes between rounds, not after the last', () => {
    expect(suggestSessionPlan(plan, 'rotating', 20, 5)).toMatchObject({ rounds: 10, minutes: 10, usedMinutes: 118, spareMinutes: 2 });
    expect(suggestSessionPlan({ ...plan, totalMinutes: 180 }, 'rotating', 32, 8)).toMatchObject({ rounds: 15, usedMinutes: 178 });
  });
  it('derives whole-minute full rotation pace and warns about very short rounds', () => {
    expect(suggestSessionPlan({ ...plan, preference: 'full' }, 'rotating', 20, 5)).toMatchObject({ rounds: 19, minutes: 4, usedMinutes: 112 });
    expect(suggestSessionPlan({ ...plan, preference: 'full' }, 'rotating', 20, 5).warnings).toContain('Rounds are under 5 minutes. Consider fewer rounds or a longer session.');
    expect(suggestSessionPlan({ ...plan, preference: 'full' }, 'fixed', 10, 5)).toMatchObject({ rounds: 9, minutes: 11, usedMinutes: 115 });
  });
  it('handles rests, repeats, capacity, unsupported counts and impossible budgets honestly', () => {
    expect(suggestSessionPlan(plan, 'fixed', 5, 3).rounds).toBe(10);
    expect(suggestSessionPlan({ ...plan, totalMinutes: 30 }, 'fixed', 5, 3).warnings.join(' ')).toMatch(/one fewer/);
    expect(suggestSessionPlan(plan, 'fixed', 2, 1).warnings.join(' ')).toMatch(/repeated/);
    expect(() => suggestSessionPlan(plan, 'rotating', 20, 4)).toThrow(/capacity/);
    expect(() => suggestSessionPlan({ ...plan, preference: 'full' }, 'rotating', 6, 2)).toThrow(/not available/);
    expect(() => suggestSessionPlan({ ...plan, totalMinutes: 10, preference: 'full' }, 'rotating', 20, 5)).toThrow(/Not enough/);
    expect(() => suggestSessionPlan({ ...plan, roundMinutes: 121 }, 'rotating', 8, 2)).toThrow(/longer/);
  });
  it('does not change manual config and preserves the plan in applied configs', () => {
    const config = defaultAmericanoConfigV3('rotating');
    expect(applySessionPlan(config, 0, 2)).toBe(config);
    expect(applySessionPlan({ ...config, sessionPlan: plan }, 20, 5)).toMatchObject({ scheduleKind: 'custom', customRounds: 10, paceMinutes: 10, sessionPlan: plan });
  });
});

describe('explicit unfinished scores', () => {
  it('requires both the event option and per-result confirmation; never manufactures rally points', () => {
    const result = { kind: 'rally' as const, scoreA: 10, scoreB: 8, endedEarly: true };
    const rules: MatchScoringV3 = { kind: 'rally', pointsPerMatch: 24, allowUnfinished: true };
    expect(validateAmericanoResultDraftV3(result, { ...rules, allowUnfinished: false }, true).valid).toBe(false);
    expect(validateAmericanoResultDraftV3({ ...result, endedEarly: false }, rules, true).valid).toBe(false);
    const checked = validateAmericanoResultDraftV3(result, rules, true);
    expect(checked).toMatchObject({ valid: true, complete: true, summary: { gamesA: 10, gamesB: 8, winner: 'A' } });
    expect(standingAwardForSideV3(rules, checked.summary!, 'B')).toBe(8);
    for (const [a,b] of [[20,8],[-1,10]]) expect(validateAmericanoResultDraftV3({ ...result, scoreA: a, scoreB: b }, rules, true).valid).toBe(false);
    expect(validateAmericanoResultDraftV3({ ...result, scoreA:0, scoreB:0 }, rules, true)).toMatchObject({valid:true,summary:{winner:null}});
    expect(validateAmericanoResultDraftV3({ ...result, scoreB: 10 }, rules, true).summary?.winner).toBeNull();
  });
  it('awards only actual games plus the configured bonus, and no bonus for draws', () => {
    const summary = validateAmericanoResultDraftV3(stopped(set(4,3)), traditional(), true).summary!;
    expect(summary).toMatchObject({ gamesA: 4, gamesB: 3, winner: 'A', terminal: false });
    expect(standingAwardForSideV3(traditional(), summary, 'A')).toBe(11);
    expect(standingAwardForSideV3(traditional(), summary, 'B')).toBe(6);
    const draw = validateAmericanoResultDraftV3(stopped(set(3,3)), traditional(), true).summary!;
    expect(draw.winner).toBeNull();
    expect(standingAwardForSideV3(traditional(), draw, 'A')).toBe(6);
    expect(validateAmericanoResultDraftV3(stopped(set(6,3)), traditional(), true).valid).toBe(false);
  });
  it('accepts only reachable partial set scores, no blank fields or impossible extra rows', () => {
    expect(validateAmericanoResultDraftV3(stopped(set(6,4),set(2,3)), traditional('best-of-three'), true).summary).toMatchObject({ winner: 'A', gamesA: 8, gamesB: 7 });
    expect(validateAmericanoResultDraftV3(stopped(set(6,4),set(4,6),set(3,3)), traditional('best-of-three'), true).summary?.winner).toBeNull();
    expect(validateAmericanoResultDraftV3(stopped(set(6,4),set(4,6)), traditional('best-of-three'), true).summary?.winner).toBeNull();
    expect(validateAmericanoResultDraftV3(stopped(set(3,3),set(2,1)), traditional('best-of-three'), true).valid).toBe(false);
    expect(validateAmericanoResultDraftV3(stopped(set(6,4),set(6,2),set(1,0)), traditional('best-of-three'), true).valid).toBe(false);
    expect(validateAmericanoResultDraftV3({ kind: 'traditional', endedEarly: true, sets: [{ ...set(4,3), gamesB: null }] }, traditional(), true).valid).toBe(false);
  });
  it('handles partial set and deciding tiebreaks without counting tiebreak points as games', () => {
    const result: AmericanoResultDraftV3 = { kind: 'traditional', endedEarly: true, sets: [{ ...set(6,6), tiebreakPointsA: 3, tiebreakPointsB: 2 }] };
    expect(validateAmericanoResultDraftV3(result, traditional('standard-set'), true).summary).toMatchObject({ gamesA: 6, gamesB: 6, winner: 'A' });
    const deciding: AmericanoResultDraftV3 = { kind: 'traditional', endedEarly: true, sets: [set(6,4),set(4,6),{ kind: 'match-tiebreak', pointsA: 4, pointsB: 3 }] };
    expect(validateAmericanoResultDraftV3(deciding, traditional('best-of-three-match-tiebreak'), true).summary).toMatchObject({ gamesA: 10, gamesB: 10, setsA: 1, setsB: 1, winner: 'A' });
  });
  it.each(['fixed','rotating'] as const)('saves, confirms and completes a %s round without waiting for a timer', async (mode) => {
    let event = createAmericanoEventV3('Session test', mode, 1);
    if (mode === 'fixed') {
      for (const name of ['A','B']) event = addAmericanoFixedTeamV3(event, { playerOne: name+'1', playerTwo: name+'2' });
    } else for (const name of ['A','B','C','D']) event = addAmericanoParticipantV3(event,name);
    event.formatConfig = { ...event.formatConfig, scoring: { kind: 'rally', pointsPerMatch: 24, allowUnfinished: true }, sessionPlan: { ...plan, totalMinutes: 7, roundMinutes: 7 } };
    event.formatConfig = applySessionPlan(event.formatConfig, mode === 'fixed' ? 2 : 4, 1);
    event = await previewAmericanoScheduleV3(event);
    event = startAmericanoEventV3(event);
    expect(event.rounds[0].durationMs).toBe(420000);
    const id = event.rounds[0].matches[0].id;
    event = setAmericanoResultDraftV3(event,id,{ kind:'rally', scoreA:10,scoreB:8,endedEarly:true });
    expect(() => endAmericanoRoundV3(event)).toThrow();
    event = confirmAmericanoResultV3(event,id);
    event = endAmericanoRoundV3(event);
    expect(event.status).toBe('complete');
    expect(parseEventState(JSON.parse(JSON.stringify(event)))).toEqual(event);
  });
});
