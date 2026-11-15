# Shared web, iOS and Android release — 15 November 2026

User request: use one main source for all platforms, release on Google Play, and report current pricing. Keep existing billing/prices and event/signup data unchanged. Enable the released Americano experience on native; keep Tournament gated. Do not add Stripe.

Baseline: `main` fast-forwarded from `7bd23d7` to `ef2cce7` after fetching origin. This preserved the pre-existing local evidence edit in `docs/app-store-release-2026-10-11.md`. Latest public iOS version verified: 1.1.2 (77), released 12 October. Remote main already contains the 1.1.3 version bump, so this release uses 1.1.4.

## Tasks

- R1 verified: public Australian listing shows free download, A$9.99/month or A$79.99/year, one-month trial for eligible subscribers. Web currently grants Pro free (`src/lib/iap.ts`); preserve this.
- R2 verified (automated): shared Americano gates on web/iOS/Android; native paywall wording includes Americano and the correct store. Tournament stays disabled. Google trial display reads the customer's selected free phase. All 596 tests in 81 files and typecheck pass.
- R3 verified build: Android project (API 36, minimum API 24), branded assets and main-branch build workflow. Run `43674050729` succeeded for `53139cc`; compile, lint (19 warnings, no errors), bundled-app emulator launch and all 596 JS tests passed. Downloaded unsigned AAB, debug APK and source receipt to `C:/Users/USER/Documents/Codex/padel-android-1.1.4-20261115`. Signing/store purchase testing remain pending. Follow-up makes Android 12+ backup/device-transfer exclusions explicit and adds an emulator assertion for those rules; revalidate before signing.
- R4 in progress: Google Play app created after explicit approval of policy/export declarations. App ID `4974295514894793698`, package `com.koc.padel`, developer `7688141064011399378`. Complete store metadata, Android subscription configuration and RevenueCat integration; validate purchases before production submission.
- R5 verified for initial release commit: `53139cc` pushed to main. Cloudflare deployment `b3c020d7-5faa-458b-8b85-ceec44ef6c15`, Xcode Cloud archive `6f5a5cd7-7dd5-4350-8766-9bc483147a98` and Android workflow all report success for that commit. An archive is not an App Store submission. Recheck the Android hardening follow-up before final release.
- R6 pending: store submissions and clear evidence of review/public availability. Never describe a draft or uploaded artifact as published.

## Release invariants

- No production data edits or schema migration is needed for this rollout.
- One source revision and production feature configuration; web deploys on push, native stores still require versioned binaries and approval.
- Existing iOS subscription products and pricing are unchanged; Android should use matching monthly/yearly pricing and eligible trial.
- Build/signing secrets must not enter source, logs, screenshots or artifacts.
- Native purchase/restore testing is a release prerequisite, not established by browser tests.

## Account setup evidence

Google Play privacy URL saved. RevenueCat Play app `app76c2fa777c` created in existing project `a234eb9e`, package `com.koc.padel`; public Android SDK key configured. Service-account credential connection and Android subscription products remain pending. Google Cloud opened a re-verification screen; requested sign-in to the Play developer account, shaun@elitewalls.com.au. No private credential was read, copied, logged or uploaded.

User completed Cloud sign-in and explicitly approved Padel-only RevenueCat access and the no-financial-services declaration. Google Cloud project `padel-tournament-maker` (116364124881) and service account `padel-revenuecat@padel-tournament-maker.iam.gserviceaccount.com` (115724169562055959019) created. Only Pub/Sub Editor and Monitoring Viewer were assigned in this dedicated project. Key creation is blocked by inherited `iam.managed.disableServiceAccountKeyCreation`; no key was generated or downloaded, no Google Play app permissions granted yet. Do not weaken organisation policy or grant additional administrator roles without specific approval.

Play draft now has saved privacy URL, no-ads, non-government and no-financial-services declarations, Sports category, public support `info@padelkoc.com` and HTTPS website. English store text is saved as a draft; graphical assets, remaining content declarations, billing and review submission remain pending. No Apple pricing or other app configuration changed.

The browser safety check paused saving the ad declaration for lack of evidence. Follow-up source verification found no advertising SDK or ad display in package dependencies, `src`, `public`, Capacitor config, Android manifest or MainActivity (the sole text match is a subscription-trial comment). Store metadata is not submitted for review yet.
