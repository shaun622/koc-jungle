import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { DndContext, DragEndEvent, PointerSensor, useSensor, useSensors, closestCenter } from '@dnd-kit/core';
import { SortableContext, arrayMove, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { ArrowUp, ArrowDown, ListOrdered, Lock, Trophy, GripVertical } from 'lucide-react';
import { useEventStore } from '@/store/eventStore';
import { CourtCard } from '@/components/CourtCard';
import { ThemeTierBadge } from '@/components/ThemeTierBadge';
import { teamLabelShort } from '@/store/selectors';
import { rankTeamsByQualifier } from '@/logic/seeding';
import { QUALIFIER_SUM, validateQualifierScore } from '@/logic/validation';
import { cn } from '@/utils/classNames';

export function QualifierScreen() {
  const event = useEventStore((s) => s.event);
  const setQualifierScore = useEventStore((s) => s.setQualifierScore);
  const confirmQualifierResults = useEventStore((s) => s.confirmQualifierResults);
  const reorderSeeding = useEventStore((s) => s.reorderSeeding);
  const lockSeedingAndStartRound1 = useEventStore((s) => s.lockSeedingAndStartRound1);
  const navigate = useNavigate();

  if (!event || !event.qualifier) {
    return <p className="p-6 text-slate-400">No qualifier in progress.</p>;
  }

  if (event.status === 'seeding') {
    return (
      <SeedingPreview
        onLock={() => {
          lockSeedingAndStartRound1();
          navigate('/round');
        }}
        onReorder={reorderSeeding}
      />
    );
  }

  const allValid = event.qualifier.matches.every((m) => !validateQualifierScore(m.scoreA, m.scoreB));

  return (
    <main className="mx-auto max-w-7xl px-4 py-6 space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-2">
          <ListOrdered className="h-6 w-6 text-amber-300" />
          <h1 className="text-2xl font-bold">Qualifier — Best of {QUALIFIER_SUM}</h1>
        </div>
        <button
          disabled={!allValid}
          onClick={() => confirmQualifierResults()}
          className={cn(
            'rounded-md px-4 py-2 font-semibold inline-flex items-center gap-2',
            allValid
              ? 'bg-emerald-500 hover:bg-emerald-400 text-emerald-950'
              : 'bg-slate-800 text-slate-400 cursor-not-allowed',
          )}
        >
          <Trophy className="h-4 w-4" />
          Confirm results
        </button>
      </div>

      <p className="text-sm text-slate-400">
        Each match plays the full 16 serves (4 per player). Enter both team scores below — they must sum to {QUALIFIER_SUM}. Draws are allowed (8–8). Qualifier points do not count toward the nightly total.
      </p>

      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
        {event.qualifier.matches
          .slice()
          .sort((a, b) => {
            const ca = event.courts.find((c) => c.id === a.courtId)?.position ?? 0;
            const cb = event.courts.find((c) => c.id === b.courtId)?.position ?? 0;
            return cb - ca;
          })
          .map((m) => {
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
                mode="qualifier"
                onScoreChange={(matchId, a, b) => setQualifierScore(matchId, a, b)}
              />
            );
          })}
      </div>
    </main>
  );
}

function SeedingPreview({
  onLock,
  onReorder,
}: {
  onLock: () => void;
  onReorder: (orderedTeamIds: string[]) => void;
}) {
  const event = useEventStore((s) => s.event)!;
  const ranked = useMemo(() => {
    if (!event.qualifier) return [];
    return rankTeamsByQualifier(event.qualifier, event.teams, (id) => {
      const t = event.teams.find((tt) => tt.id === id);
      return t ? teamLabelShort(t) : id;
    });
  }, [event.qualifier, event.teams]);

  const initialOrder = useMemo(() => {
    if (event.pendingAssignments) {
      // Build order from pending assignments (Centre court first).
      const sortedCourts = event.courts.slice().sort((a, b) => b.position - a.position);
      const order: string[] = [];
      for (const court of sortedCourts) {
        const a = event.pendingAssignments.find((p) => p.courtId === court.id);
        if (a) {
          order.push(a.teamAId, a.teamBId);
        }
      }
      return order;
    }
    return ranked.map((r) => r.teamId);
  }, [event.pendingAssignments, event.courts, ranked]);

  const [order, setOrder] = useState<string[]>(initialOrder);

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }));

  const onDragEnd = (e: DragEndEvent) => {
    const { active, over } = e;
    if (!over || active.id === over.id) return;
    const from = order.indexOf(String(active.id));
    const to = order.indexOf(String(over.id));
    if (from < 0 || to < 0) return;
    const next = arrayMove(order, from, to);
    setOrder(next);
    onReorder(next);
  };

  const move = (idx: number, delta: number) => {
    const dest = idx + delta;
    if (dest < 0 || dest >= order.length) return;
    const next = arrayMove(order, idx, dest);
    setOrder(next);
    onReorder(next);
  };

  const sortedCourtsDesc = event.courts.slice().sort((a, b) => b.position - a.position);
  const scoreByTeam = new Map(ranked.map((r) => [r.teamId, r.score]));

  return (
    <main className="mx-auto max-w-3xl px-4 py-6 space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-2">
          <Trophy className="h-6 w-6 text-amber-300" />
          <h1 className="text-2xl font-bold">Qualifier results — seed teams</h1>
        </div>
        <button
          onClick={onLock}
          className="inline-flex items-center gap-2 rounded-md bg-emerald-500 hover:bg-emerald-400 text-emerald-950 font-semibold px-4 py-2"
        >
          <Lock className="h-4 w-4" />
          Lock &amp; start Round 1
        </button>
      </div>

      <p className="text-sm text-slate-400">
        Top two teams go to Centre Court. Drag to break ties or override the order — assignments update live.
      </p>

      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
        <SortableContext items={order} strategy={verticalListSortingStrategy}>
          <div className="space-y-1">
            {order.map((teamId, idx) => {
              const team = event.teams.find((t) => t.id === teamId);
              const courtIdx = Math.floor(idx / 2);
              const court = sortedCourtsDesc[courtIdx];
              return (
                <SortableTeamRow
                  key={teamId}
                  id={teamId}
                  teamLabel={team ? teamLabelShort(team) : teamId}
                  rank={idx + 1}
                  score={scoreByTeam.get(teamId) ?? 0}
                  court={court}
                  totalCourts={event.courts.length}
                  onUp={() => move(idx, -1)}
                  onDown={() => move(idx, 1)}
                  isFirstOnCourt={idx % 2 === 0}
                />
              );
            })}
          </div>
        </SortableContext>
      </DndContext>
    </main>
  );
}

function SortableTeamRow({
  id,
  teamLabel,
  rank,
  score,
  court,
  totalCourts,
  onUp,
  onDown,
  isFirstOnCourt,
}: {
  id: string;
  teamLabel: string;
  rank: number;
  score: number;
  court: { id: string; name: string; position: number; pointValue: number } | undefined;
  totalCourts: number;
  onUp: () => void;
  onDown: () => void;
  isFirstOnCourt: boolean;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id });
  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.6 : 1,
  };
  return (
    <div
      ref={setNodeRef}
      style={style}
      className={cn(
        'rounded-md border border-slate-800 bg-slate-900/60 px-3 py-2 flex items-center gap-3',
        isFirstOnCourt && 'mt-2',
      )}
    >
      <button
        {...attributes}
        {...listeners}
        className="text-slate-500 hover:text-slate-200 cursor-grab active:cursor-grabbing"
        aria-label="Drag to reorder"
      >
        <GripVertical className="h-4 w-4" />
      </button>
      <span className="tabular-nums text-slate-400 w-6 text-right">{rank}.</span>
      <span className="flex-1 truncate font-medium">{teamLabel}</span>
      <span className="tabular-nums text-slate-300 text-sm">{score} pts</span>
      {court && (
        <span className="flex items-center gap-2 min-w-[8rem] justify-end">
          <span className="text-xs text-slate-400 truncate max-w-[7rem]">{court.name}</span>
          <ThemeTierBadge
            position={court.position}
            totalCourts={totalCourts}
            pointValue={court.pointValue}
            compact
          />
        </span>
      )}
      <div className="flex flex-col">
        <button onClick={onUp} className="p-0.5 text-slate-400 hover:text-slate-200" aria-label="Move up">
          <ArrowUp className="h-3 w-3" />
        </button>
        <button onClick={onDown} className="p-0.5 text-slate-400 hover:text-slate-200" aria-label="Move down">
          <ArrowDown className="h-3 w-3" />
        </button>
      </div>
    </div>
  );
}
