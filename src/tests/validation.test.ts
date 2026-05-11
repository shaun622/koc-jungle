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
});
