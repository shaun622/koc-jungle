import { AlertTriangle } from 'lucide-react';
import type { Court, Match, Team } from '@/types/domain';
import { ScoreInput } from './ScoreInput';
import { ThemeTierBadge, tierClasses } from './ThemeTierBadge';
import { cn } from '@/utils/classNames';
import { teamLabelShort } from '@/store/selectors';

interface Props {
  court: Court;
  totalCourts: number;
  match: Match;
  teamA: Team | undefined;
  teamB: Team | undefined;
  mode: 'qualifier' | 'round';
  onScoreChange: (matchId: string, scoreA: number, scoreB: number) => void;
  onIncrement?: (matchId: string, side: 'A' | 'B', delta: number) => void;
  onNominateWinner?: (matchId: string, winnerId: string) => void;
}

export function CourtCard({
  court,
  totalCourts,
  match,
  teamA,
  teamB,
  mode,
  onScoreChange,
  onIncrement,
  onNominateWinner,
}: Props) {
  const tier = tierClasses(court.position, totalCourts);
  const isTied = match.scoreA === match.scoreB && (match.scoreA > 0 || mode === 'qualifier');
  const tieResolved = !!match.tieBreakWinnerId;
  const max = mode === 'qualifier' ? 16 : 99;
  const qualifierHelper = (mine: number, other: number) =>
    mode === 'qualifier' ? `of 16 (sum: ${mine + other})` : undefined;

  return (
    <div
      className={cn(
        'rounded-xl border p-4 shadow-lg backdrop-blur',
        tier.bg,
        tier.border,
        tier.isCentre && 'ring-2 ring-amber-400/40',
      )}
    >
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <span className={cn('text-xs font-bold uppercase tracking-wider', tier.text)}>
            #{court.position}
          </span>
          <h3 className={cn('text-lg font-bold leading-none', tier.text)}>{court.name}</h3>
        </div>
        <ThemeTierBadge
          position={court.position}
          totalCourts={totalCourts}
          pointValue={court.pointValue}
          compact
        />
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <TeamPanel
          team={teamA}
          score={match.scoreA}
          opponentScore={match.scoreB}
          isWinnerNominated={match.tieBreakWinnerId === teamA?.id}
          onScoreChange={(v) => onScoreChange(match.id, v, match.scoreB)}
          onIncrement={onIncrement ? (delta) => onIncrement(match.id, 'A', delta) : undefined}
          max={max}
          helper={qualifierHelper(match.scoreA, match.scoreB)}
        />
        <TeamPanel
          team={teamB}
          score={match.scoreB}
          opponentScore={match.scoreA}
          isWinnerNominated={match.tieBreakWinnerId === teamB?.id}
          onScoreChange={(v) => onScoreChange(match.id, match.scoreA, v)}
          onIncrement={onIncrement ? (delta) => onIncrement(match.id, 'B', delta) : undefined}
          max={max}
          helper={qualifierHelper(match.scoreB, match.scoreA)}
        />
      </div>

      {mode === 'round' && isTied && match.scoreA > 0 && (
        <div className="mt-3 rounded-md border border-amber-500/40 bg-amber-500/10 p-2 flex items-start gap-2">
          <AlertTriangle className="h-4 w-4 text-amber-300 mt-0.5" />
          <div className="flex-1">
            <div className="text-sm text-amber-200 font-semibold">Tied — nominate winner</div>
            <div className="mt-1 flex flex-wrap gap-2">
              {[teamA, teamB].filter((t): t is Team => !!t).map((t) => (
                <button
                  key={t.id}
                  onClick={() => onNominateWinner?.(match.id, t.id)}
                  className={cn(
                    'rounded-md px-3 py-1 text-sm font-medium border',
                    match.tieBreakWinnerId === t.id
                      ? 'bg-amber-400 text-amber-950 border-amber-400'
                      : 'bg-slate-900/40 text-amber-100 border-amber-500/40 hover:bg-amber-500/20',
                  )}
                >
                  {teamLabelShort(t)} wins
                </button>
              ))}
              {tieResolved && (
                <button
                  onClick={() => onNominateWinner?.(match.id, '')}
                  className="rounded-md px-3 py-1 text-sm font-medium border bg-slate-800 text-slate-300 border-slate-700"
                >
                  Clear
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function TeamPanel({
  team,
  score,
  isWinnerNominated,
  onScoreChange,
  max,
  helper,
}: {
  team: Team | undefined;
  score: number;
  opponentScore: number;
  isWinnerNominated: boolean;
  onScoreChange: (v: number) => void;
  onIncrement?: (delta: number) => void;
  max: number;
  helper?: string;
}) {
  return (
    <div
      className={cn(
        'rounded-lg p-3 bg-slate-900/40 border border-slate-800',
        isWinnerNominated && 'ring-2 ring-amber-400',
      )}
    >
      <div className="mb-2 min-h-[2.5rem]">
        {team ? (
          <>
            {team.name && (
              <div className="text-xs uppercase tracking-wide text-slate-400 truncate">
                {team.name}
              </div>
            )}
            <div className="font-semibold text-slate-100 leading-tight">
              {team.players[0].name}
              <span className="text-slate-500"> & </span>
              {team.players[1].name}
            </div>
          </>
        ) : (
          <div className="text-slate-500 italic">No team</div>
        )}
      </div>
      <ScoreInput
        value={score}
        onChange={onScoreChange}
        max={max}
        helper={helper}
        size="md"
      />
    </div>
  );
}
