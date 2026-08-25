import { useEffect, useRef } from 'react';
import { useEventStore } from '@/store/eventStore';
import { applyStorageBroadcast, markLocalEventMutation } from '@/store/cloudSync';
import type { EventState } from '@/types/domain';

const BROADCAST_KEY = 'koc-event-broadcast-v2';

interface Version {
  at: number;
  source: string;
}

interface EventBroadcast {
  version: Version;
  event: EventState | null;
}

function compareVersion(a: Version, b: Version): number {
  if (a.at !== b.at) return a.at - b.at;
  return a.source.localeCompare(b.source);
}

function readBroadcast(raw?: string | null): EventBroadcast | null {
  try {
    const value = raw ?? globalThis.localStorage?.getItem(BROADCAST_KEY);
    if (!value) return null;
    const parsed = JSON.parse(value) as Partial<EventBroadcast>;
    if (
      !parsed.version ||
      typeof parsed.version.at !== 'number' ||
      typeof parsed.version.source !== 'string' ||
      !Object.prototype.hasOwnProperty.call(parsed, 'event')
    ) return null;
    return parsed as EventBroadcast;
  } catch {
    return null;
  }
}

function newSourceId(): string {
  try {
    return globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`;
  } catch {
    return `${Date.now()}-${Math.random()}`;
  }
}

// One browser tab has one ordering/source identity even if a component is
// accidentally mounted twice. The shared apply guard prevents an incoming
// state from being re-broadcast by a sibling subscriber.
const TAB_SOURCE = newSourceId();
let lastSeenVersion: Version = { at: 0, source: '' };
let applyingIncoming = false;

/**
 * Keep operator and TV tabs in sync. Messages carry a deterministic version,
 * so a delayed older full-state snapshot can never undo a newer court/score.
 */
export function useStorageBroadcast(enabled = true) {
  const activated = useRef(false);
  const enabledOnFirstRender = useRef(enabled);

  useEffect(() => {
    if (!enabled) return;

    const applyIncoming = (message: EventBroadcast | null) => {
      if (!message || message.version.source === TAB_SOURCE) return;
      if (compareVersion(message.version, lastSeenVersion) <= 0) return;
      lastSeenVersion = message.version;
      applyingIncoming = true;
      try {
        applyStorageBroadcast(message.event);
      } finally {
        applyingIncoming = false;
      }
    };

    // Catch up after returning from a public link or a temporarily suspended
    // tab. On first mount the Zustand snapshot was hydrated from the same
    // storage already, so its version was used only as the baseline above.
    const latest = readBroadcast();
    if (!activated.current && enabledOnFirstRender.current) {
      activated.current = true;
      if (latest && compareVersion(latest.version, lastSeenVersion) > 0) {
        lastSeenVersion = latest.version;
      }
    } else {
      activated.current = true;
      applyIncoming(latest);
    }

    const unsubscribe = useEventStore.subscribe((state, previous) => {
      if (applyingIncoming || state.event === previous.event) return;
      // Trusted cloud applies already have their own Realtime origin. Do not
      // turn a scoped remote DELETE into a plain null broadcast that another
      // same-origin tab could mistake for an explicit delete-all.
      if (!markLocalEventMutation(state.event, previous.event)) return;
      const version: Version = {
        at: Math.max(Date.now(), lastSeenVersion.at + 1),
        source: TAB_SOURCE,
      };
      lastSeenVersion = version;
      const message: EventBroadcast = { version, event: state.event };
      try {
        globalThis.localStorage?.setItem(BROADCAST_KEY, JSON.stringify(message));
      } catch {
        // Local storage can be disabled; the active tab must keep working.
      }
    });

    const onStorage = (event: StorageEvent) => {
      if (event.key !== BROADCAST_KEY || !event.newValue) return;
      applyIncoming(readBroadcast(event.newValue));
    };
    window.addEventListener('storage', onStorage);

    return () => {
      unsubscribe();
      window.removeEventListener('storage', onStorage);
    };
  }, [enabled]);
}
