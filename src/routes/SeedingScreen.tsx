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
import { RandomiseTieModal, type TieGroup } from '@/components/RandomiseTieModal';

export function SeedingScreen() {
  const event = useEventStore((s) => s.event);
  const reorderSeeding = useEventStore((s) => s.reorderSeeding);
  const lockSeedingAndStartRound1 = useEventStore((s) => s.lockSeedingAndStartRound1);
  const reopenFromSeeding = useEventStore((s) => s.reopenFromSeeding);
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
  const [activeTieGroup, setActiveTieGroup] = useState<TieGroup | null>(null);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
  );

  if (!event) return null;

  const sortedCourtsDesc = event.courts.slice().sort((a, b) => b.position - a.position);
  const scoreByTeam = new Map(ranked.map((r) => [r.teamId, r.score]));

  // Any team whose qualifier score is shared with at least one other team
  // gets flagged — same-court ties matter too because the operator may want
  // to rotate which team takes the higher seed within a court.
  //
  // Each tied score is assigned an alternating palette index (0/1) so adjacent
  // tie groups in the sorted seeding list always render in different colours
  // (amber vs blue). Keying off score — not list position — means a dragged
  // team keeps its group colour even when scattered across the list.
  const tiedTeamPalette = new Map<string, 0 | 1>();
  const tieGroupCount = (() => {
    const counts = new Map<number, number>();
    for (const teamId of order) {
      const s = scoreByTeam.get(teamId);
      if (s === undefined) continue;
      counts.set(s, (counts.get(s) ?? 0) + 1);
    }
    // Tied scores in descending order so the first-encountered tie group
    // (highest score) gets palette index 0.
    const tiedScoresDesc = Array.from(counts.entries())
      .filter(([, n]) => n > 1)
      .map(([s]) => s)
      .sort((a, b) => b - a);
    const paletteByScore = new Map<number, 0 | 1>();
    tiedScoresDesc.forEach((s, i) => paletteByScore.set(s, (i % 2) as 0 | 1));
    for (const teamId of order) {
      const s = scoreByTeam.get(teamId);
      if (s === undefined) continue;
      const palette = paletteByScore.get(s);
      if (palette !== undefined) tiedTeamPalette.set(teamId, palette);
    }
    return tiedScoresDesc.length;
  })();

  // Cross-boundary tie groups: contiguous runs of equal-score teams in the
  // current `order` that span more than one court. These get a "🎲 Randomise"
  // chip so the operator can resolve the tie with a slot-machine draw.
  // Same-court runs are excluded because seeding order within a court has no
  // effect on the round 1 matchups.
  const crossBoundaryGroups: TieGroup[] = [];
  {
    let i = 0;
    while (i < order.length) {
      let j = i + 1;
      while (
        j < order.length &&
        scoreByTeam.get(order[j]) === scoreByTeam.get(order[i])
      ) {
        j += 1;
      }
      if (j - i > 1) {
        const courtMin = Math.floor(i / 2);
        const courtMax = Math.floor((j - 1) / 2);
        if (courtMin !== courtMax) {
          const courtMinTopBoundary = (courtMin + 1) * 2; // first rank in next court
          const winnersDefault = Math.min(j, courtMinTopBoundary) - i;
          crossBoundaryGroups.push({
            score: scoreByTeam.get(order[i]) ?? 0,
            teamIds: order.slice(i, j),
            rankMin: i,
            rankMax: j - 1,
            winnersDefault,
          });
        }
      }
      i = j;
    }
  }
  const groupByTopTeamId = new Map<string, TieGroup>();
  for (const g of crossBoundaryGroups) {
    groupByTopTeamId.set(g.teamIds[0], g);
  }

  // Chunk the flat order into 2-team pairs aligned with sortedCourtsDesc.
  // Each pair[i] corresponds to court sortedCourtsDesc[i] and seed ranks
  // (i*2 + 1, i*2 + 2). The visual render order is shuffled below so the
  // courts fill column-major (matching the TV display) but the underlying
  // rank → court mapping stays unchanged.
  const pairs: Array<[string, string | undefined]> = [];
  for (let i = 0; i < order.length; i += 2) pairs.push([order[i], order[i + 1]]);

  // Column-major render order: all courts (Centre included) split into a
  // left and right column, then interleaved so the row-major CSS grid draws
  // them top-to-bottom-left then top-to-bottom-right. Centre Court is a
  // normal-width cell — it keeps its gold styling but no longer spans the
  // full row, so all courts fit one screen on iPad landscape.
  const allPairs = pairs.map((pair, idx) => ({ pair, courtIndex: idx }));
  const half = Math.ceil(allPairs.length / 2);
  const leftCol = allPairs.slice(0, half);
  const rightCol = allPairs.slice(half);
  const renderOrder: Array<{
    pair: [string, string | undefined];
    courtIndex: number;
  }> = [];
  for (let i = 0; i < Math.max(leftCol.length, rightCol.length); i++) {
    if (leftCol[i]) renderOrder.push(leftCol[i]);
    if (rightCol[i]) renderOrder.push(rightCol[i]);
  }

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

  const applyRandomise = (newOrderInRange: string[], rankMin: number) => {
    const next = order.slice();
    for (let i = 0; i < newOrderInRange.length; i++) {
      next[rankMin + i] = newOrderInRange[i];
    }
    setOrder(next);
    reorderSeeding(next);
  };

  return (
    <div className="seed">
      <div className="qual-head">
        <div>
          <div className="qual-title">Seeding preview</div>
          <div className="qual-sub">
            Teams ranked by qualifier score. Drag to reorder tied teams. Top two take Centre Court;
            bottom two take Court 1.
          </div>
        </div>
        <div className="qual-meta">
          {tieGroupCount > 0
            ? `${tieGroupCount} tie${tieGroupCount === 1 ? '' : 's'}`
            : 'No ties to resolve'}
        </div>
      </div>

      <div className="seed-list">
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
          <SortableContext items={order} strategy={verticalListSortingStrategy}>
            {renderOrder.map(({ pair: [aId, bId], courtIndex }) => {
              const court = sortedCourtsDesc[courtIndex];
              const isCentre = court ? isCentreCourt(court, event.courts) : false;
              return (
                <div
                  key={court?.id ?? courtIndex}
                  className={'seed-pair ' + (isCentre ? 'seed-pair--centre' : '')}
                  // --court-order is read by the mobile media queries to
                  // reorder pairs into strict court-position-desc on 1-col
                  // layouts. On desktop the property is ignored (no order
                  // rule applies), so the JSX interleave preserves the
                  // column-major 2-col layout.
                  style={{ ['--court-order' as string]: courtIndex }}
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
                      rank={courtIndex * 2 + 1}
                      teamLabel={teamLabelFor(event, aId)}
                      playerLabel={playerLabelFor(event, aId)}
                      score={scoreByTeam.get(aId) ?? 0}
                      showScore={!!event.qualifier}
                      tiePalette={tiedTeamPalette.get(aId)}
                      randomiseGroup={groupByTopTeamId.get(aId)}
                      onRandomise={() => {
                        const g = groupByTopTeamId.get(aId);
                        if (g) setActiveTieGroup(g);
                      }}
                    />
                  )}
                  {bId && (
                    <SortableRow
                      id={bId}
                      rank={courtIndex * 2 + 2}
                      teamLabel={teamLabelFor(event, bId)}
                      playerLabel={playerLabelFor(event, bId)}
                      score={scoreByTeam.get(bId) ?? 0}
                      showScore={!!event.qualifier}
                      tiePalette={tiedTeamPalette.get(bId)}
                      randomiseGroup={groupByTopTeamId.get(bId)}
                      onRandomise={() => {
                        const g = groupByTopTeamId.get(bId);
                        if (g) setActiveTieGroup(g);
                      }}
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
          {tieGroupCount > 0 ? (
            <>
              <span style={{ color: 'var(--amber)' }}>Tied qualifier scores</span>{' '}
              — drag to choose seeding order.
            </>
          ) : (
            <>Ready to lock seeding and start Round 1.</>
          )}
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button
            className="btn"
            onClick={() => {
              const toQualifier = !!event.qualifier;
              reopenFromSeeding();
              setTimeout(() => navigate(toQualifier ? '/qualifier' : '/setup'), 0);
            }}
          >
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

      <RandomiseTieModal
        open={!!activeTieGroup}
        group={activeTieGroup}
        onClose={() => setActiveTieGroup(null)}
        onApply={applyRandomise}
      />
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
  tiePalette,
  randomiseGroup,
  onRandomise,
}: {
  id: string;
  rank: number;
  teamLabel: string;
  playerLabel: string;
  score: number;
  showScore: boolean;
  /** undefined → not tied. 0 → palette A (amber). 1 → palette B (blue). */
  tiePalette: 0 | 1 | undefined;
  /** If set, this row is the top of a cross-boundary tie group and gets a 🎲 chip. */
  randomiseGroup: TieGroup | undefined;
  onRandomise: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id,
  });
  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
  };
  const tied = tiePalette !== undefined;
  const tiedClass = tied ? `tied tied--${tiePalette === 0 ? 'a' : 'b'} ` : '';
  return (
    <div
      ref={setNodeRef}
      style={style}
      className={'seed-row ' + tiedClass + (isDragging ? 'dragging ' : '')}
    >
      <span className="seed-rank">#{rank}</span>
      <span className="seed-team-name">
        <span className="seed-team-name-text">
          {teamLabel}
          {playerLabel && <span className="players">· {playerLabel}</span>}
        </span>
        {randomiseGroup && (
          <button
            className="seed-randomise-chip"
            onClick={(e) => {
              e.stopPropagation();
              onRandomise();
            }}
            title={`Randomise the ${randomiseGroup.teamIds.length} tied teams at Q ${randomiseGroup.score}`}
            aria-label="Randomise this tie"
          >
            <span aria-hidden="true">🎲</span>
            <span>Randomise</span>
          </button>
        )}
      </span>
      {showScore ? (
        <span className={'seed-qscore ' + tiedClass}>Q {score}</span>
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
