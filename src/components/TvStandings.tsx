import { FittedTvStandings } from './FittedTvStandings';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { EventState } from '@/types/domain';
import { leaderboard, rankMovements, teamNameFor } from '@/store/selectors';
import { Icons } from './Icons';
import { RankMovement } from './RankMovement';
import { GamesLine } from './GamesLine';

export function standingsPageSize(count: number, capacity: number): number {
  if (!count) return 1;
  return Math.ceil(count / Math.ceil(count / Math.max(1, capacity)));
}

/** Presentation only. The full ranking is derived from the existing selector. */
function PagedTvStandings({ event, subtitle }: { event: EventState; subtitle: string }) {
  const rows = useMemo(() => leaderboard(event), [event]);
  const movements = useMemo(() => rankMovements(event), [event]);
  const list = useRef<HTMLDivElement>(null);
  const [capacity, setCapacity] = useState(8);
  const [page, setPage] = useState(0);
  const [paused, setPaused] = useState(false);
  const [focused, setFocused] = useState(false);
  const size = standingsPageSize(rows.length, capacity);
  const pageCount = Math.max(1, Math.ceil(rows.length / size));
  const safePage = Math.min(page, pageCount - 1);
  const offset = safePage * size;

  useEffect(() => {
    const element = list.current;
    if (!element) return;
    const measure = () => {
      const scale = Number(getComputedStyle(element).getPropertyValue('--display-scale')) || 1;
      // Keep readable rows after the legacy TV canvas is scaled to an iPad.
      const rowHeight = Math.max(72, 58 / Math.max(.1, scale));
      if (element.clientHeight) setCapacity(Math.max(1, Math.min(16, Math.floor(element.clientHeight / rowHeight))));
    };
    measure();
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measure);
    observer?.observe(element);
    window.addEventListener('resize', measure);
    return () => { observer?.disconnect(); window.removeEventListener('resize', measure); };
  }, []);
  useEffect(() => { setPage(0); }, [event.id]);
  useEffect(() => { setPage((value) => Math.min(value, pageCount - 1)); }, [pageCount]);
  useEffect(() => {
    if (pageCount <= 1 || paused || focused) return;
    const timer = window.setInterval(() => {
      if (!document.hidden) setPage((value) => (value + 1) % pageCount);
    }, 8000);
    return () => window.clearInterval(timer);
  }, [pageCount, paused, focused]);

  return (
    <section className="tv-lb tv-standings" aria-label="Event standings"
      onFocusCapture={() => setFocused(true)}
      onBlurCapture={(event) => { if (!event.currentTarget.contains(event.relatedTarget)) setFocused(false); }}>
      <div className="tv-lb-header"><h2 className="tv-lb-title">Standings</h2><span className="tv-lb-subtitle">{subtitle}</span></div>
      <div className="tv-standing-columns"><span>Team</span><span>Points</span></div>
      <div className="tv-lb-list" ref={list}>
        {rows.slice(offset, offset + size).map((row, index) => (
          <div key={row.teamId} className={'tv-lb-row ' + (offset + index === 0 && row.total > 0 ? 'king' : '')}>
            <span className="rank">{offset + index === 0 && row.total > 0 && event.format === 'koc' ? <Icons.Crown className="tv-lb-crown" /> : offset + index + 1}</span>
            <div className="team-name">
              {event.format === 'koc' && <RankMovement movement={movements.get(row.teamId)} />}
              <div className="tv-lb-name-col"><span title={teamNameFor(event, row.teamId)}>{teamNameFor(event, row.teamId)}</span><GamesLine row={row} className="tv-lb-games" /></div>
            </div>
            <span className="pts">{row.total}</span>
          </div>
        ))}
        {!rows.length && <p className="tv-standings-empty">No teams yet.</p>}
      </div>
      <div className="tv-standings-footer">
        <span>{rows.length ? `${offset + 1}–${Math.min(offset + size, rows.length)} of ${rows.length} teams` : '0 teams'}</span>
        {pageCount > 1 && <div className="tv-standings-pager">
          <button type="button" aria-label="Previous standings page" onClick={() => setPage((safePage + pageCount - 1) % pageCount)}>←</button>
          <button type="button" aria-label={paused ? 'Resume standings rotation' : 'Pause standings rotation'} aria-pressed={paused} onClick={() => setPaused(!paused)}>{paused ? <Icons.Play className="icon" /> : <Icons.Pause className="icon" />}</button>
          <button type="button" aria-label="Next standings page" onClick={() => setPage((safePage + 1) % pageCount)}>→</button>
        </div>}
        <small>{pageCount > 1 ? (paused || focused ? 'Rotation paused' : 'Next page every 8 seconds') : 'Updates after each round'}</small>
      </div>
    </section>
  );
}

/** Keep non-KoC pagination unchanged; only KoC uses the approved fitted board. */
export function TvStandings(props: { event: EventState; subtitle: string }) {
  return (props.event.format ?? 'koc') === 'koc' ? <FittedTvStandings {...props} /> : <PagedTvStandings {...props} />;
}
