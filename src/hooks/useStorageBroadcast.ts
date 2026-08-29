import { useEffect } from 'react';
import { useEventCatalogStore } from '@/store/eventCatalog';
import { isApplyingCatalogEvent, useEventStore } from '@/store/eventStore';
import {
  applyStorageBroadcast,
  applyStorageEventDeletion,
  applyStorageEventSelection,
  isApplyingExternalEvent,
  markLocalEventDeleted,
  markLocalEventMutation,
} from '@/store/cloudSync';
import type { EventState } from '@/types/domain';

export const EVENT_BROADCAST_KEY = 'koc-event-broadcast-v3';
const LEGACY_BROADCAST_KEY = 'koc-event-broadcast-v2';

interface Version {
  at: number;
  source: string;
}

type EventBroadcast =
  | {
      schema: 3;
      operation: 'upsert';
      eventId: string;
      event: EventState;
      version: Version;
    }
  | {
      schema: 3;
      operation: 'delete' | 'select';
      eventId: string;
      version: Version;
    };

type PublishMessage =
  | { operation: 'upsert'; eventId: string; event: EventState }
  | { operation: 'delete' | 'select'; eventId: string };

interface LegacyBroadcast {
  version: Version;
  event: EventState | null;
}

function compareVersion(a: Version, b: Version): number {
  if (a.at !== b.at) return a.at - b.at;
  return a.source.localeCompare(b.source);
}

function newSourceId(): string {
  try {
    return globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`;
  } catch {
    return `${Date.now()}-${Math.random()}`;
  }
}

function parseVersion(value: unknown): Version | null {
  if (!value || typeof value !== 'object') return null;
  const candidate = value as Partial<Version>;
  return typeof candidate.at === 'number' && typeof candidate.source === 'string'
    ? { at: candidate.at, source: candidate.source }
    : null;
}

function readMessage(raw: string | null): EventBroadcast | LegacyBroadcast | null {
  if (!raw) return null;
  try {
    const value = JSON.parse(raw) as Record<string, unknown>;
    const version = parseVersion(value.version);
    if (!version) return null;
    if (value.schema === 3) {
      if (
        (value.operation !== 'upsert'
          && value.operation !== 'delete'
          && value.operation !== 'select')
        || typeof value.eventId !== 'string'
      ) return null;
      if (value.operation === 'upsert') {
        if (!value.event || typeof value.event !== 'object') return null;
        return {
          schema: 3,
          operation: 'upsert',
          eventId: value.eventId,
          event: value.event as EventState,
          version,
        };
      }
      return {
        schema: 3,
        operation: value.operation,
        eventId: value.eventId,
        version,
      };
    }
    if (!Object.prototype.hasOwnProperty.call(value, 'event')) return null;
    return { version, event: (value.event as EventState | null) ?? null };
  } catch {
    return null;
  }
}

function orderingKey(message: EventBroadcast | LegacyBroadcast): string {
  if ('schema' in message) {
    return message.operation === 'select' ? '$selection' : message.eventId;
  }
  return message.event?.id ?? '$legacy-null';
}

function inferredPinnedEventId(): string | null {
  try {
    const match = globalThis.location?.hash.match(/^#\/events\/([^/?#]+)\/display(?:[/?#]|$)/i);
    return match ? decodeURIComponent(match[1]) : null;
  } catch {
    return null;
  }
}

// One browser tab has one source identity and one event-scoped ordering map,
// even if React mounts the hook twice. Event A can never suppress a newer Event
// B message merely because their wall-clock timestamps cross.
const TAB_SOURCE = newSourceId();
const lastSeenByKey = new Map<string, Version>();
const lastPublishedFingerprints = new Map<string, string>();
const suppressedDeletes = new Set<string>();
let suppressedSelection: string | null = null;
let lastPublishedSelection: string | null = null;

function nextVersion(key: string): Version {
  const previous = lastSeenByKey.get(key);
  const version = {
    at: Math.max(Date.now(), (previous?.at ?? 0) + 1),
    source: TAB_SOURCE,
  };
  lastSeenByKey.set(key, version);
  return version;
}

function publish(message: PublishMessage): void {
  const key = message.operation === 'select' ? '$selection' : message.eventId;
  const value = {
    ...message,
    schema: 3 as const,
    version: nextVersion(key),
  } as EventBroadcast;
  try {
    globalThis.localStorage?.setItem(EVENT_BROADCAST_KEY, JSON.stringify(value));
  } catch {
    // Local storage can be disabled; the active tab must keep working.
  }
}

function fingerprint(event: EventState): string {
  try {
    return JSON.stringify(event);
  } catch {
    return `${event.id}:${event.createdAt}`;
  }
}

/**
 * Keep operator and TV tabs in sync without collapsing the event catalog.
 * Event-scoped routes are pinned by App via their URL id, so another tab can
 * select a different competition without replacing this tab's active facade.
 */
export function useStorageBroadcast(
  enabled = true,
  pinnedEventId: string | null = null,
): void {
  useEffect(() => {
    if (!enabled) return;
    const pinnedId = pinnedEventId ?? inferredPinnedEventId();

    const applyIncoming = (message: EventBroadcast | LegacyBroadcast | null) => {
      if (!message || message.version.source === TAB_SOURCE) return;
      const key = orderingKey(message);
      const previousVersion = lastSeenByKey.get(key);
      if (previousVersion && compareVersion(message.version, previousVersion) <= 0) return;
      lastSeenByKey.set(key, message.version);

      if (!('schema' in message)) {
        applyStorageBroadcast(message.event, pinnedId);
        return;
      }
      if (message.operation === 'upsert') {
        applyStorageBroadcast(message.event, pinnedId);
        return;
      }
      if (message.operation === 'delete') {
        suppressedDeletes.add(message.eventId);
        applyStorageEventDeletion(message.eventId);
        return;
      }
      if (!pinnedId || pinnedId === message.eventId) {
        suppressedSelection = message.eventId;
      }
      applyStorageEventSelection(message.eventId, pinnedId);
    };

    // Catch up after a suspended tab. The message is event-scoped, so applying
    // it cannot replace or clear unrelated catalog records.
    applyIncoming(readMessage(globalThis.localStorage?.getItem(EVENT_BROADCAST_KEY) ?? null));

    const unsubscribeEvent = useEventStore.subscribe((state, previous) => {
      if (state.event === previous.event) return;
      if (isApplyingCatalogEvent()) return;
      if (state.event) {
        const eventFingerprint = fingerprint(state.event);
        if (lastPublishedFingerprints.get(state.event.id) === eventFingerprint) return;
        if (!markLocalEventMutation(state.event, previous.event)) return;
        lastPublishedFingerprints.set(state.event.id, eventFingerprint);
        publish({
          operation: 'upsert',
          eventId: state.event.id,
          event: state.event,
        });
        return;
      }
      if (!previous.event) return;
      if (!markLocalEventMutation(null, previous.event)) return;
      lastPublishedFingerprints.delete(previous.event.id);
      publish({ operation: 'delete', eventId: previous.event.id });
    });

    const unsubscribeCatalog = useEventCatalogStore.subscribe((state, previous) => {
      const currentIds = new Set(state.events.map((event) => event.id));
      for (const removed of previous.events) {
        if (currentIds.has(removed.id)) continue;
        if (suppressedDeletes.delete(removed.id)) continue;
        if (isApplyingExternalEvent(removed.id)) continue;
        markLocalEventDeleted(removed.id);
        lastPublishedFingerprints.delete(removed.id);
        publish({ operation: 'delete', eventId: removed.id });
      }

      if (state.activeEventId === previous.activeEventId || !state.activeEventId) return;
      if (suppressedSelection === state.activeEventId) {
        suppressedSelection = null;
        return;
      }
      if (lastPublishedSelection === state.activeEventId) return;
      lastPublishedSelection = state.activeEventId;
      publish({ operation: 'select', eventId: state.activeEventId });
    });

    const onStorage = (event: StorageEvent) => {
      if (event.key === EVENT_BROADCAST_KEY) {
        applyIncoming(readMessage(event.newValue));
        return;
      }
      if (event.key === LEGACY_BROADCAST_KEY) {
        applyIncoming(readMessage(event.newValue));
      }
    };
    window.addEventListener('storage', onStorage);

    return () => {
      unsubscribeEvent();
      unsubscribeCatalog();
      window.removeEventListener('storage', onStorage);
    };
  }, [enabled, pinnedEventId]);
}

/** Test-only reset for module-scoped ordering/deduplication state. */
export function resetStorageBroadcastStateForTests(): void {
  lastSeenByKey.clear();
  lastPublishedFingerprints.clear();
  suppressedDeletes.clear();
  suppressedSelection = null;
  lastPublishedSelection = null;
}
