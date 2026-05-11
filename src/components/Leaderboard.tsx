import { Crown, Trophy } from 'lucide-react';
import type { EventState } from '@/types/domain';
import { leaderboard, teamNameFor } from '@/store/selectors';
import { cn } from '@/utils/classNames';

interface Props {
  event: EventState;
  compact?: boolean;
  limit?: number;
}

export function Leaderboard({ event, compact = false, limit }: Props) {
  const rows = leaderboard(event).filter((r) => {
    const team = event.teams.find((t) => t.id === r.teamId);
    return team?.active;
  });
  const visible = limit ? rows.slice(0, limit) : rows;
  const topId = rows[0]?.teamId;

  return (
    <div className="rounded-xl border border-slate-800 bg-slate-900/60 overflow-hidden">
      <div className="flex items-center gap-2 px-4 py-2 bg-slate-900 border-b border-slate-800">
        <Trophy className="h-4 w-4 text-amber-300" />
        <h2 className={cn('font-bold', compact ? 'text-sm' : 'text-base')}>Leaderboard</h2>
      </div>
      <table className="w-full text-sm">
        <thead className="bg-slate-900/60">
          <tr className="text-left text-slate-400 text-xs uppercase tracking-wider">
            <th className="px-3 py-2">#</th>
            <th className="px-2 py-2">Team</th>
            <th className="px-2 py-2 text-right">Pts</th>
            {!compact && <th className="px-2 py-2 text-right">W-L-T</th>}
            {!compact && <th className="px-2 py-2 text-right">Qual</th>}
          </tr>
        </thead>
        <tbody>
          {visible.map((row, idx) => {
            const isTop = row.teamId === topId && row.total > 0;
            return (
              <tr
                key={row.teamId}
                className={cn(
                  'border-t border-slate-800',
                  isTop && 'bg-amber-500/10',
                )}
              >
                <td className="px-3 py-2 text-slate-400 tabular-nums">{idx + 1}</td>
                <td className="px-2 py-2 truncate max-w-[12rem]">
                  <span className="inline-flex items-center gap-1.5">
                    {isTop && <Crown className="h-3.5 w-3.5 text-amber-300" />}
                    <span className={cn('truncate', isTop && 'text-amber-200 font-semibold')}>
                      {teamNameFor(event, row.teamId)}
                    </span>
                  </span>
                </td>
                <td className="px-2 py-2 text-right font-bold tabular-nums">{row.total}</td>
                {!compact && (
                  <td className="px-2 py-2 text-right text-slate-300 tabular-nums">
                    {row.wins}-{row.losses}-{row.ties}
                  </td>
                )}
                {!compact && (
                  <td className="px-2 py-2 text-right text-slate-400 tabular-nums">
                    {row.qualifierScore}
                  </td>
                )}
              </tr>
            );
          })}
          {visible.length === 0 && (
            <tr>
              <td colSpan={5} className="px-3 py-4 text-center text-slate-500 italic">
                No standings yet.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
