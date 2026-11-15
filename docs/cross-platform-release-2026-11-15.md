# Shared web, iOS and Android release — 15 November 2026

User request: use one main source for all platforms, release on Google Play, and report current pricing. Keep existing billing/prices and event/signup data unchanged. Enable the released Americano experience on native; keep Tournament gated. Do not add Stripe.

Baseline: `main` fast-forwarded from `7bd23d7` to `ef2cce7` after fetching origin. This preserved the pre-existing local evidence edit in `docs/app-store-release-2026-10-11.md`. Latest public iOS version verified: 1.1.2 (77), released 12 October. Remote main already contains the 1.1.3 version bump, so this release uses 1.1.4.

## Tasks

- R1 verified: public Australian listing shows free download, A$9.99/month or A$79.99/year, one-month trial for eligible subscribers. Web currently grants Pro free (`src/lib/iap.ts`); preserve this.
- R2 verified (automated): shared Americano gates on web/iOS/Android; native paywall wording includes Americano and the correct store. Tournament stays disabled. Google trial display reads the customer's selected free phase. All 596 tests in 81 files and typecheck pass.
- R3 implemented/unverified: Android project (API 36, minimum API 24), existing branded assets and main-branch build workflow. CI produces an explicitly unsigned AAB plus a debug APK and source-revision receipt; signing/store purchase testing remain pending.
- R4 in progress: Google Play app created after explicit approval of policy/export declarations. App ID `4974295514894793698`, package `com.koc.padel`, developer `7688141064011399378`. Complete store metadata, Android subscription configuration and RevenueCat integration; validate purchases before production submission.
- R5 pending: full source/build checks and native smoke tests; push main and verify web deployment, Android artifact and iOS archive from the same revision.
- R6 pending: store submissions and clear evidence of review/public availability. Never describe a draft or uploaded artifact as published.

## Release invariants

- No production data edits or schema migration is needed for this rollout.
- One source revision and production feature configuration; web deploys on push, native stores still require versioned binaries and approval.
- Existing iOS subscription products and pricing are unchanged; Android should use matching monthly/yearly pricing and eligible trial.
- Build/signing secrets must not enter source, logs, screenshots or artifacts.
- Native purchase/restore testing is a release prerequisite, not established by browser tests.

## Account setup evidence

Google Play privacy URL saved. RevenueCat Play app `app76c2fa777c` created in existing project `a234eb9e`, package `com.koc.padel`; public Android SDK key configured. Service-account credential connection and Android subscription products remain pending. Google Cloud opened a re-verification screen; requested sign-in to the Play developer account, shaun@elitewalls.com.au. No private credential was read, copied, logged or uploaded.

The browser safety check paused saving the ad declaration for lack of evidence. Follow-up source verification found no advertising SDK or ad display in package dependencies, `src`, `public`, Capacitor config, Android manifest or MainActivity (the sole text match is a subscription-trial comment). Store metadata is not submitted for review yet.
