import { useEffect, useMemo, useRef, useState } from 'react';
import type { EventState } from '@/types/domain';
import { leaderboard, rankMovements, teamNameFor, teamPlayersLabel } from '@/store/selectors';
import { Icons } from './Icons';
import { RankMovement } from './RankMovement';
import { GamesLine } from './GamesLine';

/** Presentation only. The full ranking is derived from the existing selector. */
export function FittedTvStandings({ event, subtitle }: { event: EventState; subtitle: string }) {
  const rows = useMemo(() => leaderboard(event), [event]);
  const movements = useMemo(() => rankMovements(event), [event]);
  const list = useRef<HTMLDivElement>(null);
  const [layout, setLayout] = useState({ compact: false, fontSize: 18 });

  useEffect(() => {
    const element = list.current;
    if (!element) return;
    const measure = () => {
      const scale = Number(getComputedStyle(element).getPropertyValue('--display-scale')) || 1;
      if (!element.clientHeight) return;
      const rowHeight = element.clientHeight / Math.max(1, rows.length);
      // Reserve the identity lines first; game statistics are optional in a
      // dense scoreboard, but both players must remain identifiable.
      const compact = rowHeight * scale < 64;
      const quiet = Boolean(element.closest('.tv-display--quiet'));
      let fontSize = quiet
        ? Math.min(Math.max(20, 18 / scale), (rowHeight - 6) * .46)
        : Math.min(Math.max(18, 16 / scale), (rowHeight - 6) * (compact ? .38 : .25));
      const panel = element.closest<HTMLElement>('.tv-standings');
      // Long player names can wrap. Measure the complete identity, not just
      // the row count, before committing the shared standings font size.
      for (let attempt = 0; panel && attempt < 10; attempt++) {
        panel.style.setProperty('--standings-font', `${fontSize}px`);
        const ratios = [...element.querySelectorAll<HTMLElement>('.tv-lb-row')].map((row) => {
          const identity = row.querySelector<HTMLElement>('.tv-lb-name-col');
          return identity?.scrollHeight ? Math.max(1, row.clientHeight - 6) / identity.scrollHeight : 1;
        });
        const fit = Math.min(1, ...ratios);
        if (fit >= 1) break;
        fontSize *= fit * .97;
      }
      setLayout((previous) => previous.compact === compact && previous.fontSize === fontSize
        ? previous : { compact, fontSize });
    };
    measure();
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measure);
    observer?.observe(element);
    let frame = 0;
    const onResize = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(measure);
    };
    window.addEventListener('resize', onResize);
    let active = true;
    void document.fonts?.ready.then(() => { if (active) measure(); });
    return () => { active = false; observer?.disconnect(); cancelAnimationFrame(frame); window.removeEventListener('resize', onResize); };
  }, [rows.length, event.teams]);

  return (
    <section className={'tv-lb tv-standings tv-standings--fit' + (layout.compact ? ' tv-standings--compact' : '')} aria-label="Event standings"
      style={{ ['--standings-font' as string]: `${layout.fontSize}px` }}>
      <div className="tv-lb-header"><h2 className="tv-lb-title">Standings</h2><span className="tv-lb-subtitle">{subtitle}</span></div>
      <div className="tv-standing-columns"><span>Team</span><span>Points</span></div>
      <div className="tv-lb-list" ref={list}>
        {rows.map((row, index) => {
          const team = event.teams.find((candidate) => candidate.id === row.teamId);
          const players = team ? teamPlayersLabel(team).trim() : '';
          const name = team?.name?.trim() || players || teamNameFor(event, row.teamId);
          const showPlayers = players && players.toLowerCase() !== name.toLowerCase();
          return (
          <div key={row.teamId} className={'tv-lb-row ' + (index === 0 && row.total > 0 ? 'king' : '')}>
            <span className="rank">{index === 0 && row.total > 0 && event.format === 'koc' ? <Icons.Crown className="tv-lb-crown" /> : index + 1}</span>
            <div className="team-name">
              {event.format === 'koc' && <RankMovement movement={movements.get(row.teamId)} />}
              <div className="tv-lb-name-col">
                <span className={'tv-lb-team-label' + (!showPlayers ? ' tv-lb-team-label--players' : '')} title={name}>{name}</span>
                {showPlayers && <span className="tv-lb-players">{players}</span>}
                <GamesLine row={row} className="tv-lb-games" />
              </div>
            </div>
            <span className="pts">{row.total}</span>
          </div>
          );
        })}
        {!rows.length && <p className="tv-standings-empty">No teams yet.</p>}
      </div>
      <div className="tv-standings-footer">
        <span>{rows.length} teams</span>
      </div>
    </section>
  );
}
