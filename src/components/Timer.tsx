import { useEffect } from 'react';
import { useEventStore } from '@/store/eventStore';
import { useTimer } from '@/hooks/useTimer';
import { useBuzzer } from '@/hooks/useBuzzer';
import { usePresentationMode } from '@/hooks/usePresentationMode';
import { formatMs } from '@/utils/time';
import type { MainRound } from '@/types/domain';
import { Icons } from './Icons';

interface Props {
  round: MainRound;
  warningAtMs: number;
  soundEnabled: boolean;
}

export function Timer({ round, warningAtMs, soundEnabled }: Props) {
  const [presentation] = usePresentationMode();
  const start = useEventStore((s) => s.startRoundTimer);
  const pause = useEventStore((s) => s.pauseRoundTimer);
  const reset = useEventStore((s) => s.resetRoundTimer);
  const adjust = useEventStore((s) => s.adjustTimer);
  const buzz = useBuzzer();

  const { remainingMs, isRunning, isPaused, hasStarted } = useTimer(round, () => {
    if (soundEnabled) buzz();
    try {
      document.title = '🔔 Time! — KOC';
    } catch {
      // ignore
    }
  });

  useEffect(() => {
    if (remainingMs > 0) {
      document.title = `${formatMs(remainingMs)} — KOC`;
    }
  }, [remainingMs]);

  let timerCls = '';
  if (!hasStarted) timerCls = 'idle';
  else if (remainingMs <= 60_000) timerCls = 'danger';
  else if (remainingMs <= warningAtMs) timerCls = 'warn';

  const statusCls = !hasStarted ? 'idle' : isPaused ? 'paused' : '';
  const statusLabel = !hasStarted ? 'READY' : isPaused ? 'PAUSED' : 'LIVE';

  const isIdleOrPaused = !isRunning;

  return (
    <div className="op-timer">
      <div className="op-timer-head">
        <div className="op-timer-round">Round {round.index}</div>
        <div className={'op-timer-status ' + statusCls}>
          <span className="dot" />
          {statusLabel}
        </div>
      </div>
      <div className={'op-timer-value ' + timerCls}>{formatMs(remainingMs)}</div>
      <div className="op-timer-controls">
        <button className="btn" onClick={() => adjust(-60_000)} aria-label="Subtract 1 minute">
          {presentation ? <Icons.Minus className="icon" /> : '−1 MIN'}
        </button>
        <button className="btn" onClick={() => reset()} aria-label="Reset timer">
          <Icons.Reset className="icon" />
        </button>
        <button className="btn" onClick={() => adjust(60_000)} aria-label="Add 1 minute">
          {presentation ? <Icons.Plus className="icon" /> : '+1 MIN'}
        </button>
        <button
          className={'btn op-timer-play ' + (isPaused ? 'paused' : !hasStarted ? 'idle' : '')}
          onClick={() => (isIdleOrPaused ? start() : pause())}
        >
          {isIdleOrPaused ? (
            <>
              <Icons.Play className="icon" /> {presentation ? '' : hasStarted ? 'RESUME' : 'START'}
            </>
          ) : (
            <>
              <Icons.Pause className="icon" /> {presentation ? '' : 'PAUSE'}
            </>
          )}
        </button>
      </div>
    </div>
  );
}
