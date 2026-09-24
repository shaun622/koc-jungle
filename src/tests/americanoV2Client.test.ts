import { beforeEach, describe, expect, it } from 'vitest';
import {
  AMERICANO_V2_PENDING_KEY,
  clearPendingAmericanoRequest,
  compareRevisionTokens,
  readPendingAmericanoRequests,
  sealPendingAmericanoRequest,
} from '@/lib/americanoV2';

describe('Americano v2 client protocol helpers', () => {
  beforeEach(() => localStorage.clear());

  it('compares opaque bigint revision tokens without losing precision', () => {
    expect(compareRevisionTokens('90071992547409930', '90071992547409931')).toBe(-1);
    expect(compareRevisionTokens('90071992547409931', '90071992547409931')).toBe(0);
    expect(compareRevisionTokens('90071992547409932', '90071992547409931')).toBe(1);
  });

  it('seals an immutable payload and scopes pending requests by owner and event', () => {
    const mutable = { state: { name: 'Original' } };
    const first = sealPendingAmericanoRequest({
      ownerId: 'owner-a', eventId: 'event-a', baseRevision: '7', requestId: 'request-a',
      operation: 'start', payload: mutable,
    });
    sealPendingAmericanoRequest({
      ownerId: 'owner-a', eventId: 'event-b', baseRevision: '2', requestId: 'request-b',
      operation: 'publish', payload: { title: 'Other event' },
    });
    sealPendingAmericanoRequest({
      ownerId: 'owner-b', eventId: 'event-a', baseRevision: '1', requestId: 'request-c',
      operation: 'save', payload: { title: 'Other owner' },
    });

    mutable.state.name = 'Changed after sealing';
    expect((first.payload.state as { name: string }).name).toBe('Original');
    expect(readPendingAmericanoRequests()).toHaveLength(3);

    clearPendingAmericanoRequest('owner-a', 'event-a', 'request-a');
    expect(readPendingAmericanoRequests().map((row) => `${row.ownerId}:${row.eventId}`)).toEqual([
      'owner-a:event-b',
      'owner-b:event-a',
    ]);
  });

  it('replaces only the matching retry envelope and drops malformed storage', () => {
    sealPendingAmericanoRequest({
      ownerId: 'owner-a', eventId: 'event-a', baseRevision: '1', requestId: 'same-request',
      operation: 'save', payload: { value: 1 },
    });
    sealPendingAmericanoRequest({
      ownerId: 'owner-a', eventId: 'event-a', baseRevision: '1', requestId: 'same-request',
      operation: 'save', payload: { value: 2 },
    });
    expect(readPendingAmericanoRequests()).toHaveLength(1);
    expect(readPendingAmericanoRequests()[0].payload).toEqual({ value: 2 });

    localStorage.setItem(AMERICANO_V2_PENDING_KEY, '{not-json');
    expect(readPendingAmericanoRequests()).toEqual([]);
  });
});
