import { useEffect, useRef } from 'react';
import { useEventStore } from '@/store/eventStore';
import { teamLabelShort } from '@/store/selectors';
import { isCentreCourt } from '@/types/domain';

/**
 * Round-start announcements (Phase 6.2).
 *
 * Reads round info via the Web Speech API when:
 *   1. `event.settings.announceRoundStart` is true
 *   2. A NEW round id appears in `event.rounds` (i.e. the operator just started
 *      the next round, not just a re-render of the same round)
 *
 * The hook stays defensive: it bails silently when there's no event, the
 * SpeechSynthesis API is missing (older browsers / locked-down kiosks), or
 * the round has no Centre Court match.
 */
export function useAnnouncements() {
  const event = useEventStore((s) => s.event);
  // Track the most recent round id we've already spoken, so re-renders and
  // score updates don't trigger repeat announcements.
  const lastSpokenRoundIdRef = useRef<string | null>(null);

  useEffect(() => {
    if (!event) return;
    if (!event.settings.announceRoundStart) return;
    if (typeof window === 'undefined' || !('speechSynthesis' in window)) return;

    const round = event.rounds.at(-1);
    if (!round) return;
    if (round.completedAt) return; // already finished — don't announce mid-rotation
    if (lastSpokenRoundIdRef.current === round.id) return;
    lastSpokenRoundIdRef.current = round.id;

    // Find the centre-court match and build a short phrase. Falls back to a
    // simple "Round X" if the centre court has no match for some reason.
    const sortedCourts = event.courts.slice().sort((a, b) => b.position - a.position);
    const centre = sortedCourts[0];
    const centreMatch = centre
      ? round.matches.find((m) => m.courtId === centre.id)
      : null;

    let phrase = `Round ${round.index}.`;
    if (centre && centreMatch) {
      const a = event.teams.find((t) => t.id === centreMatch.teamAId);
      const b = event.teams.find((t) => t.id === centreMatch.teamBId);
      if (a && b) {
        const courtLabel = isCentreCourt(centre, event.courts)
          ? "King's Court"
          : centre.name;
        phrase = `Round ${round.index}. ${courtLabel}: ${teamLabelShort(a)} versus ${teamLabelShort(b)}.`;
      }
    }

    try {
      // Cancel anything queued up — we only ever want one announcement live.
      window.speechSynthesis.cancel();
      const utterance = new SpeechSynthesisUtterance(phrase);
      utterance.rate = 0.95;
      utterance.pitch = 1.05;
      utterance.volume = 1;
      window.speechSynthesis.speak(utterance);
    } catch {
      // Ignore — the operator can always glance at the screen.
    }
  }, [event]);
}
