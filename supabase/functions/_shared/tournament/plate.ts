import type { TournamentPlateRuling, TournamentV1 } from './types';

export interface PlateEligibility { eligible: string[]; unresolved: string[]; excluded: string[] }

/** First-played-loss eligibility in original stage seed order. Byes and
 * walkover wins do not consume eligibility; administrative outcomes require
 * explicit settlement outside this helper. */
export function firstPlayedLossEligibility(state: TournamentV1, mainStageId: string, rulings: TournamentPlateRuling[] = []): PlateEligibility {
  const stage = state.stages.find((item) => item.id === mainStageId);
  if (!stage) throw new Error('Main draw stage not found.');
  const eligible: string[] = [];
  const unresolved: string[] = [];
  const excluded: string[] = [];
  const rulingByEntry = new Map(rulings.map((ruling) => [ruling.entryId, ruling]));
  for (const entryId of stage.entryIds) {
    const appearances = state.fixtures
      .filter((fixture) => fixture.stageId === stage.id && fixture.status !== 'voided' && fixture.actualEntryIds?.includes(entryId))
      .sort((a,b) => (a.actualStartAt ?? Number.MAX_SAFE_INTEGER) - (b.actualStartAt ?? Number.MAX_SAFE_INTEGER) || a.queueOrder - b.queueOrder || a.id.localeCompare(b.id));
    let settled = false;
    for (const fixture of appearances) {
      const fixtureResult = fixture.result;
      if (!fixtureResult) continue;
      if (fixtureResult.kind === 'played' || fixtureResult.kind === 'retirement') {
        (fixtureResult.winnerEntryId === entryId ? excluded : eligible).push(entryId);
        settled = true;
        break;
      }
      if (fixtureResult.kind === 'administrative' || fixtureResult.kind === 'walkover' && fixtureResult.winnerEntryId !== entryId) {
        const ruling = rulingByEntry.get(entryId);
        if (ruling?.reason.trim()) (ruling.decision === 'include' ? eligible : excluded).push(entryId);
        else if (fixtureResult.kind === 'walkover') excluded.push(entryId);
        else unresolved.push(entryId);
        settled = true;
        break;
      }
    }
    if (!settled) unresolved.push(entryId);
  }
  return { eligible, unresolved, excluded };
}

export function plateDependencyFingerprint(state: TournamentV1, mainStageId: string, rulings: TournamentPlateRuling[] = []): string {
  const stage = state.stages.find((item) => item.id === mainStageId);
  if (!stage) throw new Error('Main draw stage not found.');
  return JSON.stringify({
    stageId: stage.id,
    seedOrder: stage.seedOrder,
    entries: stage.entryIds,
    rulings: [...rulings].sort((a, b) => a.entryId.localeCompare(b.entryId)),
    fixtures: state.fixtures.filter((fixture) => fixture.stageId === mainStageId).map((fixture) => ({
      id: fixture.id, status: fixture.status, resultRevision: fixture.result?.revision ?? 0,
      kind: fixture.result?.kind ?? null, winner: fixture.result?.winnerEntryId ?? null,
    })),
  });
}
