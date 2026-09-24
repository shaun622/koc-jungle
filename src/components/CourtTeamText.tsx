import { useLayoutEffect, useRef } from 'react';
import type { Team } from '@/types/domain';
import { teamPlayersLabel } from '@/store/selectors';

/** Fit long identities into their allotted scoreboard row, never an ellipsis. */
export function CourtTeamText({ team }: { team: Team | undefined }) {
  const ref = useRef<HTMLDivElement>(null);
  const players = team ? teamPlayersLabel(team) : 'TBD';
  const name = team?.name;
  useLayoutEffect(() => {
    const text = ref.current;
    const row = text?.closest<HTMLElement>('.tv-court-row');
    const playerLine = text?.querySelector<HTMLElement>('.tv-court-team-name');
    if (!text || !row || !playerLine) return;
    const fit = () => {
      if (!row.clientHeight) return;
      playerLine.style.fontSize = '';
      const style = getComputedStyle(row);
      const available = row.clientHeight - parseFloat(style.paddingTop) - parseFloat(style.paddingBottom) - 6;
      if (available <= 0) return;
      let font = parseFloat(getComputedStyle(playerLine).fontSize);
      for (let attempt = 0; attempt < 10 && text.scrollHeight > available; attempt++) {
        font *= Math.min(.9, available / text.scrollHeight);
        playerLine.style.fontSize = `${font}px`;
      }
    };
    fit();
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(fit);
    observer?.observe(row);
    if (text.parentElement) observer?.observe(text.parentElement);
    let active = true;
    void document.fonts?.ready.then(() => { if (active) fit(); });
    return () => { active = false; observer?.disconnect(); };
  }, [name, players]);
  return <div className="tv-court-team-text" ref={ref}>
    {name && <div className="tv-court-team-label">{name}</div>}
    <div className="tv-court-team-name">{players}</div>
  </div>;
}
