# Americano v3 implementation ledger

- **Authoritative plan:** [`americano-v3-formats-implementation-handoff.md`](americano-v3-formats-implementation-handoff.md)
- **Repository:** `C:/Users/USER/Documents/Codex/2026-08-14/c-users-user-claude-projects-koc/work/koc-multi-event`
- **Starting branch/revision:** `main` / `e312a55cab7003bebcbbeeeabc095132b5797496`
- **Starting worktree:** `docs/release-2026-09-24.md` was already modified before this feature work. Preserve it; it is excluded from the implementation and remains untouched by this ledger.
- **Boundary:** local implementation and synthetic verification only; no deploy, shared database migration, App Store submission, trial activation, demo event, or modification/clearing of either existing preview library. User later requested “push when done” (2026-09-26). Push target is awaiting clarification because this checkout is `main` and repository release notes associate main pushes with Cloudflare Pages; deployment is not authorized by that request.

## Task status

| Task | Status | Evidence / remaining acceptance gap |
| --- | --- | --- |
| T-001 compatibility and scoring vectors | Verified | Shared fixtures exercise scoring and schedule fingerprint compatibility; legacy v2 regressions pass in the full suite and DB harness. |
| T-002 v3 types, schema validation, scoring adapter | Verified | Exact version guards, validation and score vectors pass focused and full tests. |
| T-003 deterministic schedule core and v3 lifecycle | Verified | v3 schedule/lifecycle suites pass; the eight-player synthetic rally rehearsal matches v2 per-player totals. |
| T-004 standings and championship reducer | Verified | Standings, tie rules, eligibility, basis invalidation and final scoring tests pass. |
| T-005 additive SQL schema and score authority | Verified in disposable DB | Americano-only migration rehearsal, SQL scoring/state contracts, permissions and version-guard contracts pass on loopback PostgreSQL. Not applied to Supabase. |
| T-006 versioned RPC/client workflows | Implemented; partially accepted | v3 save CAS/replay and separate-connection start/signup races both pass. Sequential v3 mutation matrix, tombstones, owner/link bypass and all transport/account-switch recovery paths still need dedicated evidence. |
| T-007 catalog/import/export/templates/creation dispatch | Implemented; partially accepted | v3 schema dispatch, copy/template/export-import and creation gate tests pass. Unknown future-record preservation across every catalog/cloud path and full offline/account-switch cases need further review. |
| T-008 setup/public rules UI | Implemented; partially accepted | Setup component and public-summary/privacy tests pass. Headless Edge layout was checked in both themes at five viewport sizes. Keyboard-only and visual screenshot review remain outstanding. |
| T-009 results/standings/final UI | Implemented; partially accepted | Synthetic component tests cover scoring, completion, a two-way championship final and spectator read-only behavior. Isolated browser viewport pass confirms three match cards and standings render without horizontal overflow. Physical-device and screenshot review remain outstanding. |
| T-010 integrated rehearsal and handoff evidence | Partial | Full host test suite, typecheck, build, isolated PostgreSQL rehearsal and 10 isolated browser/theme viewport checks pass. No UI demo records were seeded because the two local libraries contain pre-existing user data and explicit permission was not given. Keyboard/physical-device review, populated-v2 database rehearsal, screenshots and production release gates remain outstanding. |

## Preservation and execution notes

- Plan decisions D-001–D-010 and invariants INV-001–INV-008 remain authoritative.
- New v3 creation is opt-in in local preview only; the ordinary build leaves it off. Existing supported v3 records remain readable by version dispatch.
- Both previously running local preview servers and their existing browser-origin storage were left untouched. Do not clear storage, change hostname/origin, add a local event, or activate a trial without asking first.
- The test harness refuses non-loopback database URLs and requires a `koc_americano_test_` database name. All DB rehearsals used a disposable loopback database only.
- `docs/release-2026-09-24.md` remains the pre-existing user change; do not include or overwrite it as part of this feature.
- Detailed commands, outcomes and acceptance gaps are in [`americano-v3-validation.md`](americano-v3-validation.md).
