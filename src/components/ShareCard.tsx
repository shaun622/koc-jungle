import { forwardRef } from 'react';
import type { EventState, Team } from '@/types/domain';
import { leaderboard, teamLabelShort, teamNameFor } from '@/store/selectors';
import { Icons } from './Icons';

/**
 * Off-screen render of a 1080x1350 share card. Two variants:
 *  - 'podium': post-event results (top 3 podium + top 5 standings)
 *  - 'roster': pre-event team list
 *
 * Sits in the DOM at position: absolute; left: -9999px so it doesn't disrupt
 * layout. Captured by html-to-image when the operator clicks Share.
 */

interface PodiumProps {
  variant: 'podium';
  event: EventState;
}

interface RosterProps {
  variant: 'roster';
  event: EventState;
}

type Props = PodiumProps | RosterProps;

export const ShareCard = forwardRef<HTMLDivElement, Props>(function ShareCard(props, ref) {
  return (
    <div ref={ref} className={'share-card share-card--' + props.variant}>
      {props.variant === 'podium' ? (
        <PodiumCard event={props.event} />
      ) : (
        <RosterCard event={props.event} />
      )}
    </div>
  );
});

function PodiumCard({ event }: { event: EventState }) {
  const rows = leaderboard(event).filter((r) => {
    const t = event.teams.find((tt) => tt.id === r.teamId);
    return t?.active;
  });
  const [first, second, third, ...rest] = rows;
  const top5Rest = rest.slice(0, 7);
  const completedRounds = event.rounds.filter((r) => r.completedAt).length;
  const date = new Date(event.createdAt).toLocaleDateString(undefined, {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });

  const teamFor = (id?: string) => (id ? event.teams.find((t) => t.id === id) : undefined);

  return (
    <>
      <div className="share-card-header">
        <div className="share-card-brand">
          <div className="brand-mark lg">K</div>
          <span>KING OF THE COURT</span>
        </div>
        <div className="share-card-meta">
          <div className="share-card-event-name">{event.name}</div>
          <div className="share-card-event-date">
            {event.venue ? `${event.venue} · ` : ''}
            {date} · {completedRounds} rounds
          </div>
        </div>
      </div>

      <div className="share-card-headline">Tournament Complete</div>

      <div className="share-card-podium">
        <ShareCardPodiumColumn place="second" team={teamFor(second?.teamId)} points={second?.total} />
        <ShareCardPodiumColumn
          place="first"
          team={teamFor(first?.teamId)}
          points={first?.total}
          isChampion
        />
        <ShareCardPodiumColumn place="third" team={teamFor(third?.teamId)} points={third?.total} />
      </div>

      {top5Rest.length > 0 && (
        <div className="share-card-rest">
          <div className="share-card-rest-title">— The rest —</div>
          <div className="share-card-rest-list">
            {top5Rest.map((row, idx) => (
              <div key={row.teamId} className="share-card-rest-row">
                <span className="rank">#{idx + 4}</span>
                <span className="name">{teamNameFor(event, row.teamId)}</span>
                <span className="pts">{row.total}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="share-card-footer">koc-jungle.pages.dev</div>
    </>
  );
}

function RosterCard({ event }: { event: EventState }) {
  const teams = event.teams.filter((t) => t.active);
  const date = new Date(event.createdAt).toLocaleDateString(undefined, {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
  const half = Math.ceil(teams.length / 2);
  const left = teams.slice(0, half);
  const right = teams.slice(half);

  return (
    <>
      <div className="share-card-header">
        <div className="share-card-brand">
          <div className="brand-mark lg">K</div>
          <span>KING OF THE COURT</span>
        </div>
        <div className="share-card-meta">
          <div className="share-card-event-name">{event.name}</div>
          <div className="share-card-event-date">
            {event.venue ? `${event.venue} · ` : ''}
            {date}
          </div>
        </div>
      </div>

      <div className="share-card-headline" style={{ color: 'var(--lime)' }}>
        Tonight's Lineup
      </div>

      <div className="share-card-roster">
        <div className="share-card-roster-col">
          {left.map((team, i) => (
            <RosterRow key={team.id} team={team} index={i + 1} />
          ))}
        </div>
        <div className="share-card-roster-col">
          {right.map((team, i) => (
            <RosterRow key={team.id} team={team} index={left.length + i + 1} />
          ))}
        </div>
      </div>

      <div className="share-card-roster-meta">
        <div>
          <strong>{teams.length}</strong> teams
        </div>
        <div>
          <strong>{event.courts.length}</strong> courts
        </div>
        <div>
          <strong>{event.settings.roundsTotal}</strong> rounds ·{' '}
          <strong>
            {Math.round(event.settings.defaultRoundDurationMs / 60000)}m
          </strong>{' '}
          each
        </div>
      </div>

      <div className="share-card-footer">koc-jungle.pages.dev</div>
    </>
  );
}

function RosterRow({ team, index }: { team: Team; index: number }) {
  return (
    <div className="share-card-roster-row">
      <span className="rank">#{index}</span>
      <span className="name">
        {team.players[0].name} <span style={{ color: 'var(--text-2)' }}>&</span>{' '}
        {team.players[1].name}
      </span>
    </div>
  );
}

function ShareCardPodiumColumn({
  place,
  team,
  points,
  isChampion,
}: {
  place: 'first' | 'second' | 'third';
  team: Team | undefined;
  points: number | undefined;
  isChampion?: boolean;
}) {
  const placeNum = place === 'first' ? '1' : place === 'second' ? '2' : '3';
  return (
    <div className={'share-card-podium-column share-card-podium-column--' + place}>
      <div className={'share-card-podium-team share-card-podium-team--' + place}>
        {isChampion && <Icons.Crown className="share-card-podium-crown" />}
        <div className="team-name">{team ? teamLabelShort(team) : '—'}</div>
        <div className="team-points">
          <span>{points ?? 0}</span> pts
        </div>
      </div>
      <div className={'share-card-podium-block share-card-podium-block--' + place}>
        <span>{placeNum}</span>
      </div>
    </div>
  );
}
