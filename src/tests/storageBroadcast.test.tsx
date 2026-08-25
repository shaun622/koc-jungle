import { act, cleanup, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { useStorageBroadcast } from '@/hooks/useStorageBroadcast';
import { useEventStore } from '@/store/eventStore';
import type { EventState } from '@/types/domain';

const BROADCAST_KEY = 'koc-event-broadcast-v2';

function Harness() {
  useStorageBroadcast();
  return null;
}

function DoubleHarness() {
  return (
    <>
      <Harness />
      <Harness />
    </>
  );
}

function eventFixture(name: string, courtCount: number): EventState {
  useEventStore.getState().createEvent(name, 'koc');
  const event = structuredClone(useEventStore.getState().event!);
  event.courts = event.courts.slice(0, courtCount).map((court, index) => ({
    ...court,
    position: index + 1,
  }));
  return event;
}

function send(message: unknown): void {
  window.dispatchEvent(new StorageEvent('storage', {
    key: BROADCAST_KEY,
    newValue: JSON.stringify(message),
  }));
}

describe('cross-tab event ordering', () => {
  beforeEach(() => {
    localStorage.clear();
    useEventStore.setState({ event: null, hydrated: true, lastError: null });
  });

  afterEach(() => cleanup());

  it('ignores delayed snapshots and accepts every newer rapid update', () => {
    const original = eventFixture('Live event', 3);
    useEventStore.getState().loadEvent(original);
    // Deliberately mount two listeners: an incoming message must still never
    // be mistaken for a new local edit and echoed back.
    render(<DoubleHarness />);

    act(() => useEventStore.getState().addCourt());
    expect(useEventStore.getState().event?.courts).toHaveLength(4);

    const ownMessage = JSON.parse(localStorage.getItem(BROADCAST_KEY)!) as {
      version: { at: number; source: string };
    };

    act(() => send({
      version: { at: ownMessage.version.at - 1, source: 'other-tab' },
      event: original,
    }));
    expect(useEventStore.getState().event?.courts).toHaveLength(4);

    const fiveCourts = structuredClone(useEventStore.getState().event!);
    fiveCourts.courts.push({
      ...fiveCourts.courts[0],
      id: 'court-five',
      position: 5,
      name: 'Court 5',
    });
    const sixCourts = structuredClone(fiveCourts);
    sixCourts.courts.push({
      ...sixCourts.courts[0],
      id: 'court-six',
      position: 6,
      name: 'Court 6',
    });

    act(() => {
      send({
        version: { at: ownMessage.version.at + 1, source: 'other-tab' },
        event: fiveCourts,
      });
      send({
        version: { at: ownMessage.version.at + 2, source: 'other-tab' },
        event: sixCourts,
      });
    });

    expect(useEventStore.getState().event?.courts).toHaveLength(6);
    // Incoming changes are not rebroadcast, avoiding a tab-to-tab echo loop.
    expect(JSON.parse(localStorage.getItem(BROADCAST_KEY)!).version).toEqual(
      ownMessage.version,
    );
  });
});
