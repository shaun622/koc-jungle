/**
 * Tiny up/down arrow shown next to a standings row to indicate the team's
 * rank change since the most recent completed round. Subtle on purpose —
 * a small unicode triangle in lime (up) or red (down). 'same' renders
 * nothing so the rows stay clean.
 */
export function RankMovement({
  movement,
}: {
  movement: 'up' | 'down' | 'same' | undefined;
}) {
  if (movement === 'up') {
    return (
      <span
        className="rank-movement rank-movement--up"
        aria-label="moved up since last round"
      >
        ▲
      </span>
    );
  }
  if (movement === 'down') {
    return (
      <span
        className="rank-movement rank-movement--down"
        aria-label="moved down since last round"
      >
        ▼
      </span>
    );
  }
  return null;
}
