/** Store-provided offer only; never promise a trial from a marketing constant. */
export interface IntroductoryPrice {
  price: number;
  periodUnit: string;
  periodNumberOfUnits: number;
  cycles: number;
}

export function freeTrialLabel(product?: { introPrice?: IntroductoryPrice | null }): string | undefined {
  const intro = product?.introPrice;
  if (!intro || intro.price !== 0) return undefined;
  const count = intro.periodNumberOfUnits * intro.cycles;
  const unit = intro.periodUnit.toLowerCase();
  if (!Number.isSafeInteger(count) || count < 1 || !['day', 'week', 'month', 'year'].includes(unit)) return undefined;
  return `${count} ${unit}${count === 1 ? '' : 's'} free`;
}
