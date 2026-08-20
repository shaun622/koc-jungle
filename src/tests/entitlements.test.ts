import { beforeEach, describe, expect, it } from 'vitest';
import { isFormatLocked, useEntitlementsStore } from '@/store/entitlements';
import { initIAP, isIAPAvailable } from '@/lib/iap';

describe('trial entitlements', () => {
  beforeEach(() => {
    localStorage.clear();
    useEntitlementsStore.setState({
      pro: false,
      loading: false,
      trialEndsAt: undefined,
      trialUsed: false,
    });
  });

  it('unlocks every format when the seven-day trial starts', () => {
    useEntitlementsStore.getState().startTrial();

    expect(useEntitlementsStore.getState().pro).toBe(true);
    expect(useEntitlementsStore.getState().trialUsed).toBe(true);
    expect(isFormatLocked('koc')).toBe(false);
    expect(isFormatLocked('americano')).toBe(false);
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
