/**
 * Haptic feedback helpers (Capacitor Haptics).
 *
 * No-ops on the web (most desktop browsers don't vibrate, and we don't
 * want errors); fires real haptics on native iOS / Android. Imports are
 * dynamic so the plugin isn't pulled into the web bundle's critical path.
 *
 * Usage is intentionally fire-and-forget: callers never await.
 */

import { Capacitor } from '@capacitor/core';

const native = Capacitor.isNativePlatform();

/** Light tap, e.g. a score +/- button. */
export function hapticTick(): void {
  if (!native) return;
  void (async () => {
    try {
      const { Haptics, ImpactStyle } = await import('@capacitor/haptics');
      await Haptics.impact({ style: ImpactStyle.Light });
    } catch {
      /* ignore */
    }
  })();
}

/** Medium tap, e.g. confirming an action / advancing a round. */
export function hapticImpact(): void {
  if (!native) return;
  void (async () => {
    try {
      const { Haptics, ImpactStyle } = await import('@capacitor/haptics');
      await Haptics.impact({ style: ImpactStyle.Medium });
    } catch {
      /* ignore */
    }
  })();
}

/** Strong notification buzz, e.g. the round-end buzzer. */
export function hapticBuzz(): void {
  if (!native) return;
  void (async () => {
    try {
      const { Haptics, NotificationType } = await import('@capacitor/haptics');
      await Haptics.notification({ type: NotificationType.Warning });
    } catch {
      /* ignore */
    }
  })();
}
