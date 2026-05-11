import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  DndContext,
  type DragEndEvent,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
} from '@dnd-kit/core';
import {
  SortableContext,
  arrayMove,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { useEventStore } from '@/store/eventStore';
import { teamLabelShort } from '@/store/selectors';
import { rankTeamsByQualifier } from '@/logic/seeding';
import { isCentreCourt } from '@/types/domain';
import { Icons } from '@/components/Icons';

export function SeedingScreen() {
  const event = useEventStore((s) => s.event);
  const reorderSeeding = useEventStore((s) => s.reorderSeeding);
  const lockSeedingAndStartRound1 = useEventStore((s) => s.lockSeedingAndStartRound1);
  const navigate = useNavigate();

  const ranked = useMemo(() => {
    if (!event?.qualifier) return [];
    return rankTeamsByQualifier(event.qualifier, event.teams, (id) => {
      const t = event.teams.find((tt) => tt.id === id);
      return t ? teamLabelShort(t) : id;
    });
  }, [event?.qualifier, event?.teams]);

  const initialOrder = useMemo(() => {
    if (event?.pendingAssignments) {
      const sortedCourts = event.courts.slice().sort((a, b) => b.position - a.position);
      const order: string[] = [];
      for (const court of sortedCourts) {
        const a = event.pendingAssignments.find((p) => p.courtId === court.id);
        if (a) order.push(a.teamAId, a.teamBId);
      }
      return order;
    }
    return ranked.map((r) => r.teamId);
  }, [event?.pendingAssignments, event?.courts, ranked]);

  const [order, setOrder] = useState<string[]>(initialOrder);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
  );

  if (!event) return null;

  const sortedCourtsDesc = event.courts.slice().sort((a, b) => b.position - a.position);
  const scoreByTeam = new Map(ranked.map((r) => [r.teamId, r.score]));

  // Detect ties (groups of teams with the same qualifier score)
  const tieScores = new Set<number>();
  const counts = new Map<number, number>();
  ranked.forEach((r) => counts.set(r.score, (counts.get(r.score) ?? 0) + 1));
  counts.forEach((count, score) => {
    if (count > 1) tieScores.add(score);
  });
  const tiedGroupCount = tieScores.size;

  const onDragEnd = (e: DragEndEvent) => {
    const { active, over } = e;
    if (!over || active.id === over.id) return;
    const from = order.indexOf(String(active.id));
    const to = order.indexOf(String(over.id));
    if (from < 0 || to < 0) return;
    const next = arrayMove(order, from, to);
    setOrder(next);
    reorderSeeding(next);
  };

  return (
    <div className="seed">
      <div className="qual-head">
        <div>
          <div className="qual-title">Seeding preview</div>
          <div className="qual-sub">
            Teams ranked by qualifier score. Drag to reorder ties. Top two take Centre Court;
            bottom two take Court 1.
          </div>
        </div>
        <div className="qual-meta">
          {tiedGroupCount > 0 ? `${tiedGroupCount} tied group(s)` : 'No ties'}
        </div>
      </div>

      <div className="seed-list">
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
          <SortableContext items={order} strategy={verticalListSortingStrategy}>
            {order.map((teamId, idx) => {
              const team = event.teams.find((t) => t.id === teamId);
              const score = scoreByTeam.get(teamId) ?? 0;
              const courtIdx = Math.floor(idx / 2);
              const court = sortedCourtsDesc[courtIdx];
              const tied = tieScores.has(score);
              const pairFirst = idx % 2 === 0;
              return (
                <SortableRow
                  key={teamId}
                  id={teamId}
                  rank={idx + 1}
                  teamLabel={team ? teamLabelShort(team) : teamId}
                  playerLabel={
                    team && team.name ? `${team.players[0].name} & ${team.players[1].name}` : ''
                  }
                  score={score}
                  court={court}
                  isCentre={court ? isCentreCourt(court, event.courts) : false}
                  tied={tied}
                  pairFirst={pairFirst}
                />
              );
            })}
          </SortableContext>
        </DndContext>
      </div>

      <div className="qual-bottom">
        <div className="qual-bottom-info">
          {tiedGroupCount > 0 ? (
            <>
              Ties highlighted in <span style={{ color: 'var(--amber)' }}>amber</span> — drag to
              reorder before locking.
            </>
          ) : (
            <>Ready to lock seeding and start Round 1.</>
          )}
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="btn" onClick={() => navigate('/qualifier')}>
            ← Back
          </button>
          <button
            className="btn lg primary"
            onClick={() => {
              lockSeedingAndStartRound1();
              setTimeout(() => navigate('/round'), 0);
            }}
          >
            Lock seeding &amp; start Round 1 →
          </button>
        </div>
      </div>
    </div>
  );
}

function SortableRow({
  id,
  rank,
  teamLabel,
  playerLabel,
  score,
  court,
  isCentre,
  tied,
  pairFirst,
}: {
  id: string;
  rank: number;
  teamLabel: string;
  playerLabel: string;
  score: number;
  court: { name: string; position: number; pointValue: number } | undefined;
  isCentre: boolean;
  tied: boolean;
  pairFirst: boolean;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id,
  });
  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
  };
  return (
    <div
      ref={setNodeRef}
      style={style}
      className={
        'seed-row ' +
        (tied ? 'tied ' : '') +
        (isDragging ? 'dragging ' : '') +
        (pairFirst ? 'pair-divider' : '')
      }
    >
      <span className="seed-rank">#{rank}</span>
      <span className={'seed-court-chip ' + (isCentre ? 'centre' : '')}>
        {court?.name ?? ''}
      </span>
      <span className="seed-team-name">
        {teamLabel}
        {playerLabel && <span className="players">· {playerLabel}</span>}
      </span>
      <span className="seed-qscore">Q {score}</span>
      <button
        {...attributes}
        {...listeners}
        className="seed-drag"
        aria-label="Drag to reorder"
      >
        <Icons.Drag className="icon" />
      </button>
    </div>
  );
}
