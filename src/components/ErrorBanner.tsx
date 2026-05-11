import { useEventStore } from '@/store/eventStore';
import { Icons } from './Icons';

export function ErrorBanner() {
  const error = useEventStore((s) => s.lastError);
  const clear = useEventStore((s) => s.clearError);
  if (!error) return null;
  return (
    <div className="banner-error" role="alert">
      <span style={{ maxWidth: '36rem' }}>{error}</span>
      <button
        onClick={clear}
        className="op-score-btn"
        style={{ width: 24, height: 24, background: 'transparent', border: 0 }}
        aria-label="Dismiss error"
      >
        <Icons.Close className="icon" />
      </button>
    </div>
  );
}
