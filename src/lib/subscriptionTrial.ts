/** Store-provided offer only; never promise a trial from a marketing constant. */
export interface IntroductoryPrice {
  price: number;
  periodUnit: string;
  periodNumberOfUnits: number;
  cycles: number;
}

export interface StoreTrialProduct {
  introPrice?: IntroductoryPrice | null;
  defaultOption?: {
    freePhase?: {
      price: { amountMicros: number };
      billingPeriod: { unit: string; value: number };
      billingCycleCount: number | null;
    } | null;
  } | null;
}

export function freeTrialLabel(product?: StoreTrialProduct): string | undefined {
  // Only advertise the offer the store selected for this customer. Do not use
  // another subscriptionOption, which may not be eligible for purchase.
  const phase = product?.defaultOption?.freePhase;
  const intro = product?.introPrice ?? (phase ? {
    price: phase.price.amountMicros,
    periodUnit: phase.billingPeriod.unit,
    periodNumberOfUnits: phase.billingPeriod.value,
    cycles: phase.billingCycleCount ?? 1,
  } : undefined);
  if (!intro || intro.price !== 0) return undefined;
  const count = intro.periodNumberOfUnits * intro.cycles;
  const unit = intro.periodUnit.toLowerCase();
  if (!Number.isSafeInteger(count) || count < 1 || !['day', 'week', 'month', 'year'].includes(unit)) return undefined;
  return `${count} ${unit}${count === 1 ? '' : 's'} free`;
}
