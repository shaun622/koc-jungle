import { useEffect, useRef, useState } from 'react';
import type { TimerState } from '@/types/domain';

export interface TimerView {
  remainingMs: number;
  isRunning: boolean;
  isPaused: boolean;
  hasStarted: boolean;
  hasFinished: boolean;
}

export function computeRemaining(state: TimerState, now = Date.now()): number {
  if (!state.startedAt) return state.durationMs;
  const pausedFor = state.pausedAt !== undefined ? now - state.pausedAt : 0;
  const elapsed = now - state.startedAt - state.totalPausedMs - pausedFor;
  return state.durationMs - elapsed;
}

export function useTimer(
  state: (TimerState & { id?: string; completedAt?: number }) | null,
  onZero?: () => void,
): TimerView {
  const [tick, setTick] = useState(0);
  const onZeroRef = useRef(onZero);
  const firedZeroRef = useRef(false);

  useEffect(() => {
    onZeroRef.current = onZero;
  }, [onZero]);

  const stateKey = state?.id ?? (state ? 'qualifier' : null);

  useEffect(() => {
    if (!state) return;
    let raf = 0;
    const loop = () => {
      setTick((t) => (t + 1) % 1_000_000);
      raf = window.requestAnimationFrame(loop);
    };
    raf = window.requestAnimationFrame(loop);
    return () => window.cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stateKey]);

  useEffect(() => {
    firedZeroRef.current = false;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stateKey, state?.startedAt, state?.pausedAt, state?.durationMs]);

  if (!state) {
    return {
      remainingMs: 0,
      isRunning: false,
      isPaused: false,
      hasStarted: false,
      hasFinished: false,
    };
  }

  const now = Date.now();
  const remainingMs = computeRemaining(state, now);
  const isRunning = !!state.startedAt && state.pausedAt === undefined && !state.completedAt;
  const isPaused = !!state.startedAt && state.pausedAt !== undefined;
  const hasStarted = !!state.startedAt;
  const hasFinished = remainingMs <= 0;

  if (hasStarted && hasFinished && !firedZeroRef.current && isRunning) {
    firedZeroRef.current = true;
    queueMicrotask(() => onZeroRef.current?.());
  }

  void tick;

  return { remainingMs, isRunning, isPaused, hasStarted, hasFinished };
}
