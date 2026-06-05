/**
 * PaywallModal — pitches Pro and starts the 7-day trial or initiates
 * a subscription purchase.
 *
 * Prices shown here are placeholders for the PWA build. Native builds
 * (Capacitor, Stage 2.2) replace these with prices fetched live from
 * the store via RevenueCat so any price changes propagate automatically.
 */

import { useEntitlementsStore, trialDaysRemaining } from '@/store/entitlements';

// Prices are shown in the user's local currency at the App Store /
// Play Store purchase step (Apple + Google auto-convert from the base
// tier we set in the store dashboards). The PWA can't read those tiers
// directly, so it shows a deferred label until the native build wires
// in live RevenueCat pricing.
const PROD_MONTHLY_PRICE = 'See your local price';
const PROD_ANNUAL_PRICE = 'See your local price';

const FEATURES = [
  'King of the Court — winners climb, losers drop',
  'Americano — rotating partners pool',
  'Mexicano — dynamic re-pairing each round',
  'Round Robin — group stage all-play-all',
  'Single-elimination bracket — knockout tournaments',
  'Cloud sync — events across all your devices',
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

  if (pro) {
    return (
      <div className="modal-backdrop" onClick={(e) => e.target === e.currentTarget && onClose()}>
        <div className="modal paywall-modal">
          <h2>You're Pro 👑</h2>
          {trialDays > 0 && (
            <p>
              You're on the free trial — {trialDays} {trialDays === 1 ? 'day' : 'days'} remaining.
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
    );
  }

  return (
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
            onClick={() => beginPurchase('monthly')}
          >
            <span className="paywall-plan-name">Monthly</span>
            <span className="paywall-plan-price">{PROD_MONTHLY_PRICE}</span>
          </button>
          <button
            className="btn full lg paywall-plan"
            onClick={() => beginPurchase('annual')}
          >
            <span className="paywall-plan-name">
              Annual <span className="paywall-plan-badge">save 33%</span>
            </span>
            <span className="paywall-plan-price">{PROD_ANNUAL_PRICE}</span>
          </button>
        </div>

        <div className="modal-actions">
          <button className="btn" onClick={() => onRestore()}>
            Restore purchases
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
  );
}

/** Hook for the platform layer (RevenueCat) to take over the purchase flow. */
function beginPurchase(plan: 'monthly' | 'annual'): void {
  // Stage 2.5 ships the UI; the native binding (Stage 2.2) wires the
  // actual RevenueCat purchase call. On the PWA today this is a no-op.
  console.info('[paywall] purchase requested:', plan);
  alert(
    `Subscribe to the ${plan} plan: this will open the App Store / Play Store purchase flow in the native build.`,
  );
}

function onRestore(): void {
  console.info('[paywall] restore purchases requested');
  alert('Restore Purchases: will call the platform billing layer in the native build.');
}
