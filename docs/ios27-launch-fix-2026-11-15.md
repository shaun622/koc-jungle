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
- T3 / AC3 — passed: typecheck, 596 JS tests, production bundle, release preflight and signed native archive. Diff inspected: no event/scoring or database changes.
- T4 / AC4 — in progress: source pushed as `9e1fb881ce71e09000a3bc609b82dbf4d168a6f1`; Apple processed build 82 and it is selected/saved for 1.1.4. Release notes updated and existing iPhone/iPad screenshots retained. Automatic release after approval selected. Submission is gated on native launch-test completion.

## Validation / release

- Local: typecheck passed; 81 test files / 596 tests passed; production build passed; Xcode project parsed with both App and AppUITests targets; scene guard passed; release check 16 passes, no blockers. Existing warnings: large web chunk, old Browserslist data and screenshot file timestamps. No visual UI change in this fix; store screenshot content must be reviewed before submission.
- Version remains 1.1.4 (not yet public); local native build number incremented to 82, above the uploaded 81. Xcode Cloud supplies its next build number.
- Xcode Cloud build 82 succeeded using Xcode 27.2 (27B52), source `9e1fb88`: https://appstoreconnect.apple.com/teams/43e78418-bee4-46d5-b7df-d37ed22ddc4c/apps/6776987751/ci/builds/f4490655-927c-4c2c-bf50-49651d6c5dda/action/7fb6a314-51cd-47ad-850a-f772277f9eb3 . Existing dependency/toolchain warnings are recorded in that archive; no build errors.
- Apple processed build ID: `2f616027-9b43-4c4d-aeca-eca83c8144c4` (1.1.4/82).
- First native test run: https://github.com/shaun622/koc-jungle/actions/runs/43690824075 . Runner reports Xcode 27.1, SDK 27.1 and simulator runtime iOS 27.0 (24A434). Both jobs failed: iPad rotation/background-resume passed but repeated cold launch failed; iPhone launch also failed. Exported evidence shows an empty WKWebView, not merely a mismatched UI selector. This blocks submission of build 82.
- That first iPhone job fell back to iPhone 18 Pro because the image had no precreated 17 Pro Max. The runner now creates the exact iPhone 17 Pro Max from the installed iOS 27 runtime and explicitly waits for simulator boot. Diagnostic branch/run (not production) https://github.com/shaun622/koc-jungle/actions/runs/43692721548 captures native WebView startup details to identify the intermittent blank screen. Diagnostic production logging/DOM inspection must not ship.
- Added explicit application-session guards to both scene configuration and window creation. External display scenes must remain empty for ordinary AirPlay mirroring (Capacitor issue https://github.com/ionic-team/capacitor/issues/8648 and Apple DTS https://developer.apple.com/forums/thread/815376). Physical-device/AirPlay validation remains unavailable; simulator tests cannot establish that claim.
- Shared Android CI and Cloudflare deployment also succeeded for the same commit. No Google Play publishing was performed.
- Exact-model diagnostic run `43692721548` passed both tests on iPhone 17 Pro Max / iOS 27.0: rotation/background/resume (63.658s), three interactive cold launches (93.677s). Diagnostics show a slow initial WebKit navigation (`about:blank` before reaching `capacitor://localhost#/home`), followed by usable UI on every tested launch. No production code change was needed for this diagnostic pass; explicit simulator boot/model selection improved the harness. This does not establish a separate app defect or prove physical-device behavior.
- Final release build number raised to 83 with external-display guards. The final iPhone/iPad matrix must pass without temporary native logging/DOM inspection before selecting the new build and submitting to Apple.
