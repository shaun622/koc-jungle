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
import { isCentreCourt, type Court } from '@/types/domain';
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

  // Boundary ties: teams at positions i and i+1 with the same qualifier
  // score who would end up on *different* courts. Same-court ties are
  // irrelevant to the seeding and shouldn't draw the operator's attention.
  const boundaryTieTeams = new Set<string>();
  for (let i = 0; i + 1 < order.length; i++) {
    const a = order[i];
    const b = order[i + 1];
    const courtA = Math.floor(i / 2);
    const courtB = Math.floor((i + 1) / 2);
    if (courtA === courtB) continue;
    if (scoreByTeam.get(a) !== scoreByTeam.get(b)) continue;
    boundaryTieTeams.add(a);
    boundaryTieTeams.add(b);
  }
  const boundaryTieCount = boundaryTieTeams.size / 2;

  // Chunk the flat order into 2-team pairs aligned with sortedCourtsDesc
  const pairs: Array<[string, string | undefined]> = [];
  for (let i = 0; i < order.length; i += 2) pairs.push([order[i], order[i + 1]]);

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
            Teams ranked by qualifier score. Drag to reorder ties across court boundaries. Top two
            take Centre Court; bottom two take Court 1.
          </div>
        </div>
        <div className="qual-meta">
          {boundaryTieCount > 0
            ? `${boundaryTieCount} boundary tie${boundaryTieCount === 1 ? '' : 's'}`
            : 'No ties to resolve'}
        </div>
      </div>

      <div className="seed-list">
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
          <SortableContext items={order} strategy={verticalListSortingStrategy}>
            {pairs.map(([aId, bId], pairIdx) => {
              const court = sortedCourtsDesc[pairIdx];
              const isCentre = court ? isCentreCourt(court, event.courts) : false;
              return (
                <div
                  key={court?.id ?? pairIdx}
                  className={'seed-pair ' + (isCentre ? 'seed-pair--centre' : '')}
                >
                  <div className="seed-pair-header">
                    <span className="seed-pair-court-name">
                      {isCentre && <Icons.Crown className="icon" style={{ marginRight: 6 }} />}
                      {court?.name ?? '—'}
                    </span>
                    <span className="seed-pair-court-pts">{court?.pointValue ?? 0} pts</span>
                  </div>
                  {aId && (
                    <SortableRow
                      id={aId}
                      rank={pairIdx * 2 + 1}
                      teamLabel={teamLabelFor(event, aId)}
                      playerLabel={playerLabelFor(event, aId)}
                      score={scoreByTeam.get(aId) ?? 0}
                      showScore={!!event.qualifier}
                      tied={boundaryTieTeams.has(aId)}
                    />
                  )}
                  {bId && (
                    <SortableRow
                      id={bId}
                      rank={pairIdx * 2 + 2}
                      teamLabel={teamLabelFor(event, bId)}
                      playerLabel={playerLabelFor(event, bId)}
                      score={scoreByTeam.get(bId) ?? 0}
                      showScore={!!event.qualifier}
                      tied={boundaryTieTeams.has(bId)}
                    />
                  )}
                  {!bId && (
                    <div className="seed-row seed-row--empty" aria-hidden="true">
                      <span className="seed-rank">—</span>
                      <span className="seed-team-name" style={{ color: 'var(--text-2)' }}>
                        Slot open
                      </span>
                      <span />
                      <span />
                    </div>
                  )}
                </div>
              );
            })}
          </SortableContext>
        </DndContext>
      </div>

      <div className="qual-bottom">
        <div className="qual-bottom-info">
          {boundaryTieCount > 0 ? (
            <>
              <span style={{ color: 'var(--amber)' }}>
                Tied scores across court boundaries
              </span>{' '}
              — drag to choose which team gets the higher court.
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
              setTimeout(() => navigate('/display'), 0);
            }}
          >
            Lock seeding &amp; start Round 1 →
          </button>
        </div>
      </div>
    </div>
  );
}

function teamLabelFor(
  event: NonNullable<ReturnType<typeof useEventStore.getState>['event']>,
  id: string,
): string {
  const t = event.teams.find((tt) => tt.id === id);
  return t ? teamLabelShort(t) : id;
}

function playerLabelFor(
  event: NonNullable<ReturnType<typeof useEventStore.getState>['event']>,
  id: string,
): string {
  const t = event.teams.find((tt) => tt.id === id);
  return t && t.name ? `${t.players[0].name} & ${t.players[1].name}` : '';
}

function SortableRow({
  id,
  rank,
  teamLabel,
  playerLabel,
  score,
  showScore,
  tied,
}: {
  id: string;
  rank: number;
  teamLabel: string;
  playerLabel: string;
  score: number;
  showScore: boolean;
  tied: boolean;
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
        'seed-row ' + (tied ? 'tied ' : '') + (isDragging ? 'dragging ' : '')
      }
    >
      <span className="seed-rank">#{rank}</span>
      <span className="seed-team-name">
        {teamLabel}
        {playerLabel && <span className="players">· {playerLabel}</span>}
      </span>
      {showScore ? (
        <span className={'seed-qscore ' + (tied ? 'tied' : '')}>Q {score}</span>
      ) : (
        <span />
      )}
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

// Silence the unused-import warning for Court (kept for future expansion)
void (null as unknown as Court);
