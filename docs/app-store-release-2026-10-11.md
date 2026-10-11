# iOS 1.1.2 release execution — 11 October 2026

User authorized the current unpublished app updates and submission: "signed in go ahead". Baseline main `ea40f14d9d030937eb4d8bbcb94205dfba3d9ab5`. Preserve existing local planner work and release evidence; integrate the approved session-planner simplification, existing signup fix and current KoC display changes.

App: Padel Tournament Maker, Apple ID 6776987751, bundle com.koc.padel. Current public version 1.1.1, build 55; App Store Connect confirms Ready for Distribution. Latest Xcode Cloud build 76 archived but failed App Store preparation while attempting version 1.1.1. New marketing version 1.1.2 and local build number 77; Xcode Cloud assigns its next build number during archive.

- R1: verified — inspected pending edits, release state and archive issue. Existing local test fix reflects the already-deployed per-match time-out behavior; no production behavior is weakened.
- R2: verified — package/native version bumped to 1.1.2, release-check versions aligned, approved planner simplification included. Existing native creation gates preserved; no new format rollout without the separately requested user choice.
- R3: in progress — all 593 tests and typecheck pass; production/PWA build and iOS billing environment check pass. Updated screenshots and exact release snapshot next.
- R4: pending — push and Apple archive/processing verification.
- R5: pending — new App Store version, metadata/screenshots/build selection and submission, with proof.

Validation: all 593 tests in 80 files passed and TypeScript passed. Production/PWA build passed (existing bundle-size warning only), and native billing/sync configuration check passed. iPad 1376×1032 browser preview shows all 8 courts and 16 standings with no document overflow; timer and score controls fit. This is browser verification, not physical-device certification. Keep existing events, signups, auth and subscription prices unchanged. No shared database migration or row rewrite is required for the pending planner metadata. Native creation rollout is being confirmed separately; Tournament remains disabled.

Do not store review credentials or API secrets in this document. Final proof must distinguish archive, upload, processing, review submission and Apple approval.
