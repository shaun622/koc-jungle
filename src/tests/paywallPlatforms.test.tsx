import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
const platform = vi.hoisted(() => ({ value: 'ios' }));
vi.mock('@capacitor/core', () => ({ Capacitor: { getPlatform: () => platform.value } }));
vi.mock('@/lib/iap', () => ({
  isIAPAvailable: () => true,
  isRedeemCodeAvailable: () => platform.value === 'ios',
  fetchOfferings: async () => ({ monthly: { product: {
    priceString: 'A$9.99',
    defaultOption: { freePhase: { price: { amountMicros: 0 }, billingPeriod: { unit: 'MONTH', value: 1 }, billingCycleCount: 1 } },
  } } }),
  purchasePlan: vi.fn(), restorePurchases: vi.fn(), presentRedeemCodeSheet: vi.fn(),
}));
import { PaywallModal } from '@/components/PaywallModal';
import { useEntitlementsStore } from '@/store/entitlements';
beforeEach(() => useEntitlementsStore.setState({ pro: false, trialUsed: false, trialEndsAt: undefined }));
afterEach(cleanup);
describe('native platform billing copy', () => {
  it.each(['ios', 'android'])('shows correct store and offer on %s without a local trial unlock', async (name) => {
    platform.value = name;
    render(<PaywallModal onClose={() => {}} />);
    await waitFor(() => expect(screen.getByText('A$9.99 / month')).toBeInTheDocument());
    expect(screen.getByText(/1 month free if eligible/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Start 30-day free trial' })).not.toBeInTheDocument();
    expect(screen.getByText(/Americano: rotating or fixed pairs/)).toBeInTheDocument();
    if (name === 'android') {
      expect(screen.getByText(/Google Play confirms your eligibility/)).toBeInTheDocument();
      expect(screen.getByText(/Payments & subscriptions/)).toBeInTheDocument();
      expect(screen.queryByText(/Apple Account/)).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'Redeem code' })).not.toBeInTheDocument();
    } else {
      expect(screen.getByText(/The App Store confirms your eligibility/)).toBeInTheDocument();
      expect(screen.getByText(/Apple Account/)).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Redeem code' })).toBeInTheDocument();
    }
  });
});
