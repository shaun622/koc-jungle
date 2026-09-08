import { useThemeStore } from '@/store/theme';

/** Device appearance only: never writes to the event, roster or cloud. */
export function ThemeSwitch({ className = '' }: { className?: string }) {
  const preference = useThemeStore((state) => state.preference);
  const setPreference = useThemeStore((state) => state.setPreference);
  return (
    <div className={`theme-switch ${className}`} role="group" aria-label="Colour theme">
      <button type="button" aria-pressed={preference === 'light'} onClick={() => setPreference('light')}>Light</button>
      <button type="button" aria-pressed={preference === 'dark'} onClick={() => setPreference('dark')}>Dark</button>
    </div>
  );
}
