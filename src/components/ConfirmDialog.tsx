import { useEffect } from 'react';
import { cn } from '@/utils/classNames';

interface Props {
  open: boolean;
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  destructive?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

export function ConfirmDialog({
  open,
  title,
  message,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  destructive = false,
  onConfirm,
  onCancel,
}: Props) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCancel();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onCancel]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
      <div className="w-full max-w-md rounded-xl border border-slate-700 bg-slate-900 p-5 shadow-2xl">
        <h2 className="text-lg font-bold text-slate-100">{title}</h2>
        <p className="mt-2 text-sm text-slate-300 whitespace-pre-wrap">{message}</p>
        <div className="mt-5 flex justify-end gap-2">
          <button
            onClick={onCancel}
            className="rounded-md bg-slate-800 hover:bg-slate-700 px-4 py-2 text-slate-200 text-sm font-medium"
          >
            {cancelLabel}
          </button>
          <button
            onClick={onConfirm}
            className={cn(
              'rounded-md px-4 py-2 text-sm font-semibold',
              destructive
                ? 'bg-red-500 hover:bg-red-400 text-red-50'
                : 'bg-emerald-500 hover:bg-emerald-400 text-emerald-950',
            )}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
