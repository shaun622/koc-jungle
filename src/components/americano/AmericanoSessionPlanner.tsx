import { useState } from 'react';
import { suggestSessionPlan } from '@/logic/americanoV3/sessionPlan';
import type { AmericanoConfigV3, SessionPlanV3 } from '@/logic/americanoV3/types';

export function AmericanoSessionPlanner({ config, entrants, courts, startsAt, onChange }: {
  config: AmericanoConfigV3; entrants: number; courts: number; startsAt: string;
  onChange: (plan: SessionPlanV3 | undefined) => void;
}) {
  const plan = config.sessionPlan;
  const [custom, setCustom] = useState(false);
  const choice = plan?.preference === 'round-length' ? 'legacy' : plan?.calculateFrom ?? 'session';
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
    <label className="amv3-check"><input type="checkbox" checked={!!plan} onChange={(e) => onChange(e.target.checked ? { totalMinutes: 120, preference: 'full', calculateFrom: 'session', roundMinutes: config.paceMinutes, changeoverMinutes: 2 } : undefined)} /><span>Plan around session time<small>Enter one time. We calculate the other.</small></span></label>
    {plan && <>
      <div className="amv3-fields">
        <label><span>Which time do you know?</span><select value={choice} onChange={(e) => update({ preference: 'full', calculateFrom: e.target.value as 'session' | 'round', totalMinutes: plan.totalMinutes || 120, roundMinutes: plan.roundMinutes || 10 })}><option value="session">I know the session length</option><option value="round">I know the round length</option>{choice === 'legacy' && <option value="legacy">Previous plan: fit rounds into a session</option>}</select></label>
        {choice !== 'round' && <>
          <label><span>Session duration</span><select value={custom || ![90,120,180].includes(plan.totalMinutes) ? 'custom' : plan.totalMinutes} onChange={(e) => { setCustom(e.target.value === 'custom'); if (e.target.value !== 'custom') update({ totalMinutes: Number(e.target.value) }); }}><option value={90}>90 minutes</option><option value={120}>2 hours</option><option value={180}>3 hours</option><option value="custom">Custom</option></select></label>
          {(custom || ![90,120,180].includes(plan.totalMinutes)) && <label><span>Total minutes</span><input type="number" min={1} max={1440} value={plan.totalMinutes || ''} onChange={(e) => update({ totalMinutes: Number(e.target.value) })}/></label>}
        </>}
        {choice !== 'session' && <label><span>Minutes per round</span><input type="number" min={1} max={240} value={plan.roundMinutes || ''} onChange={(e) => update({ roundMinutes: Number(e.target.value) })}/></label>}
      </div>
      {choice === 'legacy' && <p className="amv3-help">Your saved plan is unchanged. Choose one of the options above to calculate one time from the other.</p>}
      <details><summary>Adjust</summary>
        {choice !== 'legacy' && <>
          <label className="amv3-check"><input type="checkbox" checked={plan.roundCount !== undefined} onChange={(e) => update({ roundCount: e.target.checked ? suggestion?.rounds ?? 7 : undefined })}/><span>Choose number of rounds<small>Otherwise, use a full rotation from your roster.</small></span></label>
          {plan.roundCount !== undefined && <label><span>Number of rounds</span><input type="number" min={1} max={64} value={plan.roundCount || ''} onChange={(e) => update({ roundCount: Number(e.target.value) })}/></label>}
        </>}
        <label><span>Changeover minutes between rounds</span><input type="number" min={0} max={60} value={plan.changeoverMinutes} onChange={(e) => update({ changeoverMinutes: Number(e.target.value) })}/></label>
      </details>
      <div className="amv3-rules-summary" role="status">
        {suggestion ? <><strong>Suggested: {suggestion.rounds} {suggestion.rounds === 1 ? 'round' : 'rounds'} · {suggestion.minutes} minutes per round</strong><span>Approximately {Math.floor(suggestion.usedMinutes / 60) > 0 ? `${Math.floor(suggestion.usedMinutes / 60)}h ` : ''}{suggestion.usedMinutes % 60}m including {plan.changeoverMinutes}-minute changeovers{finish ? ` · finish around ${finish}` : ''}</span><span>{suggestion.coverage} · {entrants} {config.pairingMode === 'fixed' ? 'teams' : 'players'} · {courts} courts</span>{suggestion.spareMinutes > 0 && <span>{suggestion.spareMinutes} minutes spare.</span>}{suggestion.warnings.map((warning) => <span key={warning}>{warning}</span>)}</> : <span>{error}</span>}
        <span>Timer is a reminder. You enter scores and finish rounds. Extra finals are not included.</span>
      </div>
    </>}
  </div>;
}
