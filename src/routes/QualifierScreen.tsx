import { useNavigate } from 'react-router-dom';
import { useEventStore } from '@/store/eventStore';
import { teamLabelShort } from '@/store/selectors';
import { QUALIFIER_TOTAL } from '@/logic/seeding';
import { validateQualifierScore } from '@/logic/validation';

export function QualifierScreen() {
  const event = useEventStore((s) => s.event);
  const setQualifierScore = useEventStore((s) => s.setQualifierScore);
  const confirmQualifierResults = useEventStore((s) => s.confirmQualifierResults);
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
            Each match is best of {QUALIFIER_TOTAL} — every serve played. Scores must sum to{' '}
            {QUALIFIER_TOTAL}.
          </div>
        </div>
        <div className="qual-meta">
          {validCount} / {total} matches valid
        </div>
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
                <input
                  type="number"
                  inputMode="numeric"
                  min={0}
                  max={QUALIFIER_TOTAL}
                  value={m.scoreA}
                  onChange={(e) => {
                    const a = Math.max(0, Math.min(QUALIFIER_TOTAL, Number(e.target.value) || 0));
                    setQualifierScore(m.id, a, m.scoreB);
                  }}
                />
              </div>
              <div className="qual-row">
                <div className="name">{teamB ? teamLabelShort(teamB) : '—'}</div>
                <input
                  type="number"
                  inputMode="numeric"
                  min={0}
                  max={QUALIFIER_TOTAL}
                  value={m.scoreB}
                  onChange={(e) => {
                    const b = Math.max(0, Math.min(QUALIFIER_TOTAL, Number(e.target.value) || 0));
                    setQualifierScore(m.id, m.scoreA, b);
                  }}
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
