import { useCallback, useRef } from 'react';

export function useBuzzer() {
  const ctxRef = useRef<AudioContext | null>(null);

  const ensureCtx = (): AudioContext | null => {
    if (!ctxRef.current) {
      const Ctx =
        (window as unknown as { AudioContext?: typeof AudioContext; webkitAudioContext?: typeof AudioContext })
          .AudioContext ||
        (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Ctx) return null;
      ctxRef.current = new Ctx();
    }
    const ctx = ctxRef.current;
    if (ctx.state === 'suspended') {
      // Best-effort resume — iOS suspends until a user gesture.
      void ctx.resume();
    }
    return ctx;
  };

  /**
   * End-of-timer buzzer — sustained low square-wave "BZZZZZ" for ~1.5s,
   * the kind that ends a basketball quarter. Two slightly-detuned
   * oscillators (220 + 223 Hz) give it the classic electromechanical
   * beating; fast attack, short decay tail.
   */
  const buzz = useCallback(() => {
    try {
      const ctx = ensureCtx();
      if (!ctx) return;
      const now = ctx.currentTime;
      const duration = 1.5;
      [220, 223].forEach((freq) => {
        const o = ctx.createOscillator();
        const g = ctx.createGain();
        o.type = 'square';
        o.frequency.value = freq;
        g.gain.setValueAtTime(0.0001, now);
        g.gain.exponentialRampToValueAtTime(0.22, now + 0.01);
        g.gain.setValueAtTime(0.22, now + duration - 0.1);
        g.gain.exponentialRampToValueAtTime(0.0001, now + duration);
        o.connect(g).connect(ctx.destination);
        o.start(now);
        o.stop(now + duration + 0.05);
      });
    } catch {
      /* ignore audio failures */
    }
  }, []);

  /** Short single beep — used for the 3/2/1 countdown ticks. */
  const tick = useCallback(() => {
    try {
      const ctx = ensureCtx();
      if (!ctx) return;
      const now = ctx.currentTime;
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.type = 'square';
      o.frequency.value = 880;
      g.gain.setValueAtTime(0.0001, now);
      g.gain.exponentialRampToValueAtTime(0.22, now + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0001, now + 0.16);
      o.connect(g).connect(ctx.destination);
      o.start(now);
      o.stop(now + 0.2);
    } catch {
      /* ignore audio failures */
    }
  }, []);

  return { buzz, tick };
}
