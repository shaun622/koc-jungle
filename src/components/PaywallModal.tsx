/**
 * PaywallModal: pitches Pro and starts the 7-day trial or initiates
 * a subscription purchase.
 *
 * Prices shown here are placeholders for the PWA build. Native builds
 * (Capacitor, Stage 2.2) replace these with prices fetched live from
 * the store via RevenueCat so any price changes propagate automatically.
 */

import { useEntitlementsStore, trialDaysRemaining } from '@/store/entitlements';
import { isIAPAvailable, purchasePlan, restorePurchases } from '@/lib/iap';
import { useState } from 'react';
import { Portal } from './Portal';

// Prices are shown in the user's local currency at the App Store /
// Play Store purchase step (Apple + Google auto-convert from the base
// tier we set in the store dashboards). The PWA can't read those tiers
// directly, so it shows a deferred label until the native build wires
// in live RevenueCat pricing.
const PROD_MONTHLY_PRICE = 'See your local price';
const PROD_ANNUAL_PRICE = 'See your local price';

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
  const [busy, setBusy] = useState<'monthly' | 'annual' | 'restore' | null>(null);
  const [purchaseError, setPurchaseError] = useState<string | null>(null);

  async function handlePurchase(plan: 'monthly' | 'annual') {
    setBusy(plan);
    setPurchaseError(null);
    const result = await purchasePlan(plan);
    setBusy(null);
    if (result.ok) onClose();
    else if (result.error) setPurchaseError(result.error);
  }

  async function handleRestore() {
    setBusy('restore');
    setPurchaseError(null);
    const result = await restorePurchases();
    setBusy(null);
    if (result.ok) onClose();
    else if (result.error) setPurchaseError(result.error);
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
            <span className="paywall-plan-name">Monthly</span>
            <span className="paywall-plan-price">
              {busy === 'monthly' ? 'Connecting…' : PROD_MONTHLY_PRICE}
            </span>
          </button>
          <button
            className="btn full lg paywall-plan"
            disabled={busy !== null}
            onClick={() => handlePurchase('annual')}
          >
            <span className="paywall-plan-name">
              Annual <span className="paywall-plan-badge">save 33%</span>
            </span>
            <span className="paywall-plan-price">
              {busy === 'annual' ? 'Connecting…' : PROD_ANNUAL_PRICE}
            </span>
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
          <button className="btn" disabled={busy !== null} onClick={handleRestore}>
            {busy === 'restore' ? 'Restoring…' : 'Restore purchases'}
          </button>
          <button className="btn" onClick={onClose}>
            Not now
          </button>
        </div>

        <p style={{ fontSize: 11, color: 'var(--text-2)', textAlign: 'center', marginTop: 8 }}>
          Cancel anytime in the platform's subscription settings. Pricing in your local
          currency is shown at the App Store / Play Store purchase step.
        </p>
      </div>
    </div>
    </Portal>
  );
}

