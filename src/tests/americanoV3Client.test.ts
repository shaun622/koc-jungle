import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createAmericanoEventV3 } from '@/logic/americanoV3/runtime';
import { readPendingAmericanoRequests } from '@/lib/americanoV2';

const { rpcMock } = vi.hoisted(() => ({ rpcMock: vi.fn() }));
vi.mock('@/lib/supabase', () => ({ supabase: { rpc: rpcMock } }));

import { saveAmericanoEventV3 } from '@/lib/americanoV3';

function success(requestId: string, event = createAmericanoEventV3('Client fixture')) {
  const saved = { ...event, revision: '1' };
  return {
    status: 'applied',
    requestId,
    committedEventRevision: '1',
    snapshot: {
      event: { id: event.id, protocolVersion: 2, revision: '1', updatedAt: '2026-09-25T00:00:00.000Z', state: saved },
      signup: null,
    },
  };
}

describe('Americano v3 owner RPC client', () => {
  beforeEach(() => {
    localStorage.clear();
    rpcMock.mockReset();
  });

  it('seals an owner/event-scoped request and clears it after a confirmed reply', async () => {
    const event = createAmericanoEventV3('Client fixture');
    rpcMock.mockResolvedValue({ data: success('request-1', event), error: null });

    const result = await saveAmericanoEventV3(event, '0', 'request-1', 'owner-1');

    expect(result.status).toBe('applied');
    expect(rpcMock).toHaveBeenCalledWith('organizer_save_event_v3', expect.objectContaining({
      p_event_id: event.id,
      p_base_event_revision: '0',
      p_request_id: 'request-1',
      p_state: event,
    }));
    expect(readPendingAmericanoRequests()).toEqual([]);
  });

  it('retains and reuses the exact request after an ambiguous transport failure', async () => {
    const event = createAmericanoEventV3('Retry fixture');
    rpcMock.mockResolvedValueOnce({ data: null, error: { message: 'network timeout' } });
    rpcMock.mockImplementationOnce(async (_name: string, parameters: { p_request_id: string }) => ({
      data: success(parameters.p_request_id, event), error: null,
    }));

    await expect(saveAmericanoEventV3(event, '0', 'request-original', 'owner-1'))
      .rejects.toThrow(/exact request is kept/i);
    expect(readPendingAmericanoRequests()).toMatchObject([{
      ownerId: 'owner-1', eventId: event.id, baseRevision: '0', requestId: 'request-original',
      operation: 'organizer_save_event_v3', payload: { p_state: event },
    }]);

    await expect(saveAmericanoEventV3({ ...event, name: 'Changed while request pending' }, '0', 'request-new', 'owner-1'))
      .rejects.toThrow(/retry that exact action/i);
    expect(rpcMock).toHaveBeenCalledTimes(1);

    const replay = await saveAmericanoEventV3(event, '0', 'request-new', 'owner-1');
    expect(replay.status).toBe('applied');
    expect(rpcMock).toHaveBeenCalledTimes(2);
    expect(rpcMock.mock.calls[1][1]).toMatchObject({ p_request_id: 'request-original', p_state: event });
    expect(readPendingAmericanoRequests()).toEqual([]);
  });
});
