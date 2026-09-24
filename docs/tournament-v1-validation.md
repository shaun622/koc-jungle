# Tournament v1 completion validation

Validated 20 September 2026 against the dirty local tree rooted at `work/koc-multi-event`, branch `main`, HEAD `3c4368d2acbf34aa95e8597a2cc7fde7823b7fc4`. The authoritative contract is `outputs/tournament-v1-completion-handoff-2026-09-19.md`.

## Readiness statement

- **Local code implementation:** complete for T-001 through T-020.
- **Local automated domain/repository acceptance:** passed where listed below.
- **Disposable Auth/Edge/PostgreSQL acceptance:** **NOT RUN** because Docker is not installed or on PATH. No hosted backend was used as a substitute.
- **Durable connected-browser rehearsal:** implemented, but **NOT RUN** because it depends on that disposable backend.
- **Physical iPad/AirPlay acceptance:** **NOT RUN**.
- **Hosted release/deployment:** not authorised and not performed. Tournament creation remains off by default in ordinary builds.

`PASS` below means the complete acceptance statement has current local evidence. `NOT RUN` means a required environment or end-to-end vector was unavailable even if lower-level source/unit coverage passed. There are no hidden “partial passes.”

## Current gates

| Gate | Result | Actual evidence |
|---|---|---|
| V1 focused Tournament | PASS | `npm run test:tournament`: 16 files, 87 tests passed. |
| V2 full regression | PASS | `npm test`: 58 files, 469 tests passed. Expected React Router warnings and injected cloud failure diagnostics only. |
| V3 typecheck | PASS | `npm run typecheck`, exit 0. |
| V4 build | PASS | `npm run build`, PWA generated. Existing 1.31 MB chunk warning remains. |
| V5 SQL-only | NOT RUN | `KOC_TOURNAMENT_TEST_DATABASE_URL` is absent; no disposable prefixed PostgreSQL database exists. |
| V6 Auth/Edge/RPC | NOT RUN | `npm run tournament:local:preflight` stopped safely: Docker is not installed/on PATH. |
| V7 built PWA/backend/browser | NOT RUN | Runner implemented at `scripts/test-tournament-v7.mjs`; requires V6 disposable runtime. |
| V8 maximum-size worker/browser | PASS | 4 divisions, 64 confirmed, 128 waiting, 16 courts, 2,048 active + 64 voided fixtures; restored semantic hash `590c0214`; maximum long task 0 ms. |
| V9 isolation/refusal | PASS | `npm run test:isolation:tournament`; hosted env, non-loopback DB and occupied port rejected before startup. |

## AC-001 through AC-040

| AC | Status | Evidence / exact missing gate |
|---|---|---|
| AC-001 | PASS | V2/V3/V4; all legacy KoC and Americano characterization/regression tests passed. |
| AC-002 | PASS | Separate Tournament routes/schema2 IndexedDB/store plus real-browser IndexedDB fence/quarantine evidence; legacy stores are not adapted. Creation flag remains off outside generated test env. |
| AC-003 | PASS | Command and scheduler tests prove court closure/overrun do not alter capacity or admission. |
| AC-004 | NOT RUN | Concurrent final-slot result requires actual V6 HTTP + PostgreSQL locking. Source suite is present. |
| AC-005 | PASS | Command tests prove post-draw admission waits and promotion/placement is explicit. |
| AC-006 | NOT RUN | Portable scoring vectors pass in V1, but the required actual Deno/Edge replay is V6. |
| AC-007 | PASS | Scoring/command/projection tests distinguish draft, progress and played/non-played terminal statistics. |
| AC-008 | PASS | DAG/source/cycle/cross-division and structural-bye vectors pass. |
| AC-009 | PASS | Three-team tied cohort, incomplete mini-table and manual full-order rules pass. |
| AC-010 | PASS | Qualification confirmation/fingerprint/correction rules pass. |
| AC-011 | PASS | Correction and repository transaction tests preserve unrelated draft/pin work and clear affected work. |
| AC-012 | PASS | Transitive correction planning requires explicit keep/replay decisions and rejects incomplete/stale apply. |
| AC-013 | PASS | Scheduling/command/export vectors preserve historical actual lineups while selected future substitution changes reservations. |
| AC-014 | PASS | Reviewed occupied-court closure and suspend/release/move/resume command vectors retain scores and enforce resource exclusion. |
| AC-015 | PASS | Scheduler overrun test proves another court can continue without a global round transition. |
| AC-016 | PASS | Deterministic groups/knockout/plate/schedule/worker proposals, pins, stale apply and cancellation pass. |
| AC-017 | PASS | Reviewed group amendment adds future fixtures only, preserves played bytes, clears qualification, and requires a reason/manual reconfirmation. |
| AC-018 | PASS | Compensating undo test preserves unrelated capacity work and rejects touched-state mismatch. |
| AC-019 | NOT RUN | Local stale/same-ID vectors pass; receipt-first replay with concurrent database locks requires V6/V5. |
| AC-020 | NOT RUN | Lost-response store/authority unit tests pass; complete crash-before/after-server-commit journey requires V7. |
| AC-021 | NOT RUN | Tombstone/takeover implementation exists; stale offline reconnect plus database deletion/account cascade requires V6/V7. |
| AC-022 | NOT RUN | Real IndexedDB tab fencing passed; the required second authenticated device claim/takeover journey requires V7. |
| AC-023 | NOT RUN | Public DTO/privacy unit tests pass; complete Auth/RLS/internal-RPC matrix requires V6. |
| AC-024 | NOT RUN | Anonymous transport/12-second Retry behavior is covered locally; real signed-out Edge journey requires V6/V7. |
| AC-025 | PASS | Paste validation is atomic; CSV is formula-safe; rich backup round-trip remaps IDs and excludes authority secrets. |
| AC-026 | NOT RUN | Responsive built-PWA runner covers both themes/four viewports/all routes, but V7 could not execute without Docker. |
| AC-027 | NOT RUN | Projection and V8 counts pass; actual 16-court TV pagination/stale-network browser observation requires V7. |
| AC-028 | PASS | V8 evidence file records exact pre/post counts, equal semantic hashes, worker cancellation and no main-thread task over 200 ms. |
| AC-029 | NOT RUN | No physical iPad/PWA/AirPlay hardware run was available; release gate remains open. |
| AC-030 | NOT RUN | Full connected 16-pair Gold/Silver disruption scenario is implemented in the durable runner but was not executed without V6. |
| AC-031 | PASS | Score editor/command/projection tests prove private draft → progress → confirmation; only confirmation advances. |
| AC-032 | NOT RUN | Exact lost-grant nonce/capability unit recovery passes; wrong claimant/owner across actual backend requires V6. |
| AC-033 | PASS | Event-zone conversions, DST gap rejection, explicit fold occurrences and event-zone rendering pass. |
| AC-034 | PASS | Public projection and TV render team/player/actual-lineup/Next labels and exclude private reasons/contacts. |
| AC-035 | NOT RUN | Strict body/schema/CORS/proxy/rate test source is complete; actual gateway/Edge execution requires V6. |
| AC-036 | PASS | Draw, import, correction, closure, schedule and group-amendment workflows use revision-bound preview/review/atomic Apply controls. |
| AC-037 | PASS | Real IndexedDB abort/fence/upcast/quarantine evidence plus injected quota and rich restore tests pass. |
| AC-038 | PASS | V9 refusal passes; generated env is loopback-only and ordinary production creation remains disabled. |
| AC-039 | NOT RUN | Owner create/list/get/import/contact/archive/delete source and lost-response tests exist; actual Auth/receipt execution requires V6. |
| AC-040 | PASS | Entitlement continuation, deferred update, sign-out/session generation and late-response account-fence tests pass. |

Totals: **25 PASS, 15 NOT RUN, 0 FAIL**. The NOT RUN rows prevent a claim of full local acceptance or launch readiness.

## Implementation coverage

- Version-2 strict protocol, upcaster, scoring, standings, qualification/correction DAG and interval scheduler.
- Schema-2 IndexedDB repository with atomic version/tab fencing, durable outbox/drafts/private contacts and corrupt-record quarantine.
- Additive Tournament SQL, receipt/tombstone/rate/authority stores, owner/public Edge handlers, strict byte limits and signed trusted-IP boundary.
- Persistent device authority, exact lost-response recovery, ordered sync, account-session fencing and conflict recovery copies.
- Authenticated Home/App integration; setup, entries/import, draw/amendment, control desk, courts, history/export and read-only public/TV routes.
- Planning workers and maximum-size V8 benchmark.
- Isolated loopback runtime, generated private secrets, synthetic users, trusted proxy, V6/V7/V9 runners and guarded teardown.

## Explicitly not performed

No Git push, deployment, hosted migration, production feature toggle, hosted secret retrieval, App Store action, real customer event read/write or real registration mutation was performed.

The baseline/final manifests show 44 pre-existing dirty files changed during execution; every one is a Tournament implementation/integration/test target named by the plan. All other pre-existing dirty-file hashes, including unrelated KoC/Americano work, are unchanged.
