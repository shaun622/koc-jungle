/**
 * ClubBrandingModal: let a club set its own name + logo for the top-left
 * brand area. Logo is fit (contain) into a 256px PNG and stored locally.
 */

import { useState } from 'react';
import { useClubBrandingStore } from '@/store/clubBranding';
import { fitImageFileToLogo } from '@/utils/avatar';
import { Icons } from './Icons';
import { Portal } from './Portal';

export function ClubBrandingModal({ onClose }: { onClose: () => void }) {
  const { name, logoDataUrl, setName, setLogo, clear } = useClubBrandingStore();
  const [draftName, setDraftName] = useState(name);
  const [error, setError] = useState<string | null>(null);

  function save() {
    setName(draftName.trim());
    onClose();
  }

  return (
    <Portal>
    <div className="modal-backdrop" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal club-modal">
        <div className="app-menu-head">
          <span className="app-menu-title">CLUB BRANDING</span>
          <button
            className="op-score-btn"
            onClick={onClose}
            aria-label="Close"
            style={{ background: 'transparent', border: 0 }}
          >
            <Icons.Close className="icon" />
          </button>
        </div>

        <p className="auth-sub">
          Show your club's name and logo in the top-left instead of the app
          branding. Leave blank to use the defaults.
        </p>

        <div className="club-logo-row">
          <div className="club-logo-preview">
            {logoDataUrl ? (
              <img src={logoDataUrl} alt="Club logo" />
            ) : (
              <span className="club-logo-empty">No logo</span>
            )}
          </div>
          <div className="club-logo-actions">
            <label className="btn sm" style={{ cursor: 'pointer' }}>
              {logoDataUrl ? 'Change logo' : 'Upload logo'}
              <input
                type="file"
                accept="image/*"
                style={{ display: 'none' }}
                onChange={async (e) => {
                  const file = e.target.files?.[0];
                  if (!file) return;
                  try {
                    setLogo(await fitImageFileToLogo(file));
                    setError(null);
                  } catch (err) {
                    setError(err instanceof Error ? err.message : 'Could not load image.');
                  }
                  e.target.value = '';
                }}
              />
            </label>
            {logoDataUrl && (
              <button className="btn sm ghost" onClick={() => setLogo(null)}>
                Remove logo
              </button>
            )}
          </div>
        </div>

        <div className="setup-field" style={{ marginTop: 4 }}>
          <label>Club name</label>
          <input
            className="setup-input"
            value={draftName}
            maxLength={32}
            placeholder="e.g. High Court Padel"
            onChange={(e) => setDraftName(e.target.value)}
          />
        </div>

        {error && <div style={{ color: 'var(--red)', fontSize: 12, marginTop: 6 }}>{error}</div>}

        <div className="modal-actions">
          <button
            className="btn"
            onClick={() => {
              clear();
              setDraftName('');
              onClose();
            }}
          >
            Reset to default
          </button>
          <button className="btn primary" onClick={save}>
            Save
          </button>
        </div>
      </div>
    </div>
    </Portal>
  );
}
