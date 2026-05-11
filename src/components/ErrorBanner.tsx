import { AlertCircle, X } from 'lucide-react';
import { useEventStore } from '@/store/eventStore';

export function ErrorBanner() {
  const error = useEventStore((s) => s.lastError);
  const clear = useEventStore((s) => s.clearError);
  if (!error) return null;
  return (
    <div className="fixed top-3 left-1/2 -translate-x-1/2 z-40 flex items-start gap-2 rounded-md border border-red-500/60 bg-red-950/90 text-red-100 px-4 py-2 shadow-lg">
      <AlertCircle className="h-4 w-4 mt-0.5" />
      <div className="text-sm max-w-md">{error}</div>
      <button onClick={clear} className="ml-2 text-red-200 hover:text-red-50">
        <X className="h-4 w-4" />
      </button>
    </div>
  );
}
