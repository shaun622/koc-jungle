# iOS 27 launch correction — execution ledger

## Approved contract

User instruction, 15 November 2026: “Ok fix it, test it on iOS 27 and submit the corrected update to Apple.”

Fix the native scene lifecycle incompatibility; run the actual bundled application on iOS 27; submit the corrected App Store update only after successful launch verification. Preserve tournament/scoring/sign-up behavior, event data, bundle identity, purchases and the single-window/mirrored-iPad experience. No database migrations or production event writes. Google Play release remains postponed.

Baseline: main `e235e736f3e5130a6082f765b33e3cd6840c82f9`. Existing edits in `docs/app-store-release-2026-10-11.md` and `docs/cross-platform-release-2026-11-15.md` are preserved and excluded from this change.

## Evidence

- Public iOS release 1.1.2 (77), App Store Connect build `5c347cec-b3ae-401e-92b5-b498d2a32881`, uses SDK `24A430` (iOS 27). Observed in build metadata.
- Released source `7bd23d7` and current source have neither a scene manifest nor a scene delegate.
- Apple requires scene lifecycle adoption for iOS-27-SDK apps to launch on iOS 27: https://developer.apple.com/documentation/uikit/transitioning-to-the-uikit-scene-based-life-cycle
- Capacitor 8.5.0 introduced official UIScene support and migration: https://github.com/ionic-team/capacitor/releases/tag/8.5.0
- Friend's video shows repeated immediate launch exits. No matching device crash report was supplied, so attribution of that individual crash remains inferred until device/reproduction evidence.

## Tasks / acceptance

- T1 / AC1 — implemented/unverified natively: Capacitor core/iOS/CLI pinned to 8.5.3. Official scene proxy handles cold/warm links. SceneDelegate owns one programmatic bridge; omit storyboard startup keys to prevent creating a second bridge. Multiple scenes remain disabled; Android native dependency unchanged.
- T2 / AC2 — in progress: native XCTest target/shared scheme and GitHub `xcode-27` iPhone/iPad matrix added. Verify rendered web UI, repeated launch, background/foreground and portrait/landscape; retain test results and screenshots. A browser viewport test or archive alone does not satisfy this.
- T3 / AC3 — pending: run typecheck, JS tests, production bundle and native archive; inspect final diff. No event/scoring or database changes.
- T4 / AC4 — pending: push reviewed source, select corrected processed build, update release notes and submit to Apple. Record submission receipt/status, not approval or live availability.

## Validation / release

- Local: typecheck passed; 81 test files / 596 tests passed; production build passed; Xcode project parsed with both App and AppUITests targets; scene guard passed; release check 16 passes, no blockers. Existing warnings: large web chunk, old Browserslist data and screenshot file timestamps. No visual UI change in this fix; store screenshot content must be reviewed before submission.
- Version remains 1.1.4 (not yet public); local native build number incremented to 82, above the uploaded 81. Xcode Cloud supplies its next build number.
- Local host is Windows; native launch tests require hosted Mac infrastructure. Test results/archive/submission are still pending.
