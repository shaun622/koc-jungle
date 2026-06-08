/**
 * FormatRulesModal: popover showing the rules for one tournament format.
 * Triggered from the 'Show rules' link on each landing-card mode button
 * and from the Help screen.
 */

import { FORMAT_RULES } from '@/content/formatRules';
import type { TournamentFormatId } from '@/types/domain';
import { Icons } from './Icons';
import { Portal } from './Portal';

export function FormatRulesModal({
  formatId,
  onClose,
}: {
  formatId: TournamentFormatId;
  onClose: () => void;
}) {
  const guide = FORMAT_RULES[formatId];
  if (!guide) return null;

  return (
    <Portal>
    <div
      className="modal-backdrop"
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="modal format-rules-modal">
        <div className="format-rules-head">
          <div>
            <h2 className="format-rules-title">{guide.name.toUpperCase()}</h2>
            <p className="format-rules-tagline">{guide.tagline}</p>
          </div>
          <button
            className="op-score-btn"
            onClick={onClose}
            aria-label="Close"
            style={{ background: 'transparent', border: 0 }}
          >
            <Icons.Close className="icon" />
          </button>
        </div>

        <div className="format-rules-section">
          <div className="format-rules-section-label">Best for</div>
          <p>{guide.bestFor}</p>
        </div>

        <div className="format-rules-section">
          <div className="format-rules-section-label">How it works</div>
          <ol className="format-rules-list">
            {guide.rules.map((r, i) => (
              <li key={i}>{r}</li>
            ))}
          </ol>
        </div>

        <div className="format-rules-section">
          <div className="format-rules-section-label">Scoring</div>
          <p>{guide.scoring}</p>
        </div>

        <div className="modal-actions">
          <button className="btn primary" onClick={onClose}>
            Got it
          </button>
        </div>
      </div>
    </div>
    </Portal>
  );
}
