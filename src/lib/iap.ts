/**
 * In-App Purchase wrapper for native Capacitor builds.
 *
 * Two layers:
 *  - Web (PWA, including koc-jungle.pages.dev): IAP is a no-op. The
 *    7-day trial runs in local state; subscribe buttons show a "Open
 *    the iOS or Android app to subscribe" message.
 *  - Native (Capacitor iOS / Android): wires through RevenueCat which
 *    talks to StoreKit / Google Billing.
 *
 * Architecture detail: the platform-specific imports are dynamic so
 * the @revenuecat/purchases-capacitor module doesn't get bundled into
 * the web build. On native, Capacitor's runtime injects the plugin.
 *
 * Env vars (Cloudflare Pages + Xcode .xcconfig):
 *   VITE_REVENUECAT_PUBLIC_API_KEY_IOS     — RevenueCat dashboard, iOS app, public SDK key
 *   VITE_REVENUECAT_PUBLIC_API_KEY_ANDROID — Same for Android
 */

import { Capacitor } from '@capacitor/core';
import { useEntitlementsStore } from '@/store/entitlements';

/** Whether the runtime can perform real in-app purchases. */
export function isIAPAvailable(): boolean {
  return Capacitor.isNativePlatform();
}

/** Identifier matching App Store Connect + Google Play product setup. */
export const PRODUCT_IDS = {
  monthly: 'padel_tm_pro_monthly',
  annual: 'padel_tm_pro_annual',
} as const;

interface RevenueCatOffering {
  monthly?: RevenueCatPackage;
  annual?: RevenueCatPackage;
}
interface RevenueCatPackage {
  identifier: string;
  packageType: string;
  product: {
    identifier: string;
    priceString: string;
    title: string;
  };
}

let cachedOfferings: RevenueCatOffering | null = null;

// Identity state. RevenueCat must be configured before logIn/logOut can be
// called, but Supabase auth can resolve either side of that, so we track
// readiness and stash a pending id to apply once configure() completes.
let configured = false;
let pendingAppUserId: string | null = null;
let currentAppUserId: string | null = null;

/**
 * Configure the SDK + subscribe to customer-info updates so the
 * entitlements store reflects whatever RevenueCat says is active.
 * Call once at app boot from main.tsx (after the Zustand store is
 * ready). No-op on web.
 */
export async function initIAP(): Promise<void> {
  if (!isIAPAvailable()) return;
  const { Purchases, LOG_LEVEL } = await import('@revenuecat/purchases-capacitor');
  const platform = Capacitor.getPlatform();
  const apiKey =
    platform === 'ios'
      ? import.meta.env.VITE_REVENUECAT_PUBLIC_API_KEY_IOS
      : import.meta.env.VITE_REVENUECAT_PUBLIC_API_KEY_ANDROID;
  if (!apiKey) {
    console.warn('[iap] no RevenueCat API key configured for', platform);
    return;
  }
  await Purchases.setLogLevel({ level: LOG_LEVEL.WARN });
  await Purchases.configure({ apiKey });
  configured = true;

  if (pendingAppUserId) {
    // The user signed in before the SDK finished configuring; apply that
    // identity now so entitlements resolve against their account.
    try {
      const { customerInfo } = await Purchases.logIn({ appUserID: pendingAppUserId });
      currentAppUserId = pendingAppUserId;
      applyCustomerInfo(customerInfo);
    } catch (err) {
      console.warn('[iap] deferred logIn failed', err);
    }
    pendingAppUserId = null;
  } else {
    // First read of customer info to seed the entitlements store.
    const { customerInfo } = await Purchases.getCustomerInfo();
    applyCustomerInfo(customerInfo);
  }

  // Live updates whenever RevenueCat hears about a purchase / renewal /
  // cancellation. Note the listener is async-fire-and-forget.
  Purchases.addCustomerInfoUpdateListener((customerInfo) => {
    applyCustomerInfo(customerInfo);
  });
}

/** Pre-fetch the offerings so the paywall shows live prices. Safe to call multiple times. */
export async function fetchOfferings(): Promise<RevenueCatOffering | null> {
  if (!isIAPAvailable()) return null;
  if (cachedOfferings) return cachedOfferings;
  const { Purchases } = await import('@revenuecat/purchases-capacitor');
  // Bound the call: a hung getOfferings (the symptom App Review saw while
  // the Paid Apps Agreement was inactive) must never freeze the paywall.
  // Resolve to null on timeout; the caller shows a fallback label.
  const timeout = new Promise<null>((resolve) => setTimeout(() => resolve(null), 10000));
  const load = (async (): Promise<RevenueCatOffering | null> => {
    try {
      const result = await Purchases.getOfferings();
      const current = result.current;
      if (!current) return null;
      cachedOfferings = {
        monthly: current.monthly ?? undefined,
        annual: current.annual ?? undefined,
      };
      return cachedOfferings;
    } catch {
      // SDK not configured (missing key), store unreachable, agreement not
      // active, etc. Resolve to null so the paywall shows a fallback label
      // rather than letting an unhandled rejection escape.
      return null;
    }
  })();
  return Promise.race([load, timeout]);
}

/** Purchase a plan. Returns true on success (entitlement applied via listener). */
export async function purchasePlan(plan: 'monthly' | 'annual'): Promise<{
  ok: boolean;
  error?: string;
}> {
  if (!isIAPAvailable()) {
    return {
      ok: false,
      error: 'Open the Padel Tournament Maker app on iOS or Android to subscribe.',
    };
  }
  const offerings = await fetchOfferings();
  const pkg = plan === 'monthly' ? offerings?.monthly : offerings?.annual;
  if (!pkg) {
    return { ok: false, error: `Couldn't find the ${plan} subscription. Try again in a moment.` };
  }
  const { Purchases } = await import('@revenuecat/purchases-capacitor');
  try {
    // RevenueCat's PurchasesPackage type has additional internal fields
    // we don't care about; cast through unknown to satisfy TS.
    const { customerInfo } = await Purchases.purchasePackage({
      aPackage: pkg as unknown as Parameters<typeof Purchases.purchasePackage>[0]['aPackage'],
    });
    applyCustomerInfo(customerInfo);
    return { ok: true };
  } catch (err) {
    const e = err as { code?: string; message?: string; userCancelled?: boolean };
    if (e.userCancelled || e.code === '1') {
      return { ok: false, error: 'Purchase cancelled.' };
    }
    return { ok: false, error: e.message ?? 'Purchase failed.' };
  }
}

/** Restore previous purchases for the signed-in Apple / Google account. */
export async function restorePurchases(): Promise<{ ok: boolean; error?: string }> {
  if (!isIAPAvailable()) {
    return { ok: false, error: 'Restore Purchases works inside the iOS / Android app.' };
  }
  const { Purchases } = await import('@revenuecat/purchases-capacitor');
  try {
    const { customerInfo } = await Purchases.restorePurchases();
    applyCustomerInfo(customerInfo);
    return { ok: true };
  } catch (err) {
    const e = err as { message?: string };
    return { ok: false, error: e.message ?? 'Restore failed.' };
  }
}

/**
 * Identify the RevenueCat customer with a stable app-level id (the
 * Supabase auth user id). This keeps Pro status attached to the account
 * across devices and, crucially, lets us grant a promotional entitlement
 * by user id from the RevenueCat dashboard (e.g. comp a friend for free).
 * No-op on web. Safe to call before configure() finishes; the id is
 * applied once the SDK is ready.
 */
export async function logInIAP(appUserId: string): Promise<void> {
  if (!isIAPAvailable() || !appUserId) return;
  if (!configured) {
    pendingAppUserId = appUserId;
    return;
  }
  if (currentAppUserId === appUserId) return;
  const { Purchases } = await import('@revenuecat/purchases-capacitor');
  try {
    const { customerInfo } = await Purchases.logIn({ appUserID: appUserId });
    currentAppUserId = appUserId;
    applyCustomerInfo(customerInfo);
  } catch (err) {
    console.warn('[iap] logIn failed', err);
  }
}

/** Revert to an anonymous RevenueCat id on sign-out. No-op on web or when already anonymous. */
export async function logOutIAP(): Promise<void> {
  if (!isIAPAvailable()) return;
  if (!configured) {
    pendingAppUserId = null;
    return;
  }
  if (!currentAppUserId) return;
  const { Purchases } = await import('@revenuecat/purchases-capacitor');
  try {
    const { customerInfo } = await Purchases.logOut();
    currentAppUserId = null;
    applyCustomerInfo(customerInfo);
  } catch (err) {
    // logOut rejects if the user is already anonymous, which is harmless here.
    console.warn('[iap] logOut skipped', err);
  }
}

/** iOS only: whether the App Store offer-code redemption sheet can be shown. */
export function isRedeemCodeAvailable(): boolean {
  return isIAPAvailable() && Capacitor.getPlatform() === 'ios';
}

/**
 * Present the native App Store offer-code redemption sheet (iOS only).
 * Any entitlement the code unlocks arrives via the customer-info listener,
 * so the paywall flips to the Pro state on its own with no manual refresh.
 */
export async function presentRedeemCodeSheet(): Promise<{ ok: boolean; error?: string }> {
  if (!isRedeemCodeAvailable()) {
    return { ok: false, error: 'Code redemption opens inside the iOS app.' };
  }
  const { Purchases } = await import('@revenuecat/purchases-capacitor');
  try {
    await Purchases.presentCodeRedemptionSheet();
    return { ok: true };
  } catch (err) {
    const e = err as { message?: string };
    return { ok: false, error: e.message ?? 'Could not open the redemption sheet.' };
  }
}

/**
 * Translate RevenueCat's customerInfo into the entitlements store.
 *
 * We treat ANY active entitlement as Pro rather than matching a specific
 * identifier string. The project has a single entitlement ("Padel
 * Tournament Maker Pro"), so "any active entitlement" == Pro, and this
 * avoids breaking if the dashboard identifier is ever renamed.
 */
function applyCustomerInfo(customerInfo: unknown): void {
  const info = customerInfo as {
    entitlements?: {
      active?: Record<string, { isActive?: boolean; expirationDate?: string | null }>;
    };
  };
  const active = info.entitlements?.active ?? {};
  const entries = Object.values(active).filter((e) => e?.isActive !== false);
  const proActive = entries.length > 0;
  // Use the soonest expiration among active entitlements for the trial clock.
  const exps = entries
    .map((e) => (e.expirationDate ? new Date(e.expirationDate).getTime() : undefined))
    .filter((n): n is number => typeof n === 'number');
  const trialEndsAt = exps.length ? Math.min(...exps) : undefined;
  useEntitlementsStore.getState().setPro(proActive, trialEndsAt);
}
