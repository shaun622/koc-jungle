import { useEffect, useState } from 'react';

/**
 * True when the viewport is phone-sized (in either orientation) — used by
 * `/display` to swap the 1920×1080 scaled-canvas layout for a real
 * responsive list. iPad in any orientation has at least one dimension
 * >= 600 AND >= 500, so it never matches.
 *
 *   max-width:  600 catches phone portrait + iPhone SE landscape
 *   max-height: 500 catches phone landscape (any iPhone rotated)
 */
const QUERY = '(max-width: 600px), (max-height: 500px)';

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
