/**
 * BrandLogo — the crowned padel ball app logo, used as the in-app brand
 * mark in the top nav, landing card, and share card. Renders the same
 * PNG that ships as the app icon, clipped to a rounded tile by the
 * surrounding .brand-mark container.
 */

export function BrandLogo({ alt = 'Padel Tournament Maker' }: { alt?: string }) {
  return <img src="/icons/icon-192.png" alt={alt} draggable={false} />;
}
