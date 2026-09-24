export class TournamentRuleError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly field?: string,
  ) {
    super(message);
    this.name = 'TournamentRuleError';
  }
}

export function invariant(condition: unknown, code: string, message: string, field?: string): asserts condition {
  if (!condition) throw new TournamentRuleError(code, message, field);
}

