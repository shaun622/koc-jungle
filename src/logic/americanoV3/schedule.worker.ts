/// <reference lib="webworker" />

import { generateAmericanoScheduleV3, type GenerateAmericanoScheduleV3Input } from './schedule';

type Reply =
  | { ok: true; schedule: Awaited<ReturnType<typeof generateAmericanoScheduleV3>> }
  | { ok: false; error: { name: string; message: string; code?: string } };

self.onmessage = async (event: MessageEvent<GenerateAmericanoScheduleV3Input>) => {
  let reply: Reply;
  try {
    reply = { ok: true, schedule: await generateAmericanoScheduleV3(event.data) };
  } catch (error) {
    const value = error as Error & { code?: string };
    reply = { ok: false, error: { name: value.name, message: value.message, code: value.code } };
  }
  self.postMessage(reply);
};

export {};
