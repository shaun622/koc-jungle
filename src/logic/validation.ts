import type { Court, PendingAssignment, QualifierUnit, Team } from '@/types/domain';

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

  // A round may legitimately use FEWER courts than are configured (a bracket
  // bye round) or MORE matches than courts (they run in waves on the same
  // courts). The only impossible case is more matches than courts *within a
  // single wave*, so count per wave. Assignments with no wave field are all
  // wave 0, so single-wave rounds (KoC always) are checked exactly as before.
  const perWaveCount = new Map<number, number>();
  for (const a of assignments) {
    const w = a.wave ?? 0;
    perWaveCount.set(w, (perWaveCount.get(w) ?? 0) + 1);
  }
  for (const count of perWaveCount.values()) {
    if (count > courts.length) {
      issues.push({
        message: `${count} matches but only ${courts.length} court${
          courts.length === 1 ? '' : 's'
        } available.`,
      });
      break;
    }
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

export interface QualifierScoreRule {
  unit: QualifierUnit;
  target: number;
}

/**
 * Validate one qualifier match's scores.
 *  - points / games: scores must sum to the target (every point/game played).
 *  - time: each team scores independently, so any non-negative integers are
 *    valid (no sum constraint). A 0-0 is still allowed (not yet played reads
 *    as 0-0 which the caller treats as "not entered" via its own UI state).
 *
 * Back-compat: called with no rule it defaults to points / 16.
 */
export function validateQualifierScore(
  scoreA: number,
  scoreB: number,
  rule?: QualifierScoreRule,
): ValidationIssue | null {
  if (!Number.isInteger(scoreA) || !Number.isInteger(scoreB)) {
    return { message: 'Scores must be whole numbers.' };
  }
  if (scoreA < 0 || scoreB < 0) {
    return { message: 'Scores cannot be negative.' };
  }
  const unit = rule?.unit ?? 'points';
  const target = rule?.target ?? QUALIFIER_SUM;
  if (unit === 'points' || unit === 'games') {
    if (scoreA + scoreB !== target) {
      const noun = unit === 'games' ? 'games' : 'points';
      return {
        message: `Qualifier ${noun} must sum to ${target} (got ${scoreA + scoreB}).`,
      };
    }
  }
  // 'time': no sum constraint.
  return null;
}
