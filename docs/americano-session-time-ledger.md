# Americano session-time option

Approved design: conversation, 2026-09-26. Baseline main 460294c. Preserve unrelated edit in docs/release-2026-09-24.md.

- T1 / AC1: optional session duration and preference (full partner/team rotation, or chosen round length), changeover under More options. Derive rounds/minutes from actual confirmed roster and courts; show coverage/capacity limitations honestly. Persist configuration, invalidate changed previews. Verified locally.
- T2 / AC2: optional unfinished results, disabled by default. Explicit per-match "Finish with score played" confirmation; no automatic stopping/submission. Actual points/games only; equal unfinished scores draw; existing overall finals retained. For sets, completed sets first, then the unfinished set games (or tiebreak points) determine the leader. Stopping at one completed set all is a draw. Verified locally.
- T3 / AC3: server/client agreement, frozen rules, existing v1/v2/v3 unchanged when option absent, no row rewrites. Verified in disposable PostgreSQL; additive production migration applied successfully on 2026-09-26.
- T4 / AC4: unit/runtime/UI, browser responsiveness, disposable PostgreSQL and production build checks; deploy database before compatible frontend; verify live assets. Local checks passed; release pending.

Planner implementation limits follow existing scheduler: 1–16 courts, confirmed capacity 4 players/2 teams per court, 1–64 rounds. Unsupported exact rotating counts offer chosen-round-length planning instead of pretending full coverage. Round durations whole minutes, 1–240. Session 1–1440 minutes; changeover 0–60 minutes, between rounds only. Timer remains advisory; actual play can finish later than the estimate.

## Implementation and validation

- New pure `sessionPlan.ts` helper, optional persisted `sessionPlan` and `scoring.allowUnfinished`, per-result `endedEarly`. Absent flags preserve strict results. Blank fields remain invalid on confirmation; explicitly entered 0–0 is a draw. No automatic totals or score normalization.
- Setup can save/publish preferences before the minimum roster exists. Preview recalculates against the current confirmed roster, retains the public signup revision, and freezes the result at Start. Disabling the planner removes its saved preference.
- Traditional editor now creates the configured deciding-tiebreak row and permits removing a blank last row even when at the maximum set count, both needed to enter stopped set matches correctly.
- `20260926100000_americano_session_time.sql` adds validators without row rewrites or public grants; preserves deployed strict validators for old events and adapts only the synthetic v2 fixture-validation pace.
- Full suite: 77 files / 568 tests; production build including PWA passed. Existing bundle-size warning remains.
- `node scripts/check-americano-setup.mjs`: 84 layout checks (seven viewport sizes, two themes, two pairing modes, three form variants), plus four browser flows from planner through actual-score standings. Local iPad preview visually inspected. Not physical-device certification.
- `node tests/db/americano-v2/run.mjs --americano-only` against the explicitly named loopback database `koc_americano_test_session_20260926`: migration, v2/v3 compatibility, public privacy, privileges, owner writes, CAS/idempotency, deletion and signup/start races passed.
- `vite-node scripts/check-americano-session-db.ts`: 1,418 partial-score cases agree between SQL and TypeScript, plus eight planned setup/live/confirmed/completed states. No real event data used.
- Release staging dry run identified only this migration; unrelated Tournament migrations remain excluded. Preserve the user's unrelated September 24 release-note edit.
- Production `supabase db push --linked --yes` applied only `20260926100000_americano_session_time.sql` from the inspected release directory, before the frontend push. Cloudflare deployment confirmation is the final release step after this commit.
