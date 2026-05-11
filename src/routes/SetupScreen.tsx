import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Plus, Trash2, Sparkles, Download, Upload } from 'lucide-react';
import { useEventStore } from '@/store/eventStore';
import { buildDemoEvent } from '@/logic/demoData';
import { activeTeams, teamLabelShort } from '@/store/selectors';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { ThemeTierBadge } from '@/components/ThemeTierBadge';
import { downloadJsonFile, parseImportJson, toExportJson } from '@/utils/exportImport';
import { formatMs, parseDurationInput } from '@/utils/time';

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
  const setEventName = useEventStore((s) => s.setEventName);
  const setRoundDuration = useEventStore((s) => s.setRoundDuration);
  const startQualifier = useEventStore((s) => s.startQualifier);
  const navigate = useNavigate();

  const [confirmReset, setConfirmReset] = useState(false);
  const [importError, setImportError] = useState<string | null>(null);

  const [newP1, setNewP1] = useState('');
  const [newP2, setNewP2] = useState('');
  const [newName, setNewName] = useState('');

  if (!event) {
    return (
      <main className="mx-auto max-w-2xl px-4 py-12">
        <div className="rounded-2xl border border-slate-800 bg-slate-900/60 p-8 text-center">
          <Sparkles className="h-10 w-10 text-amber-300 mx-auto" />
          <h1 className="mt-3 text-2xl font-bold">King of the Court</h1>
          <p className="mt-2 text-slate-400">
            Run your padel KOC night: timer, courts, score entry, auto-rotation, leaderboard.
          </p>
          <div className="mt-6 flex flex-col sm:flex-row gap-2 justify-center">
            <button
              onClick={() => createEvent('KOC Night')}
              className="rounded-md bg-emerald-500 hover:bg-emerald-400 text-emerald-950 font-semibold px-5 py-2.5"
            >
              Create new event
            </button>
            <button
              onClick={() => loadEvent(buildDemoEvent())}
              className="rounded-md bg-slate-800 hover:bg-slate-700 text-slate-100 font-semibold px-5 py-2.5"
            >
              Load demo (14 teams)
            </button>
            <ImportButton
              onLoad={loadEvent}
              onError={setImportError}
            />
          </div>
          {importError && (
            <div className="mt-4 text-sm text-red-300">{importError}</div>
          )}
        </div>
      </main>
    );
  }

  const teams = activeTeams(event);
  const expectedTeams = event.courts.length * 2;
  const canStartQualifier = event.status === 'setup' && teams.length === expectedTeams;

  return (
    <main className="mx-auto max-w-5xl px-4 py-6 space-y-6">
      <section className="rounded-xl border border-slate-800 bg-slate-900/60 p-4">
        <div className="flex flex-col sm:flex-row sm:items-end gap-3 justify-between">
          <div className="flex-1">
            <label className="text-xs uppercase tracking-wider text-slate-400">Event name</label>
            <input
              type="text"
              value={event.name}
              onChange={(e) => setEventName(e.target.value)}
              className="mt-1 w-full rounded-md bg-slate-900/80 border border-slate-700 px-3 py-2 text-lg font-semibold"
            />
          </div>
          <div>
            <label className="text-xs uppercase tracking-wider text-slate-400">Default round</label>
            <DurationInput
              valueMs={event.settings.defaultRoundDurationMs}
              onChange={setRoundDuration}
            />
          </div>
          <button
            onClick={() => setConfirmReset(true)}
            className="rounded-md border border-red-500/50 bg-red-500/10 hover:bg-red-500/20 text-red-200 px-4 py-2 text-sm font-medium"
          >
            Reset event
          </button>
        </div>
        <div className="mt-3 text-xs text-slate-400 flex flex-wrap gap-3">
          <span>Status: <span className="font-semibold text-slate-200">{event.status}</span></span>
          <span>Teams: <span className="font-semibold text-slate-200">{teams.length} / {expectedTeams}</span></span>
          <span>Courts: <span className="font-semibold text-slate-200">{event.courts.length}</span></span>
        </div>
      </section>

      <section className="rounded-xl border border-slate-800 bg-slate-900/60 p-4">
        <h2 className="text-lg font-bold mb-3">Courts &amp; points</h2>
        <div className="space-y-2">
          {event.courts
            .slice()
            .sort((a, b) => b.position - a.position)
            .map((court) => (
              <div
                key={court.id}
                className="flex flex-wrap items-center gap-2 rounded-md border border-slate-800 bg-slate-900/40 px-3 py-2"
              >
                <span className="text-xs text-slate-400 w-12">#{court.position}</span>
                <input
                  type="text"
                  value={court.name}
                  onChange={(e) => renameCourt(court.id, e.target.value)}
                  className="flex-1 min-w-[10rem] rounded-md bg-slate-900/80 border border-slate-700 px-2 py-1"
                />
                <label className="text-xs text-slate-400 ml-auto">Points</label>
                <input
                  type="number"
                  min={0}
                  value={court.pointValue}
                  onChange={(e) => setCourtPoints(court.id, Number(e.target.value))}
                  className="w-20 rounded-md bg-slate-900/80 border border-slate-700 px-2 py-1 text-right tabular-nums"
                />
                <ThemeTierBadge
                  position={court.position}
                  totalCourts={event.courts.length}
                  pointValue={court.pointValue}
                  compact
                />
                {event.status === 'setup' && event.courts.length > 1 && (
                  <button
                    onClick={() => removeCourt(court.id)}
                    className="text-slate-400 hover:text-red-300 px-2"
                    title="Remove court"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                )}
              </div>
            ))}
        </div>
        {event.status === 'setup' && (
          <button
            onClick={addCourt}
            className="mt-3 inline-flex items-center gap-1.5 rounded-md bg-slate-800 hover:bg-slate-700 px-3 py-1.5 text-sm"
          >
            <Plus className="h-4 w-4" /> Add court
          </button>
        )}
      </section>

      <section className="rounded-xl border border-slate-800 bg-slate-900/60 p-4">
        <h2 className="text-lg font-bold mb-3">Teams</h2>
        {event.status === 'setup' && (
          <div className="flex flex-wrap gap-2 mb-4">
            <input
              type="text"
              placeholder="Team name (optional)"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              className="flex-1 min-w-[12rem] rounded-md bg-slate-900/80 border border-slate-700 px-3 py-2"
            />
            <input
              type="text"
              placeholder="Player 1"
              value={newP1}
              onChange={(e) => setNewP1(e.target.value)}
              className="flex-1 min-w-[10rem] rounded-md bg-slate-900/80 border border-slate-700 px-3 py-2"
            />
            <input
              type="text"
              placeholder="Player 2"
              value={newP2}
              onChange={(e) => setNewP2(e.target.value)}
              className="flex-1 min-w-[10rem] rounded-md bg-slate-900/80 border border-slate-700 px-3 py-2"
            />
            <button
              onClick={() => {
                if (newP1.trim() && newP2.trim()) {
                  addTeam({ name: newName, player1: newP1, player2: newP2 });
                  setNewName('');
                  setNewP1('');
                  setNewP2('');
                }
              }}
              className="rounded-md bg-emerald-500 hover:bg-emerald-400 text-emerald-950 font-semibold px-4 py-2 inline-flex items-center gap-1.5"
            >
              <Plus className="h-4 w-4" /> Add team
            </button>
          </div>
        )}

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          {teams.map((team, idx) => (
            <div
              key={team.id}
              className="rounded-md border border-slate-800 bg-slate-900/40 p-3"
            >
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs uppercase tracking-wider text-slate-400">Team {idx + 1}</span>
                <button
                  onClick={() => removeTeam(team.id)}
                  className="text-slate-400 hover:text-red-300"
                  title="Remove team"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
              <input
                type="text"
                placeholder="Team name (optional)"
                value={team.name ?? ''}
                onChange={(e) => updateTeam(team.id, { name: e.target.value })}
                className="w-full rounded-md bg-slate-900/80 border border-slate-700 px-2 py-1 mb-1 text-sm"
              />
              <div className="grid grid-cols-2 gap-2">
                <input
                  type="text"
                  value={team.players[0].name}
                  onChange={(e) => updateTeam(team.id, { player1: e.target.value })}
                  className="rounded-md bg-slate-900/80 border border-slate-700 px-2 py-1 text-sm"
                />
                <input
                  type="text"
                  value={team.players[1].name}
                  onChange={(e) => updateTeam(team.id, { player2: e.target.value })}
                  className="rounded-md bg-slate-900/80 border border-slate-700 px-2 py-1 text-sm"
                />
              </div>
            </div>
          ))}
          {teams.length === 0 && (
            <div className="col-span-full text-slate-500 italic text-sm">No teams yet.</div>
          )}
        </div>
      </section>

      <section className="rounded-xl border border-slate-800 bg-slate-900/60 p-4 flex flex-wrap gap-3 items-center justify-between">
        <div className="text-sm text-slate-400">
          {teams.length === expectedTeams
            ? 'Ready to start qualifier.'
            : `Need ${expectedTeams - teams.length > 0 ? 'more' : 'fewer'} ${Math.abs(expectedTeams - teams.length)} team(s) for ${event.courts.length} courts.`}
        </div>
        <div className="flex flex-wrap gap-2">
          <ExportButton event={event} />
          <button
            disabled={!canStartQualifier}
            onClick={() => {
              startQualifier();
              navigate('/qualifier');
            }}
            className="rounded-md bg-amber-500 hover:bg-amber-400 disabled:opacity-40 disabled:cursor-not-allowed text-amber-950 font-semibold px-4 py-2"
          >
            Start qualifier
          </button>
        </div>
      </section>

      <div className="text-xs text-slate-500 text-center">
        Total round duration: {formatMs(event.settings.defaultRoundDurationMs)}
      </div>

      <ConfirmDialog
        open={confirmReset}
        title="Reset entire event?"
        message="This permanently clears teams, scores, and all rounds. You may want to export the event first."
        confirmLabel="Reset"
        destructive
        onConfirm={() => {
          resetEvent();
          setConfirmReset(false);
        }}
        onCancel={() => setConfirmReset(false)}
      />
    </main>
  );
}

function DurationInput({ valueMs, onChange }: { valueMs: number; onChange: (ms: number) => void }) {
  const [text, setText] = useState(formatMs(valueMs));
  return (
    <input
      type="text"
      value={text}
      onChange={(e) => setText(e.target.value)}
      onBlur={() => {
        const parsed = parseDurationInput(text);
        if (parsed !== null) onChange(parsed);
        else setText(formatMs(valueMs));
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
      }}
      className="mt-1 w-28 rounded-md bg-slate-900/80 border border-slate-700 px-3 py-2 text-center tabular-nums font-semibold"
      placeholder="20:00"
    />
  );
}

function ExportButton({ event }: { event: ReturnType<typeof useEventStore.getState>['event'] }) {
  if (!event) return null;
  return (
    <button
      onClick={() => {
        const filename = `koc-${event.name.replace(/[^a-z0-9-_]+/gi, '-')}-${new Date()
          .toISOString()
          .slice(0, 10)}.json`;
        downloadJsonFile(filename, toExportJson(event));
      }}
      className="inline-flex items-center gap-1.5 rounded-md bg-slate-800 hover:bg-slate-700 px-3 py-2 text-sm"
    >
      <Download className="h-4 w-4" /> Export JSON
    </button>
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
    <label className="cursor-pointer rounded-md bg-slate-800 hover:bg-slate-700 text-slate-100 font-semibold px-5 py-2.5 inline-flex items-center gap-2">
      <Upload className="h-4 w-4" />
      Import JSON
      <input
        type="file"
        accept="application/json,.json"
        className="sr-only"
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

// Suppress unused-export warning while keeping the helper available.
void teamLabelShort;
