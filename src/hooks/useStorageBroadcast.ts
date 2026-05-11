import { useEffect } from 'react';
import { STORAGE_KEY, useEventStore } from '@/store/eventStore';

/**
 * Keep the store in sync if another tab edits the same event (e.g. the operator
 * tab updates state while the /display tab is open).
 */
export function useStorageBroadcast() {
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key !== STORAGE_KEY || !e.newValue) return;
      try {
        const parsed = JSON.parse(e.newValue) as { state?: { event?: unknown } };
        const event = parsed.state?.event ?? null;
        useEventStore.setState({ event: event as never });
      } catch {
        // ignore
      }
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);
}
