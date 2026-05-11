import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { CheckCircle2, Undo2 } from 'lucide-react';
import { useEventStore } from '@/store/eventStore';
import { Timer } from '@/components/Timer';
import { CourtCard } from '@/components/CourtCard';
import { Leaderboard } from '@/components/Leaderboard';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { currentRound } from '@/store/selectors';
import { unresolvedTies } from '@/logic/rotation';
import { useTimer } from '@/hooks/useTimer';
import { formatMs } from '@/utils/time';

export function RoundScreen() {
  const event = useEventStore((s) => s.event);
  const setMatchScore = useEventStore((s) => s.setMatchScore);
  const incrementScore = useEventStore((s) => s.incrementScore);
  const nominateTieWinner = useEventStore((s) => s.nominateTieWinner);
  const endRound = useEventStore((s) => s.endRound);
  const undoLastRound = useEventStore((s) => s.undoLastRound);
  const navigate = useNavigate();
  const [confirmEnd, setConfirmEnd] = useState(false);
  const [confirmUndo, setConfirmUndo] = useState(false);

  const round = currentRound(event);
  const timerView = useTimer(round);

  if (!event || !round) {
    return <p className="p-6 text-slate-400">No round in progress.</p>;
  }

  const ties = unresolvedTies(round, event.settings.tieRule).filter(
    (m) => m.scoreA > 0 || m.scoreB > 0,
  );
  const sortedMatches = round.matches
    .slice()
    .sort((a, b) => {
      const pa = event.courts.find((c) => c.id === a.courtId)?.position ?? 0;
      const pb = event.courts.find((c) => c.id === b.courtId)?.position ?? 0;
      return pb - pa;
    });

  return (
    <main className="mx-auto max-w-[100rem] px-4 py-4">
      <div className="grid grid-cols-1 xl:grid-cols-[1fr_22rem] gap-4">
        <div className="space-y-4">
          <section className="rounded-2xl border border-slate-800 bg-slate-900/60 px-4 py-5 flex flex-col items-center">
            <div className="text-sm uppercase tracking-wider text-slate-400 mb-1">
              Round {round.index}
            </div>
            <Timer
              round={round}
              warningAtMs={event.settings.warningAtMs}
              soundEnabled={event.settings.soundOnTimerEnd}
            />
            <div className="mt-3 flex flex-wrap items-center gap-2 justify-center">
              <button
                onClick={() => setConfirmEnd(true)}
                className="rounded-md bg-emerald-500 hover:bg-emerald-400 text-emerald-950 font-bold px-4 py-2 inline-flex items-center gap-2"
              >
                <CheckCircle2 className="h-4 w-4" />
                End round
              </button>
              <button
                onClick={() => setConfirmUndo(true)}
                className="rounded-md bg-slate-800 hover:bg-slate-700 text-slate-200 px-4 py-2 inline-flex items-center gap-2 text-sm"
              >
                <Undo2 className="h-4 w-4" />
                Undo last round
              </button>
            </div>
            {ties.length > 0 && (
              <div className="mt-3 text-sm text-amber-300">
                Resolve {ties.length} tied match(es) before ending the round.
              </div>
            )}
          </section>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {sortedMatches.map((m) => {
              const court = event.courts.find((c) => c.id === m.courtId);
              const teamA = event.teams.find((t) => t.id === m.teamAId);
              const teamB = event.teams.find((t) => t.id === m.teamBId);
              if (!court) return null;
              return (
                <CourtCard
                  key={m.id}
                  court={court}
                  totalCourts={event.courts.length}
                  match={m}
                  teamA={teamA}
                  teamB={teamB}
                  mode="round"
                  onScoreChange={(matchId, a, b) => setMatchScore(matchId, a, b)}
                  onIncrement={incrementScore}
                  onNominateWinner={(id, winnerId) => nominateTieWinner(id, winnerId)}
                />
              );
            })}
          </div>
        </div>

        <aside className="space-y-4">
          <Leaderboard event={event} limit={10} />
        </aside>
      </div>

      <ConfirmDialog
        open={confirmEnd}
        title={`End Round ${round.index}?`}
        message={
          timerView.remainingMs > 0
            ? `${formatMs(timerView.remainingMs)} remaining on the clock. Scores will be locked and the next round's assignments will be computed.`
            : 'Scores will be locked and the next round’s assignments will be computed.'
        }
        confirmLabel="End round"
        onConfirm={() => {
          setConfirmEnd(false);
          endRound();
          // Defer navigation until store update propagates.
          setTimeout(() => navigate('/between'), 0);
        }}
        onCancel={() => setConfirmEnd(false)}
      />
      <ConfirmDialog
        open={confirmUndo}
        title="Undo last round?"
        message="Clears the most recent completed round (if any) and lets you re-play it. Scores in the current round will be preserved."
        confirmLabel="Undo"
        destructive
        onConfirm={() => {
          setConfirmUndo(false);
          undoLastRound();
        }}
        onCancel={() => setConfirmUndo(false)}
      />
    </main>
  );
}
