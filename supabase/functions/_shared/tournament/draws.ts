import { invariant } from './errors';
import type { FixtureSource, TournamentDrawProposal, TournamentFixture, TournamentGroup, TournamentGroupAmendmentProposal, TournamentStage, TournamentV1 } from './types';
import { TOURNAMENT_CONTRACT_VERSION } from './types';

export type IdFactory = (prefix: string) => string;

export function stagePlanningDefaults(): Pick<TournamentStage,
  'standingsPolicy' | 'seedMode' | 'seedOrder' | 'shuffleSeed' | 'qualificationBands' |
  'qualificationDestinations' | 'plateSourceStageId' | 'plateDependencyFingerprint' | 'plateRulings'> {
  return {
    standingsPolicy: { winPoints: 2, lossPoints: 0, includeSetDifference: false },
    seedMode: 'entered', seedOrder: [], shuffleSeed: null, qualificationBands: [],
    qualificationDestinations: [], plateSourceStageId: null, plateDependencyFingerprint: null, plateRulings: [],
  };
}

export function deterministicIdFactory(namespace: string): IdFactory {
  let index = 0;
  return (prefix) => `${prefix}-${stableHash(`${namespace}|${prefix}|${index++}`)}`;
}

export function seededOrder<T>(items: readonly T[], seed: string): T[] {
  const output = [...items];
  let state = parseInt(stableHash(seed).slice(0, 8), 16) || 1;
  for (let index = output.length - 1; index > 0; index -= 1) {
    state = (Math.imul(state, 1_664_525) + 1_013_904_223) >>> 0;
    const selected = state % (index + 1);
    [output[index], output[selected]] = [output[selected], output[index]];
  }
  return output;
}

export function createDrawProposal(input: Omit<TournamentDrawProposal, 'contractVersion' | 'fingerprint'>): TournamentDrawProposal {
  const proposal = { ...input, contractVersion: TOURNAMENT_CONTRACT_VERSION, fingerprint: '' };
  proposal.fingerprint = drawProposalFingerprint(proposal);
  return proposal;
}

export function drawProposalFingerprint(proposal: Omit<TournamentDrawProposal, 'fingerprint'> | TournamentDrawProposal): string {
  const { fingerprint: _ignored, ...content } = proposal as TournamentDrawProposal;
  return stableHash(canonicalJson(content));
}

export function validateDrawProposal(proposal: TournamentDrawProposal, revision: string): void {
  invariant(proposal.contractVersion === TOURNAMENT_CONTRACT_VERSION, 'CONTRACT_VERSION', 'This draw proposal was created by an unsupported client version.');
  invariant(proposal.baseRevision === revision, 'STALE_PREVIEW', 'The tournament changed after this draw was reviewed. Generate it again.');
  invariant(proposal.fingerprint === drawProposalFingerprint(proposal), 'PROPOSAL_FINGERPRINT', 'The reviewed draw proposal changed before Apply.');
  invariant(proposal.fixtures.every((fixture) => fixture.stageId === proposal.stage.id), 'PROPOSAL_STAGE', 'Every proposed fixture must belong to the proposed stage.');
  invariant(proposal.groups.every((group) => group.stageId === proposal.stage.id), 'PROPOSAL_STAGE', 'Every proposed group must belong to the proposed stage.');
  assertTournamentDependencyAcyclic(proposal.fixtures, proposal.groups);
}

export function createGroupAmendmentProposal(
  state: TournamentV1,
  stageId: string,
  groupId: string,
  entryId: string,
  id: IdFactory,
): TournamentGroupAmendmentProposal {
  const stage = state.stages.find((item) => item.id === stageId);
  invariant(stage && stage.kind === 'group' && stage.groupIds.includes(groupId), 'AMENDMENT_STAGE', 'Choose a group stage and one of its groups.');
  invariant(stage.closedAt === null, 'AMENDMENT_STAGE', 'A closed group stage cannot be amended.');
  const group = state.groups.find((item) => item.id === groupId && item.stageId === stage.id);
  invariant(group, 'AMENDMENT_GROUP', 'Group not found.');
  const entry = state.entries.find((item) => item.id === entryId);
  invariant(entry && entry.divisionId === stage.divisionId && entry.admission === 'confirmed', 'AMENDMENT_ENTRY', 'Choose a confirmed entry from this division.');
  invariant(!stage.entryIds.includes(entry.id) && !state.groups.some((item) => item.stageId === stage.id && item.entryIds.includes(entry.id)), 'AMENDMENT_ENTRY', 'This entry is already in the group stage.');
  invariant(group.entryIds.length > 0, 'AMENDMENT_GROUP', 'A group amendment needs at least one existing opponent.');
  const nextQueue = Math.max(0, ...state.fixtures.map((fixture) => fixture.queueOrder)) + 1;
  const fixtures = group.entryIds.map((opponentId, index) => makeFixture({
    id: id('fixture'),
    divisionId: stage.divisionId,
    stageId: stage.id,
    groupId: group.id,
    label: `${group.name} · amendment ${index + 1}`,
    sideA: { kind: 'entry', entryId: entry.id },
    sideB: { kind: 'entry', entryId: opponentId },
    ruleProfileId: stage.defaultRuleProfileId,
    queueOrder: nextQueue + index,
  }));
  const proposal: TournamentGroupAmendmentProposal = {
    contractVersion: TOURNAMENT_CONTRACT_VERSION,
    baseRevision: state.revision,
    fingerprint: '',
    stageId: stage.id,
    groupId: group.id,
    entryId: entry.id,
    fixtures,
  };
  proposal.fingerprint = groupAmendmentFingerprint(proposal);
  return proposal;
}

export function groupAmendmentFingerprint(
  proposal: Omit<TournamentGroupAmendmentProposal, 'fingerprint'> | TournamentGroupAmendmentProposal,
): string {
  const { fingerprint: _ignored, ...content } = proposal as TournamentGroupAmendmentProposal;
  return stableHash(canonicalJson(content));
}

export function validateGroupAmendmentProposal(state: TournamentV1, proposal: TournamentGroupAmendmentProposal): void {
  invariant(proposal.contractVersion === TOURNAMENT_CONTRACT_VERSION, 'CONTRACT_VERSION', 'This group amendment was created by an unsupported client version.');
  invariant(proposal.baseRevision === state.revision, 'STALE_PREVIEW', 'The tournament changed after this group amendment was reviewed. Generate it again.');
  invariant(proposal.fingerprint === groupAmendmentFingerprint(proposal), 'PROPOSAL_FINGERPRINT', 'The reviewed group amendment changed before Apply.');
  const stage = state.stages.find((item) => item.id === proposal.stageId);
  const group = state.groups.find((item) => item.id === proposal.groupId);
  const entry = state.entries.find((item) => item.id === proposal.entryId);
  invariant(stage && stage.kind === 'group' && stage.groupIds.includes(proposal.groupId) && stage.closedAt === null, 'AMENDMENT_STAGE', 'The group stage can no longer accept this amendment.');
  invariant(group && group.stageId === stage.id && !group.entryIds.includes(proposal.entryId), 'AMENDMENT_GROUP', 'The selected group can no longer accept this entry.');
  invariant(entry && entry.divisionId === stage.divisionId && entry.admission === 'confirmed' && !stage.entryIds.includes(entry.id), 'AMENDMENT_ENTRY', 'The selected entry can no longer be added to this group stage.');
  invariant(proposal.fixtures.length === group.entryIds.length, 'AMENDMENT_FIXTURES', 'The amendment must add exactly one future match against every existing group entry.');
  const opponents = new Set<string>();
  for (const fixture of proposal.fixtures) {
    invariant(fixture.status === 'planned' && fixture.stageId === stage.id && fixture.groupId === group.id && fixture.divisionId === stage.divisionId, 'AMENDMENT_FIXTURES', 'Every amendment fixture must be a new unstarted match in the selected group.');
    invariant(fixture.sideA.kind === 'entry' && fixture.sideA.entryId === entry.id && fixture.sideB.kind === 'entry' && group.entryIds.includes(fixture.sideB.entryId), 'AMENDMENT_FIXTURES', 'Every amendment fixture must pair the new entry with one existing group entry.');
    opponents.add(fixture.sideB.entryId);
  }
  invariant(opponents.size === group.entryIds.length, 'AMENDMENT_FIXTURES', 'The amendment must include each existing group opponent exactly once.');
  const existingFixtureIds = new Set(state.fixtures.map((fixture) => fixture.id));
  invariant(proposal.fixtures.every((fixture) => !existingFixtureIds.has(fixture.id)), 'PROPOSAL_ID_COLLISION', 'A proposed amendment fixture ID already exists.');
}

export function defaultGroups(entryIds: string[], requestedCount = Math.ceil(entryIds.length / 4)): string[][] {
  invariant(entryIds.length >= 2, 'GROUP_ENTRIES', 'A group stage needs at least two entries.');
  invariant(Number.isInteger(requestedCount) && requestedCount >= 1 && requestedCount <= Math.floor(entryIds.length / 2), 'GROUP_COUNT', `Choose from 1 to ${Math.floor(entryIds.length / 2)} groups.`, 'groupCount');
  const minimumSize = Math.floor(entryIds.length / requestedCount);
  const extra = entryIds.length % requestedCount;
  const result: string[][] = [];
  let cursor = 0;
  for (let index = 0; index < requestedCount; index += 1) {
    const size = minimumSize + (index < extra ? 1 : 0);
    result.push(entryIds.slice(cursor, cursor + size));
    cursor += size;
  }
  return result;
}

export function bergerRounds(entryIds: string[]): Array<Array<[string, string]>> {
  if (entryIds.length < 2) return [];
  let positions: Array<string | null> = entryIds.length % 2 ? [...entryIds, null] : [...entryIds];
  const rounds: Array<Array<[string, string]>> = [];
  for (let round = 0; round < positions.length - 1; round += 1) {
    const fixtures: Array<[string, string]> = [];
    for (let index = 0; index < positions.length / 2; index += 1) {
      const left = positions[index];
      const right = positions[positions.length - 1 - index];
      if (left && right) fixtures.push([left, right]);
    }
    rounds.push(fixtures);
    const fixed = positions[0];
    const rotating = positions.slice(1);
    rotating.unshift(rotating.pop() ?? null);
    positions = [fixed, ...rotating];
  }
  return rounds;
}

export function groupFixtureSources(entryIds: string[]): Array<Array<[FixtureSource, FixtureSource]>> {
  return bergerRounds(entryIds).map((round) => round.map(([a, b]) => [
    { kind: 'entry', entryId: a },
    { kind: 'entry', entryId: b },
  ]));
}

export function nextPowerOfTwo(value: number): number {
  if (value <= 1) return 1;
  return 2 ** Math.ceil(Math.log2(value));
}

export function balancedSeedOrder(size: number): number[] {
  invariant(size >= 1 && (size & (size - 1)) === 0, 'BRACKET_SIZE', 'Bracket size must be a power of two.');
  if (size === 1) return [0];
  const smaller = balancedSeedOrder(size / 2);
  const output: number[] = [];
  for (const position of smaller) output.push(position, size - 1 - position);
  return output;
}

export function bracketSlots(sources: FixtureSource[]): FixtureSource[] {
  const size = nextPowerOfTwo(sources.length);
  const order = balancedSeedOrder(size);
  return order.map((sourceIndex) => sources[sourceIndex] ?? { kind: 'bye' });
}

export interface GeneratedFixtureInput {
  id: string;
  divisionId: string;
  stageId: string;
  groupId?: string | null;
  label: string;
  sideA: FixtureSource;
  sideB: FixtureSource;
  ruleProfileId: string;
  queueOrder: number;
}

export function makeFixture(input: GeneratedFixtureInput): TournamentFixture {
  return {
    id: input.id,
    divisionId: input.divisionId,
    stageId: input.stageId,
    groupId: input.groupId ?? null,
    label: input.label,
    sideA: input.sideA,
    sideB: input.sideB,
    resolvedEntryAId: input.sideA.kind === 'entry' ? input.sideA.entryId : null,
    resolvedEntryBId: input.sideB.kind === 'entry' ? input.sideB.entryId : null,
    ruleProfileId: input.ruleProfileId,
    status: 'planned',
    courtId: null,
    queueOrder: input.queueOrder,
    plannedStartAt: null,
    pinned: false,
    actualStartAt: null,
    actualEndAt: null,
    actualEntryIds: null,
    actualPlayerIds: null,
    actualRuleProfile: null,
    liveScore: null,
    result: null,
    voidReason: null,
    sourceFingerprint: sourceFingerprint(input.sideA, input.sideB),
    importedInterruption: false,
    durationOverrideMinutes: null,
    restOverrideMinutes: null,
    estimatedReleaseAt: null,
  };
}

export function generateRoundRobinFixtures(input: {
  divisionId: string;
  stageId: string;
  groups: Array<{ id: string; name: string; entryIds: string[] }>;
  ruleProfileId: string;
  id: IdFactory;
}): TournamentFixture[] {
  const result: TournamentFixture[] = [];
  let queueOrder = 1;
  const schedules = input.groups.map((group) => ({ group, rounds: groupFixtureSources(group.entryIds) }));
  const maxRounds = Math.max(...schedules.map((item) => item.rounds.length), 0);
  for (let roundIndex = 0; roundIndex < maxRounds; roundIndex += 1) {
    for (const { group, rounds } of schedules) {
      const current = rounds[roundIndex] ?? [];
      current.forEach(([sideA, sideB], matchIndex) => {
        result.push(makeFixture({
          id: input.id('fixture'), divisionId: input.divisionId, stageId: input.stageId,
          groupId: group.id, label: `${group.name} · R${roundIndex + 1} M${matchIndex + 1}`,
          sideA, sideB, ruleProfileId: input.ruleProfileId, queueOrder: queueOrder++,
        }));
      });
    }
  }
  return result;
}

export function generateKnockoutFixtures(input: {
  divisionId: string;
  stageId: string;
  sources: FixtureSource[];
  ruleProfileId: string;
  finalRuleProfileId?: string;
  id: IdFactory;
}): TournamentFixture[] {
  invariant(input.sources.length >= 1, 'KNOCKOUT_ENTRIES', 'A knockout needs at least one entry.');
  const size = nextPowerOfTwo(input.sources.length);
  if (size === 1) return [];
  let previous = bracketSlots(input.sources);
  const fixtures: TournamentFixture[] = [];
  let queueOrder = 1;
  const roundCount = Math.log2(size);
  for (let roundIndex = 0; roundIndex < roundCount; roundIndex += 1) {
    const currentIds: string[] = [];
    const matches = previous.length / 2;
    for (let matchIndex = 0; matchIndex < matches; matchIndex += 1) {
      const id = input.id('fixture');
      currentIds.push(id);
      const isFinal = roundIndex === roundCount - 1;
      fixtures.push(makeFixture({
        id, divisionId: input.divisionId, stageId: input.stageId,
        label: knockoutLabel(roundIndex, roundCount, matchIndex),
        sideA: previous[matchIndex * 2], sideB: previous[matchIndex * 2 + 1],
        ruleProfileId: isFinal ? input.finalRuleProfileId ?? input.ruleProfileId : input.ruleProfileId,
        queueOrder: queueOrder++,
      }));
    }
    previous = currentIds.map((fixtureId) => ({ kind: 'winner-of-match', fixtureId } as FixtureSource));
  }
  return fixtures;
}

function knockoutLabel(roundIndex: number, totalRounds: number, matchIndex: number): string {
  const remaining = totalRounds - roundIndex;
  const name = remaining === 1 ? 'Final' : remaining === 2 ? 'Semifinal' : remaining === 3 ? 'Quarterfinal' : `Round ${roundIndex + 1}`;
  return `${name}${remaining === 1 ? '' : ` ${matchIndex + 1}`}`;
}

export function sourceFingerprint(...sources: FixtureSource[]): string {
  return sources.map((source) => source.kind === 'entry' ? `e:${source.entryId}`
    : source.kind === 'group-position' ? `g:${source.groupId}:${source.position}`
      : source.kind === 'bye' ? 'bye' : `${source.kind}:${source.fixtureId}`).join('|');
}

export function goldSilverSources(groupIds: string[]): { gold: FixtureSource[]; silver: FixtureSource[] } {
  return {
    gold: [1, 2].flatMap((position) => groupIds.map((groupId) => ({ kind: 'group-position', groupId, position }) as FixtureSource)),
    silver: [3, 4].flatMap((position) => groupIds.map((groupId) => ({ kind: 'group-position', groupId, position }) as FixtureSource)),
  };
}

export function assertAcyclic(fixtures: TournamentFixture[]): void {
  assertTournamentDependencyAcyclic(fixtures, []);
}

export function assertTournamentDependencyAcyclic(fixtures: TournamentFixture[], groups: TournamentGroup[]): void {
  const byId = new Map(fixtures.map((fixture) => [fixture.id, fixture]));
  const groupById = new Map(groups.map((group) => [group.id, group]));
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const visit = (node: string) => {
    if (visited.has(node)) return;
    invariant(!visiting.has(node), 'QUALIFICATION_CYCLE', 'Fixture and qualification links cannot form a cycle.');
    visiting.add(node);
    if (node.startsWith('q|')) {
      const groupId = node.slice(2);
      const group = groupById.get(groupId);
      invariant(group, 'GROUP_REFERENCE', 'Qualification links must stay within this tournament.');
      group.fixtureIds.forEach(visit);
    } else {
      const fixture = byId.get(node);
      invariant(fixture, 'FIXTURE_REFERENCE', 'Qualification links must stay within this tournament.');
      for (const side of [fixture.sideA, fixture.sideB]) {
        if (side.kind === 'winner-of-match' || side.kind === 'loser-of-match') visit(side.fixtureId);
        if (side.kind === 'group-position') visit(`q|${side.groupId}`);
      }
    }
    visiting.delete(node);
    visited.add(node);
  };
  fixtures.forEach((fixture) => visit(fixture.id));
}

function stableHash(value: string): string {
  let hash = 0xcbf29ce484222325n;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= BigInt(value.charCodeAt(index));
    hash = BigInt.asUintN(64, hash * 0x100000001b3n);
  }
  return hash.toString(16).padStart(16, '0');
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`).join(',')}}`;
  }
  return JSON.stringify(value);
}
