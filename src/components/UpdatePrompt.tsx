import { useEffect, useState } from 'react';
// eslint-disable-next-line import/no-unresolved
import { useRegisterSW } from 'virtual:pwa-register/react';

/**
 * Listens for a fresh service-worker version and prompts the operator to
 * refresh. Sits as a small floating toast at the bottom-right.
 */
export function UpdatePrompt() {
  const {
    needRefresh: [needRefresh, setNeedRefresh],
    offlineReady: [offlineReady, setOfflineReady],
    updateServiceWorker,
  } = useRegisterSW({
    onRegisteredSW(swUrl) {
      // eslint-disable-next-line no-console
      console.log('[pwa] service worker registered:', swUrl);
    },
    onRegisterError(err) {
      // eslint-disable-next-line no-console
      console.warn('[pwa] service worker registration error', err);
    },
  });

  // Auto-dismiss the offline-ready toast after a short delay
  const [autoHide, setAutoHide] = useState(false);
  useEffect(() => {
    if (!offlineReady) return;
    const id = setTimeout(() => setAutoHide(true), 5000);
    return () => clearTimeout(id);
  }, [offlineReady]);

  if (needRefresh) {
    return (
      <div className="pwa-toast pwa-toast--update" role="status">
        <div className="pwa-toast-body">
          <strong>New version available.</strong>
          <span>Refresh to pick it up — your event state stays.</span>
        </div>
        <button
          className="btn primary sm"
          onClick={() => updateServiceWorker(true)}
        >
          Refresh
        </button>
        <button
          className="btn ghost sm"
          onClick={() => setNeedRefresh(false)}
        >
          Later
        </button>
      </div>
    );
  }

  if (offlineReady && !autoHide) {
    return (
      <div className="pwa-toast pwa-toast--offline" role="status">
        <div className="pwa-toast-body">
          <strong>Offline-ready.</strong>
          <span>The app will keep running even without WiFi.</span>
        </div>
        <button className="btn ghost sm" onClick={() => setOfflineReady(false)}>
          Dismiss
        </button>
      </div>
    );
  }

  return null;
}
