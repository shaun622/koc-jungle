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
  const buzz = useBuzzer();

  const { remainingMs, isRunning, isPaused, hasStarted } = useTimer(state, () => {
    if (soundEnabled) {
      buzz();
      try {
        if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
          window.speechSynthesis.cancel();
          window.speechSynthesis.speak(
            new SpeechSynthesisUtterance('Kriss is a cunt'),
          );
        }
      } catch {
        // ignore speech failures
      }
    }
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
