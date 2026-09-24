import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { isFormatLocked, useEntitlementsStore, trialDaysRemaining } from '@/store/entitlements';
import { initIAP, isIAPAvailable } from '@/lib/iap';

describe('trial entitlements', () => {
  afterEach(() => vi.useRealTimers());
  beforeEach(() => {
    localStorage.clear();
    useEntitlementsStore.setState({
      pro: false,
      loading: false,
      trialEndsAt: undefined,
      trialUsed: false,
    });
  });

  it('starts a 30-day trial and expires at the exact boundary', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-24T00:00:00Z'));
    useEntitlementsStore.getState().startTrial();

    expect(useEntitlementsStore.getState().pro).toBe(true);
    expect(useEntitlementsStore.getState().trialUsed).toBe(true);
    expect(isFormatLocked('koc')).toBe(false);
    expect(isFormatLocked('americano')).toBe(false);
    const end = Date.now() + 30 * 24 * 60 * 60 * 1000;
    expect(useEntitlementsStore.getState().trialEndsAt).toBe(end);
    expect(trialDaysRemaining()).toBe(30);
    vi.setSystemTime(end - 1);
    useEntitlementsStore.getState().tickTrial();
    expect(useEntitlementsStore.getState().pro).toBe(true);
    vi.setSystemTime(end);
    useEntitlementsStore.getState().tickTrial();
    expect(useEntitlementsStore.getState().pro).toBe(false);
  });

  it('does not restart or silently extend an existing trial', () => {
    const previousEnd = Date.now() + 2 * 24 * 60 * 60 * 1000;
    useEntitlementsStore.setState({ pro: true, trialUsed: true, trialEndsAt: previousEnd });
    useEntitlementsStore.getState().startTrial();
    expect(useEntitlementsStore.getState().trialEndsAt).toBe(previousEnd);
  });

  it('returns to the Pro paywall after the trial expires', () => {
    useEntitlementsStore.setState({
      pro: true,
      trialUsed: true,
      trialEndsAt: Date.now() - 1,
    });

    useEntitlementsStore.getState().tickTrial();

    expect(useEntitlementsStore.getState().pro).toBe(false);
    expect(useEntitlementsStore.getState().trialEndsAt).toBeUndefined();
    expect(useEntitlementsStore.getState().trialUsed).toBe(true);
    expect(isFormatLocked('koc')).toBe(true);
    expect(isFormatLocked('americano')).toBe(true);
  });

  it('temporarily includes Pro in the web PWA without changing native billing', async () => {
    expect(isIAPAvailable()).toBe(false);

    await initIAP();

    expect(useEntitlementsStore.getState().pro).toBe(true);
    expect(useEntitlementsStore.getState().trialEndsAt).toBeUndefined();
    expect(isFormatLocked('koc')).toBe(false);
    expect(isFormatLocked('americano')).toBe(false);
  });
});
