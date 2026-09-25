import { generateAmericanoScheduleV3, type GenerateAmericanoScheduleV3Input } from './schedule';
import type { AmericanoScheduleV3 } from './types';
import { AmericanoScheduleError } from '@/logic/americanoV2/validation';

const WATCHDOG_MS = 2_000;

export function generateAmericanoScheduleV3WithWatchdog(input: GenerateAmericanoScheduleV3Input): Promise<AmericanoScheduleV3> {
  if (typeof Worker === 'undefined') return generateAmericanoScheduleV3(input);
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./schedule.worker.ts', import.meta.url), { type: 'module' });
    const timeout = window.setTimeout(() => {
      worker.terminate();
      reject(new AmericanoScheduleError('SCHEDULE_TIMEOUT', 'Schedule generation took longer than two seconds. Your previous preview was kept.'));
    }, WATCHDOG_MS);
    worker.onmessage = (event: MessageEvent<
      | { ok: true; schedule: AmericanoScheduleV3 }
      | { ok: false; error: { name: string; message: string; code?: string } }
    >) => {
      window.clearTimeout(timeout);
      worker.terminate();
      if (event.data.ok) resolve(event.data.schedule);
      else reject(new AmericanoScheduleError(
        (event.data.error.code ?? 'INVALID_SCHEDULE') as ConstructorParameters<typeof AmericanoScheduleError>[0],
        event.data.error.message,
      ));
    };
    worker.onerror = () => {
      window.clearTimeout(timeout);
      worker.terminate();
      reject(new AmericanoScheduleError('INVALID_SCHEDULE', 'The schedule worker failed. Your previous preview was kept.'));
    };
    worker.postMessage(input);
  });
}
