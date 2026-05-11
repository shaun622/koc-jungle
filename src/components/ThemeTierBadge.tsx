import { Crown } from 'lucide-react';
import { cn } from '@/utils/classNames';

interface Props {
  position: number;
  totalCourts: number;
  pointValue: number;
  compact?: boolean;
}

function tierFor(position: number, totalCourts: number): {
  bg: string;
  border: string;
  text: string;
  label: string;
  isCentre: boolean;
} {
  const isCentre = position === totalCourts;
  if (isCentre) {
    return {
      bg: 'bg-amber-500/15',
      border: 'border-amber-400/60',
      text: 'text-amber-200',
      label: 'Centre',
      isCentre: true,
    };
  }
  const ratio = position / totalCourts;
  if (ratio > 0.7) {
    return { bg: 'bg-slate-200/10', border: 'border-slate-300/40', text: 'text-slate-200', label: 'Top', isCentre: false };
  }
  if (ratio > 0.5) {
    return { bg: 'bg-blue-500/10', border: 'border-blue-400/40', text: 'text-blue-200', label: 'Upper', isCentre: false };
  }
  if (ratio > 0.3) {
    return { bg: 'bg-teal-500/10', border: 'border-teal-400/40', text: 'text-teal-200', label: 'Mid', isCentre: false };
  }
  if (ratio > 0.15) {
    return { bg: 'bg-slate-500/10', border: 'border-slate-400/40', text: 'text-slate-300', label: 'Lower', isCentre: false };
  }
  return { bg: 'bg-slate-700/30', border: 'border-slate-500/40', text: 'text-slate-300', label: 'Bottom', isCentre: false };
}

export function ThemeTierBadge({ position, totalCourts, pointValue, compact }: Props) {
  const t = tierFor(position, totalCourts);
  return (
    <div
      className={cn(
        'inline-flex items-center gap-1.5 rounded-md border px-2 py-1 font-semibold',
        t.bg,
        t.border,
        t.text,
        compact ? 'text-xs' : 'text-sm',
      )}
    >
      {t.isCentre && <Crown className={cn(compact ? 'h-3 w-3' : 'h-4 w-4')} />}
      <span>{pointValue} pts</span>
    </div>
  );
}

export function tierClasses(position: number, totalCourts: number) {
  return tierFor(position, totalCourts);
}
