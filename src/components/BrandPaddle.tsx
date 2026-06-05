/**
 * BrandPaddle — small paddle silhouette used as the in-app brand mark.
 *
 * Mirrors the app icon (gold padel paddle with drilled-holes pattern)
 * but stylised down to read clearly at 16-40px sizes. Uses currentColor
 * for the dots and a fill that contrasts against the gold pill it lives
 * in, so it adapts to light + dark themes automatically.
 *
 * Three callers: TopNav, ShareCard, SetupScreen landing card. All three
 * wrap it in a .brand-mark div that handles the gold pill background.
 */

export function BrandPaddle({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 32"
      width="100%"
      height="100%"
      className={className}
      aria-hidden="true"
      style={{ display: 'block' }}
    >
      {/* Paddle face — rounded vertical rectangle */}
      <rect
        x="2"
        y="1.5"
        width="20"
        height="22"
        rx="9"
        fill="currentColor"
        opacity="0.0"
      />
      <rect
        x="2"
        y="1.5"
        width="20"
        height="22"
        rx="9"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.2"
      />
      {/* Drilled holes pattern (padel signature) */}
      <g fill="currentColor">
        <circle cx="8" cy="7" r="1.1" />
        <circle cx="12" cy="6.4" r="1.1" />
        <circle cx="16" cy="7" r="1.1" />
        <circle cx="7" cy="11" r="1.1" />
        <circle cx="11" cy="10.5" r="1.1" />
        <circle cx="14.5" cy="10.5" r="1.1" />
        <circle cx="17.5" cy="11" r="1.1" />
        <circle cx="7" cy="15" r="1.1" />
        <circle cx="11" cy="14.5" r="1.1" />
        <circle cx="14.5" cy="14.5" r="1.1" />
        <circle cx="17.5" cy="15" r="1.1" />
        <circle cx="8.5" cy="18.5" r="1.1" />
        <circle cx="12" cy="18.8" r="1.1" />
        <circle cx="15.5" cy="18.5" r="1.1" />
      </g>
      {/* Throat */}
      <path
        d="M 10 23.5 L 14 23.5 L 13.2 25 L 10.8 25 Z"
        fill="currentColor"
      />
      {/* Handle */}
      <rect
        x="10.4"
        y="25"
        width="3.2"
        height="6.2"
        rx="1.2"
        fill="currentColor"
      />
    </svg>
  );
}
