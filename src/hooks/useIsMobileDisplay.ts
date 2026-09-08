import { useEffect, useState } from 'react';

/**
 * Phones and portrait tablets use the readable, scrollable scoring list.
 *
 * Phone landscape gets the desktop 1920×1080 scaled canvas (even though
 * it renders tiny on the phone itself) — the operator AirPlays/mirrors
 * to a TV in landscape and wants the TV to show the proper canvas
 * layout, not the mobile list.
 *
 * Landscape tablets retain the TV canvas for mirroring. Portrait tablets
 * should not squeeze the entire TV layout into the top third of the screen.
 */
const QUERY = '(max-width: 600px), (max-width: 1100px) and (orientation: portrait)';

export function useIsMobileDisplay(): boolean {
  const [isMobile, setIsMobile] = useState(() => {
    if (typeof window === 'undefined') return false;
    return window.matchMedia(QUERY).matches;
  });

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const mql = window.matchMedia(QUERY);
    const onChange = (e: MediaQueryListEvent) => setIsMobile(e.matches);
    mql.addEventListener('change', onChange);
    return () => mql.removeEventListener('change', onChange);
  }, []);

  return isMobile;
}
