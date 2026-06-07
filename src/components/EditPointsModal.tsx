import { useEffect, useMemo, useState } from 'react';
import { useEventStore } from '@/store/eventStore';
import { leaderboard, teamLabelShort } from '@/store/selectors';
import { Icons } from './Icons';

/**
 * Post-event manual points correction. Reachable from the podium toolbar
 * once the event is complete — in case a score was entered wrong somewhere.
 *
 * Each team's typed total is stored as `team.pointsOverride`; `computeStandings`
 * applies it and every standings view (podium, rail, /leaderboard) re-sorts.
 * The row order here is frozen on open so rows don't jump around mid-edit.
 */
export function EditPointsModal({ onClose }: { onClose: () => void }) {
  const event = useEventStore((s) => s.event);

  // Captured once at mount (the modal is conditionally mounted, so a fresh
  // open re-runs this) — keeps rows stable while the podium behind re-sorts.
  const orderedTeamIds = useMemo(
    () => {
      if (!event) return [];
      return leaderboard(event)
        .filter((r) => event.teams.find((t) => t.id === r.teamId)?.active)
        .map((r) => r.teamId);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  if (!event) return null;

  const standings = leaderboard(event);
  const totalFor = (id: string) =>
    standings.find((r) => r.teamId === id)?.total ?? 0;
  const teamFor = (id: string) => event.teams.find((t) => t.id === id);

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div
        className="modal"
        onClick={(e) => e.stopPropagation()}
        style={{ maxWidth: '28rem' }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
          <div>
            <h2>Edit points</h2>
            <p style={{ fontSize: 13, color: 'var(--text-1)', margin: '4px 0 0' }}>
              Correct any team's total and the podium and standings re-sort
              automatically.
            </p>
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

        <div className="edit-points-list">
          {orderedTeamIds.map((id) => {
            const team = teamFor(id);
            return (
              <div key={id} className="edit-points-row">
                <span className="edit-points-name">
                  {team ? teamLabelShort(team) : id}
                </span>
                <PointsInput teamId={id} total={totalFor(id)} />
              </div>
            );
          })}
          {orderedTeamIds.length === 0 && (
            <div style={{ color: 'var(--text-2)', fontSize: 13 }}>No teams.</div>
          )}
        </div>

        <div className="modal-actions">
          <button className="btn primary" onClick={onClose}>
            Done
          </button>
        </div>
      </div>
    </div>
  );
}

function PointsInput({ teamId, total }: { teamId: string; total: number }) {
  const setPointsOverride = useEventStore((s) => s.setPointsOverride);
  const [text, setText] = useState(String(total));
  const [focused, setFocused] = useState(false);
  // Re-sync from the live total when not actively editing.
  useEffect(() => {
    if (!focused) setText(String(total));
  }, [total, focused]);
  const commit = () => {
    setFocused(false);
    const n = parseInt(text, 10);
    if (!Number.isNaN(n) && n >= 0) {
      setPointsOverride(teamId, n);
      setText(String(n));
    } else {
      setText(String(total));
    }
  };
  return (
    <input
      className="setup-input edit-points-input"
      type="text"
      inputMode="numeric"
      pattern="[0-9]*"
      maxLength={3}
      value={text}
      onChange={(e) => setText(e.target.value.replace(/[^0-9]/g, ''))}
      onFocus={(e) => {
        setFocused(true);
        e.currentTarget.select();
      }}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
      }}
    />
  );
}
