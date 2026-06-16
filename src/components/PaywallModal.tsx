/**
 * PaywallModal: pitches Pro and starts the 7-day trial or initiates
 * a subscription purchase.
 *
 * Prices shown here are placeholders for the PWA build. Native builds
 * (Capacitor, Stage 2.2) replace these with prices fetched live from
 * the store via RevenueCat so any price changes propagate automatically.
 */

import { useEntitlementsStore, trialDaysRemaining } from '@/store/entitlements';
import {
  fetchOfferings,
  isIAPAvailable,
  isRedeemCodeAvailable,
  presentRedeemCodeSheet,
  purchasePlan,
  restorePurchases,
} from '@/lib/iap';
import { openUrl } from '@/lib/browser';
import { useEffect, useState } from 'react';
import { Portal } from './Portal';

const TERMS_URL = 'https://koc-jungle.pages.dev/terms/';
const PRIVACY_URL = 'https://koc-jungle.pages.dev/privacy/';

const FEATURES = [
  'King of the Court: winners climb, losers drop',
  'Americano: rotating partners pool',
  'Mexicano: dynamic re-pairing each round',
  'Round Robin: group stage all-play-all',
  'Single-elimination bracket: knockout tournaments',
  'Cloud sync: events across all your devices',
];

export function PaywallModal({
  onClose,
  reason,
}: {
  onClose: () => void;
  /** Optional contextual reason for the prompt (e.g. "Round Robin needs Pro"). */
  reason?: string;
}) {
  const { pro, trialUsed, startTrial } = useEntitlementsStore();
  const trialDays = trialDaysRemaining();
  const [busy, setBusy] = useState<'monthly' | 'annual' | 'restore' | 'redeem' | null>(null);
  const [purchaseError, setPurchaseError] = useState<string | null>(null);
  const [prices, setPrices] = useState<{ monthly?: string; annual?: string }>({});
  const [offerStatus, setOfferStatus] = useState<'idle' | 'loading' | 'ready' | 'error'>(
    isIAPAvailable() ? 'loading' : 'idle',
  );

  // Fetch live store prices on mount (native only). fetchOfferings is
  // timeout-bounded, so this can never leave the buttons stuck loading.
  useEffect(() => {
    if (!isIAPAvailable()) return;
    let cancelled = false;
    fetchOfferings()
      .then((o) => {
        if (cancelled) return;
        if (o && (o.monthly || o.annual)) {
          setPrices({
            monthly: o.monthly?.product.priceString,
            annual: o.annual?.product.priceString,
          });
          setOfferStatus('ready');
        } else {
          setOfferStatus('error');
        }
      })
      .catch(() => {
        if (!cancelled) setOfferStatus('error');
      });
    return () => {
      cancelled = true;
    };
  }, []);

  function priceLabel(plan: 'monthly' | 'annual'): string {
    if (busy === plan) return 'Connecting…';
    const p = plan === 'monthly' ? prices.monthly : prices.annual;
    if (p) return `${p} / ${plan === 'annual' ? 'year' : 'month'}`;
    if (offerStatus === 'loading') return 'Loading price…';
    if (offerStatus === 'error') return 'Price unavailable';
    return ''; // web / idle: the footer note explains store pricing
  }

  async function handlePurchase(plan: 'monthly' | 'annual') {
    setBusy(plan);
    setPurchaseError(null);
    try {
      const result = await purchasePlan(plan);
      if (result.ok) onClose();
      else if (result.error) setPurchaseError(result.error);
    } finally {
      // Always clear busy so the button can never stick on "Connecting…".
      setBusy(null);
    }
  }

  async function handleRestore() {
    setBusy('restore');
    setPurchaseError(null);
    const result = await restorePurchases();
    setBusy(null);
    if (result.ok) onClose();
    else if (result.error) setPurchaseError(result.error);
  }

  async function handleRedeem() {
    setBusy('redeem');
    setPurchaseError(null);
    const result = await presentRedeemCodeSheet();
    setBusy(null);
    // Don't close: if the code grants Pro, the customer-info listener
    // flips `pro` and this modal re-renders into its "You're Pro" state.
    if (!result.ok && result.error) setPurchaseError(result.error);
  }

  if (pro) {
    return (
      <Portal>
      <div className="modal-backdrop" onClick={(e) => e.target === e.currentTarget && onClose()}>
        <div className="modal paywall-modal">
          <h2>You're Pro 👑</h2>
          {trialDays > 0 && (
            <p>
              You're on the free trial, {trialDays} {trialDays === 1 ? 'day' : 'days'} remaining.
            </p>
          )}
          <p style={{ color: 'var(--text-2)', fontSize: 13 }}>
            All formats and cloud sync are unlocked.
          </p>
          <div className="modal-actions">
            <button className="btn primary" onClick={onClose}>
              Got it
            </button>
          </div>
        </div>
      </div>
      </Portal>
    );
  }

  return (
    <Portal>
    <div className="modal-backdrop" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal paywall-modal">
        <h2>Unlock everything with Pro</h2>
        {reason && (
          <p style={{ color: 'var(--accent)', fontSize: 13, fontWeight: 600 }}>{reason}</p>
        )}
        <ul className="paywall-features">
          {FEATURES.map((f) => (
            <li key={f}>
              <span className="paywall-check">✓</span>
              {f}
            </li>
          ))}
        </ul>

        {!trialUsed ? (
          <button
            className="btn full primary lg"
            onClick={() => {
              startTrial();
              onClose();
            }}
          >
            Start 7-day free trial
          </button>
        ) : (
          <p style={{ color: 'var(--text-2)', fontSize: 12, textAlign: 'center' }}>
            You've already used the free trial on this device.
          </p>
        )}

        <div className="paywall-divider"><span>or subscribe</span></div>

        <div className="paywall-plans">
          <button
            className="btn full lg paywall-plan"
            disabled={busy !== null}
            onClick={() => handlePurchase('monthly')}
          >
            <span className="paywall-plan-name">
              Pro Monthly
              <span style={{ display: 'block', fontSize: 10, fontWeight: 400, color: 'var(--text-2)', letterSpacing: '0.02em', marginTop: 2 }}>Auto-renews monthly</span>
            </span>
            <span className="paywall-plan-price">{priceLabel('monthly')}</span>
          </button>
          <button
            className="btn full lg paywall-plan"
            disabled={busy !== null}
            onClick={() => handlePurchase('annual')}
          >
            <span className="paywall-plan-name">
              Pro Annual <span className="paywall-plan-badge">save 33%</span>
              <span style={{ display: 'block', fontSize: 10, fontWeight: 400, color: 'var(--text-2)', letterSpacing: '0.02em', marginTop: 2 }}>Auto-renews yearly</span>
            </span>
            <span className="paywall-plan-price">{priceLabel('annual')}</span>
          </button>
        </div>

        {purchaseError && (
          <div style={{ color: 'var(--red)', fontSize: 12, textAlign: 'center', marginTop: 4 }}>
            {purchaseError}
          </div>
        )}
        {!isIAPAvailable() && (
          <div style={{ color: 'var(--text-2)', fontSize: 11, textAlign: 'center', marginTop: 4 }}>
            Subscribe in the iOS or Android app to unlock.
          </div>
        )}

        <div className="modal-actions">
          {isRedeemCodeAvailable() && (
            <button className="btn" disabled={busy !== null} onClick={handleRedeem}>
              {busy === 'redeem' ? 'Opening…' : 'Redeem code'}
            </button>
          )}
          <button className="btn" disabled={busy !== null} onClick={handleRestore}>
            {busy === 'restore' ? 'Restoring…' : 'Restore purchases'}
          </button>
          <button className="btn" onClick={onClose}>
            Not now
          </button>
        </div>

        <p
          style={{
            fontSize: 10,
            color: 'var(--text-2)',
            textAlign: 'center',
            marginTop: 10,
            lineHeight: 1.5,
          }}
        >
          Pro Monthly and Pro Annual are auto-renewable subscriptions. Payment is
          charged to your Apple ID at confirmation of purchase. Each renews
          automatically unless cancelled at least 24 hours before the end of the
          current period; your account is charged within 24 hours before renewal.
          Manage or cancel anytime in your App Store account settings.
        </p>

        <div
          style={{
            display: 'flex',
            justifyContent: 'center',
            gap: 6,
            marginTop: 8,
            fontSize: 11,
          }}
        >
          <button
            onClick={() => openUrl(TERMS_URL)}
            style={{
              background: 'none',
              border: 0,
              color: 'var(--accent)',
              textDecoration: 'underline',
              cursor: 'pointer',
              padding: 0,
              font: 'inherit',
            }}
          >
            Terms of Use (EULA)
          </button>
          <span aria-hidden style={{ color: 'var(--text-2)' }}>
            ·
          </span>
          <button
            onClick={() => openUrl(PRIVACY_URL)}
            style={{
              background: 'none',
              border: 0,
              color: 'var(--accent)',
              textDecoration: 'underline',
              cursor: 'pointer',
              padding: 0,
              font: 'inherit',
            }}
          >
            Privacy Policy
          </button>
        </div>
      </div>
    </div>
    </Portal>
  );
}

