import { useEffect } from 'react';
import { Capacitor } from '@capacitor/core';

const native = Capacitor.isNativePlatform();

/**
 * Keep the screen awake while `active` is true. The operator's iPad must not
 * fall asleep mid-round while it's mirroring the scoreboard to a TV — that
 * kills the broadcast. Native uses the KeepAwake plugin; the web uses the
 * Screen Wake Lock API, re-acquired when the tab returns to the foreground
 * (the lock is dropped on visibility loss).
 */
export function useKeepAwake(active: boolean): void {
  useEffect(() => {
    if (!active) return;

    if (native) {
      let cancelled = false;
      void (async () => {
        try {
          const { KeepAwake } = await import('@capacitor-community/keep-awake');
          if (!cancelled) await KeepAwake.keepAwake();
        } catch (err) {
          console.warn('[keep-awake] request failed', err);
        }
      })();
      return () => {
        cancelled = true;
        void (async () => {
          try {
            const { KeepAwake } = await import('@capacitor-community/keep-awake');
            await KeepAwake.allowSleep();
          } catch {
            /* ignore */
          }
        })();
      };
    }

    // Web: Screen Wake Lock API (typed minimally to avoid lib-dom coupling).
    const wl = (
      navigator as unknown as {
        wakeLock?: { request(type: 'screen'): Promise<{ release(): Promise<void> }> };
      }
    ).wakeLock;
    let sentinel: { release(): Promise<void> } | null = null;
    let released = false;
    const request = async () => {
      if (!wl) return;
      try {
        sentinel = await wl.request('screen');
      } catch {
        /* denied / unsupported — nothing more to do */
      }
    };
    const onVisibility = () => {
      if (document.visibilityState === 'visible' && !released) void request();
    };
    void request();
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      released = true;
      document.removeEventListener('visibilitychange', onVisibility);
      void sentinel?.release().catch(() => {});
      sentinel = null;
    };
  }, [active]);
}
