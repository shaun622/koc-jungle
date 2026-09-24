import { describe, expect, it } from 'vitest';
import { formatEventDateTime, zonedLocalToIso } from '@/lib/eventTime';

describe('event time zones', () => {
  it('converts an unambiguous Bali wall-clock time to an instant', () => {
    expect(zonedLocalToIso('2026-09-08T18:00', 'Asia/Makassar')).toBe('2026-09-08T10:00:00.000Z');
  });

  it('rejects a daylight-saving gap', () => {
    expect(() => zonedLocalToIso('2026-03-29T02:30', 'Europe/Paris')).toThrow(/does not exist/i);
  });

  it('rejects an ambiguous daylight-saving time', () => {
    expect(() => zonedLocalToIso('2026-10-25T02:30', 'Europe/Paris')).toThrow(/occurs twice/i);
    expect(zonedLocalToIso('2026-10-25T02:30', 'Europe/Paris', 'earlier')).toBe('2026-10-25T00:30:00.000Z');
    expect(zonedLocalToIso('2026-10-25T02:30', 'Europe/Paris', 'later')).toBe('2026-10-25T01:30:00.000Z');
    expect(zonedLocalToIso('2026-11-01T01:30', 'America/New_York', 'earlier')).toBe('2026-11-01T05:30:00.000Z');
    expect(zonedLocalToIso('2026-11-01T01:30', 'America/New_York', 'later')).toBe('2026-11-01T06:30:00.000Z');
  });

  it('formats using the event zone instead of the viewer zone', () => {
    expect(formatEventDateTime('2026-09-08T10:00:00.000Z', 'Asia/Makassar')).toMatch(/6:00 pm/i);
  });
});
