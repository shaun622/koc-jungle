import {
  generateAmericanoSchedule,
  type GenerateAmericanoScheduleInput,
} from './schedule';
import { AmericanoScheduleError, type AmericanoScheduleErrorCode } from './validation';
import type { AmericanoScheduleV2 } from './types';

const WATCHDOG_MS = 2_000;

/**
 * Generate away from the UI thread in browsers. Tests and non-browser runtimes
 * use the same deterministic implementation directly.
 */
export function generateAmericanoScheduleWithWatchdog(
  input: GenerateAmericanoScheduleInput,
): Promise<AmericanoScheduleV2> {
  if (typeof Worker === 'undefined') return generateAmericanoSchedule(input);

  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./schedule.worker.ts', import.meta.url), { type: 'module' });
    const timeout = window.setTimeout(() => {
      worker.terminate();
      reject(new AmericanoScheduleError(
        'SCHEDULE_TIMEOUT',
        'Schedule generation took longer than two seconds. Your previous preview was kept.',
      ));
    }, WATCHDOG_MS);

    worker.onmessage = (event: MessageEvent<
      | { ok: true; schedule: AmericanoScheduleV2 }
      | { ok: false; error: { name: string; message: string; code?: string } }
    >) => {
      window.clearTimeout(timeout);
      worker.terminate();
      if (event.data.ok) {
        resolve(event.data.schedule);
        return;
      }
      reject(new AmericanoScheduleError(
        (event.data.error.code ?? 'INVALID_SCHEDULE') as AmericanoScheduleErrorCode,
        event.data.error.message,
      ));
    };
    worker.onerror = () => {
      window.clearTimeout(timeout);
      worker.terminate();
      reject(new AmericanoScheduleError(
        'INVALID_SCHEDULE',
        'The schedule worker failed. Your previous preview was kept.',
      ));
    };
    worker.postMessage(input);
  });
}
