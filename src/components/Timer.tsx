import { useEffect } from 'react';
import { Play, Pause, Plus, Minus, RotateCcw } from 'lucide-react';
import type { MainRound } from '@/types/domain';
import { useTimer } from '@/hooks/useTimer';
import { useBuzzer } from '@/hooks/useBuzzer';
import { useEventStore } from '@/store/eventStore';
import { formatMs } from '@/utils/time';
import { cn } from '@/utils/classNames';

interface Props {
  round: MainRound;
  large?: boolean;
  showControls?: boolean;
  warningAtMs: number;
  soundEnabled: boolean;
}

export function Timer({ round, large = true, showControls = true, warningAtMs, soundEnabled }: Props) {
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

  const start = useEventStore((s) => s.startRoundTimer);
  const pause = useEventStore((s) => s.pauseRoundTimer);
  const reset = useEventStore((s) => s.resetRoundTimer);
  const adjust = useEventStore((s) => s.adjustTimer);

  let state: 'idle' | 'ok' | 'warn' | 'critical' | 'done';
  if (remainingMs <= 0) state = 'done';
  else if (remainingMs <= 60_000) state = 'critical';
  else if (remainingMs <= warningAtMs) state = 'warn';
  else if (!hasStarted) state = 'idle';
  else state = 'ok';

  const colorClass =
    state === 'done'
      ? 'text-red-300 animate-flash'
      : state === 'critical'
        ? 'text-red-400 animate-pulse-fast'
        : state === 'warn'
          ? 'text-amber-300'
          : state === 'idle'
            ? 'text-slate-300'
            : 'text-emerald-300';

  return (
    <div className="flex flex-col items-center gap-3">
      <div
        className={cn(
          'tabular-nums font-extrabold tracking-tight leading-none',
          large ? 'text-7xl sm:text-8xl md:text-9xl' : 'text-5xl',
          colorClass,
        )}
        aria-label="Round time remaining"
      >
        {formatMs(remainingMs)}
      </div>
      {showControls && (
        <div className="flex flex-wrap items-center justify-center gap-2">
          {!isRunning && (
            <button
              onClick={start}
              className="inline-flex items-center gap-1.5 rounded-md bg-emerald-500 hover:bg-emerald-400 text-emerald-950 font-semibold px-4 py-2"
            >
              <Play className="h-4 w-4" />
              {isPaused ? 'Resume' : hasStarted ? 'Resume' : 'Start'}
            </button>
          )}
          {isRunning && (
            <button
              onClick={pause}
              className="inline-flex items-center gap-1.5 rounded-md bg-amber-500 hover:bg-amber-400 text-amber-950 font-semibold px-4 py-2"
            >
              <Pause className="h-4 w-4" />
              Pause
            </button>
          )}
          <button
            onClick={() => adjust(-60_000)}
            className="inline-flex items-center gap-1 rounded-md bg-slate-800 hover:bg-slate-700 px-3 py-2 text-slate-100"
            aria-label="Subtract one minute"
          >
            <Minus className="h-4 w-4" />
            1m
          </button>
          <button
            onClick={() => adjust(60_000)}
            className="inline-flex items-center gap-1 rounded-md bg-slate-800 hover:bg-slate-700 px-3 py-2 text-slate-100"
            aria-label="Add one minute"
          >
            <Plus className="h-4 w-4" />
            1m
          </button>
          <button
            onClick={reset}
            className="inline-flex items-center gap-1 rounded-md bg-slate-800 hover:bg-slate-700 px-3 py-2 text-slate-300"
            aria-label="Reset timer"
          >
            <RotateCcw className="h-4 w-4" />
            Reset
          </button>
        </div>
      )}
    </div>
  );
}
