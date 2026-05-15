import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useEventStore } from '@/store/eventStore';
import { teamLabelShort } from '@/store/selectors';
import { QUALIFIER_TOTAL } from '@/logic/seeding';
import { validateQualifierScore } from '@/logic/validation';
import { Timer } from '@/components/Timer';

export function QualifierScreen() {
  const event = useEventStore((s) => s.event);
  const setQualifierScore = useEventStore((s) => s.setQualifierScore);
  const confirmQualifierResults = useEventStore((s) => s.confirmQualifierResults);
  const startQualifierTimer = useEventStore((s) => s.startQualifierTimer);
  const pauseQualifierTimer = useEventStore((s) => s.pauseQualifierTimer);
  const resetQualifierTimer = useEventStore((s) => s.resetQualifierTimer);
  const adjustQualifierTimer = useEventStore((s) => s.adjustQualifierTimer);
  const navigate = useNavigate();

  if (!event || !event.qualifier) {
    return null;
  }

  const allValid = event.qualifier.matches.every(
    (m) => !validateQualifierScore(m.scoreA, m.scoreB),
  );
  const validCount = event.qualifier.matches.filter(
    (m) => !validateQualifierScore(m.scoreA, m.scoreB),
  ).length;
  const total = event.qualifier.matches.length;

  const matches = event.qualifier.matches
    .slice()
    .sort((a, b) => {
      const pa = event.courts.find((c) => c.id === a.courtId)?.position ?? 0;
      const pb = event.courts.find((c) => c.id === b.courtId)?.position ?? 0;
      return pb - pa;
    });

  return (
    <div className="qual">
      <div className="qual-head">
        <div>
          <div className="qual-title">Qualifier round</div>
          <div className="qual-sub">
            {event.teams.filter((t) => t.active).length} teams paired randomly across {total} courts.
            Each match is best of {QUALIFIER_TOTAL} — every serve played. Enter one team's score and the
            other auto-fills to keep the sum at {QUALIFIER_TOTAL}.
          </div>
        </div>
        <div className="qual-meta">
          {validCount} / {total} matches valid
        </div>
      </div>

      <div className="qual-timer-row">
        <Timer
          state={event.qualifier}
          label="Qualifier round"
          warningAtMs={event.settings.warningAtMs}
          soundEnabled={event.settings.soundOnTimerEnd}
          onStart={startQualifierTimer}
          onPause={pauseQualifierTimer}
          onReset={resetQualifierTimer}
          onAdjust={adjustQualifierTimer}
        />
      </div>

      <div className="qual-grid">
        {matches.map((m, i) => {
          const court = event.courts.find((c) => c.id === m.courtId);
          const teamA = event.teams.find((t) => t.id === m.teamAId);
          const teamB = event.teams.find((t) => t.id === m.teamBId);
          const sum = m.scoreA + m.scoreB;
          const valid = sum === QUALIFIER_TOTAL;
          const tooMuch = sum > QUALIFIER_TOTAL;
          return (
            <div key={m.id} className="qual-match">
              <div className="qual-match-head">
                <span>Match {i + 1}</span>
                <span className="qual-match-court">{court?.name ?? ''}</span>
              </div>
              <div className="qual-row">
                <div className="name">{teamA ? teamLabelShort(teamA) : '—'}</div>
                <QualifierScoreInput
                  value={m.scoreA}
                  onCommit={(n) => setQualifierScore(m.id, n, QUALIFIER_TOTAL - n)}
                />
              </div>
              <div className="qual-row">
                <div className="name">{teamB ? teamLabelShort(teamB) : '—'}</div>
                <QualifierScoreInput
                  value={m.scoreB}
                  onCommit={(n) => setQualifierScore(m.id, QUALIFIER_TOTAL - n, n)}
                />
              </div>
              <div className={'qual-sum ' + (valid ? 'ok' : sum > 0 || !valid ? 'bad' : '')}>
                SUM {sum} / {QUALIFIER_TOTAL}{' '}
                {valid ? '✓' : tooMuch ? '× over' : '× short'}
              </div>
            </div>
          );
        })}
      </div>

      <div className="qual-bottom">
        <div className="qual-bottom-info">
          <strong>Best of {QUALIFIER_TOTAL} format</strong> — every serve is played. Draws ({Math.floor(QUALIFIER_TOTAL / 2)}-{Math.floor(QUALIFIER_TOTAL / 2)}) allowed.
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="btn" onClick={() => navigate('/setup')}>
            ← Back to setup
          </button>
          <button
            className="btn lg primary"
            disabled={!allValid}
            onClick={() => {
              confirmQualifierResults();
              setTimeout(() => navigate('/seeding'), 0);
            }}
          >
            {allValid ? 'Confirm results →' : `${total - validCount} more to enter`}
          </button>
        </div>
      </div>
    </div>
  );
}

function QualifierScoreInput({
  value,
  onCommit,
}: {
  value: number;
  onCommit: (n: number) => void;
}) {
  const [text, setText] = useState(String(value));
  const [focused, setFocused] = useState(false);
  useEffect(() => {
    if (!focused) setText(String(value));
  }, [value, focused]);
  const commit = () => {
    setFocused(false);
    const n = parseInt(text, 10);
    if (!Number.isNaN(n) && n >= 0 && n <= QUALIFIER_TOTAL) {
      onCommit(n);
      setText(String(n));
    } else {
      setText(String(value));
    }
  };
  return (
    <input
      type="number"
      inputMode="numeric"
      min={0}
      max={QUALIFIER_TOTAL}
      value={text}
      onChange={(e) => setText(e.target.value)}
      onFocus={(e) => {
        setFocused(true);
        e.currentTarget.select();
      }}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
      }}
    />
  );
}
