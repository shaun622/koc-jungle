import { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowDown, ArrowUp, Crown, Play } from 'lucide-react';
import { useEventStore } from '@/store/eventStore';
import { teamLabelShort } from '@/store/selectors';
import { ThemeTierBadge } from '@/components/ThemeTierBadge';
import { Leaderboard } from '@/components/Leaderboard';
import { cn } from '@/utils/classNames';

export function BetweenRoundsScreen() {
  const event = useEventStore((s) => s.event);
  const startNextRound = useEventStore((s) => s.startNextRound);
  const navigate = useNavigate();

  const movements = useMemo(() => {
    if (!event?.pendingAssignments) return [];
    const lastRound = event.rounds[event.rounds.length - 1];
    if (!lastRound) return [];
    const prevByTeam = new Map<string, string>();
    for (const m of lastRound.matches) {
      prevByTeam.set(m.teamAId, m.courtId);
      prevByTeam.set(m.teamBId, m.courtId);
    }
    type Row = {
      teamId: string;
      from: { id: string; position: number; name: string } | undefined;
      to: { id: string; position: number; name: string };
    };
    const rows: Row[] = [];
    for (const a of event.pendingAssignments) {
      const court = event.courts.find((c) => c.id === a.courtId)!;
      for (const teamId of [a.teamAId, a.teamBId]) {
        const fromCourtId = prevByTeam.get(teamId);
        const fromCourt = fromCourtId ? event.courts.find((c) => c.id === fromCourtId) : undefined;
        rows.push({
          teamId,
          from: fromCourt,
          to: court,
        });
      }
    }
    return rows;
  }, [event]);

  if (!event || !event.pendingAssignments) {
    return <p className="p-6 text-slate-400">Nothing pending.</p>;
  }

  const sortedAssignments = event.pendingAssignments.slice().sort((a, b) => {
    const pa = event.courts.find((c) => c.id === a.courtId)?.position ?? 0;
    const pb = event.courts.find((c) => c.id === b.courtId)?.position ?? 0;
    return pb - pa;
  });

  return (
    <main className="mx-auto max-w-7xl px-4 py-6 space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <h1 className="text-2xl font-bold">Next round — court assignments</h1>
        <button
          onClick={() => {
            startNextRound();
            setTimeout(() => navigate('/round'), 0);
          }}
          className="rounded-md bg-emerald-500 hover:bg-emerald-400 text-emerald-950 font-semibold px-4 py-2 inline-flex items-center gap-2"
        >
          <Play className="h-4 w-4" />
          Start next round
        </button>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-[1fr_22rem] gap-4">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {sortedAssignments.map((a) => {
            const court = event.courts.find((c) => c.id === a.courtId)!;
            const teamA = event.teams.find((t) => t.id === a.teamAId);
            const teamB = event.teams.find((t) => t.id === a.teamBId);
            return (
              <div
                key={a.courtId}
                className="rounded-xl border border-slate-800 bg-slate-900/60 p-4"
              >
                <div className="flex items-center justify-between mb-3">
                  <div className="font-bold">
                    #{court.position} · {court.name}
                  </div>
                  <ThemeTierBadge
                    position={court.position}
                    totalCourts={event.courts.length}
                    pointValue={court.pointValue}
                    compact
                  />
                </div>
                {[teamA, teamB].map((t, i) =>
                  t ? (
                    <div
                      key={t.id}
                      className="flex items-center gap-2 py-1 border-t border-slate-800 first:border-t-0"
                    >
                      <DirectionBadge
                        teamId={t.id}
                        movements={movements}
                        isCentre={court.position === event.courts.length}
                      />
                      <div className="flex-1 truncate">{teamLabelShort(t)}</div>
                    </div>
                  ) : (
                    <div key={i} className="text-slate-500 italic py-1">
                      No team
                    </div>
                  ),
                )}
              </div>
            );
          })}
        </div>
        <aside>
          <Leaderboard event={event} limit={20} />
        </aside>
      </div>
    </main>
  );
}

function DirectionBadge({
  teamId,
  movements,
  isCentre,
}: {
  teamId: string;
  movements: { teamId: string; from?: { position: number } | undefined; to: { position: number } }[];
  isCentre: boolean;
}) {
  const m = movements.find((mm) => mm.teamId === teamId && mm.to);
  if (!m) return null;
  const fromPos = m.from?.position;
  const toPos = m.to.position;
  if (fromPos === undefined) {
    return <span className="text-slate-500 text-xs">·</span>;
  }
  if (toPos > fromPos) {
    return (
      <span className="inline-flex items-center gap-1 text-emerald-300 text-xs font-semibold">
        <ArrowUp className="h-3.5 w-3.5" />UP
      </span>
    );
  }
  if (toPos < fromPos) {
    return (
      <span className="inline-flex items-center gap-1 text-red-300 text-xs font-semibold">
        <ArrowDown className="h-3.5 w-3.5" />DOWN
      </span>
    );
  }
  if (isCentre) {
    return (
      <span className="inline-flex items-center gap-1 text-amber-300 text-xs font-bold">
        <Crown className="h-3.5 w-3.5" />KING
      </span>
    );
  }
  return <span className="text-slate-400 text-xs font-medium">STAYS</span>;
}

// silence unused court reference
void cn;
