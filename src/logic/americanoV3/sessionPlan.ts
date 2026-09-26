import { hasExactRotatingCycle } from '@/logic/americanoV2/fixtures';
import type { AmericanoConfigV3, SessionPlanV3 } from './types';

export function validateSessionPlan(plan: SessionPlanV3): void {
  for (const [key, min, max] of [['totalMinutes', 1, 1440], ['roundMinutes', 1, 240], ['changeoverMinutes', 0, 60]] as const) {
    if (!Number.isInteger(plan[key]) || plan[key] < min || plan[key] > max) throw new Error(`${key === 'totalMinutes' ? 'Session duration' : key === 'roundMinutes' ? 'Round length' : 'Changeover'} must be ${min}–${max} whole minutes.`);
  }
  if (!['full', 'round-length'].includes(plan.preference)) throw new Error('Choose a session planning preference.');
}

export function suggestSessionPlan(plan: SessionPlanV3, mode: 'fixed' | 'rotating', count: number, courts: number) {
  validateSessionPlan(plan);
  const minimum = mode === 'fixed' ? 2 : 4;
  if (!Number.isInteger(courts) || courts < 1 || courts > 16) throw new Error('Add 1–16 courts first.');
  if (count < minimum) throw new Error(`Add at least ${minimum} ${mode === 'fixed' ? 'teams' : 'players'} to calculate your plan.`);
  if (count > courts * minimum) throw new Error('There are more confirmed entrants than court capacity. Add courts or reduce the confirmed roster first.');
  const fullAvailable = mode === 'fixed' || hasExactRotatingCycle(count);
  const cycle = mode === 'fixed' ? count % 2 === 0 ? count - 1 : count : count % 4 === 0 ? count - 1 : count;
  let rounds: number;
  let minutes: number;
  const warnings: string[] = [];
  if (plan.preference === 'full') {
    if (!fullAvailable) throw new Error('A once-with-every-partner rotation is not available for this player count. Choose round length for a balanced schedule.');
    rounds = cycle;
    minutes = Math.min(240, Math.floor((plan.totalMinutes - (rounds - 1) * plan.changeoverMinutes) / rounds));
    if (minutes < 1) throw new Error('Not enough time for a full rotation. Reduce changeover time, extend the session or choose round length.');
  } else {
    minutes = plan.roundMinutes;
    rounds = Math.min(64, Math.floor((plan.totalMinutes + plan.changeoverMinutes) / (minutes + plan.changeoverMinutes)));
    if (rounds < 1) throw new Error('The chosen round length is longer than the session.');
    // Prefer equal appearances when resting entrants require a multi-round cycle.
    const playing = Math.floor(count / minimum) * minimum;
    let a = count; let b = playing;
    while (b) [a, b] = [b, a % b];
    const equalCycle = count / a;
    if (rounds >= equalCycle) rounds -= rounds % equalCycle;
    else if (playing < count) warnings.push('Some entrants will play one fewer match. The preview shows rests.');
    if (fullAvailable && rounds > cycle) warnings.push('This includes repeated matchups after the first full rotation.');
    if (!fullAvailable || rounds < cycle) warnings.push('Balanced playing time; not a complete everyone-with-everyone rotation.');
  }
  if (minutes < 5) warnings.push('Rounds are under 5 minutes. Consider fewer rounds or a longer session.');
  const usedMinutes = rounds * minutes + (rounds - 1) * plan.changeoverMinutes;
  return { rounds, minutes, usedMinutes, spareMinutes: plan.totalMinutes - usedMinutes, warnings,
    coverage: mode === 'fixed' ? 'Play each team once' : 'Partner with each player once' };
}

export function applySessionPlan(config: AmericanoConfigV3, count: number, courts: number): AmericanoConfigV3 {
  if (!config.sessionPlan) return config;
  const suggestion = suggestSessionPlan(config.sessionPlan, config.pairingMode, count, courts);
  const next = { ...config, scheduleKind: config.sessionPlan.preference === 'full' ? 'full' as const : 'custom' as const, paceMinutes: suggestion.minutes };
  if (next.scheduleKind === 'custom') next.customRounds = suggestion.rounds;
  else delete next.customRounds;
  return next;
}
