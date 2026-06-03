/**
 * Apply the user's theme preference to <html data-theme="...">.
 * Re-runs when preference changes; also subscribes to OS theme changes
 * when in 'auto' mode so the page flips live with the system.
 */

import { useEffect } from 'react';
import { resolveTheme, useThemeStore } from '@/store/theme';

export function useApplyTheme(): void {
  const preference = useThemeStore((s) => s.preference);
  useEffect(() => {
    const root = document.documentElement;
    const apply = () => {
      root.dataset.theme = resolveTheme(preference);
    };
    apply();
    if (preference !== 'auto') return;
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    mq.addEventListener('change', apply);
    return () => mq.removeEventListener('change', apply);
  }, [preference]);
}
