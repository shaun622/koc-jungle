import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useEventStore } from '@/store/eventStore';
import { leaderboard, teamLabelShort } from '@/store/selectors';
import { Icons } from '@/components/Icons';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { downloadJsonFile, toExportJson } from '@/utils/exportImport';
import type { Team } from '@/types/domain';

type Place = 'first' | 'second' | 'third';

const CONFETTI_COUNT = 60;
const CONFETTI_COLORS = [
  'var(--gold)',
  'var(--lime)',
  'var(--blue)',
  'var(--amber)',
  'var(--red)',
  'oklch(85% 0.02 245)',
];

export function PodiumScreen() {
  const event = useEventStore((s) => s.event);
  const resetEvent = useEventStore((s) => s.resetEvent);
  const navigate = useNavigate();
  const [confirmReset, setConfirmReset] = useState(false);

  const rows = useMemo(() => {
    if (!event) return [];
    return leaderboard(event).filter((r) => {
      const t = event.teams.find((tt) => tt.id === r.teamId);
      return t?.active;
    });
  }, [event]);

  const confetti = useMemo(
    () =>
      Array.from({ length: CONFETTI_COUNT }, (_, i) => ({
        key: i,
        left: Math.random() * 100,
        delay: Math.random() * 6,
        duration: 4 + Math.random() * 4,
        color: CONFETTI_COLORS[Math.floor(Math.random() * CONFETTI_COLORS.length)],
        size: 6 + Math.random() * 6,
        rotate: Math.random() * 360,
      })),
    [],
  );

  if (!event) return null;

  const first = rows[0];
  const second = rows[1];
  const third = rows[2];
  const rest = rows.slice(3);

  const teamFor = (id?: string): Team | undefined =>
    id ? event.teams.find((t) => t.id === id) : undefined;

  return (
    <div className="podium-screen">
      <div className="podium-confetti" aria-hidden="true">
        {confetti.map((c) => (
          <span
            key={c.key}
            style={{
              left: `${c.left}%`,
              animationDelay: `${c.delay}s`,
              animationDuration: `${c.duration}s`,
              background: c.color,
              width: `${c.size}px`,
              height: `${c.size * 1.6}px`,
              transform: `rotate(${c.rotate}deg)`,
            }}
          />
        ))}
      </div>

      <div className="podium-head">
        <div className="podium-head-eyebrow">{event.name}</div>
        <h1 className="podium-head-title">Tournament Complete</h1>
        <p className="podium-head-sub">
          {event.rounds.filter((r) => r.completedAt).length} rounds played ·{' '}
          {rows.length} teams
        </p>
      </div>

      <div className="podium-stage">
        <PodiumColumn place="second" team={teamFor(second?.teamId)} points={second?.total} />
        <PodiumColumn place="first" team={teamFor(first?.teamId)} points={first?.total} />
        <PodiumColumn place="third" team={teamFor(third?.teamId)} points={third?.total} />
      </div>

      {rest.length > 0 && (
        <div className="podium-rest">
          <div className="podium-rest-title">— The rest of the field —</div>
          <div className="podium-rest-list">
            {rest.map((row, idx) => {
              const team = teamFor(row.teamId);
              return (
                <div
                  key={row.teamId}
                  className="podium-rest-row"
                  style={{ animationDelay: `${2.6 + idx * 0.06}s` }}
                >
                  <span className="rank">#{idx + 4}</span>
                  <span className="name">
                    {team ? teamLabelShort(team) : row.teamId}
                  </span>
                  <span className="wl">
                    {row.wins}W · {row.losses}L
                  </span>
                  <span className="points">{row.total}</span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      <div className="podium-actions">
        <button className="btn" onClick={() => navigate('/leaderboard')}>
          Full standings
        </button>
        <button
          className="btn"
          onClick={() => {
            const filename = `koc-${event.name.replace(/[^a-z0-9-_]+/gi, '-')}-final.json`;
            downloadJsonFile(filename, toExportJson(event));
          }}
        >
          Export results
        </button>
        <button className="btn" onClick={() => navigate('/display')}>
          TV mode
        </button>
        <button className="btn primary" onClick={() => setConfirmReset(true)}>
          Start new event →
        </button>
      </div>

      <ConfirmDialog
        open={confirmReset}
        title="Start a new event?"
        message="This clears the current tournament — teams, scores, rounds, podium. Export results first if you want to keep them."
        confirmLabel="Yes, start fresh"
        destructive
        onConfirm={() => {
          resetEvent();
          setConfirmReset(false);
          setTimeout(() => navigate('/setup'), 0);
        }}
        onCancel={() => setConfirmReset(false)}
      />
    </div>
  );
}

function PodiumColumn({
  place,
  team,
  points,
}: {
  place: Place;
  team: Team | undefined;
  points: number | undefined;
}) {
  const placeLabel = place === 'first' ? 'CHAMPION' : place === 'second' ? '2ND PLACE' : '3RD PLACE';
  const placeNum = place === 'first' ? '1' : place === 'second' ? '2' : '3';
  return (
    <div className={'podium-column podium-column--' + place}>
      <div className={'podium-team podium-team--' + place}>
        {place === 'first' && <Icons.Crown className="icon lg team-crown" />}
        <div className="place-tag">{placeLabel}</div>
        <div className="team-name">{team ? teamLabelShort(team) : '—'}</div>
        {team && (
          <div className="team-players">
            {team.players[0].name} · {team.players[1].name}
          </div>
        )}
        <div className="team-points">
          <span>{points ?? 0}</span> pts
        </div>
      </div>
      <div className={'podium-block podium-block--' + place}>
        <span className="place-num">{placeNum}</span>
      </div>
    </div>
  );
}
