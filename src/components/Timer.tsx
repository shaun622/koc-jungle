import { useEffect } from 'react';
import { useTimer } from '@/hooks/useTimer';
import { useBuzzer } from '@/hooks/useBuzzer';
import { usePresentationMode } from '@/hooks/usePresentationMode';
import { formatMs } from '@/utils/time';
import type { TimerState } from '@/types/domain';
import { Icons } from './Icons';

interface Props {
  state: (TimerState & { id?: string; completedAt?: number }) | null;
  label: string;
  warningAtMs: number;
  soundEnabled: boolean;
  onStart: () => void;
  onPause: () => void;
  onReset: () => void;
  onAdjust: (deltaMs: number) => void;
}

export function Timer({
  state,
  label,
  warningAtMs,
  soundEnabled,
  onStart,
  onPause,
  onReset,
  onAdjust,
}: Props) {
  const [presentation] = usePresentationMode();
  const { buzz, tick } = useBuzzer();

  const { remainingMs, isRunning, isPaused, hasStarted } = useTimer(state, () => {
    if (soundEnabled) buzz();
    try {
      document.title = '🔔 Time! · Padel TM';
    } catch {
      // ignore
    }
  });

  // Countdown ticks at T-3, T-2, T-1.
  const secondsLeft = Math.max(0, Math.ceil(remainingMs / 1000));
  useEffect(() => {
    if (!soundEnabled || !isRunning) return;
    if (secondsLeft === 3 || secondsLeft === 2 || secondsLeft === 1) {
      tick();
    }
  }, [secondsLeft, isRunning, soundEnabled, tick]);

  useEffect(() => {
    if (remainingMs > 0) {
      document.title = `${formatMs(remainingMs)} · Padel TM`;
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
        <div className="op-timer-round">{label}</div>
        <div className={'op-timer-status ' + statusCls}>
          <span className="dot" />
          {statusLabel}
        </div>
      </div>
      <div className={'op-timer-value ' + timerCls}>{formatMs(remainingMs)}</div>
      <div className="op-timer-controls">
        <button className="btn" onClick={() => onAdjust(-60_000)} aria-label="Subtract 1 minute">
          {presentation ? <Icons.Minus className="icon" /> : '−1 MIN'}
        </button>
        <button className="btn" onClick={() => onReset()} aria-label="Reset timer">
          <Icons.Reset className="icon" />
        </button>
        <button className="btn" onClick={() => onAdjust(60_000)} aria-label="Add 1 minute">
          {presentation ? <Icons.Plus className="icon" /> : '+1 MIN'}
        </button>
        <button
          className={'btn op-timer-play ' + (isPaused ? 'paused' : !hasStarted ? 'idle' : '')}
          onClick={() => (isIdleOrPaused ? onStart() : onPause())}
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
