import { describe, expect, it } from 'vitest';
import { validateAssignments, validateQualifierScore } from '@/logic/validation';
import type { Court, PendingAssignment, Team } from '@/types/domain';

function team(id: string, active = true): Team {
  return {
    id,
    players: [
      { id: `${id}-1`, name: 'a' },
      { id: `${id}-2`, name: 'b' },
    ],
    createdAt: 0,
    active,
  };
}

const courts: Court[] = [
  { id: 'c1', position: 1, name: 'C1', pointValue: 3 },
  { id: 'c2', position: 2, name: 'C2', pointValue: 4 },
];

describe('validateAssignments', () => {
  it('accepts clean assignment', () => {
    const teams = ['a', 'b', 'c', 'd'].map((id) => team(id));
    const assignments: PendingAssignment[] = [
      { courtId: 'c1', teamAId: 'a', teamBId: 'b' },
      { courtId: 'c2', teamAId: 'c', teamBId: 'd' },
    ];
    expect(validateAssignments(assignments, courts, teams)).toEqual([]);
  });

  it('detects duplicate team', () => {
    const teams = ['a', 'b', 'c', 'd'].map((id) => team(id));
    const assignments: PendingAssignment[] = [
      { courtId: 'c1', teamAId: 'a', teamBId: 'b' },
      { courtId: 'c2', teamAId: 'a', teamBId: 'd' },
    ];
    const issues = validateAssignments(assignments, courts, teams);
    expect(issues.some((i) => /more than one court/i.test(i.message))).toBe(true);
  });

  it('rejects inactive team', () => {
    const teams = [team('a'), team('b'), team('c'), team('d', false)];
    const assignments: PendingAssignment[] = [
      { courtId: 'c1', teamAId: 'a', teamBId: 'b' },
      { courtId: 'c2', teamAId: 'c', teamBId: 'd' },
    ];
    const issues = validateAssignments(assignments, courts, teams);
    expect(issues.some((i) => /inactive/i.test(i.message))).toBe(true);
  });

  it('detects same team on both sides of a court', () => {
    const teams = ['a', 'b', 'c', 'd'].map((id) => team(id));
    const assignments: PendingAssignment[] = [
      { courtId: 'c1', teamAId: 'a', teamBId: 'a' },
      { courtId: 'c2', teamAId: 'c', teamBId: 'd' },
    ];
    const issues = validateAssignments(assignments, courts, teams);
    expect(issues.some((i) => /both sides/i.test(i.message))).toBe(true);
  });

  it('accepts fewer matches than courts (e.g. a bracket bye round)', () => {
    const teams = ['a', 'b'].map((id) => team(id));
    const assignments: PendingAssignment[] = [
      { courtId: 'c1', teamAId: 'a', teamBId: 'b' },
    ];
    // 1 match, 2 courts — fine, the other court just sits empty.
    expect(validateAssignments(assignments, courts, teams)).toEqual([]);
  });

  it('rejects more matches than courts in a single wave', () => {
    const teams = ['a', 'b', 'c', 'd', 'e', 'f'].map((id) => team(id));
    const assignments: PendingAssignment[] = [
      { courtId: 'c1', teamAId: 'a', teamBId: 'b' },
      { courtId: 'c2', teamAId: 'c', teamBId: 'd' },
      { courtId: 'c1', teamAId: 'e', teamBId: 'f' },
    ];
    // No wave field → all wave 0 → 3 matches > 2 courts at once.
    const issues = validateAssignments(assignments, courts, teams);
    expect(issues.some((i) => /only 2 courts/i.test(i.message))).toBe(true);
  });

  it('accepts more matches than courts when split across waves', () => {
    const teams = ['a', 'b', 'c', 'd', 'e', 'f'].map((id) => team(id));
    const assignments: PendingAssignment[] = [
      { courtId: 'c1', teamAId: 'a', teamBId: 'b', wave: 0 },
      { courtId: 'c2', teamAId: 'c', teamBId: 'd', wave: 0 },
      { courtId: 'c1', teamAId: 'e', teamBId: 'f', wave: 1 },
    ];
    // 3 matches on 2 courts, but wave 0 has 2 and wave 1 has 1 — both fit.
    expect(validateAssignments(assignments, courts, teams)).toEqual([]);
  });
});

describe('validateQualifierScore', () => {
  it('passes when sum is 16', () => {
    expect(validateQualifierScore(8, 8)).toBeNull();
    expect(validateQualifierScore(16, 0)).toBeNull();
    expect(validateQualifierScore(9, 7)).toBeNull();
  });

  it('rejects when sum is not 16', () => {
    expect(validateQualifierScore(10, 5)).not.toBeNull();
    expect(validateQualifierScore(0, 0)).not.toBeNull();
  });

  it('rejects non-integers', () => {
    expect(validateQualifierScore(8.5, 7.5)).not.toBeNull();
  });

  it('rejects negatives', () => {
    expect(validateQualifierScore(-1, 17)).not.toBeNull();
  });

  it('honours a custom points target', () => {
    expect(validateQualifierScore(11, 10, { unit: 'points', target: 21 })).toBeNull();
    expect(validateQualifierScore(11, 9, { unit: 'points', target: 21 })).not.toBeNull();
  });

  it('treats games like points (sum to target)', () => {
    expect(validateQualifierScore(4, 2, { unit: 'games', target: 6 })).toBeNull();
    expect(validateQualifierScore(4, 4, { unit: 'games', target: 6 })).not.toBeNull();
  });

  it('time unit accepts any non-negative scores (no sum constraint)', () => {
    expect(validateQualifierScore(7, 3, { unit: 'time', target: 10 })).toBeNull();
    expect(validateQualifierScore(0, 0, { unit: 'time', target: 10 })).toBeNull();
    expect(validateQualifierScore(30, 12, { unit: 'time', target: 10 })).toBeNull();
    // still rejects negatives / non-integers
    expect(validateQualifierScore(-1, 5, { unit: 'time', target: 10 })).not.toBeNull();
    expect(validateQualifierScore(5.5, 4, { unit: 'time', target: 10 })).not.toBeNull();
  });
});
