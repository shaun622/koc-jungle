/**
 * NightlyStatsModal: fun end-of-night breakdowns (biggest margin, Centre
 * Court king, longest streak, sharpshooter, wooden spoon). Opened from the
 * podium toolbar so the operator can show them off regardless of which
 * screen / orientation the TV podium is on.
 */

import { useMemo } from 'react';
import { nightlyStats } from '@/store/selectors';
import type { EventState } from '@/types/domain';
import { Icons } from './Icons';
import { Portal } from './Portal';

export function NightlyStatsModal({
  event,
  onClose,
}: {
  event: EventState;
  onClose: () => void;
}) {
  const stats = useMemo(() => nightlyStats(event), [event]);

  return (
    <Portal>
      <div className="modal-backdrop" onClick={(e) => e.target === e.currentTarget && onClose()}>
        <div className="modal nightly-modal">
          <div className="app-menu-head">
            <span className="app-menu-title">NIGHTLY STATS</span>
            <button
              className="op-score-btn"
              onClick={onClose}
              aria-label="Close"
              style={{ background: 'transparent', border: 0 }}
            >
              <Icons.Close className="icon" />
            </button>
          </div>

          {stats.length === 0 ? (
            <p className="auth-sub">Play a few rounds to unlock the night's stats.</p>
          ) : (
            <div className="nightly-list">
              {stats.map((s) => (
                <div key={s.label} className="nightly-row">
                  <div className="nightly-label">{s.label}</div>
                  <div className="nightly-value">{s.value}</div>
                  {s.detail && <div className="nightly-detail">{s.detail}</div>}
                </div>
              ))}
            </div>
          )}

          <div className="modal-actions">
            <button className="btn primary" onClick={onClose}>
              Done
            </button>
          </div>
        </div>
      </div>
    </Portal>
  );
}
