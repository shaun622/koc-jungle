# iOS 1.1 release preparation — 8 September 2026

Status update, 10 September: Apple approved and released version 1.1. It now shows Ready for Distribution. The subsequent 1.1.1 update is documented in `app-store-release-2026-09-10.md`.

## Completed

- Pushed `f1bc3db68f37e3fd0014f4a21aa969378926a818` to `main`.
- Replaced Capacitor placeholder app icon and launch graphics with the existing crowned padel-ball logo (opaque 1024×1024 source).
- Added executable Xcode Cloud post-clone dependency preparation, the CocoaPods workspace, production configuration validation and LF shell-script attributes.
- Corrected the iOS local URL scheme to the supported `capacitor` scheme.
- Set native build number to 54, retaining marketing version 1.1.
- Updated the Default Xcode Cloud workflow to archive the workspace and prepare distribution for App Store Connect. Configured existing public client settings without changing database permissions or server credentials.
- All 243 tests passed. Production web build passed. Local iOS release checklist: 16 passed, zero blockers.
- Xcode Cloud build 54 succeeded, including archive and App Store preparation.
- Apple processed version 1.1 (54): binary state **Validated**, bundle `com.koc.padel`, iPhone and iPad, minimum iOS 15.0.
- Attached build 54 to the existing version 1.1 submission, replacing the association with build 3 (build 3 remains uploaded).
- Saved accurate description, keywords, release notes and review instructions. Preserved the existing dedicated review-account details in App Store Connect only.
- Existing Pro Monthly and Pro Annual subscriptions show Approved.
- Generated four current sample-data screenshots each for iPhone and iPad with the isolated local fixture. No live event data was changed.

## Submitted — Waiting for Review

- User approved replacing the old iPhone and iPad screenshots and publishing the Phone Number privacy disclosure.
- Verified App Privacy was already published with seven data types including Phone Number, used for App Functionality and linked to identity.
- Replaced six old screenshots each for iPhone 6.5-inch and iPad 13-inch with four current screenshots each. Verified completed uploads and order: event library, live scoring, standings, final results.
- Confirmed build 54 remains attached. Automatic release after approval and immediate release to all users remain selected.
- Clicked Update Review and then Resubmit to App Review. App Store Connect visibly confirmed **Waiting for Review** for iOS App 1.1, build **1.1 (54)** on 8 September 2026.
- At submission time Apple approval was pending. By 10 September, version 1.1 was approved and publicly released.

## References

- App ID: `6776987751`
- Xcode Cloud build: `ddae345d-28ad-4060-877c-30ca14cee81c`
- Processed build: `438cd877-ccd5-4640-8cbb-705d4bcffc0d`
- Existing review submission: `6736359e-9df9-435d-bacf-99f36e61ed80`
- [Version 1.1](https://appstoreconnect.apple.com/apps/6776987751/distribution/ios/version/inflight)
- [App Privacy](https://appstoreconnect.apple.com/apps/6776987751/distribution/privacy)

Screenshot helper `scripts/capture-release-screenshots.mjs` and this handoff are local release artifacts, not included in build 54. Screenshots are git-ignored. Native runtime tests on an actual iPhone/iPad were not performed from this Windows environment; successful Apple compilation/validation is not a substitute for device runtime testing.

