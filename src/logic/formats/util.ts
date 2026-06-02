/**
 * Shared helpers for tournament-format implementations.
 */

import type { Court, PendingAssignment } from '@/types/domain';

/**
 * Pack scheduled matches onto the highest-position courts first.
 * Throws if there are more matches than courts.
 *
 *  - `formatName` is just used in the thrown error message so each format
 *    reports its own context.
 */
export function packMatchesOntoCourts(
  matches: Array<[string, string]>,
  courts: Court[],
  formatName: string,
): PendingAssignment[] {
  const sortedCourts = courts.slice().sort((a, b) => b.position - a.position);
  if (matches.length > sortedCourts.length) {
    throw new Error(
      `${formatName}: ${matches.length} matches scheduled but only ${sortedCourts.length} courts available.`,
    );
  }
  return matches.map(([teamAId, teamBId], i) => ({
    courtId: sortedCourts[i].id,
    teamAId,
    teamBId,
  }));
}
