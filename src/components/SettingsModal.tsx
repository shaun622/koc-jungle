import { useState, useEffect } from 'react';
import { useEventStore } from '@/store/eventStore';
import type { TieRule } from '@/types/domain';
import { formatMs, parseDurationInput } from '@/utils/time';
import { Icons } from './Icons';

const TIE_RULE_LABELS: Record<TieRule, string> = {
  'operator-decides': 'Operator nominates winner',
  'team-a-wins': 'Team A wins',
  'split-points': 'Split points',
  replay: 'Replay match',
};

interface Props {
  open: boolean;
  onClose: () => void;
}

export function SettingsModal({ open, onClose }: Props) {
  const event = useEventStore((s) => s.event);
  const updateSettings = useEventStore((s) => s.updateSettings);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open || !event) return null;
  const s = event.settings;

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div
        className="modal settings-modal"
        onClick={(e) => e.stopPropagation()}
        style={{ maxWidth: '32rem' }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
          <h2>Settings</h2>
          <button
            className="op-score-btn"
            onClick={onClose}
            aria-label="Close"
            style={{ background: 'transparent', border: 0 }}
          >
            <Icons.Close className="icon" />
          </button>
        </div>

        <div className="settings-grid">
          <DurationRow
            label="Default round duration"
            valueMs={s.defaultRoundDurationMs}
            onCommit={(ms) => updateSettings({ defaultRoundDurationMs: ms })}
            hint="Used for the next round when no override is set."
          />
          <NumberRow
            label="Total rounds"
            value={s.roundsTotal}
            min={1}
            max={20}
            onCommit={(n) => updateSettings({ roundsTotal: n })}
            hint="Event ends after this many completed rounds."
          />
          <SelectRow
            label="Tie rule"
            value={s.tieRule}
            options={Object.keys(TIE_RULE_LABELS) as TieRule[]}
            optionLabel={(v) => TIE_RULE_LABELS[v]}
            onCommit={(v) => updateSettings({ tieRule: v })}
          />
          <DurationRow
            label="Warning flash at"
            valueMs={s.warningAtMs}
            onCommit={(ms) => updateSettings({ warningAtMs: ms })}
            hint="Timer turns amber when this much time is left."
          />
          <ToggleRow
            label="Buzzer on timer end"
            value={s.soundOnTimerEnd}
            onCommit={(v) => updateSettings({ soundOnTimerEnd: v })}
            hint="Plays a generated tone when the round timer hits zero."
          />
        </div>

        <div className="modal-actions">
          <button className="btn primary" onClick={onClose}>
            Done
          </button>
        </div>
      </div>
    </div>
  );
}

function DurationRow({
  label,
  valueMs,
  onCommit,
  hint,
}: {
  label: string;
  valueMs: number;
  onCommit: (ms: number) => void;
  hint?: string;
}) {
  const [text, setText] = useState(formatMs(valueMs));
  useEffect(() => setText(formatMs(valueMs)), [valueMs]);
  return (
    <label className="settings-row">
      <div className="settings-row-label">
        <span>{label}</span>
        {hint && <span className="settings-row-hint">{hint}</span>}
      </div>
      <input
        type="text"
        inputMode="numeric"
        className="setup-input"
        value={text}
        onChange={(e) => setText(e.target.value)}
        onFocus={(e) => e.currentTarget.select()}
        onBlur={() => {
          const parsed = parseDurationInput(text);
          if (parsed !== null) {
            onCommit(parsed);
            setText(formatMs(parsed));
          } else {
            setText(formatMs(valueMs));
          }
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
        }}
        style={{ width: 100 }}
      />
    </label>
  );
}

function NumberRow({
  label,
  value,
  min,
  max,
  onCommit,
  hint,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  onCommit: (n: number) => void;
  hint?: string;
}) {
  const [text, setText] = useState(String(value));
  useEffect(() => setText(String(value)), [value]);
  return (
    <label className="settings-row">
      <div className="settings-row-label">
        <span>{label}</span>
        {hint && <span className="settings-row-hint">{hint}</span>}
      </div>
      <input
        type="number"
        inputMode="numeric"
        min={min}
        max={max}
        className="setup-input"
        value={text}
        onChange={(e) => setText(e.target.value)}
        onFocus={(e) => e.currentTarget.select()}
        onBlur={() => {
          const n = parseInt(text, 10);
          if (!Number.isNaN(n) && n >= min && n <= max) {
            onCommit(n);
            setText(String(n));
          } else {
            setText(String(value));
          }
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
        }}
        style={{ width: 100 }}
      />
    </label>
  );
}

function SelectRow<T extends string>({
  label,
  value,
  options,
  optionLabel,
  onCommit,
}: {
  label: string;
  value: T;
  options: T[];
  optionLabel: (v: T) => string;
  onCommit: (v: T) => void;
}) {
  return (
    <label className="settings-row">
      <div className="settings-row-label">
        <span>{label}</span>
      </div>
      <select
        className="setup-input"
        value={value}
        onChange={(e) => onCommit(e.target.value as T)}
      >
        {options.map((o) => (
          <option key={o} value={o}>
            {optionLabel(o)}
          </option>
        ))}
      </select>
    </label>
  );
}

function ToggleRow({
  label,
  value,
  onCommit,
  hint,
}: {
  label: string;
  value: boolean;
  onCommit: (v: boolean) => void;
  hint?: string;
}) {
  return (
    <label className="settings-row">
      <div className="settings-row-label">
        <span>{label}</span>
        {hint && <span className="settings-row-hint">{hint}</span>}
      </div>
      <button
        type="button"
        className={'settings-toggle ' + (value ? 'on' : '')}
        onClick={() => onCommit(!value)}
        aria-pressed={value}
      >
        <span className="settings-toggle-dot" />
      </button>
    </label>
  );
}
