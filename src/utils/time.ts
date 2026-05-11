export function formatMs(ms: number): string {
  const sign = ms < 0 ? '-' : '';
  const abs = Math.abs(ms);
  const totalSec = Math.floor(abs / 1000);
  const mm = Math.floor(totalSec / 60);
  const ss = totalSec % 60;
  return `${sign}${mm}:${ss.toString().padStart(2, '0')}`;
}

export function parseDurationInput(value: string): number | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const colon = trimmed.match(/^(\d+):(\d{1,2})$/);
  if (colon) {
    const mm = Number(colon[1]);
    const ss = Number(colon[2]);
    if (!Number.isFinite(mm) || !Number.isFinite(ss) || ss >= 60) return null;
    return (mm * 60 + ss) * 1000;
  }
  const num = Number(trimmed);
  if (Number.isFinite(num) && num >= 0) {
    return Math.round(num * 60 * 1000);
  }
  return null;
}
