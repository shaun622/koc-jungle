import { useMemo } from 'react';
import type { EventState, Team } from '@/types/domain';
import {
  leaderboard,
  nightlyStats,
  rankMovements,
  teamLabelShort,
} from '@/store/selectors';
import { Avatar } from './Avatar';
import { RankMovement } from './RankMovement';
import { Icons } from './Icons';

/**
 * Standalone 1920×1080 "Tournament Complete" canvas.
 *
 * Used both on /display when the event finishes AND inside the off-screen
 * ShareCard so the captured PNG matches what the operator sees on the TV.
 */

const CONFETTI_COUNT = 80;
const CONFETTI_COLORS = [
  'var(--gold)',
  'var(--lime)',
  'var(--blue)',
  'var(--amber)',
  'var(--red)',
  'oklch(85% 0.02 245)',
];

export function TvCompleteView({ event }: { event: EventState }) {
  const rows = useMemo(
    () =>
      leaderboard(event).filter((r) => {
        const t = event.teams.find((tt) => tt.id === r.teamId);
        return t?.active;
      }),
    [event],
  );
  const movements = useMemo(() => rankMovements(event), [event]);

  const confetti = useMemo(
    () =>
      Array.from({ length: CONFETTI_COUNT }, (_, i) => ({
        key: i,
        left: Math.random() * 100,
        delay: Math.random() * 6,
        duration: 5 + Math.random() * 4,
        color: CONFETTI_COLORS[Math.floor(Math.random() * CONFETTI_COLORS.length)],
        size: 10 + Math.random() * 10,
        rotate: Math.random() * 360,
      })),
    [],
  );

  const first = rows[0];
  const second = rows[1];
  const third = rows[2];
  const rest = rows.slice(3);

  const teamFor = (id?: string) => (id ? event.teams.find((t) => t.id === id) : undefined);
  const teamLabel = (id?: string) => {
    const t = teamFor(id);
    return t ? teamLabelShort(t) : '—';
  };

  const completedRounds = event.rounds.filter((r) => r.completedAt).length;
  const stats = useMemo(() => nightlyStats(event), [event]);

  return (
    <div className="tv-display tv-complete">
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

      <div className="tv-header">
        <div className="tv-header-brand">
          <div className="brand-mark lg">K</div>
          <div className="tv-header-event">
            <div className="tv-header-event-name">{event.name}</div>
            <div className="tv-header-event-meta">
              {event.venue ? `${event.venue} • ` : ''}
              {completedRounds} rounds played
            </div>
          </div>
        </div>
        <div className="tv-header-right">
          <span>{rows.length} teams</span>
          <span style={{ opacity: 0.3 }}>•</span>
          <span>{event.courts.length} courts</span>
          <span style={{ opacity: 0.3 }}>•</span>
          <div className="tv-header-live tv-header-final">
            <span style={{ color: 'var(--gold)', letterSpacing: '0.18em' }}>FINAL</span>
          </div>
        </div>
      </div>

      <div className="tv-body tv-complete-body">
        <div className="tv-lb tv-lb-final">
          <div className="tv-lb-header">
            <div className="tv-lb-title">Final Standings</div>
            <div className="tv-lb-subtitle">After R{completedRounds}</div>
          </div>
          <div className="tv-lb-list">
            {rows.map((row, idx) => (
              <div key={row.teamId} className={'tv-lb-row ' + (idx === 0 ? 'king' : '')}>
                <span className="rank">{idx + 1}</span>
                <div className="team-name">
                  {idx === 0 && <Icons.Crown className="tv-lb-crown" />}
                  <RankMovement movement={movements.get(row.teamId)} />
                  <span>{teamLabel(row.teamId)}</span>
                </div>
                <span className="wl">
                  {row.wins}W-{row.losses}L
                </span>
                <span className="pts">{row.total}</span>
              </div>
            ))}
          </div>
        </div>

        <div className="tv-complete-main">
          <div className="tv-complete-title">
            <div className="tv-complete-eyebrow">{event.name}</div>
            <h1 className="tv-complete-headline">Tournament Complete</h1>
            <div className="tv-complete-sub">
              {completedRounds} rounds played · {rows.length} teams
            </div>
          </div>

          <div className="tv-podium-stage">
            <TvPodiumColumn
              place="second"
              team={teamFor(second?.teamId)}
              points={second?.total}
              wins={second?.wins}
            />
            <TvPodiumColumn
              place="first"
              team={teamFor(first?.teamId)}
              points={first?.total}
              wins={first?.wins}
              isChampion
            />
            <TvPodiumColumn
              place="third"
              team={teamFor(third?.teamId)}
              points={third?.total}
              wins={third?.wins}
            />
          </div>

          {rest.length > 0 && (
            <div className="tv-complete-footnote">
              {rest.length} more team{rest.length === 1 ? '' : 's'} in the rail →
            </div>
          )}

          <NightlyStatsStrip stats={stats} />
        </div>
      </div>
    </div>
  );
}

function NightlyStatsStrip({
  stats,
}: {
  stats: ReturnType<typeof nightlyStats>;
}) {
  if (stats.length === 0) return null;
  return (
    <div className="nightly-stats">
      {stats.map((s) => (
        <div key={s.label} className="nightly-stat">
          <div className="nightly-stat-label">{s.label}</div>
          <div className="nightly-stat-value">{s.value}</div>
          {s.detail && <div className="nightly-stat-detail">{s.detail}</div>}
        </div>
      ))}
    </div>
  );
}

function TvPodiumColumn({
  place,
  team,
  points,
  wins,
  isChampion,
}: {
  place: 'first' | 'second' | 'third';
  team: Team | undefined;
  points: number | undefined;
  wins: number | undefined;
  isChampion?: boolean;
}) {
  const placeLabel =
    place === 'first' ? 'CHAMPION' : place === 'second' ? '2ND PLACE' : '3RD PLACE';
  const placeNum = place === 'first' ? '1' : place === 'second' ? '2' : '3';
  return (
    <div className={'tv-podium-column tv-podium-column--' + place}>
      <div className={'tv-podium-team tv-podium-team--' + place}>
        {isChampion && <Icons.Crown className="tv-podium-crown" />}
        <div className="place-tag">{placeLabel}</div>
        {team && (
          <div className="tv-podium-avatars">
            <Avatar player={team.players[0]} size="lg" />
            <Avatar player={team.players[1]} size="lg" />
          </div>
        )}
        <div className="team-name">{team ? teamLabelShort(team) : '—'}</div>
        {team && team.name && (
          <div className="team-players">
            {team.players[0].name} · {team.players[1].name}
          </div>
        )}
        <div className="team-points">
          <span className="pts-value">{points ?? 0}</span>
          <span className="pts-label">PTS</span>
          {wins !== undefined && <span className="pts-wins">· {wins}W</span>}
        </div>
      </div>
      <div className={'tv-podium-block tv-podium-block--' + place}>
        <span className="place-num">{placeNum}</span>
      </div>
    </div>
  );
}
