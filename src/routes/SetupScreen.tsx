import { useEffect, useRef, useState } from 'react';
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
import { getFormat } from '@/logic/formats';
import { isCentreCourt, type Court, type Player, type QualifierUnit, type Team, type TieRule } from '@/types/domain';
import { formatMs, parseDurationInput } from '@/utils/time';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { Icons } from '@/components/Icons';
import { ShareCard } from '@/components/ShareCard';
import { Avatar } from '@/components/Avatar';
import { captureAndShare } from '@/utils/shareCard';
import { cropImageFileToAvatar } from '@/utils/avatar';

const TIE_RULE_LABELS: Record<TieRule, string> = {
  'operator-decides': 'Operator nominates winner',
  'team-a-wins': 'Team A wins',
  'split-points': 'Split points',
  replay: 'Replay match',
};

export function SetupScreen() {
  const event = useEventStore((s) => s.event);
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
  const setPlayerAvatar = useEventStore((s) => s.setPlayerAvatar);
  const updateSettings = useEventStore((s) => s.updateSettings);
  const startQualifier = useEventStore((s) => s.startQualifier);
  const skipQualifierToSeeding = useEventStore((s) => s.skipQualifierToSeeding);
  const setFormatConfig = useEventStore((s) => s.setFormatConfig);
  const startTournament = useEventStore((s) => s.startTournament);
  const lastError = useEventStore((s) => s.lastError);
  const navigate = useNavigate();

  const [confirmReset, setConfirmReset] = useState(false);
  const [confirmRemoveTeamId, setConfirmRemoveTeamId] = useState<string | null>(null);
  const [sharingRoster, setSharingRoster] = useState(false);
  const rosterShareRef = useRef<HTMLDivElement>(null);

  const requestRemoveTeam = (id: string) => {
    // Hard-delete during setup is non-destructive. Otherwise confirm.
    if (event?.status === 'setup') {
      removeTeam(id);
    } else {
      setConfirmRemoveTeamId(id);
    }
  };
  const confirmedTeam =
    confirmRemoveTeamId && event
      ? event.teams.find((t) => t.id === confirmRemoveTeamId)
      : null;

  // No event: the dedicated /home screen owns the launch experience.
  // RouteGate redirects here, this is just a guard.
  if (!event) return null;

  const teams = activeTeams(event);
  const format = getFormat(event.format);
  const expectedTeams = event.courts.length * 2;
  const qualifierEnabled = event.settings.qualifierEnabled !== false;
  const qualifierUnit = event.settings.qualifierUnit ?? 'points';
  const canStartQualifier =
    format.usesQualifier && event.status === 'setup' && teams.length === expectedTeams;
  const teamDelta = expectedTeams - teams.length;
  // Non-qualifier formats (Round Robin, Americano, ...) need at least 2
  // active teams. Court-capacity overflow is caught at start time and
  // surfaced via lastError.
  const rrGroupSize = Number(
    (event.formatConfig as { groupSize?: number } | undefined)?.groupSize ?? 4,
  );
  // Bracket seeding: how teams get placed into the draw.
  const bracketSeeding =
    (event.formatConfig as { seedingSource?: 'entered' | 'random' | 'manual' } | undefined)
      ?.seedingSource ?? 'entered';
  const savedSeedOrder =
    (event.formatConfig as { seedOrder?: string[] } | undefined)?.seedOrder ?? [];
  const activeTeamIds = teams.map((t) => t.id);
  // Reconcile the saved order with the current roster (teams may have been
  // added/removed since it was set), keeping saved order first.
  const bracketSeedOrder = [
    ...savedSeedOrder.filter((id) => activeTeamIds.includes(id)),
    ...activeTeamIds.filter((id) => !savedSeedOrder.includes(id)),
  ];
  const canStartNonQualifier =
    !format.usesQualifier && event.status === 'setup' && teams.length >= 2;

  return (
    <div className="setup">
      <div className="setup-col">
        <h2 className="setup-h">
          Event
          <span className="setup-format-badge">{format.name}</span>
          <button className="btn sm" onClick={() => setConfirmReset(true)}>
            Reset
          </button>
        </h2>
        <div className="setup-sub">
          Event name, venue, round duration, and tie rules.
        </div>
        {format.id === 'round-robin' && (
          <div className="setup-form" style={{ marginBottom: 12 }}>
            <div className="setup-field">
              <label>Group size</label>
              <NumberField
                value={rrGroupSize}
                min={2}
                max={12}
                disabled={event.status !== 'setup'}
                onCommit={(n) => setFormatConfig({ groupSize: n })}
              />
            </div>
            <div className="setup-sub" style={{ marginTop: -4 }}>
              Teams split into groups of this size; everyone plays everyone in
              their group. The trailing group may be smaller.
            </div>
          </div>
        )}
        {format.id === 'bracket' && (
          <div className="setup-form" style={{ marginBottom: 12 }}>
            <div className="setup-field">
              <label>Seeding</label>
              <div style={{ display: 'flex', gap: 6 }}>
                {(['entered', 'random', 'manual'] as const).map((s) => (
                  <button
                    key={s}
                    type="button"
                    className={'btn sm ' + (bracketSeeding === s ? 'primary' : '')}
                    disabled={event.status !== 'setup'}
                    onClick={() => setFormatConfig({ seedingSource: s })}
                  >
                    {s === 'entered' ? 'As entered' : s === 'random' ? 'Random' : 'Manual'}
                  </button>
                ))}
              </div>
            </div>
            <div className="setup-sub" style={{ marginTop: -4 }}>
              {bracketSeeding === 'entered'
                ? 'Teams are seeded in the order you added them. Seed 1 gets the first bye when the field is not a power of 2.'
                : bracketSeeding === 'random'
                  ? 'Teams are drawn into the bracket randomly when you start.'
                  : 'Drag teams into seed order. Seed 1 (top) gets the first bye when the field is not a power of 2.'}
            </div>
            {bracketSeeding === 'manual' && (
              <SortableSeedList
                order={bracketSeedOrder}
                teams={teams}
                disabled={event.status !== 'setup'}
                onReorder={(ids) => setFormatConfig({ seedingSource: 'manual', seedOrder: ids })}
              />
            )}
          </div>
        )}
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
          {format.id !== 'bracket' && format.id !== 'round-robin' && (
            <div className="setup-field">
              <label>Total rounds</label>
              <NumberField
                value={event.settings.roundsTotal}
                min={1}
                max={20}
                onCommit={(n) => updateSettings({ roundsTotal: n })}
              />
            </div>
          )}
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
          <div className="setup-field">
            <label>Buzzer on timer end</label>
            <ToggleField
              value={event.settings.soundOnTimerEnd}
              onChange={(v) => updateSettings({ soundOnTimerEnd: v })}
            />
          </div>
          <div className="setup-field">
            <label>Announce round start</label>
            <ToggleField
              value={event.settings.announceRoundStart}
              onChange={(v) => updateSettings({ announceRoundStart: v })}
            />
          </div>

          {format.usesQualifier && (
            <>
              <div className="setup-field">
                <label>Use qualifier round</label>
                <ToggleField
                  value={qualifierEnabled}
                  onChange={(v) => updateSettings({ qualifierEnabled: v })}
                />
              </div>
              {qualifierEnabled && (
                <>
                  <div className="setup-field">
                    <label>Qualifier scored in</label>
                    <select
                      className="setup-input"
                      value={qualifierUnit}
                      onChange={(e) =>
                        updateSettings({ qualifierUnit: e.target.value as QualifierUnit })
                      }
                    >
                      <option value="points">Points</option>
                      <option value="games">Games</option>
                      <option value="time">Time</option>
                    </select>
                  </div>
                  <div className="setup-field">
                    <label>
                      {qualifierUnit === 'time'
                        ? 'Minutes per match'
                        : qualifierUnit === 'games'
                          ? 'Games to'
                          : 'Points to'}
                    </label>
                    <NumberField
                      value={event.settings.qualifierTarget ?? 16}
                      min={1}
                      max={qualifierUnit === 'time' ? 60 : 99}
                      onCommit={(n) => updateSettings({ qualifierTarget: n })}
                    />
                  </div>
                </>
              )}
            </>
          )}
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
        {event.status !== 'setup' && (
          <div className="setup-mid-event-banner">
            <strong>Mid-event edits.</strong> Editing a player name is a safe substitution. The
            team's points and standings stay attached to the team, not the individual player.
            Adding or removing a team won't change the current round; removed teams stay in the
            history but are skipped in future rotations, and added teams need to be dragged into a
            court on the next rotation preview.
          </div>
        )}
        <NewTeamForm onAdd={(p1, p2) => addTeam({ player1: p1, player2: p2 })} />
        <div className="setup-list">
          {teams.map((team, i) => (
            <div key={team.id} className="setup-team-row">
              <div className="setup-team-num">{i + 1}</div>
              <div className="setup-team-inputs">
                <PlayerInput
                  player={team.players[0]}
                  placeholder="Player A"
                  onNameChange={(value) => updateTeam(team.id, { player1: value })}
                  onAvatarUpload={(dataUrl) =>
                    setPlayerAvatar(team.id, 0, { photoDataUrl: dataUrl })
                  }
                  onAvatarClear={() => setPlayerAvatar(team.id, 0, undefined)}
                />
                <PlayerInput
                  player={team.players[1]}
                  placeholder="Player B"
                  onNameChange={(value) => updateTeam(team.id, { player2: value })}
                  onAvatarUpload={(dataUrl) =>
                    setPlayerAvatar(team.id, 1, { photoDataUrl: dataUrl })
                  }
                  onAvatarClear={() => setPlayerAvatar(team.id, 1, undefined)}
                />
              </div>
              <button
                className="op-score-btn"
                onClick={() => requestRemoveTeam(team.id)}
                aria-label="Remove team"
              >
                <Icons.Minus className="icon" />
              </button>
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
            disabled={sharingRoster || teams.length === 0}
            onClick={async () => {
              if (!rosterShareRef.current) return;
              setSharingRoster(true);
              try {
                await captureAndShare(rosterShareRef.current, {
                  filename: `koc-${event.name.replace(/[^a-z0-9-_]+/gi, '-')}-roster.png`,
                  shareTitle: `${event.name} lineup`,
                  shareText: 'Tonight\'s padel lineup 🎾',
                });
              } finally {
                setSharingRoster(false);
              }
            }}
          >
            {sharingRoster ? 'Generating…' : 'Share roster'}
          </button>
          {format.usesQualifier ? (
            <button
              className="btn full primary lg"
              disabled={!canStartQualifier}
              onClick={() => {
                if (qualifierEnabled) {
                  startQualifier();
                  setTimeout(() => navigate('/qualifier'), 0);
                } else {
                  skipQualifierToSeeding();
                  setTimeout(() => navigate('/seeding'), 0);
                }
              }}
            >
              {canStartQualifier
                ? qualifierEnabled
                  ? 'Start qualifier round →'
                  : 'Continue to seeding →'
                : teamDelta > 0
                  ? `Need ${teamDelta} more team(s)`
                  : `Remove ${-teamDelta} team(s)`}
            </button>
          ) : (
            <button
              className="btn full primary lg"
              disabled={!canStartNonQualifier}
              onClick={() => {
                startTournament();
                // If startTournament set a lastError it stayed on setup,
                // so check status before navigating.
                setTimeout(() => {
                  const next = useEventStore.getState().event;
                  if (next?.status === 'round-in-progress') {
                    navigate('/display');
                  }
                }, 0);
              }}
            >
              {canStartNonQualifier
                ? 'Start tournament →'
                : `Need ${Math.max(0, 2 - teams.length)} more team(s)`}
            </button>
          )}
        </div>
        {lastError && event.status === 'setup' && (
          <div style={{ color: 'var(--red)', fontSize: 12, marginTop: 8 }}>
            {lastError}
          </div>
        )}
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

      <ShareCard ref={rosterShareRef} variant="roster" event={event} />

      <ConfirmDialog
        open={!!confirmedTeam}
        title="Remove this team mid-event?"
        message={
          confirmedTeam
            ? `${confirmedTeam.players[0].name} & ${confirmedTeam.players[1].name} will be marked inactive, kept for history but skipped in future rotations. Their existing scores stay in the standings. The current round is unaffected; you'll need to drop in a replacement team via the rotation preview before starting the next round.`
            : ''
        }
        confirmLabel="Yes, remove"
        destructive
        onConfirm={() => {
          if (confirmRemoveTeamId) removeTeam(confirmRemoveTeamId);
          setConfirmRemoveTeamId(null);
        }}
        onCancel={() => setConfirmRemoveTeamId(null)}
      />
    </div>
  );
}

function PlayerInput({
  player,
  placeholder,
  onNameChange,
  onAvatarUpload,
  onAvatarClear,
}: {
  player: Player;
  placeholder: string;
  onNameChange: (value: string) => void;
  onAvatarUpload: (dataUrl: string) => void;
  onAvatarClear: () => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const hasPhoto = !!player.avatar?.photoDataUrl;
  return (
    <div className="setup-player-input">
      <button
        type="button"
        className="setup-player-avatar"
        onClick={() => inputRef.current?.click()}
        aria-label={hasPhoto ? `Change photo for ${player.name}` : `Add photo for ${player.name}`}
        title={hasPhoto ? 'Change photo' : 'Add photo'}
      >
        <Avatar player={player} size="sm" />
        <span className="setup-player-avatar-overlay">
          {busy ? '…' : hasPhoto ? '✎' : '+'}
        </span>
      </button>
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        style={{ display: 'none' }}
        onChange={async (e) => {
          const file = e.target.files?.[0];
          if (!file) return;
          setBusy(true);
          try {
            const dataUrl = await cropImageFileToAvatar(file);
            onAvatarUpload(dataUrl);
          } catch {
            // Swallow: invalid image; the avatar simply doesn't update.
          } finally {
            setBusy(false);
            // Allow re-selecting the same file.
            e.target.value = '';
          }
        }}
      />
      <input
        className="setup-input setup-player-name"
        value={player.name}
        onChange={(e) => onNameChange(e.target.value)}
        placeholder={placeholder}
      />
      {hasPhoto && (
        <button
          type="button"
          className="setup-player-avatar-clear"
          onClick={onAvatarClear}
          aria-label="Remove photo"
          title="Remove photo"
        >
          <Icons.Close className="icon" />
        </button>
      )}
    </div>
  );
}

function ToggleField({
  value,
  onChange,
}: {
  value: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <button
      type="button"
      className={'settings-toggle ' + (value ? 'on' : '')}
      onClick={() => onChange(!value)}
      aria-pressed={value}
    >
      <span className="settings-toggle-dot" />
    </button>
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
  onAdd: (player1: string, player2: string) => void;
}) {
  const [p1, setP1] = useState('');
  const [p2, setP2] = useState('');
  const valid = p1.trim() && p2.trim();
  const submit = () => {
    if (!valid) return;
    onAdd(p1, p2);
    setP1('');
    setP2('');
  };
  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: '1fr 1fr auto',
        gap: 6,
        marginBottom: 12,
      }}
    >
      <input
        className="setup-input"
        placeholder="Player A"
        value={p1}
        onChange={(e) => setP1(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') submit();
        }}
      />
      <input
        className="setup-input"
        placeholder="Player B"
        value={p2}
        onChange={(e) => setP2(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') submit();
        }}
      />
      <button className="btn primary" disabled={!valid} onClick={submit}>
        + Add
      </button>
    </div>
  );
}

function NumberField({
  value,
  min,
  max,
  onCommit,
  className = 'setup-input',
  disabled,
}: {
  value: number;
  min: number;
  max: number;
  onCommit: (n: number) => void;
  className?: string;
  disabled?: boolean;
}) {
  const [text, setText] = useState(String(value));
  // Re-sync if external value changes while the field isn't focused
  useEffect(() => {
    setText(String(value));
  }, [value]);
  const commit = () => {
    const n = parseInt(text, 10);
    if (!Number.isNaN(n) && n >= min && n <= max) {
      onCommit(n);
      setText(String(n));
    } else {
      setText(String(value));
    }
  };
  return (
    <input
      type="number"
      inputMode="numeric"
      min={min}
      max={max}
      className={className}
      value={text}
      disabled={disabled}
      onChange={(e) => setText(e.target.value)}
      onFocus={(e) => e.currentTarget.select()}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
      }}
    />
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
        <NumberField
          className="setup-court-pts-input setup-input"
          value={court.pointValue}
          min={0}
          max={99}
          onCommit={(n) => onPoints(court.id, n)}
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

function teamLabel(t: Team): string {
  return t.name?.trim() || t.players.map((p) => p.name).join(' & ');
}

/** Drag-to-arrange seed order for a manually-seeded bracket. */
function SortableSeedList({
  order,
  teams,
  disabled,
  onReorder,
}: {
  order: string[];
  teams: Team[];
  disabled: boolean;
  onReorder: (orderedIds: string[]) => void;
}) {
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
  );
  const teamById = new Map(teams.map((t) => [t.id, t]));
  const handleDragEnd = (e: DragEndEvent) => {
    const { active, over } = e;
    if (!over || active.id === over.id) return;
    const from = order.indexOf(String(active.id));
    const to = order.indexOf(String(over.id));
    if (from < 0 || to < 0) return;
    onReorder(arrayMove(order, from, to));
  };
  return (
    <div className="setup-list" style={{ marginTop: 8 }}>
      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
        <SortableContext items={order} strategy={verticalListSortingStrategy}>
          {order.map((id, i) => {
            const t = teamById.get(id);
            if (!t) return null;
            return (
              <SortableSeedRow key={id} id={id} seed={i + 1} label={teamLabel(t)} disabled={disabled} />
            );
          })}
        </SortableContext>
      </DndContext>
    </div>
  );
}

function SortableSeedRow({
  id,
  seed,
  label,
  disabled,
}: {
  id: string;
  seed: number;
  label: string;
  disabled: boolean;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id,
    disabled,
  });
  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.6 : 1,
  };
  return (
    <div ref={setNodeRef} style={style} className="setup-court-row">
      {!disabled ? (
        <button
          className="setup-court-drag"
          {...attributes}
          {...listeners}
          aria-label="Drag to reorder seed"
          type="button"
        >
          <Icons.Drag className="icon" />
        </button>
      ) : (
        <span className="setup-court-drag" aria-hidden="true" />
      )}
      <div className="setup-court-pos">{seed}</div>
      <span style={{ flex: 1, fontWeight: 600 }}>{label}</span>
    </div>
  );
}

