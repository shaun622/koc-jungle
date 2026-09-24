import { useState } from "react";
import {
  americanoEntrantView,
  americanoMatchHistory,
  computeAmericanoStandings,
} from "@/logic/americanoV2/standings";
import type { AmericanoEventStateV2 } from "@/logic/americanoV2/types";
import { ThemeSwitch } from "@/components/ThemeSwitch";

export function AmericanoLeaderboard({
  event,
}: {
  event: AmericanoEventStateV2;
}) {
  const [selected, setSelected] = useState<string | null>(null);
  const rows = computeAmericanoStandings(event);
  const through = event.rounds.filter(
    (round) => round.completedAt && !round.excludedReason
  ).length;
  const selectedView = selected ? americanoEntrantView(event, selected) : null;
  const history = selected ? americanoMatchHistory(event, selected) : [];
  return (
    <main className="americano-leaderboard-page">
      <header>
        <div>
          <span>AMERICANO STANDINGS</span>
          <h1>
            {event.formatConfig.pairingMode === "rotating"
              ? "Players"
              : "Teams"}
          </h1>
        </div>
        <div className="americano-night-tools">
          <strong>
            {through ? `Through round ${through}` : "No completed rounds yet"}
          </strong>
          <ThemeSwitch />
        </div>
      </header>
      <section className="americano-leaderboard-table">
        <div className="head">
          <span>Rank</span>
          <span>
            {event.formatConfig.pairingMode === "rotating" ? "Player" : "Team"}
          </span>
          <span>Played</span>
          <span>W–D–L</span>
          <span>For</span>
          <span>Against</span>
          <span>Points</span>
        </div>
        {rows.map((row) => {
          const entrant = americanoEntrantView(event, row.entrantId);
          return (
            <button
              key={row.entrantId}
              onClick={() => setSelected(row.entrantId)}
            >
              <b>#{row.rank}</b>
              <span>
                <strong>{entrant.primaryLabel}</strong>
                {entrant.secondaryLabel && (
                  <small>{entrant.secondaryLabel}</small>
                )}
              </span>
              <span>{row.matchesPlayed}</span>
              <span>
                {row.wins}–{row.draws}–{row.losses}
              </span>
              <span>{row.pointsFor}</span>
              <span>{row.pointsAgainst}</span>
              <em>{row.total}</em>
            </button>
          );
        })}
      </section>
      {selected && selectedView && (
        <div className="modal-backdrop" onClick={() => setSelected(null)}>
          <section
            className="modal americano-history"
            onClick={(mouseEvent) => mouseEvent.stopPropagation()}
          >
            <header>
              <div>
                <span>MATCH HISTORY</span>
                <h2>{selectedView.primaryLabel}</h2>
              </div>
              <button className="icon-button" onClick={() => setSelected(null)}>
                ×
              </button>
            </header>
            {history.length ? (
              history.map((row) => (
                <div
                  className={
                    "americano-history-row " + (row.excluded ? "excluded" : "")
                  }
                  key={row.fixtureId}
                >
                  <span>R{row.roundIndex}</span>
                  <p>
                    {row.side.primaryLabel} vs {row.opponents.primaryLabel}
                  </p>
                  <strong>
                    {row.ownScore}–{row.opponentScore}
                  </strong>
                  {row.excluded && <small>Excluded</small>}
                </div>
              ))
            ) : (
              <p>No completed matches yet.</p>
            )}
          </section>
        </div>
      )}
    </main>
  );
}
