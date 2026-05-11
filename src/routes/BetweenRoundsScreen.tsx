import { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useEventStore } from '@/store/eventStore';
import { teamLabelShort } from '@/store/selectors';
import { isCentreCourt, type Court, type Team } from '@/types/domain';
import { Icons } from '@/components/Icons';

type MovementArrow = 'up' | 'down' | 'stay' | 'king';

interface Movement {
  teamId: string;
  fromCourt: Court | undefined;
  toCourt: Court;
  arrow: MovementArrow;
}

export function BetweenRoundsScreen() {
  const event = useEventStore((s) => s.event);
  const startNextRound = useEventStore((s) => s.startNextRound);
  const navigate = useNavigate();

  const movements: Map<string, Movement> = useMemo(() => {
    const map = new Map<string, Movement>();
    if (!event?.pendingAssignments) return map;
    const lastRound = event.rounds[event.rounds.length - 1];
    if (!lastRound) return map;
    const prevByTeam = new Map<string, string>();
    for (const m of lastRound.matches) {
      prevByTeam.set(m.teamAId, m.courtId);
      prevByTeam.set(m.teamBId, m.courtId);
    }
    for (const a of event.pendingAssignments) {
      const toCourt = event.courts.find((c) => c.id === a.courtId)!;
      const isCentre = isCentreCourt(toCourt, event.courts);
      for (const teamId of [a.teamAId, a.teamBId]) {
        const fromCourtId = prevByTeam.get(teamId);
        const fromCourt = fromCourtId ? event.courts.find((c) => c.id === fromCourtId) : undefined;
        let arrow: MovementArrow;
        if (!fromCourt) arrow = 'stay';
        else if (toCourt.position > fromCourt.position) arrow = 'up';
        else if (toCourt.position < fromCourt.position) arrow = 'down';
        else if (isCentre) arrow = 'king';
        else arrow = 'stay';
        map.set(teamId, { teamId, fromCourt, toCourt, arrow });
      }
    }
    return map;
  }, [event]);

  if (!event || !event.pendingAssignments) {
    return <p style={{ padding: 24, color: 'var(--text-2)' }}>Nothing pending.</p>;
  }

  const lastRound = event.rounds[event.rounds.length - 1];
  const sortedAssignments = event.pendingAssignments.slice().sort((a, b) => {
    const pa = event.courts.find((c) => c.id === a.courtId)?.position ?? 0;
    const pb = event.courts.find((c) => c.id === b.courtId)?.position ?? 0;
    return pb - pa;
  });

  return (
    <div className="between">
      <div className="qual-head">
        <div>
          <div className="qual-title">
            Round {lastRound?.index ?? '?'} complete — rotation preview
          </div>
          <div className="qual-sub">
            Winners move up, losers move down. Centre winner stays King, bottom-court loser stays.
          </div>
        </div>
        <div className="qual-meta">
          {event.teams.filter((t) => t.active).length} teams • {event.courts.length} courts
        </div>
      </div>

      <div className="between-grid">
        {sortedAssignments.map((a) => {
          const court = event.courts.find((c) => c.id === a.courtId)!;
          const teamA = event.teams.find((t) => t.id === a.teamAId);
          const teamB = event.teams.find((t) => t.id === a.teamBId);
          const isCentre = isCentreCourt(court, event.courts);
          return (
            <div key={a.courtId} className={'between-card ' + (isCentre ? 'centre' : '')}>
              <div className="between-card-head">
                <div className="between-card-name">
                  {isCentre && <Icons.Crown className="icon" />}
                  {court.name}
                </div>
                <div className="op-court-pts-chip">{court.pointValue} PTS</div>
              </div>
              {teamA && <BetweenTeamRow team={teamA} mv={movements.get(teamA.id)} />}
              {teamB && <BetweenTeamRow team={teamB} mv={movements.get(teamB.id)} />}
            </div>
          );
        })}
      </div>

      <div className="qual-bottom">
        <div className="qual-bottom-info">
          <strong>King stays</strong> as long as they keep winning Centre Court. Bottom-court loser
          stays.
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="btn" onClick={() => navigate('/round')}>
            ← Back to round
          </button>
          <button
            className="btn lg primary"
            onClick={() => {
              startNextRound();
              setTimeout(() => navigate('/round'), 0);
            }}
          >
            Lock &amp; start Round {(lastRound?.index ?? 0) + 1} →
          </button>
        </div>
      </div>
    </div>
  );
}

function BetweenTeamRow({ team, mv }: { team: Team; mv: Movement | undefined }) {
  const arrow = mv?.arrow ?? 'stay';
  const ArrowIcon =
    arrow === 'up' ? Icons.ArrowUp : arrow === 'down' ? Icons.ArrowDown : arrow === 'king' ? Icons.Crown : Icons.Dash;
  const label = arrow === 'up' ? 'UP' : arrow === 'down' ? 'DOWN' : arrow === 'king' ? 'KING' : 'STAY';
  return (
    <div className="between-team-row">
      <Icons.Drag className="icon" style={{ color: 'var(--text-2)' }} />
      <div>
        <div className="between-team-name">{teamLabelShort(team)}</div>
        <div className="between-team-from">
          {mv?.fromCourt ? `from ${mv.fromCourt.name}` : 'seeded'}
          {team.name && ` · ${team.players[0].name} & ${team.players[1].name}`}
        </div>
      </div>
      <div className={'between-arrow ' + arrow}>
        <ArrowIcon className="icon" />
        {label}
      </div>
    </div>
  );
}
