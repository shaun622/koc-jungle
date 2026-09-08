import type { TimerView } from '@/hooks/useTimer';
import { formatMs } from '@/utils/time';

export function visibleRoundSteps(current: number, total: number): number[] {
  const count = Math.max(0, Math.min(6, total));
  const first = Math.max(1, Math.min(current - 2, total - count + 1));
  return Array.from({ length: count }, (_, index) => first + index);
}

export function RoundProgress({ current, total }: { current: number; total: number }) {
  return <div className="night-round-progress" aria-label={`Round ${current} of ${total}`}>
    {visibleRoundSteps(current, total).map((index) => <span key={index} className={index < current ? 'played' : index === current ? 'current' : ''} aria-current={index === current ? 'step' : undefined} aria-label={`Round ${index}${index < current ? ', completed' : ''}`}>{index < current ? '✓' : index}</span>)}
  </div>;
}

/** Render the existing timer state; controls and timing remain in DisplayScreen. */
export function EventNightTimer({ timer, roundIndex, totalRounds, durationMs, warningAtMs, hasRound }: {
  timer: TimerView; roundIndex: number; totalRounds: number; durationMs: number; warningAtMs: number; hasRound: boolean;
}) {
  const status = !hasRound ? 'Ready' : timer.hasFinished ? "Time’s up" : timer.isPaused ? 'Paused' : timer.isRunning ? 'Running' : 'Ready';
  const urgency = timer.hasStarted ? timer.remainingMs <= 60_000 ? 'danger' : timer.remainingMs <= warningAtMs ? 'warn' : '' : '';
  const remaining = durationMs > 0 ? Math.max(0, Math.min(100, timer.remainingMs / durationMs * 100)) : 0;
  return <section className="tv-timer-block night-timer" aria-label="Round timer">
    <div className="night-timer-head"><h2>Round <strong>{roundIndex || '–'}</strong> <span>/ {totalRounds}</span></h2><span className={'night-timer-status ' + urgency}><i />{status}</span></div>
    <div className="night-timer-centre"><div className="tv-timer-label">Time remaining</div><div role="timer" className={'tv-timer-value size-xl ' + urgency}>{hasRound ? formatMs(timer.remainingMs) : '–'}</div>
      <div className="tv-timer-progress"><div className="tv-timer-progress-bar" style={{ width: `${remaining}%` }} /></div><div className="night-timer-scale"><span>{Math.round(durationMs / 60000)} minute round</span><span>00:00</span></div>
    </div>
    <div className="night-timer-foot"><RoundProgress current={roundIndex} total={totalRounds} /><p>{roundIndex >= totalRounds ? 'Final round' : <>Up next <strong>Round {roundIndex + 1}</strong></>}</p></div>
  </section>;
}
