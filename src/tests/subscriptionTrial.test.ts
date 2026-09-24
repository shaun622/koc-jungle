import { describe, expect, it } from 'vitest';
import { freeTrialLabel } from '@/lib/subscriptionTrial';

describe('store trial display', () => {
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
