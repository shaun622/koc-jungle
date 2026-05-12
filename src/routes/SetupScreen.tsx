import { useState } from 'react';
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
import { activeTeams } from '@/store/selectors';
import { buildDemoEvent } from '@/logic/demoData';
import { isCentreCourt, type Court, type TieRule } from '@/types/domain';
import { formatMs, parseDurationInput } from '@/utils/time';
import { downloadJsonFile, parseImportJson, toExportJson } from '@/utils/exportImport';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { Icons } from '@/components/Icons';

const TIE_RULE_LABELS: Record<TieRule, string> = {
  'operator-decides': 'Operator nominates winner',
  'team-a-wins': 'Team A wins',
  'split-points': 'Split points',
  replay: 'Replay match',
};

export function SetupScreen() {
  const event = useEventStore((s) => s.event);
  const createEvent = useEventStore((s) => s.createEvent);
  const loadEvent = useEventStore((s) => s.loadEvent);
  const resetEvent = useEventStore((s) => s.resetEvent);
  const addTeam = useEventStore((s) => s.addTeam);
  const updateTeam = useEventStore((s) => s.updateTeam);
  const removeTeam = useEventStore((s) => s.removeTeam);
  const renameCourt = useEventStore((s) => s.renameCourt);
  const setCourtPoints = useEventStore((s) => s.setCourtPoints);
  const addCourt = useEventStore((s) => s.addCourt);
  const removeCourt = useEventStore((s) => s.removeCourt);
  const reorderCourts = useEventStore((s) => s.reorderCourts);
  const setEventName = useEventStore((s) => s.setEventName);
  const setEventVenue = useEventStore((s) => s.setEventVenue);
  const updateSettings = useEventStore((s) => s.updateSettings);
  const startQualifier = useEventStore((s) => s.startQualifier);
  const navigate = useNavigate();

  const [confirmReset, setConfirmReset] = useState(false);
  const [importError, setImportError] = useState<string | null>(null);

  if (!event) {
    return (
      <div className="landing">
        <div className="landing-card">
          <div className="brand-mark lg">K</div>
          <h1>King of the Court</h1>
          <p>
            Run your padel KOC night: timer, courts, score entry, auto-rotation, leaderboard.
            Set up an event and start the qualifier in under two minutes.
          </p>
          <div className="actions">
            <button className="btn primary lg" onClick={() => createEvent('KOC Night')}>
              Create new event
            </button>
            <button className="btn lg" onClick={() => loadEvent(buildDemoEvent())}>
              Load demo (14 teams)
            </button>
            <ImportButton onLoad={loadEvent} onError={setImportError} />
          </div>
          {importError && <p style={{ color: 'var(--red)' }}>{importError}</p>}
        </div>
      </div>
    );
  }

  const teams = activeTeams(event);
  const expectedTeams = event.courts.length * 2;
  const canStartQualifier = event.status === 'setup' && teams.length === expectedTeams;
  const teamDelta = expectedTeams - teams.length;

  return (
    <div className="setup">
      <div className="setup-col">
        <h2 className="setup-h">
          Event
          <button className="btn sm" onClick={() => setConfirmReset(true)}>
            Reset
          </button>
        </h2>
        <div className="setup-sub">
          Event name, venue, round duration, and tie rules.
        </div>
        <div className="setup-form">
          <div className="setup-field">
            <label>Event name</label>
            <input
              className="setup-input"
              value={event.name}
              onChange={(e) => setEventName(e.target.value)}
            />
          </div>
          <div className="setup-field">
            <label>Venue</label>
            <input
              className="setup-input"
              value={event.venue ?? ''}
              onChange={(e) => setEventVenue(e.target.value)}
              placeholder="High Court Padel"
            />
          </div>
          <DurationField
            label="Round duration"
            valueMs={event.settings.defaultRoundDurationMs}
            onChange={(ms) => updateSettings({ defaultRoundDurationMs: ms })}
          />
          <div className="setup-field">
            <label>Total rounds</label>
            <input
              type="number"
              min={1}
              max={20}
              className="setup-input"
              value={event.settings.roundsTotal}
              onChange={(e) => {
                const n = Math.max(1, Math.min(20, Number(e.target.value) || 1));
                updateSettings({ roundsTotal: n });
              }}
            />
          </div>
          <div className="setup-field">
            <label>Tie rule</label>
            <select
              className="setup-input"
              value={event.settings.tieRule}
              onChange={(e) => updateSettings({ tieRule: e.target.value as TieRule })}
            >
              {(Object.keys(TIE_RULE_LABELS) as TieRule[]).map((rule) => (
                <option key={rule} value={rule}>
                  {TIE_RULE_LABELS[rule]}
                </option>
              ))}
            </select>
          </div>
          <DurationField
            label="Warning flash at"
            valueMs={event.settings.warningAtMs}
            onChange={(ms) => updateSettings({ warningAtMs: ms })}
          />
        </div>

        <h2 className="setup-h" style={{ marginTop: 12 }}>
          Courts ({event.courts.length})
          {event.status === 'setup' && (
            <button className="btn sm" onClick={addCourt}>
              + Add court
            </button>
          )}
        </h2>
        <div className="setup-sub">
          Higher position = more prestige. Top court is the Centre / King's Court.
        </div>
        <SortableCourtList
          courts={event.courts}
          canRemove={event.status === 'setup' && event.courts.length > 1}
          canReorder={event.status === 'setup'}
          onRename={renameCourt}
          onPoints={setCourtPoints}
          onRemove={removeCourt}
          onReorder={reorderCourts}
        />
      </div>

      <div className="setup-col">
        <h2 className="setup-h">
          Teams ({teams.length} / {expectedTeams})
        </h2>
        <div className="setup-sub">
          Each team is a fixed pair of two named players. Leave team name blank to auto-label.
        </div>
        {event.status === 'setup' && (
          <NewTeamForm onAdd={(p1, p2, name) => addTeam({ player1: p1, player2: p2, name })} />
        )}
        <div className="setup-list">
          {teams.map((team, i) => (
            <div key={team.id} className="setup-team-row">
              <div className="setup-team-num">{i + 1}</div>
              <div className="setup-team-inputs">
                <input
                  className="setup-input"
                  value={team.players[0].name}
                  onChange={(e) => updateTeam(team.id, { player1: e.target.value })}
                  placeholder="Player A"
                />
                <input
                  className="setup-input"
                  value={team.players[1].name}
                  onChange={(e) => updateTeam(team.id, { player2: e.target.value })}
                  placeholder="Player B"
                />
              </div>
              {event.status === 'setup' && (
                <button
                  className="op-score-btn"
                  onClick={() => removeTeam(team.id)}
                  aria-label="Remove team"
                >
                  <Icons.Minus className="icon" />
                </button>
              )}
            </div>
          ))}
          {teams.length === 0 && (
            <div style={{ color: 'var(--text-2)', fontSize: 12, fontStyle: 'italic' }}>
              No teams yet.
            </div>
          )}
        </div>
        <div className="setup-actions">
          <button
            className="btn"
            onClick={() => {
              const filename = `koc-${event.name.replace(/[^a-z0-9-_]+/gi, '-')}-${new Date()
                .toISOString()
                .slice(0, 10)}.json`;
              downloadJsonFile(filename, toExportJson(event));
            }}
          >
            Export JSON
          </button>
          <button
            className="btn full primary lg"
            disabled={!canStartQualifier}
            onClick={() => {
              startQualifier();
              setTimeout(() => navigate('/qualifier'), 0);
            }}
          >
            {canStartQualifier
              ? 'Start qualifier round →'
              : teamDelta > 0
                ? `Need ${teamDelta} more team(s)`
                : `Remove ${-teamDelta} team(s)`}
          </button>
        </div>
      </div>

      <ConfirmDialog
        open={confirmReset}
        title="Reset entire event?"
        message="This permanently clears teams, scores, and all rounds. Export first if you need a backup."
        confirmLabel="Reset"
        destructive
        onConfirm={() => {
          resetEvent();
          setConfirmReset(false);
        }}
        onCancel={() => setConfirmReset(false)}
      />
    </div>
  );
}

function DurationField({
  label,
  valueMs,
  onChange,
}: {
  label: string;
  valueMs: number;
  onChange: (ms: number) => void;
}) {
  const [text, setText] = useState(formatMs(valueMs));
  return (
    <div className="setup-field">
      <label>{label}</label>
      <input
        className="setup-input"
        value={text}
        onChange={(e) => setText(e.target.value)}
        onFocus={() => setText(formatMs(valueMs))}
        onBlur={() => {
          const parsed = parseDurationInput(text);
          if (parsed !== null) {
            onChange(parsed);
            setText(formatMs(parsed));
          } else {
            setText(formatMs(valueMs));
          }
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
        }}
      />
    </div>
  );
}

function NewTeamForm({
  onAdd,
}: {
  onAdd: (player1: string, player2: string, name?: string) => void;
}) {
  const [name, setName] = useState('');
  const [p1, setP1] = useState('');
  const [p2, setP2] = useState('');
  const valid = p1.trim() && p2.trim();
  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: '1fr 1fr 1fr auto',
        gap: 6,
        marginBottom: 12,
      }}
    >
      <input
        className="setup-input"
        placeholder="Team name (optional)"
        value={name}
        onChange={(e) => setName(e.target.value)}
      />
      <input
        className="setup-input"
        placeholder="Player A"
        value={p1}
        onChange={(e) => setP1(e.target.value)}
      />
      <input
        className="setup-input"
        placeholder="Player B"
        value={p2}
        onChange={(e) => setP2(e.target.value)}
      />
      <button
        className="btn primary"
        disabled={!valid}
        onClick={() => {
          if (!valid) return;
          onAdd(p1, p2, name);
          setName('');
          setP1('');
          setP2('');
        }}
      >
        + Add
      </button>
    </div>
  );
}

function SortableCourtList({
  courts,
  canRemove,
  canReorder,
  onRename,
  onPoints,
  onRemove,
  onReorder,
}: {
  courts: Court[];
  canRemove: boolean;
  canReorder: boolean;
  onRename: (id: string, name: string) => void;
  onPoints: (id: string, value: number) => void;
  onRemove: (id: string) => void;
  onReorder: (orderedIdsTopFirst: string[]) => void;
}) {
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
  );
  const ordered = courts.slice().sort((a, b) => b.position - a.position);
  const ids = ordered.map((c) => c.id);

  const handleDragEnd = (e: DragEndEvent) => {
    const { active, over } = e;
    if (!over || active.id === over.id) return;
    const from = ids.indexOf(String(active.id));
    const to = ids.indexOf(String(over.id));
    if (from < 0 || to < 0) return;
    const next = arrayMove(ids, from, to);
    onReorder(next);
  };

  return (
    <div className="setup-list">
      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
        <SortableContext items={ids} strategy={verticalListSortingStrategy}>
          {ordered.map((c) => (
            <SortableCourtRow
              key={c.id}
              court={c}
              isCentre={isCentreCourt(c, courts)}
              canRemove={canRemove}
              canReorder={canReorder}
              onRename={onRename}
              onPoints={onPoints}
              onRemove={onRemove}
            />
          ))}
        </SortableContext>
      </DndContext>
    </div>
  );
}

function SortableCourtRow({
  court,
  isCentre,
  canRemove,
  canReorder,
  onRename,
  onPoints,
  onRemove,
}: {
  court: Court;
  isCentre: boolean;
  canRemove: boolean;
  canReorder: boolean;
  onRename: (id: string, name: string) => void;
  onPoints: (id: string, value: number) => void;
  onRemove: (id: string) => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: court.id,
    disabled: !canReorder,
  });
  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.6 : 1,
  };
  return (
    <div
      ref={setNodeRef}
      style={style}
      className={'setup-court-row ' + (isCentre ? 'centre' : '')}
    >
      {canReorder ? (
        <button
          className="setup-court-drag"
          {...attributes}
          {...listeners}
          aria-label="Drag to reorder court"
          type="button"
        >
          <Icons.Drag className="icon" />
        </button>
      ) : (
        <span className="setup-court-drag" aria-hidden="true" />
      )}
      <div className="setup-court-pos">{court.position}</div>
      <input
        className="setup-input"
        value={court.name}
        onChange={(e) => onRename(court.id, e.target.value)}
      />
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <input
          className="setup-court-pts-input setup-input"
          type="number"
          min={0}
          value={court.pointValue}
          onChange={(e) => onPoints(court.id, Number(e.target.value) || 0)}
        />
        <span
          style={{
            fontSize: 10,
            color: 'var(--text-2)',
            fontFamily: 'var(--font-mono)',
            letterSpacing: '0.12em',
          }}
        >
          PTS
        </span>
      </div>
      {canRemove ? (
        <button
          className="op-score-btn"
          onClick={() => onRemove(court.id)}
          aria-label="Remove court"
          type="button"
        >
          <Icons.Minus className="icon" />
        </button>
      ) : (
        <span style={{ width: 32 }} />
      )}
    </div>
  );
}

function ImportButton({
  onLoad,
  onError,
}: {
  onLoad: (event: ReturnType<typeof buildDemoEvent>) => void;
  onError: (message: string) => void;
}) {
  return (
    <label className="btn lg" style={{ cursor: 'pointer' }}>
      Import JSON
      <input
        type="file"
        accept="application/json,.json"
        style={{ display: 'none' }}
        onChange={async (e) => {
          const file = e.target.files?.[0];
          if (!file) return;
          try {
            const text = await file.text();
            const parsed = parseImportJson(text);
            onLoad(parsed);
            onError('');
          } catch (err) {
            onError(err instanceof Error ? err.message : 'Could not parse file.');
          }
          e.target.value = '';
        }}
      />
    </label>
  );
}
