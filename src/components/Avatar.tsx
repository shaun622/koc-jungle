import type { Player } from '@/types/domain';
import { avatarColor, playerInitials } from '@/utils/avatar';

type Size = 'xs' | 'sm' | 'md' | 'lg';

interface Props {
  player: Player;
  size?: Size;
  className?: string;
  /** Optional aria-label override (defaults to player name). */
  ariaLabel?: string;
}

const SIZE_PX: Record<Size, number> = {
  xs: 24,
  sm: 32,
  md: 56,
  lg: 96,
};

/**
 * Round avatar — renders the uploaded photo if present, otherwise a
 * coloured circle with the player's initials.
 */
export function Avatar({ player, size = 'sm', className = '', ariaLabel }: Props) {
  const px = SIZE_PX[size];
  const photo = player.avatar?.photoDataUrl;
  const cls = `avatar avatar--${size} ${className}`.trim();
  if (photo) {
    return (
      <span
        className={cls}
        role="img"
        aria-label={ariaLabel ?? player.name}
        style={{ width: px, height: px, backgroundImage: `url(${photo})` }}
      />
    );
  }
  return (
    <span
      className={cls + ' avatar--initials'}
      role="img"
      aria-label={ariaLabel ?? player.name}
      style={{ width: px, height: px, background: avatarColor(player) }}
    >
      {playerInitials(player.name)}
    </span>
  );
}

/**
 * Two avatars stacked side-by-side — used to identify a team in a single slot.
 */
export function TeamAvatars({
  players,
  size = 'sm',
  className = '',
}: {
  players: [Player, Player];
  size?: Size;
  className?: string;
}) {
  return (
    <span className={`team-avatars team-avatars--${size} ${className}`.trim()}>
      <Avatar player={players[0]} size={size} />
      <Avatar player={players[1]} size={size} />
    </span>
  );
}
