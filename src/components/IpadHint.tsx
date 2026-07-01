/**
 * IpadHint: a one-time, dismissable banner on the Home screen telling new
 * users the app is designed for an iPad held in landscape (where the full
 * scoreboard, timer and standings all fit). Dismissal is remembered so it
 * never nags again. Distinct from RotateHint (the phone -> TV cast modal).
 */

import { useState } from 'react';
import { Icons } from './Icons';

const DISMISS_KEY = 'koc-ipad-hint-dismissed-v1';

export function IpadHint() {
  const [dismissed, setDismissed] = useState(() => {
    try {
      return localStorage.getItem(DISMISS_KEY) === '1';
    } catch {
      return false;
    }
  });

  if (dismissed) return null;

  const close = () => {
    try {
      localStorage.setItem(DISMISS_KEY, '1');
    } catch {
      /* ignore */
    }
    setDismissed(true);
  };

  return (
    <div className="ipad-hint" role="note">
      <Icons.Rotate className="icon ipad-hint-icon" />
      <span className="ipad-hint-text">
        <strong>Best on iPad, in landscape</strong> — the full scoreboard, timer
        and standings all fit on screen.
      </span>
      <button className="ipad-hint-close" onClick={close} aria-label="Dismiss">
        ×
      </button>
    </div>
  );
}
