import { useEffect, useRef, useState } from 'react';
import { useEventStore } from '@/store/eventStore';
import { teamLabelShort } from '@/store/selectors';
import { Icons } from './Icons';

export interface TieGroup {
  /** Qualifier score shared by all teams in the group. */
  score: number;
  /** Team IDs in their current seeding order (top-down). */
  teamIds: string[];
  /** First seeding index this group occupies. */
  rankMin: number;
  /** Last seeding index this group occupies (inclusive). */
  rankMax: number;
  /** Slots above the highest court boundary this group spans — sensible default for "winners". */
  winnersDefault: number;
}

interface Props {
  open: boolean;
  group: TieGroup | null;
  onClose: () => void;
  onApply: (newOrderInRange: string[], rankMin: number) => void;
}

type Phase = 'idle' | 'rolling' | 'result';

const ROLL_DURATION_MS = 2400; // total slot-machine roll length
const STAGGER_MS = 220; // delay between each reel locking in
const TICK_MS = 60; // how fast the names cycle while rolling

function shuffle<T>(arr: readonly T[]): T[] {
  const out = arr.slice();
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/**
 * Slot-machine modal for randomly resolving cross-boundary tie groups.
 *
 * The bucket is fixed to the teams in `group` (the operator can drag teams
 * out of the group before opening the modal if they want a different set).
 * After rolling, "winners" land in the top of the tied range, "losers"
 * at the bottom; the parent applies the new order via `onApply`.
 */
export function RandomiseTieModal({ open, group, onClose, onApply }: Props) {
  const event = useEventStore((s) => s.event);

  // Names currently displayed in each reel slot (top-down).
  const [reels, setReels] = useState<string[]>([]);
  // Which reels have stopped rolling and locked to their final value.
  const stoppedRef = useRef<boolean[]>([]);
  const finalRef = useRef<string[]>([]);
  const tickTimerRef = useRef<number | null>(null);
  const stopTimersRef = useRef<number[]>([]);
  const endTimerRef = useRef<number | null>(null);

  const [winnersCount, setWinnersCount] = useState(1);
  const [phase, setPhase] = useState<Phase>('idle');

  // Reset state whenever a new group is opened.
  useEffect(() => {
    if (!group) return;
    setWinnersCount(group.winnersDefault);
    setReels(group.teamIds.slice());
    setPhase('idle');
    stoppedRef.current = group.teamIds.map(() => false);
    finalRef.current = group.teamIds.slice();
  }, [group]);

  // Always cancel timers on close / unmount so the modal doesn't keep
  // running in the background.
  useEffect(() => {
    return () => cancelTimers();
  }, []);

  function cancelTimers() {
    if (tickTimerRef.current !== null) {
      window.clearInterval(tickTimerRef.current);
      tickTimerRef.current = null;
    }
    for (const t of stopTimersRef.current) window.clearTimeout(t);
    stopTimersRef.current = [];
    if (endTimerRef.current !== null) {
      window.clearTimeout(endTimerRef.current);
      endTimerRef.current = null;
    }
  }

  if (!open || !group || !event) return null;

  const teams = group.teamIds;
  const teamLabel = (id: string) => {
    const t = event.teams.find((tt) => tt.id === id);
    return t ? teamLabelShort(t) : id;
  };

  const startRoll = () => {
    cancelTimers();
    const final = shuffle(teams);
    finalRef.current = final;
    stoppedRef.current = teams.map(() => false);
    setReels(teams.map(() => teams[Math.floor(Math.random() * teams.length)]));
    setPhase('rolling');

    // Cycle every reel rapidly until it's locked.
    tickTimerRef.current = window.setInterval(() => {
      setReels((current) =>
        current.map((_, i) =>
          stoppedRef.current[i]
            ? finalRef.current[i]
            : teams[Math.floor(Math.random() * teams.length)],
        ),
      );
    }, TICK_MS);

    // Stop reels one by one, left-to-right (top-down here).
    stopTimersRef.current = teams.map((_, i) =>
      window.setTimeout(
        () => {
          stoppedRef.current[i] = true;
          setReels((current) => {
            const next = current.slice();
            next[i] = finalRef.current[i];
            return next;
          });
        },
        ROLL_DURATION_MS + i * STAGGER_MS,
      ),
    );

    // Final cleanup once every reel has stopped.
    const totalMs = ROLL_DURATION_MS + teams.length * STAGGER_MS + 80;
    endTimerRef.current = window.setTimeout(() => {
      if (tickTimerRef.current !== null) {
        window.clearInterval(tickTimerRef.current);
        tickTimerRef.current = null;
      }
      setReels(finalRef.current.slice());
      setPhase('result');
    }, totalMs);
  };

  const apply = () => {
    if (phase !== 'result') return;
    onApply(finalRef.current.slice(), group.rankMin);
    onClose();
  };

  const losersCount = teams.length - winnersCount;
  const canDecrement = winnersCount > 1;
  const canIncrement = winnersCount < teams.length - 1;

  return (
    <div className="modal-backdrop" onClick={phase === 'rolling' ? undefined : onClose}>
      <div
        className="modal randomise-modal"
        onClick={(e) => e.stopPropagation()}
        style={{ maxWidth: '28rem' }}
      >
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'flex-start',
          }}
        >
          <div>
            <h2>Randomise tied scores</h2>
            <div className="randomise-subtitle">
              Q {group.score} · {teams.length} teams
            </div>
          </div>
          <button
            className="op-score-btn"
            onClick={onClose}
            aria-label="Close"
            disabled={phase === 'rolling'}
            style={{ background: 'transparent', border: 0 }}
          >
            <Icons.Close className="icon" />
          </button>
        </div>

        <ul className="randomise-reels">
          {reels.map((teamId, idx) => {
            const isStopped = phase === 'rolling' ? stoppedRef.current[idx] : true;
            const isWinner = phase === 'result' && idx < winnersCount;
            const isLoser = phase === 'result' && idx >= winnersCount;
            const showBadge = phase === 'result';
            return (
              <li
                key={idx}
                className={
                  'randomise-reel ' +
                  (phase === 'rolling' && !isStopped ? 'rolling ' : '') +
                  (isWinner ? 'winner ' : '') +
                  (isLoser ? 'loser ' : '')
                }
              >
                <span className="randomise-reel-rank">
                  #{group.rankMin + idx + 1}
                </span>
                <span className="randomise-reel-name">{teamLabel(teamId)}</span>
                {showBadge && (
                  <span className={'randomise-reel-badge ' + (isWinner ? 'winner' : 'loser')}>
                    {isWinner ? 'WINNER' : 'loser'}
                  </span>
                )}
              </li>
            );
          })}
        </ul>

        {phase === 'idle' && (
          <div className="randomise-stepper-row">
            <div className="randomise-stepper-label">
              <span>Winners</span>
              <span className="randomise-stepper-hint">
                Top N take the higher court(s). {losersCount} loser
                {losersCount === 1 ? '' : 's'}.
              </span>
            </div>
            <div className="randomise-stepper">
              <button
                type="button"
                className="op-score-btn"
                onClick={() => canDecrement && setWinnersCount((n) => n - 1)}
                disabled={!canDecrement}
                aria-label="Fewer winners"
              >
                <Icons.Minus className="icon" />
              </button>
              <span className="randomise-stepper-value">{winnersCount}</span>
              <button
                type="button"
                className="op-score-btn"
                onClick={() => canIncrement && setWinnersCount((n) => n + 1)}
                disabled={!canIncrement}
                aria-label="More winners"
              >
                <Icons.Plus className="icon" />
              </button>
            </div>
          </div>
        )}

        {phase === 'rolling' && (
          <div className="randomise-status" aria-live="polite">
            Rolling…
          </div>
        )}

        <div className="modal-actions">
          {phase === 'idle' && (
            <>
              <button className="btn" onClick={onClose}>
                Cancel
              </button>
              <button className="btn primary" onClick={startRoll}>
                <span aria-hidden="true" style={{ marginRight: 6 }}>
                  🎲
                </span>
                Roll
              </button>
            </>
          )}
          {phase === 'rolling' && (
            <button className="btn" disabled>
              Rolling…
            </button>
          )}
          {phase === 'result' && (
            <>
              <button className="btn" onClick={onClose}>
                Cancel
              </button>
              <button className="btn" onClick={startRoll}>
                <span aria-hidden="true" style={{ marginRight: 6 }}>
                  🎲
                </span>
                Re-roll
              </button>
              <button className="btn primary" onClick={apply}>
                Apply →
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
