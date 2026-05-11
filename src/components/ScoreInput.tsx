import { useEffect, useRef, useState } from 'react';
import { Minus, Plus } from 'lucide-react';
import { cn } from '@/utils/classNames';

interface Props {
  value: number;
  onChange: (next: number) => void;
  min?: number;
  max?: number;
  helper?: string;
  size?: 'sm' | 'md' | 'lg';
  disabled?: boolean;
}

export function ScoreInput({
  value,
  onChange,
  min = 0,
  max = 99,
  helper,
  size = 'md',
  disabled = false,
}: Props) {
  const [text, setText] = useState(String(value));
  const lastValueRef = useRef(value);

  useEffect(() => {
    if (value !== lastValueRef.current) {
      lastValueRef.current = value;
      setText(String(value));
    }
  }, [value]);

  const clamp = (v: number) => Math.max(min, Math.min(max, Math.round(v)));

  const commit = (raw: string) => {
    const num = Number(raw);
    if (Number.isFinite(num)) {
      const next = clamp(num);
      lastValueRef.current = next;
      setText(String(next));
      onChange(next);
    } else {
      setText(String(value));
    }
  };

  const btnSize =
    size === 'lg'
      ? 'h-14 w-14 text-2xl'
      : size === 'sm'
        ? 'h-9 w-9 text-base'
        : 'h-12 w-12 text-xl';

  const numSize =
    size === 'lg'
      ? 'text-5xl w-20'
      : size === 'sm'
        ? 'text-2xl w-12'
        : 'text-3xl w-16';

  return (
    <div className="flex flex-col items-center gap-1">
      <div className="flex items-center gap-2">
        <button
          aria-label="Decrease score"
          disabled={disabled || value <= min}
          onClick={() => onChange(clamp(value - 1))}
          className={cn(
            'rounded-md bg-slate-800 hover:bg-slate-700 active:bg-slate-600 disabled:opacity-30 flex items-center justify-center text-slate-200',
            btnSize,
          )}
        >
          <Minus className="h-5 w-5" />
        </button>
        <input
          type="number"
          inputMode="numeric"
          value={text}
          disabled={disabled}
          onChange={(e) => setText(e.target.value)}
          onBlur={(e) => commit(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              commit((e.target as HTMLInputElement).value);
              (e.target as HTMLInputElement).blur();
            }
          }}
          className={cn(
            'rounded-md bg-slate-900/60 text-center font-extrabold tabular-nums text-slate-100 border border-slate-700 focus:border-emerald-400 focus:outline-none py-1',
            numSize,
          )}
        />
        <button
          aria-label="Increase score"
          disabled={disabled || value >= max}
          onClick={() => onChange(clamp(value + 1))}
          className={cn(
            'rounded-md bg-emerald-600 hover:bg-emerald-500 active:bg-emerald-400 disabled:opacity-30 flex items-center justify-center text-emerald-50',
            btnSize,
          )}
        >
          <Plus className="h-5 w-5" />
        </button>
      </div>
      {helper && <div className="text-xs text-slate-400">{helper}</div>}
    </div>
  );
}
