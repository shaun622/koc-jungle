import { useEventStore } from '@/store/eventStore';
import { Leaderboard } from '@/components/Leaderboard';

export function LeaderboardScreen() {
  const event = useEventStore((s) => s.event);
  if (!event) {
    return <p className="p-6 text-slate-400">No event.</p>;
  }
  return (
    <main className="mx-auto max-w-3xl px-4 py-6 space-y-4">
      <h1 className="text-2xl font-bold">Leaderboard</h1>
      <Leaderboard event={event} />
      <p className="text-xs text-slate-500">
        Tie-breaks: total points → wins → qualifier score → team name.
      </p>
    </main>
  );
}
