function localMinuteParts(iso: string, timeZone: string): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(new Date(iso));
  const value = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${value.year}-${value.month}-${value.day}T${value.hour}:${value.minute}`;
}

export function browserTimeZone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
}

export function supportedTimeZones(): string[] {
  const intl = Intl as typeof Intl & { supportedValuesOf?: (key: 'timeZone') => string[] };
  return Array.from(new Set([browserTimeZone(), 'UTC', ...(intl.supportedValuesOf?.('timeZone') ?? [])]));
}

export type ZonedTimeOccurrence = 'earlier' | 'later';

export function zonedLocalCandidates(localValue: string, timeZone: string): string[] {
  if (!localValue) return [];
  const match = localValue.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/);
  if (!match) throw new Error('Choose a valid date and time.');
  const [, year, month, day, hour, minute] = match;
  const target = `${year}-${month}-${day}T${hour}:${minute}`;
  const wallClockUtc = Date.UTC(+year, +month - 1, +day, +hour, +minute);
  const candidates = new Set<string>();
  for (let offsetMinutes = -14 * 60; offsetMinutes <= 14 * 60; offsetMinutes += 15) {
    const iso = new Date(wallClockUtc - offsetMinutes * 60_000).toISOString();
    if (localMinuteParts(iso, timeZone) === target) candidates.add(iso);
  }
  if (candidates.size === 0) throw new Error('That local time does not exist in the selected time zone. Choose another time.');
  return [...candidates].sort();
}

export function zonedLocalToIso(localValue: string, timeZone: string, occurrence?: ZonedTimeOccurrence): string | null {
  if (!localValue) return null;
  const candidates = zonedLocalCandidates(localValue, timeZone);
  if (candidates.length > 1 && !occurrence) throw new Error('That local time occurs twice in the selected time zone. Choose the earlier or later occurrence.');
  return candidates[occurrence === 'later' ? candidates.length - 1 : 0];
}

export function formatEventDateTime(iso: string | null, timeZone?: string | null): string {
  if (!iso) return 'Time to be confirmed';
  return new Date(iso).toLocaleString(undefined, {
    ...(timeZone ? { timeZone } : {}), weekday: 'long', day: 'numeric', month: 'long',
    hour: 'numeric', minute: '2-digit', timeZoneName: timeZone ? 'short' : undefined,
  });
}

export function isoToZonedLocalInput(iso: string | null, timeZone?: string | null): string {
  if (!iso) return '';
  if (!timeZone) {
    const date = new Date(iso);
    return new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
  }
  return localMinuteParts(iso, timeZone);
}
