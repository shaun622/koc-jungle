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
    if (!text.closest('.tv-display--quiet')) return;
    const fit = () => {
      if (!row.clientHeight) return;
      playerLine.style.fontSize = '';
      const style = getComputedStyle(row);
      const available = row.clientHeight - parseFloat(style.paddingTop) - parseFloat(style.paddingBottom) - 6;
      if (available <= 0) return;
      const font = parseFloat(getComputedStyle(playerLine).fontSize);
      if (text.scrollHeight > available) {
        // Wrapping is discontinuous: a height ratio can shrink past the
        // largest readable size. Search within the existing CSS size instead.
        let low = 0;
        let high = font;
        for (let attempt = 0; attempt < 10; attempt++) {
          const size = (low + high) / 2;
          playerLine.style.fontSize = `${size}px`;
          if (text.scrollHeight <= available) low = size;
          else high = size;
        }
        playerLine.style.fontSize = `${low}px`;
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
