import { useEffect, useState } from 'react';
import { Icons } from '@/components/Icons';
import { Portal } from '@/components/Portal';
import {
  copyRosterText,
  shareRosterText,
} from '@/utils/rosterShare';

export function RosterShareModal({
  title,
  text,
  onClose,
}: {
  title: string;
  text: string;
  onClose: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !busy) onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [busy, onClose]);

  const run = async (action: () => Promise<{ ok: boolean; copied?: boolean; error?: string }>) => {
    setBusy(true);
    setMessage(null);
    setError(null);
    try {
      const result = await action();
      if (!result.ok) setError(result.error ?? 'Could not share the roster.');
      else if (result.copied) setMessage('Roster copied. Paste it into WhatsApp.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Portal>
      <div className="modal-backdrop" onClick={() => !busy && onClose()}>
        <div className="modal roster-share-modal" onClick={(event) => event.stopPropagation()}>
          <div className="roster-share-heading">
            <div>
              <h2>Share roster</h2>
              <p>Preview the message, then use your device’s share menu or copy it.</p>
            </div>
            <button className="op-score-btn" type="button" disabled={busy} onClick={onClose} aria-label="Close">
              <Icons.Close className="icon" />
            </button>
          </div>

          <pre className="roster-share-preview">{text}</pre>

          {message && <div className="signup-message success">{message}</div>}
          {error && <div className="signup-message error">{error}</div>}

          <div className="roster-share-actions">
            <button className="btn primary" type="button" disabled={busy} onClick={() => void run(() => shareRosterText(title, text))}>
              {busy ? 'Sharing…' : 'Share…'}
            </button>
            <button className="btn" type="button" disabled={busy} onClick={() => void run(() => copyRosterText(text))}>
              Copy text
            </button>
          </div>
        </div>
      </div>
    </Portal>
  );
}
