import { confirmedSummaryV3, standingAwardForSideV3 } from './scoring';
import type { AmericanoSide } from '@/logic/americanoV2/types';
import type { AmericanoEventStateV3, AmericanoStandingV3 } from './types';

function entrantIdsForSide(event: AmericanoEventStateV3, side: AmericanoSide): string[] {
  if (event.formatConfig.pairingMode === 'fixed') return side.kind === 'fixed-team' ? [side.teamId] : [];
  return side.kind === 'rotating-pair' ? [...side.playerIds] : [];
}

function orderedEntrantIds(event: AmericanoEventStateV3): string[] {
  return event.americanoSchedule?.orderedEntrantIds
    ?? (event.formatConfig.pairingMode === 'fixed'
      ? event.teams.filter((team) => team.active).map((team) => team.id)
      : event.participants.filter((player) => player.active).map((player) => player.id));
}

function groupBy<T>(rows: T[], keyFor: (row: T) => string): T[][] {
  const groups = new Map<string, T[]>();
  for (const row of rows) {
    const key = keyFor(row);
    groups.set(key, [...(groups.get(key) ?? []), row]);
  }
  return [...groups.values()];
}

function headToHeadAwards(event: AmericanoEventStateV3, firstId: string, secondId: string): Map<string, number> | null {
  if (event.formatConfig.pairingMode !== 'fixed') return null;
  const totals = new Map([[firstId, 0], [secondId, 0]]);
  let matches = 0;
  for (const round of event.rounds) {
    if (!round.completedAt || round.excludedReason) continue;
    for (const match of round.matches) {
      if (!match.resultConfirmed) continue;
      const sideAIds = entrantIdsForSide(event, match.sideA);
      const sideBIds = entrantIdsForSide(event, match.sideB);
      const isDirect = sideAIds.includes(firstId) && sideBIds.includes(secondId)
        || sideAIds.includes(secondId) && sideBIds.includes(firstId);
      if (!isDirect) continue;
      const summary = confirmedSummaryV3(match.result, event.formatConfig.scoring, event.formatConfig.paceMinutes);
      const awardA = standingAwardForSideV3(event.formatConfig.scoring, summary, 'A');
      const awardB = standingAwardForSideV3(event.formatConfig.scoring, summary, 'B');
      if (sideAIds[0] === firstId) {
        totals.set(firstId, totals.get(firstId)! + awardA);
        totals.set(secondId, totals.get(secondId)! + awardB);
      } else {
        totals.set(firstId, totals.get(firstId)! + awardB);
        totals.set(secondId, totals.get(secondId)! + awardA);
      }
      matches += 1;
    }
  }
  return matches ? totals : null;
}

function applyHeadToHead(event: AmericanoEventStateV3, group: AmericanoStandingV3[]): AmericanoStandingV3[][] {
  if (group.length !== 2 || event.formatConfig.pairingMode !== 'fixed') return [group];
  const totals = headToHeadAwards(event, group[0].entrantId, group[1].entrantId);
  if (!totals) return [group];
  const left = totals.get(group[0].entrantId)!;
  const right = totals.get(group[1].entrantId)!;
  if (left === right) return [group];
  const first = left > right ? group[0] : group[1];
  const second = first === group[0] ? group[1] : group[0];
  return [[first], [second]];
}

function applyDifference(group: AmericanoStandingV3[]): AmericanoStandingV3[][] {
  return groupBy(group, (row) => String(row.unitsFor - row.unitsAgainst))
    .sort((a, b) => (b[0].unitsFor - b[0].unitsAgainst) - (a[0].unitsFor - a[0].unitsAgainst));
}

function sideStat(rows: Map<string, AmericanoStandingV3>, entrantIds: string[], award: number, units: number, sets: number, against: number, setsAgainst: number, winner: 'A' | 'B' | null, side: 'A' | 'B'): void {
  for (const entrantId of entrantIds) {
    const row = rows.get(entrantId);
    if (!row) continue;
    row.total += award;
    row.unitsFor += units;
    row.unitsAgainst += against;
    row.setsFor += sets;
    row.setsAgainst += setsAgainst;
    row.matchesPlayed += 1;
    if (winner === null) row.draws += 1;
    else if (winner === side) row.wins += 1;
    else row.losses += 1;
  }
}

export function computeAmericanoStandingsV3(event: AmericanoEventStateV3): AmericanoStandingV3[] {
  const ids = orderedEntrantIds(event);
  const rows = new Map(ids.map((entrantId) => [entrantId, {
    entrantId, rank: 1, total: 0, matchesPlayed: 0, unitsFor: 0, unitsAgainst: 0,
    wins: 0, draws: 0, losses: 0, setsFor: 0, setsAgainst: 0,
  }]));

  for (const round of event.rounds) {
    if (!round.completedAt || round.excludedReason) continue;
    for (const match of round.matches) {
      if (!match.resultConfirmed) continue;
      const summary = confirmedSummaryV3(match.result, event.formatConfig.scoring, event.formatConfig.paceMinutes);
      const unitsA = summary.gamesA;
      const unitsB = summary.gamesB;
      const awardA = standingAwardForSideV3(event.formatConfig.scoring, summary, 'A');
      const awardB = standingAwardForSideV3(event.formatConfig.scoring, summary, 'B');
      sideStat(rows, entrantIdsForSide(event, match.sideA), awardA, unitsA, summary.setsA, unitsB, summary.setsB, summary.winner, 'A');
      sideStat(rows, entrantIdsForSide(event, match.sideB), awardB, unitsB, summary.setsB, unitsA, summary.setsA, summary.winner, 'B');
    }
  }

  const baseRows = [...rows.values()].sort((a, b) => b.total - a.total || ids.indexOf(a.entrantId) - ids.indexOf(b.entrantId));
  const totalGroups = groupBy(baseRows, (row) => String(row.total));
  const policy = event.formatConfig.ranking.tiebreak;
  const rankedGroups: AmericanoStandingV3[][] = [];
  for (const totalGroup of totalGroups) {
    let groups = policy.startsWith('head-to-head') ? applyHeadToHead(event, totalGroup) : [totalGroup];
    if (policy === 'difference' || policy === 'head-to-head-then-difference') groups = groups.flatMap(applyDifference);
    rankedGroups.push(...groups);
  }
  let position = 1;
  for (const group of rankedGroups) {
    for (const row of group) row.rank = position;
    position += group.length;
  }
  return rankedGroups.flat();
}

export function americanoPodiumV3(event: AmericanoEventStateV3): AmericanoStandingV3[] {
  if (!event.rounds.some((round) => Boolean(round.completedAt) && !round.excludedReason)) return [];
  return computeAmericanoStandingsV3(event).filter((row) => row.rank <= 3);
}

export function americanoEntrantViewV3(event: AmericanoEventStateV3, entrantId: string): { id: string; primaryLabel: string; secondaryLabel?: string; playerIds: string[] } {
  if (event.formatConfig.pairingMode === 'fixed') {
    const team = event.teams.find((item) => item.id === entrantId);
    return { id: entrantId, primaryLabel: team?.name?.trim() || team?.players.map((player) => player.name).join(' & ') || entrantId, secondaryLabel: team?.players.map((player) => player.name).join(' & '), playerIds: team ? [team.players[0].id, team.players[1].id] : [] };
  }
  const player = event.participants.find((item) => item.id === entrantId);
  return { id: entrantId, primaryLabel: player?.name ?? entrantId, playerIds: player ? [player.id] : [] };
}
