import { forwardRef } from 'react';
import type { EventState, Team } from '@/types/domain';
import { TvCompleteView } from './TvCompleteView';
import { BrandPaddle } from './BrandPaddle';

/**
 * Off-screen render of a share card. Two variants:
 *  - 'podium': renders the 1920×1080 TV complete view (final standings rail
 *    on the left + podium + headline + nightly stats on the right). The
 *    captured PNG is exactly what the operator sees on the TV.
 *  - 'roster': 1080×1350 pre-event team list (unchanged).
 *
 * Sits in the DOM at position: fixed; left: -10000px so it doesn't disrupt
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
        <TvCompleteView event={props.event} />
      ) : (
        <RosterCard event={props.event} />
      )}
    </div>
  );
});

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
          <div className="brand-mark lg"><BrandPaddle /></div>
          <span>PADEL TOURNAMENT MAKER</span>
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
