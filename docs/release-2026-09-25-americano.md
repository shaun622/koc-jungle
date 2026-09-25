# Americano web release — 25 September 2026

## Scope and gates

Americano fixed and rotating pairs are enabled for production web creation.
Tournament remains disabled in production; native Americano creation remains gated for a separate app release.
Explicit local preview opt-ins remain available. Readers are independent of creation flags.
KoC events, signup rows and scoring rules are not migrated or rewritten.

## Corrections

- Published-event setup waits for the linked signup snapshot; failed reads offer retry and cannot fall back to an unlinked local start.
- Start and configuration RPCs resolve the server-side signup linkage and reject missing client linkage.
- Generic event saves cannot bypass the published start handshake.
- Starting locks/closes registration; all four public mutation paths also check event status. Roster projection refuses started events.
- Fixed-pair start uses the same pair-completion ordering as canonical roster projection.
- Court changes rebalance and reproject the event roster atomically, preserving identities and invalidating previews.
- Setup schedule previews can be validated/saved/replaced before Start; started schedules remain frozen.
- Metadata drafts survive polling; stale in-flight responses cannot undo acknowledged saves; explicit conflict reload discards the draft.
- Generated and older hash-query TV links are read-only.
- Enabled v2 templates use the existing versioned event loader.

## Database deployment

Applied only:
1. 20260911100000 — Americano protocol
2. 20260911110000 — owner core
3. 20260911120000 — owner workflows
4. 20260911130000 — public signup
5. 20260925100000 — additive release safety corrections

Tournament migrations 20260912100000 and 20260919100000 remain unapplied.
Deployment used a hash-verified isolated migration staging directory and reviewed dry run, not an unfiltered repository push.

The first attempt applied the protocol migration, then the owner-core migration rolled back on a public.digest reference: hosted Supabase installs pgcrypto into extensions.
The unapplied owner-core migration was corrected to use PostgreSQL's built-in pg_catalog.sha256 (identical hash output), retested, and successfully applied. Local test bootstrap now matches Supabase's extension layout.

Before/after read-only record digests (excluding new columns) matched:
- events: 20 rows, 64b7f46891ef6f53968dd7662472af6b
- signup_events: 14 rows, 80c235538700d2dd6ba121cb635305f1
- signup_registrations: 52 rows, 5394c1ba6bfc8182f8e8ff0d4f14dbcf

## Validation

- 502 unit/component tests across 64 files passed.
- TypeScript and Vite production build passed; existing large-bundle warning remains.
- Isolated PostgreSQL Americano-only migration, legacy preservation, RPC, cross-language fingerprint and two-connection concurrency contracts passed.
- Real browser-runtime schedules passed database regressions for both pairing modes: shrink/grow capacity, preview replacement, missed signup linkage, generic-save start bypass, atomic start, idempotent replay, post-start signup/projection guards, and scoring.
- Late-completed solo joining a fixed pair starts successfully in canonical order.
- UI regressions cover generated/legacy TV routes, dirty forms through polls, failed-read start blocking/retry, save-versus-poll ordering, conflict reload and event switching.

Re-run the database release checks only on an isolated loopback database named koc_americano_test_*:
```
node tests/db/americano-v2/run.mjs --americano-only
node tests/db/americano-v2/release-safety.mjs
```

Set KOC_TEST_DATABASE_URL explicitly. The harness rejects remote hosts and does not read production environment credentials.
No new App Store binary is submitted by this release.
