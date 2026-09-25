# Americano v3 local validation

**Scope:** local-only implementation check against the approved Americano v3 handoff. No hosted environment, production/shared database, deployment, push, App Store submission, demo-event seed, or trial activation was used.

## Commands and outcomes

| Command | Outcome |
| --- | --- |
| `npm test` | **Pass:** 75 test files, 543 tests. First sandbox attempt could not resolve the Vite config because Windows denied an ancestor read; the same command passed with host-level access. React Router future-flag notices and expected cloud-sync warning-path logs appeared. |
| `npm run typecheck` | **Pass.** |
| `npm run build` | **Pass.** Vite generated the production bundle and PWA worker. Existing bundle-size warning remains: the main JS chunk is about 1.38 MB minified (375 KB gzip), above Vite's 500 KB warning threshold. |
| `npm run test:db:americano -- --americano-only` | **Pass** against disposable loopback PostgreSQL database `koc_americano_test_v3_20260925`. The script's host and database-prefix safety gates remained enabled. It replayed Americano migrations/contracts, v2/v3 SQL scoring and state validation, TypeScript/PostgreSQL fingerprint parity, v3 owner save CAS/replay, and signup/start races. |

The isolated database race test exercised both serialized winners through the v2 compatibility RPC and the v3 Start RPC:

1. **Signup wins:** public registration commits first and is wait-listed; Start with the stale roster revision conflicts; a refreshed preview is accepted for the separate Start-first case.
2. **Start wins:** Start commits first and locks/closes the roster; a subsequent public signup is rejected.

Final SQL assertions verify four confirmed entrants, the retained wait-listed entrant, no later entrant, an in-progress event and a closed/locked signup. Concurrent v3 event saves produced one CAS winner and one conflict; the winning request replayed idempotently.

## Synthetic UI and compatibility evidence

- React component/runtime tests build v3 event state in memory and cover a complete eight-player rotating rally event compared with v2 totals, fixed-pair first-to-five scoring and correction, traditional sets and match tiebreak, result completion, a championship final, and spectator read-only controls.
- Setup tests cover traditional format selection, configurable points-per-game and match-win bonus, public rule summary, custom rounds, and local creation gating.
- Persistence tests cover schema-3 export/import and independent template copies without carrying signup linkage.
- SQL contracts check schema-version write guards, owner-scoped v3 writes, public signup privacy/rules contracts and request replay. The full test command also runs legacy v2/Tournament suites.
- A separate headless Microsoft Edge pass used a fresh isolated browser context on the already-running `127.0.0.1:4173` origin. It constructed a 12-player/3-court live event in memory with no cloud backend and checked phone portrait (390×844), tablet portrait (820×1180), iPad landscape (1024×768), desktop (1366×768) and TV (1920×1080), in light and dark themes. All 10 checks rendered three court cards and standings, had no horizontal document overflow, and produced no application errors. The isolated context was closed afterward; its local entitlement state reported `trialUsed: false`.
- This was DOM/layout viewport verification, not saved screenshots, keyboard-only audit or physical iPad/TV testing. The fixture was not saved to either pre-existing local event library. No existing local library was opened in the user's browser, modified, seeded, or cleared.

## Explicit remaining acceptance gaps

The implementation is not yet release-certified. The following plan gates still need separate, scoped evidence:

- Sequential schema-3 mutation coverage across save → config → signup projection → score/correction → round end → next round → final prepare/confirm/correct/reset, including retries and reload.
- Tombstone/delete races and full owner/link bypass checks across every shared v2/v3 RPC path; the performed checks cover version guards, selected owner/public paths and Start/signup ordering, not every combination.
- Backup/import recovery, unsupported-future-record preservation through all catalog and cloud-sync/account-switch paths, offline retry and stale-acknowledgement races.
- Screenshots/design review, keyboard-only audit, and physical iPad/TV testing. The isolated headless viewport pass is useful responsive evidence but is not physical-device or full accessibility certification.
- A populated schema-2 database upgrade rehearsal in a separately identified disposable database. The successful harness is an isolated Americano-only migration/contract rehearsal; it is not a shared or production migration.
- Release-reader compatibility on the actual iPad/TV workflow, remote migration review, launch flag decision, and any website/native/App Store submission. None was attempted.

## Preview and data safety

The two pre-existing local Vite preview processes were left running with their local-only Americano v3 opt-in and blank Supabase configuration. Existing event libraries were left as found. They are reachable on their existing ports (4173 and 4174); use the same browser tabs/origin already open rather than changing between `localhost` and `127.0.0.1`, since browser storage is origin-specific. The preview opens the existing local library; it does not contain newly seeded v3 demo events. Ask before creating an isolated demo/sandbox event.

The disposable loopback PostgreSQL cluster was intentionally left running. No release or recovery operation was performed.
