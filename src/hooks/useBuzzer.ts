import { useCallback, useRef } from 'react';

export function useBuzzer() {
  const ctxRef = useRef<AudioContext | null>(null);

  const play = useCallback(() => {
    try {
      if (!ctxRef.current) {
        const Ctx =
          (window as unknown as { AudioContext?: typeof AudioContext; webkitAudioContext?: typeof AudioContext })
            .AudioContext ||
          (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
        if (!Ctx) return;
        ctxRef.current = new Ctx();
      }
      const ctx = ctxRef.current;
      if (!ctx) return;
      if (ctx.state === 'suspended') ctx.resume();
      const now = ctx.currentTime;
      const tones = [880, 660, 880];
      tones.forEach((freq, i) => {
        const o = ctx.createOscillator();
        const g = ctx.createGain();
        o.type = 'square';
        o.frequency.value = freq;
        const start = now + i * 0.25;
        const end = start + 0.2;
        g.gain.setValueAtTime(0.0001, start);
        g.gain.exponentialRampToValueAtTime(0.25, start + 0.02);
        g.gain.exponentialRampToValueAtTime(0.0001, end);
        o.connect(g).connect(ctx.destination);
        o.start(start);
        o.stop(end + 0.05);
      });
    } catch {
      // ignore audio failures
    }
  }, []);

  return play;
}
