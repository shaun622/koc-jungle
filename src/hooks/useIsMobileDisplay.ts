import { useEffect, useState } from 'react';

/**
 * True only for phone PORTRAIT — `/display` uses the responsive list
 * layout there so the operator can score with their thumb.
 *
 * Phone landscape gets the desktop 1920×1080 scaled canvas (even though
 * it renders tiny on the phone itself) — the operator AirPlays/mirrors
 * to a TV in landscape and wants the TV to show the proper canvas
 * layout, not the mobile list.
 *
 * iPad in any orientation: width is always >= 744, so never matches.
 */
const QUERY = '(max-width: 600px)';

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
