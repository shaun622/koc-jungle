import { useEffect, useRef, useState } from 'react';
import type { MainRound } from '@/types/domain';

export interface TimerView {
  remainingMs: number;
  isRunning: boolean;
  isPaused: boolean;
  hasStarted: boolean;
  hasFinished: boolean;
}

export function computeRemaining(round: MainRound, now = Date.now()): number {
  if (!round.startedAt) return round.durationMs;
  const pausedFor = round.pausedAt !== undefined ? now - round.pausedAt : 0;
  const elapsed = now - round.startedAt - round.totalPausedMs - pausedFor;
  return round.durationMs - elapsed;
}

export function useTimer(round: MainRound | null, onZero?: () => void): TimerView {
  const [tick, setTick] = useState(0);
  const onZeroRef = useRef(onZero);
  const firedZeroRef = useRef(false);

  useEffect(() => {
    onZeroRef.current = onZero;
  }, [onZero]);

  useEffect(() => {
    if (!round) return;
    let raf = 0;
    const loop = () => {
      setTick((t) => (t + 1) % 1_000_000);
      raf = window.requestAnimationFrame(loop);
    };
    raf = window.requestAnimationFrame(loop);
    return () => window.cancelAnimationFrame(raf);
  }, [round?.id]);

  useEffect(() => {
    firedZeroRef.current = false;
  }, [round?.id, round?.startedAt, round?.pausedAt, round?.durationMs]);

  if (!round) {
    return {
      remainingMs: 0,
      isRunning: false,
      isPaused: false,
      hasStarted: false,
      hasFinished: false,
    };
  }

  const now = Date.now();
  const remainingMs = computeRemaining(round, now);
  const isRunning = !!round.startedAt && round.pausedAt === undefined && !round.completedAt;
  const isPaused = !!round.startedAt && round.pausedAt !== undefined;
  const hasStarted = !!round.startedAt;
  const hasFinished = remainingMs <= 0;

  if (hasStarted && hasFinished && !firedZeroRef.current && isRunning) {
    firedZeroRef.current = true;
    // Defer to avoid setState-in-render
    queueMicrotask(() => onZeroRef.current?.());
  }

  // Suppress unused warning while still triggering rerenders.
  void tick;

  return { remainingMs, isRunning, isPaused, hasStarted, hasFinished };
}
