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
  const [updating, setUpdating] = useState(false);
  useEffect(() => {
    if (!offlineReady) return;
    const id = setTimeout(() => setAutoHide(true), 5000);
    return () => clearTimeout(id);
  }, [offlineReady]);

  function applyUpdate() {
    if (updating) return;
    setUpdating(true);

    // The current installed worker may predate clientsClaim, so keep an
    // explicit reload fallback as well as Workbox's controlling-event reload.
    // Event state is persisted before this prompt is shown.
    const reload = () => window.location.reload();
    window.setTimeout(reload, 2500);
    void updateServiceWorker()
      .then(() => window.setTimeout(reload, 350))
      .catch(reload);
  }

  if (needRefresh) {
    return (
      <div className="pwa-toast pwa-toast--update" role="status">
        <div className="pwa-toast-body">
          <strong>New version available.</strong>
          <span>Refresh to pick it up. Your event state stays.</span>
        </div>
        <button
          className="btn primary sm"
          disabled={updating}
          onClick={applyUpdate}
        >
          {updating ? 'Updating…' : 'Refresh'}
        </button>
        <button
          className="btn ghost sm"
          disabled={updating}
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
