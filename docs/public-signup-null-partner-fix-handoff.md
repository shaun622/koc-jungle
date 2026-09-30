# Public signup blank-page fix — implementation handoff

## 1. Objective, baseline and authority

Restore public signup rendering when a registration has no partner. Preserve every registration and all existing signup rules. This is a frontend compatibility hotfix, not a data repair.

**Ready for implementation:** no unresolved design decisions. The current request authorizes planning only. Implementation, commit, push and deployment must be authorized separately; this document does not grant those permissions.

Inspected 30 September 2026. Repository: `C:/Users/USER/Documents/Codex/2026-08-14/c-users-user-claude-projects-koc/work/koc-multi-event`. Branch `main`, baseline `ad7d6fb39de87c14e4e1f191a720cc172ef206d3`.

Preserve these pre-existing unrelated changes; do not incorporate them into this hotfix:

- `docs/americano-session-time-ledger.md`, `docs/release-2026-09-24.md`
- `scripts/check-americano-session-db.ts`, `scripts/check-americano-setup.mjs`
- `src/components/americano/AmericanoSessionPlanner.tsx`
- `src/logic/americanoV3/sessionPlan.ts`, `src/logic/americanoV3/types.ts`
- `src/tests/americanoSessionTime.test.ts`, `src/tests/americanoV3Setup.test.tsx`
- Untracked `src/tests/americanoSessionPlanner.test.tsx`

Non-goals: SQL changes, migrations, backfills, deleting/recreating events, registration mutations, scorekeeping, session planning, layout redesign, authentication changes, new dependencies, native builds or App Store submission. Do not change the legitimate database representation of a solo registration.

## 2. Verified cause and architecture

Affected URL: <https://koc-jungle.pages.dev/signup/krissbell/05-oct-2026-silver-king-of-the-court>. The clean URL redirects to the matching `/#/signup/…` route successfully; routing is not the identified failure.

Production browser reported `TypeError: Cannot read properties of null (reading 'trim')`. A read-only anonymous `get_public_signup_v3` response confirmed an open event titled `SILVER KING OF THE COURT`, with 12 registrations at inspection and one `looking` registration with a first name and `playerTwo: null`. Twelve is an observation, not a permanent expected count.

Relevant existing code:

- `supabase/migrations/20260926092000_americano_v3_public_rules.sql`: public reader emits database `player_two` directly as `playerTwo`. Null is legitimate for solos/individuals. Private contacts are omitted. No SQL modification is required.
- `src/lib/signups.ts`: `SignupRegistration.playerTwo` is typed as `string`; `getPublicSignup` casts the raw response and normalizes event capacity, but not registration names. Its v3-to-v2 fallback only occurs on `PGRST202`/`42883`. The separate organizer `mapRegistration` already uses `row.player_two ?? ''`.
- `src/utils/signupRosterView.ts`: `isCompletePair` calls `registration.playerTwo.trim()`. `buildSignupRosterView` is also consumed by `EventSignupPanel` and `rosterShare`.
- `src/routes/PublicSignupScreen.tsx`: `registrationLabel` and `rosterRow` independently call the same unsafe `.trim()`. The screen calls `buildSignupRosterView` even for individual Americano before choosing its individual-player lists.
- The screen already handles fetch errors, retry, serialized polling and preservation of last-good data. The anonymous public client is already separate from organizer authentication.

Baseline verification actually run: the four focused test files listed under T-001 passed, **21 tests total**. The first sandbox attempt failed before tests because esbuild could not read a parent directory; host execution passed. React Router future-flag warnings were non-failing. Existing fixtures represent missing partners as empty/whitespace strings, not the production null. Full suite and build were not run during planning.

## 3. Acceptance, invariants and decisions

### Acceptance criteria

- **AC-001:** A fixed-pairs public signup containing `playerTwo: null` loads without an uncaught render error. That registration appears once under Looking for a partner, using the first player's name; it does not consume a confirmed pair slot.
- **AC-002:** Missing/undefined, null, empty and whitespace-only partner names all mean an incomplete pair. Complete pairs keep their names, status-derived list, ordering and capacity treatment. Cancelled and duplicate records retain existing handling.
- **AC-003:** Rotating Americano still treats confirmed/waitlisted individual entries as players, even with null partner names. It must not show partner-joining controls or count them as teams. Fixed-pairs Americano retains partner joining.
- **AC-004:** Both v3 success and the existing v2 fallback normalize partner names. Permission/backend errors must not trigger extra fallback or be masked. Invalid roster response shapes fail through existing retry/error UI, not an empty successful roster or a render crash.
- **AC-005:** A poll that introduces a solo entry cannot blank the page or erase typed form values. A failed poll retains the last good roster and shows the existing refresh error. Retry recovers.
- **AC-006:** Existing named-pair/player labels, privacy, closed/past-event restrictions and mutation routing remain unchanged. The production clean URL and hash URL render after an authorized release without modifying production data.

### Invariants

- **INV-001:** No database writes, row deletion, ID regeneration, reseeding, capacity changes or signup-state changes are part of the fix.
- **INV-002:** Normalization is immutable and preserves all fields, registration order and metadata except replacing nullish `playerTwo` with `''`. Do not trim or rewrite actual names.
- **INV-003:** Maintain the anonymous public-client boundary and existing contact privacy; do not add privileged credentials, private data fetches or diagnostic contact logging.
- **INV-004:** Keep existing route-change guards, polling serialization, retries and mutation/idempotency behavior. No timer or event-night logic changes.

### Fixed decisions

- **D-001 — Normalize at the reader boundary.** Keep the application-facing `SignupRegistration.playerTwo: string`. Add a local raw-response registration type with `playerTwo?: string | null`, rather than propagating nullable types throughout the application. Apply normalization after either RPC path succeeds and before returning from `getPublicSignup`.
- **D-002 — Share a defensive completeness check.** Export the existing `isCompletePair` from `signupRosterView.ts`, accepting `{ playerTwo?: string | null }`, using `Boolean(registration.playerTwo?.trim())`. Reuse it in `registrationLabel` and `rosterRow`. This protects legacy/test callers as well as normalized reads and avoids three divergent checks.
- **D-003 — Reject narrowly malformed responses.** Require `registrations` to be an array of non-null objects, and `playerTwo` to be nullish or a string. Reject violations with `The sign-up server returned an invalid response. Refresh and try again.` Do not drop individual rows, coerce numbers to names, or substitute an empty roster. This is not a general schema-validation refactor.
- **D-004 — No migration or global error-boundary redesign.** The data is valid; the client contract is wrong. Repair that boundary and its direct consumers.

Assumption: public readers continue returning the inspected event/registration shape. Test both supported reader paths. No new product choices are needed.

## 4. Target contract and scenarios

Public read arguments and response event fields stay unchanged. Model the raw type locally as the existing public response with a raw registration array; do not falsely assert raw rows already satisfy the normalized domain type. After the existing RPC/not-found error handling, validate the narrow roster contract, then map each row to `{ ...row, playerTwo: row.playerTwo ?? '' }`. Keep existing event capacity/protocol defaults verbatim.

| Input/scenario | Required outcome |
| --- | --- |
| Partner `null` or property absent | Normalize to empty string; fixed-pairs entry becomes a partner seeker |
| Partner `''` or whitespace only | Preserve value; classify as incomplete |
| Partner contains a name | Preserve exact spelling/spacing and other fields; existing complete-pair behavior |
| Individual-mode entry without partner | Existing individual list and player capacity, no Join button |
| Empty `registrations: []` | Valid empty signup page |
| Roster absent/null/non-array, null row, or numeric/object partner | Reader rejects with D-003 message; initial load shows retry; refresh preserves prior data |
| First request fails; retry succeeds | Existing retry UI recovers without stale error |
| Solo appears during polling | Roster updates without render failure or resetting form input |
| Closed/past event with solo | Roster visible; registration and partner-joining remain unavailable |
| Cancelled/duplicate entries | Existing skip/dedup rules unchanged |

No persistence/state transition is introduced. All operations in the fix are read/transform/render. Backend join/register behavior stays authoritative and unchanged.

## 5. Ordered implementation tasks

Commands below run from the repository directory in section 1. Use the existing installed dependencies. If Windows sandbox access blocks esbuild, rerun the same checks through permitted host execution; do not alter application/configuration to bypass that environmental issue.

### T-001 — Reproduce the missing contract cases

Dependencies: none. Supports AC-001–004, INV-001–003, D-001–003.

Targets: existing `src/tests/publicSignupCompatibility.test.ts`, `src/tests/signupRosterView.test.ts`.

1. Correct existing compatibility success fixtures to include actual `registrations: []`, replacing the obsolete `confirmed`/`waiting` fixture shape.
2. Add reader cases for null, omitted, empty, whitespace and named partners; both fallback error codes; valid empty roster; each malformed shape in section 4. Assert immutable input, unchanged IDs/order/status/metadata, preserved event capacity and competition rules, and no fallback for `42501`.
3. Extend roster-view tests for raw nullable/omitted partners, retaining legacy confirmed/waitlisted solo classification, duplicate/cancelled exclusions and capacity checks. Use explicit test-only casting when simulating unnormalized inputs, not weakened application types.

Verification: `npm test -- src/tests/publicSignupCompatibility.test.ts src/tests/signupRosterView.test.ts src/tests/publicSignupScreen.test.tsx src/tests/americanoV2PublicSignup.test.tsx`.

Done: new tests demonstrably fail for the identified null/contract defects on the old implementation; existing behavior expectations stay intact. Recovery: no live data or network is needed; mock fixtures only.

### T-002 — Correct read normalization and completeness consumers

Dependencies: T-001. Supports AC-001–004 and all invariants.

Targets: `src/lib/signups.ts` / `getPublicSignup`; `src/utils/signupRosterView.ts` / `isCompletePair`; `src/routes/PublicSignupScreen.tsx` / `registrationLabel`, `rosterRow`.

Implement D-001–003 exactly. Add the raw type and narrowly scoped validation/immutable mapping; export/import the shared check. Do not change form-local `playerTwo.trim()` validation: that value is controlled form text, not a nullable response. Do not change unused alternative readers or organizer mappings.

Verification: repeat T-001 command; run `npm run typecheck`.

Done: all focused tests and typecheck pass; the three response-name call sites are safe; diff contains no backend/mutation changes. Risk/recovery: avoid a blanket `try/catch` that silently hides roster rows; revert only task-owned edits if needed, never reset the dirty worktree.

### T-003 — Prove rendering and refresh end to end

Dependencies: T-002. Supports AC-001–006, INV-002–004.

Targets: existing `src/tests/publicSignupScreen.test.tsx`, `src/tests/americanoV2PublicSignup.test.tsx`; proposed new `src/tests/publicSignupNullPartner.test.tsx`.

1. In the proposed integration test, mock `@/lib/supabase` and its anonymous RPC, but use the real `getPublicSignup` and real screen. Reuse existing router/render conventions. Return a synthetic future/open KoC event with a named confirmed pair, waitlisted pair and null-partner solo. Assert all three lists, correct available spaces, first-name solo label and Join control, and no private contact text. No real production roster fixture or credentials.
2. Add screen tests for a poll introducing null, preserving a typed player name; malformed refresh retains last-good roster; malformed initial response shows D-003 error and successful retry renders normally. Keep fake-timer cleanup deterministic.
3. Cover nullable individual Americano and fixed-pairs solo joining in its existing test file. Verify the existing mutation RPC is selected, not a new API path.
4. Cover closed/past solo events with no Join/registration controls. Retain existing named-team/member-label assertions.

Verification: `npm test -- src/tests/publicSignupNullPartner.test.tsx src/tests/publicSignupScreen.test.tsx src/tests/americanoV2PublicSignup.test.tsx` (new file must exist first).

Done: real reader-to-render regression passes, including refresh and both entry modes. Risk/recovery: screen-only mocks cannot substitute for the required real-reader integration test; no production signup submissions for testing.

### T-004 — Final checks and release handoff

Dependencies: T-003. Supports all ACs and invariants.

Targets: task-owned diff and this handoff's verification record. No unrelated feature changes.

Run `npm test`, then `npm run build`. Also verify the affected shared consumers through existing `src/tests/eventSignupPanel.test.tsx` and `src/tests/rosterShare.test.ts` (included in full suite). Record actual results and distinguish any baseline/unrelated failures instead of silently fixing other features.

For local visual verification, run `npm run dev -- --host 127.0.0.1`; use its printed port. Visit the affected clean/hash signup route using anonymous read-only production configuration only if already configured, or isolated synthetic fixtures. Verify desktop and iPad-sized landscape rendering, all lists and browser console. Do not register, join, edit or delete on the real event. Automated mocked tests cover those interactions.

Done: tests/build and visual evidence recorded, no new uncaught errors, changed-file list contains only approved hotfix work. If deployment is not authorized, stop with the tested local fix and release instructions; do not push.

### Acceptance matrix

| Criterion | Tasks | Required evidence |
| --- | --- | --- |
| AC-001 | T-001–004 | Nullable KoC real-reader render, correct partner list/count, visual check |
| AC-002 | T-001–002, T-004 | Nullish/whitespace/name matrix, immutability, cancelled/dedup/capacity tests |
| AC-003 | T-002–004 | Individual and fixed-pairs Americano nullable UI/mutation regression tests |
| AC-004 | T-001–003 | v3/v2 fallback tests, malformed/error and retry cases |
| AC-005 | T-003–004 | Successful/failed polling with last-good roster and typed text preserved |
| AC-006 | T-003–004 | Privacy/closed/past/labels tests; exact-link read-only smoke after authorized release |

## 6. Deployment, observation and recovery

No migration, backfill, database restart or event downtime is required. Existing data remains the source of truth.

After separate release authorization:

1. Inspect status/diff against the baseline, preserve unrelated edits and stage only the tested hotfix and its tests/documentation. Never stage the whole dirty tree. Verify the release artifact cannot include unrelated working-tree changes. Follow repository GitHub account-wrapper instructions; never switch shared authentication.
2. Use the established web release workflow. Check current CI triggers before pushing; do not assume a push has only web side effects. Native release/submission is outside this plan.
3. Confirm the intended commit/build is live. Open the exact clean URL and hash route anonymously in a fresh browser context, then a normal returning session to check cached-client behavior. Use the existing refresh/update mechanism if necessary; do not add cache-clearing code or change service-worker policy for this fix.
4. Check title, roster, partner list, available capacity, open/closed status based on current server time, and console through at least two existing polling intervals. Registrations may legitimately change during testing; do not require the historical count of 12. Submit no live form.
5. Record release revision and smoke outcome. A local pass is not proof of deployed success.

If release introduces a different regression, use the established web rollback mechanism to the recorded prior deployment and report that the original null-partner crash may return. Prefer a forward code correction when safe. There is no data restoration step because this hotfix performs no data writes; never delete a solo registration as a workaround.

## 7. Boundaries and executor instruction

No blocking decisions remain. Low-risk freedoms: internal raw-type/helper names, test fixture names and test grouping. Fixed: nullish normalization semantics, narrow rejection behavior, shared completeness helper, preserved privacy/state/capacity, regression coverage, no SQL or unrelated changes.

Read this entire plan and applicable repository instructions, verify the baseline, execute T-001 through T-004 in dependency order, and validate every acceptance-matrix row. Pause only affected work before any material deviation. Release steps require explicit authorization. Authoritative plan: `C:/Users/USER/Documents/Codex/2026-08-14/c-users-user-claude-projects-koc/work/koc-multi-event/docs/public-signup-null-partner-fix-handoff.md`.
