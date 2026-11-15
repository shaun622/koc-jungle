import { describe, expect, it } from 'vitest';
import { freeTrialLabel } from '@/lib/subscriptionTrial';

describe('store trial display', () => {
  it('uses the selected Google Play free phase, including non-repeating offers', () => {
    const freePhase = { price: { amountMicros: 0 }, billingPeriod: { unit: 'MONTH', value: 1 }, billingCycleCount: null };
    expect(freeTrialLabel({ defaultOption: { freePhase } })).toBe('1 month free');
    expect(freeTrialLabel({ defaultOption: { freePhase: { ...freePhase, billingCycleCount: 2 } } })).toBe('2 months free');
    expect(freeTrialLabel({ defaultOption: { freePhase: null } })).toBeUndefined();
    expect(freeTrialLabel({ defaultOption: { freePhase: { ...freePhase, price: { amountMicros: 1000000 } } } })).toBeUndefined();
  });
  it.each([['DAY', 30, '30 days free'], ['MONTH', 1, '1 month free'], ['WEEK', 1, '1 week free']])('uses the actual %s offer', (periodUnit, periodNumberOfUnits, label) => {
    expect(freeTrialLabel({ introPrice: { price: 0, periodUnit: String(periodUnit), periodNumberOfUnits: Number(periodNumberOfUnits), cycles: 1 } })).toBe(label);
  });
  it('does not claim free access for missing, paid or invalid offers', () => {
    expect(freeTrialLabel()).toBeUndefined();
    expect(freeTrialLabel({ introPrice: null })).toBeUndefined();
    for (const [price, periodNumberOfUnits] of [[1, 1], [0, 0], [0, NaN]]) {
      expect(freeTrialLabel({ introPrice: { price, periodUnit: 'MONTH', periodNumberOfUnits, cycles: 1 } })).toBeUndefined();
    }
  });
});
