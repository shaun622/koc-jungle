import type { EventState } from '@/types/domain';

export const EXPORT_VERSION = 1;

export interface ExportPayload {
  version: number;
  exportedAt: number;
  event: EventState;
}

export function toExportJson(event: EventState): string {
  const payload: ExportPayload = {
    version: EXPORT_VERSION,
    exportedAt: Date.now(),
    event,
  };
  return JSON.stringify(payload, null, 2);
}

export function parseImportJson(text: string): EventState {
  const parsed = JSON.parse(text) as Partial<ExportPayload>;
  if (!parsed || typeof parsed !== 'object' || !parsed.event) {
    throw new Error('Invalid export file: missing event.');
  }
  if (typeof parsed.version !== 'number') {
    throw new Error('Invalid export file: missing version.');
  }
  return parsed.event;
}

export function downloadJsonFile(filename: string, contents: string): void {
  const blob = new Blob([contents], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
