import { useState } from 'react';
import { suggestSessionPlan } from '@/logic/americanoV3/sessionPlan';
import type { AmericanoConfigV3, SessionPlanV3 } from '@/logic/americanoV3/types';

export function AmericanoSessionPlanner({ config, entrants, courts, startsAt, onChange }: {
  config: AmericanoConfigV3; entrants: number; courts: number; startsAt: string;
  onChange: (plan: SessionPlanV3 | undefined) => void;
}) {
  const plan = config.sessionPlan;
  const [custom, setCustom] = useState(false);
  let suggestion: ReturnType<typeof suggestSessionPlan> | undefined;
  let error = '';
  if (plan) {
    try { suggestion = suggestSessionPlan(plan, config.pairingMode, entrants, courts); }
    catch (cause) { error = cause instanceof Error ? cause.message : 'Check the planning options.'; }
  }
  const update = (patch: Partial<SessionPlanV3>) => onChange({ ...plan!, ...patch });
  const start = startsAt ? new Date(startsAt).getTime() : NaN;
  const finish = suggestion && Number.isFinite(start) ? new Date(start + suggestion.usedMinutes * 60000).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) : null;
  return <div className="amv3-session-planner">
    <label className="amv3-check"><input type="checkbox" checked={!!plan} onChange={(e) => onChange(e.target.checked ? { totalMinutes: 120, preference: 'round-length', roundMinutes: config.paceMinutes, changeoverMinutes: 2 } : undefined)} /><span>Plan around session time<small>Let the app work out the rounds. Optional.</small></span></label>
    {plan && <>
      <div className="amv3-fields">
        <label><span>Session duration</span><select value={custom || ![90,120,180].includes(plan.totalMinutes) ? 'custom' : plan.totalMinutes} onChange={(e) => { setCustom(e.target.value === 'custom'); if (e.target.value !== 'custom') update({ totalMinutes: Number(e.target.value) }); }}><option value={90}>90 minutes</option><option value={120}>2 hours</option><option value={180}>3 hours</option><option value="custom">Custom</option></select></label>
        {(custom || ![90,120,180].includes(plan.totalMinutes)) && <label><span>Total minutes</span><input type="number" min={1} max={1440} value={plan.totalMinutes || ''} onChange={(e) => update({ totalMinutes: Number(e.target.value) })}/></label>}
        <label><span>Planning preference</span><select value={plan.preference} onChange={(e) => update({ preference: e.target.value as SessionPlanV3['preference'] })}><option value="round-length">Choose round length</option><option value="full">{config.pairingMode === 'fixed' ? 'Play each team once' : 'Partner with everyone once'}</option></select></label>
        {plan.preference === 'round-length' && <label><span>Minutes per round</span><input type="number" min={1} max={240} value={plan.roundMinutes || ''} onChange={(e) => update({ roundMinutes: Number(e.target.value) })}/></label>}
      </div>
      <details><summary>More options</summary><label><span>Changeover minutes between rounds</span><input type="number" min={0} max={60} value={plan.changeoverMinutes} onChange={(e) => update({ changeoverMinutes: Number(e.target.value) })}/></label></details>
      <div className="amv3-rules-summary" role="status">
        {suggestion ? <><strong>Suggested: {suggestion.rounds} rounds · {suggestion.minutes} minutes per round</strong><span>{entrants} {config.pairingMode === 'fixed' ? 'teams' : 'players'} · {courts} courts · {suggestion.usedMinutes} minutes including changeovers{finish ? ` · estimated finish ${finish}` : ''}</span>{suggestion.spareMinutes > 0 && <span>{suggestion.spareMinutes} minutes spare.</span>}{suggestion.warnings.map((warning) => <span key={warning}>{warning}</span>)}</> : <span>{error}</span>}
        <span>Estimate only. You confirm scores and end each round; the timer never stops a match. Additional finals are not included.</span>
      </div>
    </>}
  </div>;
}
