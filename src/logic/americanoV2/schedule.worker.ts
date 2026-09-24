/// <reference lib="webworker" />

import { generateAmericanoSchedule, type GenerateAmericanoScheduleInput } from './schedule';

type WorkerReply =
  | { ok: true; schedule: Awaited<ReturnType<typeof generateAmericanoSchedule>> }
  | { ok: false; error: { name: string; message: string; code?: string } };

self.onmessage = async (event: MessageEvent<GenerateAmericanoScheduleInput>) => {
  let reply: WorkerReply;
  try {
    reply = { ok: true, schedule: await generateAmericanoSchedule(event.data) };
  } catch (error) {
    const value = error as Error & { code?: string };
    reply = {
      ok: false,
      error: { name: value.name, message: value.message, code: value.code },
    };
  }
  self.postMessage(reply);
};

export {};
