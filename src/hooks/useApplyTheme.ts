/**
 * Apply the user's theme preference to <html data-theme="...">.
 * Two options: 'light' or 'dark'. No system-follow mode.
 */

import { useEffect } from 'react';
import { useThemeStore } from '@/store/theme';

export function useApplyTheme(): void {
  const preference = useThemeStore((s) => s.preference);
  useEffect(() => {
    document.documentElement.dataset.theme = preference;
  }, [preference]);
}
