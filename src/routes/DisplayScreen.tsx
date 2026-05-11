import { useEventStore } from '@/store/eventStore';
import { currentRound, teamLabelShort } from '@/store/selectors';
import { Timer } from '@/components/Timer';
import { Leaderboard } from '@/components/Leaderboard';
import { ThemeTierBadge, tierClasses } from '@/components/ThemeTierBadge';
import { cn } from '@/utils/classNames';
import { Crown } from 'lucide-react';
import { useStorageBroadcast } from '@/hooks/useStorageBroadcast';

export function DisplayScreen() {
  useStorageBroadcast();
  const event = useEventStore((s) => s.event);
  const round = currentRound(event);

  if (!event) {
    return (
      <div className="min-h-screen grid place-items-center text-slate-400">
        No event yet. Set one up on the operator device.
      </div>
    );
  }

  const sortedCourtsDesc = event.courts.slice().sort((a, b) => b.position - a.position);

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 px-6 py-6">
      <header className="flex flex-wrap items-end justify-between gap-4 mb-6">
        <div>
          <div className="text-xs uppercase tracking-[0.3em] text-slate-400">King of the Court</div>
          <h1 className="text-3xl sm:text-5xl font-extrabold mt-1">{event.name}</h1>
        </div>
        {round && (
          <div className="text-right">
            <div className="text-xs uppercase tracking-wider text-slate-400">Round {round.index}</div>
            <Timer
              round={round}
              warningAtMs={event.settings.warningAtMs}
              soundEnabled={false}
              showControls={false}
              large={false}
            />
          </div>
        )}
      </header>

      <div className="grid grid-cols-1 xl:grid-cols-[1fr_24rem] gap-6">
        <section className="space-y-3">
          {sortedCourtsDesc.map((court) => {
            const match = round?.matches.find((m) => m.courtId === court.id);
            const teamA = match && event.teams.find((t) => t.id === match.teamAId);
            const teamB = match && event.teams.find((t) => t.id === match.teamBId);
            const tier = tierClasses(court.position, event.courts.length);
            return (
              <div
                key={court.id}
                className={cn(
                  'rounded-2xl border px-5 py-4 flex items-center gap-4',
                  tier.bg,
                  tier.border,
                  tier.isCentre && 'ring-4 ring-amber-400/40',
                )}
              >
                <div className="min-w-[8rem]">
                  <div className={cn('text-xs font-bold uppercase tracking-widest', tier.text)}>
                    #{court.position}
                  </div>
                  <div className={cn('text-2xl sm:text-3xl font-extrabold flex items-center gap-2', tier.text)}>
                    {tier.isCentre && <Crown className="h-6 w-6" />}
                    {court.name}
                  </div>
                </div>
                <div className="flex-1 grid grid-cols-2 gap-4">
                  <DisplayTeam team={teamA} score={match?.scoreA ?? 0} />
                  <DisplayTeam team={teamB} score={match?.scoreB ?? 0} />
                </div>
                <ThemeTierBadge
                  position={court.position}
                  totalCourts={event.courts.length}
                  pointValue={court.pointValue}
                />
              </div>
            );
          })}
        </section>

        <aside>
          <Leaderboard event={event} />
        </aside>
      </div>
    </div>
  );
}

function DisplayTeam({ team, score }: { team: ReturnType<typeof useEventStore.getState>['event'] extends infer _ ? any : never; score: number }) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-xl bg-slate-900/40 border border-slate-800 px-3 py-2">
      <div className="flex-1 min-w-0">
        {team ? (
          <>
            {team.name && (
              <div className="text-xs uppercase tracking-wide text-slate-400 truncate">
                {team.name}
              </div>
            )}
            <div className="font-semibold truncate text-base sm:text-lg">
              {teamLabelShort(team)}
            </div>
          </>
        ) : (
          <div className="text-slate-500 italic">No team</div>
        )}
      </div>
      <div className="text-3xl sm:text-4xl font-extrabold tabular-nums">{score}</div>
    </div>
  );
}
