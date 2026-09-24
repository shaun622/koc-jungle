import { equivalentScoringProfile, resultSummary } from './scoring';
import type { RuleProfile, TournamentFixture, TournamentV1 } from './types';

export interface StandingsPolicy {
  winPoints: number;
  lossPoints: number;
  includeSetDifference: boolean;
  explicitOrder?: string[];
}

export interface StandingRow {
  entryId: string;
  played: number;
  wins: number;
  losses: number;
  matchPoints: number;
  setsFor: number;
  setsAgainst: number;
  gamesFor: number;
  gamesAgainst: number;
  position: number;
  tied: boolean;
}

export interface GroupStandings {
  rows: StandingRow[];
  unresolvedCohorts: string[][];
  differentialDisabled: boolean;
  complete: boolean;
}

const DEFAULT_POLICY: StandingsPolicy = { winPoints: 2, lossPoints: 0, includeSetDifference: false };

export function computeGroupStandings(tournament: TournamentV1, groupId: string, policy: StandingsPolicy = DEFAULT_POLICY): GroupStandings {
  validatePolicy(policy);
  const group = tournament.groups.find((item) => item.id === groupId);
  if (!group) throw new Error('Group not found.');
  const rows = new Map(group.entryIds.map((entryId) => [entryId, emptyRow(entryId)]));
  const fixtures = group.fixtureIds.map((id) => tournament.fixtures.find((item) => item.id === id)).filter((item): item is TournamentFixture => Boolean(item));
  const counted = fixtures.filter((fixture) => fixture.status === 'completed' && fixture.result && fixture.actualEntryIds);
  const profiles = counted.filter((fixture) => fixture.result?.kind === 'played')
    .map((fixture) => fixture.actualRuleProfile ?? tournament.ruleProfiles.find((profile) => profile.id === fixture.ruleProfileId))
    .filter((item): item is RuleProfile => Boolean(item));
  const differentialDisabled = profiles.some((profile) => !equivalentScoringProfile(profile, profiles[0]));

  for (const fixture of counted) {
    const result = fixture.result!;
    const [entryA, entryB] = fixture.actualEntryIds!;
    const rowA = rows.get(entryA);
    const rowB = rows.get(entryB);
    if (!rowA || !rowB || fixture.status === 'voided') continue;
    rowA.played += 1;
    rowB.played += 1;
    const aWon = result.winnerEntryId === entryA;
    const winner = aWon ? rowA : rowB;
    const loser = aWon ? rowB : rowA;
    winner.wins += 1;
    loser.losses += 1;
    winner.matchPoints += policy.winPoints;
    loser.matchPoints += policy.lossPoints;
    if (result.kind === 'played') {
      const profile = fixture.actualRuleProfile ?? tournament.ruleProfiles.find((item) => item.id === fixture.ruleProfileId);
      if (profile) {
        const summary = resultSummary(result, profile);
        rowA.setsFor += summary.setsA;
        rowA.setsAgainst += summary.setsB;
        rowB.setsFor += summary.setsB;
        rowB.setsAgainst += summary.setsA;
        rowA.gamesFor += summary.gamesA;
        rowA.gamesAgainst += summary.gamesB;
        rowB.gamesFor += summary.gamesB;
        rowB.gamesAgainst += summary.gamesA;
      }
    }
  }

  const ordered: StandingRow[] = [];
  const unresolvedCohorts: string[][] = [];
  const pointBuckets = [...rows.values()].sort((a, b) => b.matchPoints - a.matchPoints).reduce<StandingRow[][]>((buckets, row) => {
    const last = buckets.at(-1);
    if (last?.[0].matchPoints === row.matchPoints) last.push(row);
    else buckets.push([row]);
    return buckets;
  }, []);

  for (const bucket of pointBuckets) {
    if (bucket.length === 1) {
      ordered.push(bucket[0]);
      continue;
    }
    const mini = miniTable(fixtures, bucket.map((row) => row.entryId), policy);
    const explicit = explicitCohortOrder(policy.explicitOrder, bucket.map((row) => row.entryId));
    bucket.sort((a, b) => {
      const miniDiff = mini ? (mini.get(b.entryId) ?? -1) - (mini.get(a.entryId) ?? -1) : 0;
      if (miniDiff) return miniDiff;
      if (!differentialDisabled && policy.includeSetDifference) {
        const diff = (b.setsFor - b.setsAgainst) - (a.setsFor - a.setsAgainst);
        if (diff) return diff;
      }
      if (!differentialDisabled) {
        const gameDiff = (b.gamesFor - b.gamesAgainst) - (a.gamesFor - a.gamesAgainst);
        if (gameDiff) return gameDiff;
        if (b.gamesFor !== a.gamesFor) return b.gamesFor - a.gamesFor;
      }
      const aExplicit = explicit.get(a.entryId);
      const bExplicit = explicit.get(b.entryId);
      if (aExplicit !== undefined || bExplicit !== undefined) return (aExplicit ?? Number.MAX_SAFE_INTEGER) - (bExplicit ?? Number.MAX_SAFE_INTEGER);
      return 0;
    });
    const unresolved = findUnresolved(bucket, mini, differentialDisabled, policy, explicit);
    unresolvedCohorts.push(...unresolved);
    ordered.push(...bucket);
  }

  ordered.forEach((row, index) => {
    row.position = index + 1;
    row.tied = unresolvedCohorts.some((cohort) => cohort.includes(row.entryId));
  });
  const terminalStatuses = new Set(['completed', 'voided', 'resolved-bye']);
  return { rows: ordered, unresolvedCohorts, differentialDisabled, complete: fixtures.every((fixture) => terminalStatuses.has(fixture.status)) };
}

function miniTable(fixtures: TournamentFixture[], cohort: string[], policy: StandingsPolicy): Map<string, number> | null {
  for (let left = 0; left < cohort.length; left += 1) {
    for (let right = left + 1; right < cohort.length; right += 1) {
      const meeting = fixtures.find((fixture) => {
        const entrants = fixture.actualEntryIds ?? [fixture.resolvedEntryAId, fixture.resolvedEntryBId];
        return entrants.includes(cohort[left]) && entrants.includes(cohort[right]);
      });
      if (!meeting || meeting.status !== 'completed' || !meeting.result) return null;
    }
  }
  const output = new Map(cohort.map((id) => [id, 0]));
  for (const fixture of fixtures) {
    if (fixture.status !== 'completed' || !fixture.result || !fixture.actualEntryIds) continue;
    const [a, b] = fixture.actualEntryIds;
    if (!cohort.includes(a) || !cohort.includes(b)) continue;
    output.set(fixture.result.winnerEntryId, (output.get(fixture.result.winnerEntryId) ?? 0) + policy.winPoints);
    const loser = fixture.result.winnerEntryId === a ? b : a;
    output.set(loser, (output.get(loser) ?? 0) + policy.lossPoints);
  }
  return output;
}

function findUnresolved(rows: StandingRow[], mini: Map<string, number> | null, differentialDisabled: boolean, policy: StandingsPolicy, explicit: Map<string, number>): string[][] {
  const result: string[][] = [];
  let current: StandingRow[] = [];
  let previousKey = '';
  const keyFor = (row: StandingRow) => {
    const values: Array<string | number> = [mini?.get(row.entryId) ?? 'head-to-head-unresolved'];
    if (!differentialDisabled && policy.includeSetDifference) values.push(row.setsFor - row.setsAgainst);
    if (!differentialDisabled) values.push(row.gamesFor - row.gamesAgainst, row.gamesFor);
    values.push(explicit.get(row.entryId) ?? 'unresolved');
    return values.join('|');
  };
  rows.forEach((row, index) => {
    const key = keyFor(row);
    if (index === 0 || key === previousKey) current.push(row);
    else {
      if (current.length > 1 && !hasFullExplicitOrder(current, explicit)) result.push(current.map((item) => item.entryId));
      current = [row];
    }
    previousKey = key;
  });
  if (current.length > 1 && !hasFullExplicitOrder(current, explicit)) result.push(current.map((item) => item.entryId));
  return result;
}

function emptyRow(entryId: string): StandingRow {
  return { entryId, played: 0, wins: 0, losses: 0, matchPoints: 0, setsFor: 0, setsAgainst: 0, gamesFor: 0, gamesAgainst: 0, position: 0, tied: false };
}

export function standingsFingerprint(tournament: TournamentV1, groupIds: string[]): string {
  const stage = tournament.stages.find((item) => groupIds.some((groupId) => item.groupIds.includes(groupId)));
  return JSON.stringify({
    groups: groupIds.map((groupId) => {
    const group = tournament.groups.find((item) => item.id === groupId);
    return {
      id: groupId,
      entries: group?.entryIds ?? [],
      fixtures: (group?.fixtureIds ?? []).map((id) => {
        const fixture = tournament.fixtures.find((item) => item.id === id);
        return { id, revision: fixture?.result?.revision ?? 0, status: fixture?.status ?? 'missing', profile: fixture?.actualRuleProfile ?? fixture?.ruleProfileId ?? null };
      }),
    };
  }),
    policy: stage?.standingsPolicy ?? DEFAULT_POLICY,
    amended: stage?.amended ?? false,
    destinations: stage?.qualificationDestinations ?? [],
    bands: stage?.qualificationBands ?? [],
  });
}

function validatePolicy(policy: StandingsPolicy): void {
  if (!Number.isInteger(policy.winPoints) || policy.winPoints < 0 || policy.winPoints > 10) throw new Error('Win points must be an integer from 0 to 10.');
  if (!Number.isInteger(policy.lossPoints) || policy.lossPoints < 0 || policy.lossPoints > 10 || policy.winPoints <= policy.lossPoints) throw new Error('Loss points must be an integer from 0 to 10 below win points.');
}

function explicitCohortOrder(order: string[] | undefined, cohort: string[]): Map<string, number> {
  if (!order) return new Map();
  const selected = order.filter((id) => cohort.includes(id));
  if (selected.length !== cohort.length || new Set(selected).size !== cohort.length) return new Map();
  return new Map(selected.map((id, index) => [id, index]));
}

function hasFullExplicitOrder(rows: StandingRow[], explicit: Map<string, number>): boolean {
  return rows.every((row) => explicit.has(row.entryId));
}
