/**
 * RotateHint: a one-time, dismissable nudge shown on the first round
 * (phone portrait) letting the operator know they can rotate the phone
 * to get a full-screen scoreboard for casting to a TV. Dismissal is
 * remembered so it never nags again.
 */

import { useState } from 'react';
import { Portal } from './Portal';
import { Icons } from './Icons';

const DISMISS_KEY = 'koc-rotate-hint-dismissed-v1';

export function RotateHint() {
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
    <Portal>
      <div className="rotate-hint-backdrop" onClick={(e) => e.target === e.currentTarget && close()}>
        <div className="rotate-hint" role="dialog" aria-label="Mirror to a TV">
          <div className="rotate-hint-icon">
            <Icons.Rotate className="icon" />
          </div>
          <div className="rotate-hint-title">Show it on the big screen</div>
          <p className="rotate-hint-body">
            Turn your phone sideways for a full-screen scoreboard, ideal for
            AirPlay or an HDMI cable to a TV. Turn back to portrait any time to
            keep scoring.
          </p>
          <button className="btn primary" onClick={close}>
            Got it
          </button>
        </div>
      </div>
    </Portal>
  );
}
