import { useEffect, useState } from 'react';
import {
  DndContext,
  PointerSensor,
  useSensor,
  useSensors,
  useDraggable,
  useDroppable,
  type DragEndEvent,
  type DragStartEvent,
} from '@dnd-kit/core';
import { CSS } from '@dnd-kit/utilities';
import { useEventStore } from '@/store/eventStore';
import { currentRound, teamLabelShort } from '@/store/selectors';
import type { Team } from '@/types/domain';
import { Portal } from './Portal';
import { TeamAvatars } from './Avatar';

/**
 * Mid-round court re-assignment. Reachable from the operator toolbar during a
 * live round. Each team on a court is a draggable chip; drop one team onto
 * another and the two swap courts (like re-arranging apps on a phone home
 * screen). Scores stay with the court, not the team. Rendered in a Portal so
 * drag coordinates are correct even though the TV canvas is transform-scaled.
 */
type Slot = { matchId: string; side: 'A' | 'B' };

function slotId(matchId: string, side: 'A' | 'B'): string {
  return `${matchId}:${side}`;
}
function parseSlot(id: string): Slot {
  const idx = id.lastIndexOf(':');
  return { matchId: id.slice(0, idx), side: id.slice(idx + 1) as 'A' | 'B' };
}

export function AdjustCourtsModal({ onClose }: { onClose: () => void }) {
  const event = useEventStore((s) => s.event);
  const swapMatchSlots = useEventStore((s) => s.swapMatchSlots);
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
  );
  const [activeId, setActiveId] = useState<string | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const round = currentRound(event ?? null);
  if (!event || !round) return null;

  const currentWave = round.currentWave ?? 0;
  const waveMatches = round.matches.filter((m) => (m.wave ?? 0) === currentWave);
  const courtById = new Map(event.courts.map((c) => [c.id, c]));
  const teamById = new Map(event.teams.map((t) => [t.id, t]));
  // Highest-position court first, matching the on-screen order.
  const sortedMatches = waveMatches
    .slice()
    .sort(
      (a, b) =>
        (courtById.get(b.courtId)?.position ?? 0) -
        (courtById.get(a.courtId)?.position ?? 0),
    );
  const anyScored = waveMatches.some((m) => m.scoreA > 0 || m.scoreB > 0);

  function onDragEnd(e: DragEndEvent) {
    setActiveId(null);
    const overId = e.over?.id ? String(e.over.id) : null;
    const activeIdStr = String(e.active.id);
    if (!overId || overId === activeIdStr) return;
    swapMatchSlots(parseSlot(activeIdStr), parseSlot(overId));
  }

  return (
    <Portal>
      <div className="modal-backdrop" onClick={onClose}>
        <div
          className="modal adjust-courts-modal"
          onClick={(e) => e.stopPropagation()}
          style={{ maxWidth: '30rem' }}
        >
          <h2>Adjust courts</h2>
          <p className="adjust-courts-hint">
            Drag a team onto another team to swap their courts.
            {anyScored && ' Any scores already entered stay with the court.'}
          </p>
          <DndContext
            sensors={sensors}
            onDragStart={(e: DragStartEvent) => setActiveId(String(e.active.id))}
            onDragEnd={onDragEnd}
            onDragCancel={() => setActiveId(null)}
          >
            <div className="adjust-courts-list">
              {sortedMatches.map((m) => {
                const court = courtById.get(m.courtId);
                return (
                  <div key={m.id} className="adjust-court">
                    <div className="adjust-court-head">
                      <span className="adjust-court-name">{court?.name ?? 'Court'}</span>
                      <span className="adjust-court-pts">{court?.pointValue ?? 0} pts</span>
                    </div>
                    <TeamChip
                      id={slotId(m.id, 'A')}
                      team={teamById.get(m.teamAId)}
                      activeId={activeId}
                    />
                    <TeamChip
                      id={slotId(m.id, 'B')}
                      team={teamById.get(m.teamBId)}
                      activeId={activeId}
                    />
                  </div>
                );
              })}
              {sortedMatches.length === 0 && (
                <div style={{ color: 'var(--text-2)', fontSize: 13 }}>
                  No matches on court in this wave.
                </div>
              )}
            </div>
          </DndContext>
          <div className="modal-actions">
            <button className="btn primary" onClick={onClose}>
              Done
            </button>
          </div>
        </div>
      </div>
    </Portal>
  );
}

function TeamChip({
  id,
  team,
  activeId,
}: {
  id: string;
  team: Team | undefined;
  activeId: string | null;
}) {
  const { attributes, listeners, setNodeRef: setDragRef, transform, isDragging } =
    useDraggable({ id });
  const { setNodeRef: setDropRef, isOver } = useDroppable({ id });
  const ref = (node: HTMLElement | null) => {
    setDragRef(node);
    setDropRef(node);
  };
  const highlight = isOver && activeId !== null && activeId !== id;
  return (
    <div
      ref={ref}
      className={'adjust-chip' + (highlight ? ' adjust-chip--over' : '')}
      style={{
        transform: CSS.Translate.toString(transform),
        opacity: isDragging ? 0.4 : 1,
      }}
      {...attributes}
      {...listeners}
    >
      {team && <TeamAvatars players={team.players} size="sm" />}
      <span className="adjust-chip-name">{team ? teamLabelShort(team) : 'TBD'}</span>
      <span className="adjust-chip-grip" aria-hidden>
        ⠿
      </span>
    </div>
  );
}
