import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useEventStore } from '@/store/eventStore';
import { teamLabelShort } from '@/store/selectors';
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

  const unit = event.settings.qualifierUnit ?? 'points';
  const target = event.settings.qualifierTarget ?? 16;
  const rule = { unit, target };
  const isTimed = unit === 'time';
  const noun = unit === 'games' ? 'games' : unit === 'time' ? 'points' : 'points';

  const allValid = event.qualifier.matches.every(
    (m) => !validateQualifierScore(m.scoreA, m.scoreB, rule),
  );
  const validCount = event.qualifier.matches.filter(
    (m) => !validateQualifierScore(m.scoreA, m.scoreB, rule),
  ).length;
  const total = event.qualifier.matches.length;

  const matches = event.qualifier.matches
    .slice()
    .sort((a, b) => {
      const pa = event.courts.find((c) => c.id === a.courtId)?.position ?? 0;
      const pb = event.courts.find((c) => c.id === b.courtId)?.position ?? 0;
      return pb - pa;
    });

  const headSub = isTimed
    ? `${event.teams.filter((t) => t.active).length} teams paired randomly across ${total} courts. Each match runs ${target} minutes. Enter each team's final score.`
    : `${event.teams.filter((t) => t.active).length} teams paired randomly across ${total} courts. Each match plays to ${target} ${noun}, every serve played. Enter one team's score and the other auto-fills.`;

  return (
    <div className="qual">
      <div className="qual-head">
        <div>
          <div className="qual-title">Qualifier round</div>
          <div className="qual-sub">{headSub}</div>
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
          const valid = isTimed ? true : sum === target;
          const tooMuch = sum > target;
          return (
            <div key={m.id} className="qual-match">
              <div className="qual-match-head">
                <span>Match {i + 1}</span>
                <span className="qual-match-court">{court?.name ?? ''}</span>
              </div>
              <div className="qual-row">
                <div className="name">{teamA ? teamLabelShort(teamA) : 'TBD'}</div>
                <QualifierScoreInput
                  value={m.scoreA}
                  max={isTimed ? 99 : target}
                  onCommit={(n) =>
                    isTimed
                      ? setQualifierScore(m.id, n, m.scoreB)
                      : setQualifierScore(m.id, n, target - n)
                  }
                />
              </div>
              <div className="qual-row">
                <div className="name">{teamB ? teamLabelShort(teamB) : 'TBD'}</div>
                <QualifierScoreInput
                  value={m.scoreB}
                  max={isTimed ? 99 : target}
                  onCommit={(n) =>
                    isTimed
                      ? setQualifierScore(m.id, m.scoreA, n)
                      : setQualifierScore(m.id, target - n, n)
                  }
                />
              </div>
              {isTimed ? (
                <div className="qual-sum ok">FINAL {m.scoreA}–{m.scoreB}</div>
              ) : (
                <div className={'qual-sum ' + (valid ? 'ok' : sum > 0 || !valid ? 'bad' : '')}>
                  SUM {sum} / {target}{' '}
                  {valid ? '✓' : tooMuch ? '× over' : '× short'}
                </div>
              )}
            </div>
          );
        })}
      </div>

      <div className="qual-bottom">
        <div className="qual-bottom-info">
          {isTimed ? (
            <>
              <strong>Timed format ({target} min).</strong> Enter each team's final score.
            </>
          ) : (
            <>
              <strong>Play to {target} {noun}.</strong> Every {noun.slice(0, -1)} is played. Draws (
              {Math.floor(target / 2)}-{Math.floor(target / 2)}) allowed.
            </>
          )}
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
  max,
  onCommit,
}: {
  value: number;
  max: number;
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
    if (!Number.isNaN(n) && n >= 0 && n <= max) {
      onCommit(n);
      setText(String(n));
    } else {
      setText(String(value));
    }
  };
  return (
    <input
      // type="text" + inputMode + pattern is the reliable iOS recipe for the
      // plain numeric keypad. type="number" on iOS can still surface the full
      // keyboard. The commit() handler clamps to 0..max.
      type="text"
      inputMode="numeric"
      pattern="[0-9]*"
      maxLength={2}
      value={text}
      onChange={(e) => setText(e.target.value.replace(/[^0-9]/g, ''))}
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
