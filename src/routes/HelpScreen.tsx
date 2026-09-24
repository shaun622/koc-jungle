/**
 * Help / Rules screen: one card per tournament format with rules,
 * scoring, and 'best for' breakdown. Reachable from Settings and from
 * the landing card.
 */

import { useNavigate } from 'react-router-dom';
import { FORMAT_ORDER, FORMAT_RULES } from '@/content/formatRules';

export function HelpScreen() {
  const navigate = useNavigate();
  return (
    <div className="help">
      <div className="help-head">
        <button className="btn ghost sm" onClick={() => navigate(-1)}>
          ← Back
        </button>
        <h2>FORMAT GUIDE</h2>
        <div className="help-sub">
          Choose King of the Court or Americano today. Our complete Tournament
          mode is coming next.
        </div>
      </div>

      <div className="help-grid">
        {FORMAT_ORDER.map((id) => {
          const g = FORMAT_RULES[id];
          return (
            <article key={id} className="help-card">
              <h3 className="help-card-title">{g.name.toUpperCase()}</h3>
              <p className="help-card-tagline">{g.tagline}</p>

              <div className="help-card-section">
                <div className="help-card-label">Best for</div>
                <p>{g.bestFor}</p>
              </div>

              <div className="help-card-section">
                <div className="help-card-label">How it works</div>
                <ol>
                  {g.rules.map((r, i) => (
                    <li key={i}>{r}</li>
                  ))}
                </ol>
              </div>

              <div className="help-card-section">
                <div className="help-card-label">Scoring</div>
                <p>{g.scoring}</p>
              </div>
            </article>
          );
        })}
        <article className="help-card help-card--coming-soon">
          <h3 className="help-card-title">TOURNAMENT</h3>
          <p className="help-card-tagline">A complete draw, from first match to TV-ready podium.</p>
          <div className="help-card-section">
            <div className="help-card-label">Coming soon</div>
            <p>
              Tournament mode is being designed as the third flagship format.
              It will join King of the Court and Americano after the core flow is finalised.
            </p>
          </div>
        </article>
      </div>
    </div>
  );
}
