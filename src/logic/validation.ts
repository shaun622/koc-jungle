import type { Court, PendingAssignment, Team } from '@/types/domain';

export interface ValidationIssue {
  message: string;
}

export function validateAssignments(
  assignments: PendingAssignment[],
  courts: Court[],
  teams: Team[],
): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const courtIds = new Set(courts.map((c) => c.id));
  const activeTeamIds = new Set(teams.filter((t) => t.active).map((t) => t.id));

  if (assignments.length !== courts.length) {
    issues.push({
      message: `Expected ${courts.length} court assignments, got ${assignments.length}.`,
    });
  }

  const seenTeams = new Set<string>();
  for (const a of assignments) {
    if (!courtIds.has(a.courtId)) {
      issues.push({ message: 'Assignment references an unknown court.' });
    }
    if (a.teamAId === a.teamBId) {
      issues.push({ message: 'A court cannot have the same team on both sides.' });
    }
    for (const teamId of [a.teamAId, a.teamBId]) {
      if (!activeTeamIds.has(teamId)) {
        issues.push({ message: 'An inactive or unknown team is assigned to a court.' });
      }
      if (seenTeams.has(teamId)) {
        issues.push({ message: 'A team is assigned to more than one court.' });
      }
      seenTeams.add(teamId);
    }
  }

  return issues;
}

export const QUALIFIER_SUM = 16;

export function validateQualifierScore(scoreA: number, scoreB: number): ValidationIssue | null {
  if (!Number.isInteger(scoreA) || !Number.isInteger(scoreB)) {
    return { message: 'Scores must be whole numbers.' };
  }
  if (scoreA < 0 || scoreB < 0) {
    return { message: 'Scores cannot be negative.' };
  }
  if (scoreA + scoreB !== QUALIFIER_SUM) {
    return { message: `Qualifier scores must sum to ${QUALIFIER_SUM} (got ${scoreA + scoreB}).` };
  }
  return null;
}
