# Public signup null-partner fix execution

Authoritative plan: `docs/public-signup-null-partner-fix-handoff.md`.
Baseline: main at `ad7d6fb39de87c14e4e1f191a720cc172ef206d3`, 30 September 2026.
User amendment: "implement and deploy" authorizes implementation and web release.
Unrelated dirty files listed in the plan remain protected and excluded from release.

- T-001: verified — red run reproduced null/undefined trim crashes and missing normalization/rejection (13 failing, 8 passing). Corrected Vitest table wrapping so array-valued malformed inputs remain arrays.
- T-002: verified — reader normalization, narrow contract validation and shared safe completeness check; TypeScript passes.
- T-003: verified — real-reader screen integration, polling/retry/privacy/closed cases and nullable Americano fixtures. Refresh-error assertion follows existing generic refresh message, not initial-load error wording. Extra individual waiting-player assertions added for final release verification.
- T-004: in progress — full working-tree suite 593/593 tests (80 files), production build passed. Clean committed snapshot: 587 passed / 1 failed across 79 files; the sole failure is the unchanged Americano unfinished-score expectation at `americanoSessionTime.test.ts:43`. Reproduced that same failure independently on baseline ad7d6fb (9 passed / 1 failed in that file). This is not a signup regression; no unrelated fix or test weakening included. Clean release build passed and rendered the real signup in Edge without console errors. Existing large-chunk, React Router future-flag and unrelated act warnings remain. Deployment/live smoke pending.

Baseline: 21 focused tests passed during planning. No data writes or migrations planned.

Local read-only browser check: exact clean route redirected and rendered, expanded all 12 teams; no console errors. At verification the live event had changed to 12 complete pairs, no solo, and organizer-closed registrations. No changes were made by this task. Null/solo behavior remains covered by synthetic real-reader tests. Edge at 1024x768 landscape showed no horizontal overflow (document width 1009); this is emulation, not physical Safari testing. Viewport restored.

Release route confirmed: GitHub main -> Cloudflare Pages. Remote main matches baseline. Existing Xcode Cloud archive check is action_required on the baseline; web release does not submit an App Store version. No native changes are included.

Release isolation: committed only the ten hotfix files. Verified a `git archive` snapshot under ignored `.release-signup-null-20260930/app`, using existing ancestor dependencies without copying unrelated working-tree source. Snapshot frontend asset: `index-CgXtsi2B.js`. A second baseline archive proves the unrelated failure. Source/plan fixed decisions preserved; malformed polling tests correctly assert the existing generic refresh warning. AC-001–005 and local AC-006 checks verified; remote AC-006 remains pending deployment.

## Completed release evidence

- T-004 verified; AC-006 remote smoke complete. Pushed `ea40f14d9d030937eb4d8bbcb94205dfba3d9ab5` to main.
- Cloudflare Pages deployment `348504de-b966-40ce-af28-50ac0d5506e3` reported success for that commit.
- Uncached HTTP request to the exact clean public URL returned 200. Live entry asset `index-BPy3o-K9.js` contains the nullish partner normalization. Cloud build asset hash differs from local build; verified the actual deployed artifact instead of assuming hash equality across environments.
- Existing Edge tab initially served its cached prior bundle and showed the normal update prompt. Clicking Refresh loaded the new asset successfully. New-tab clean-route navigation and hash-route reload also render correctly; no cache purge or event-state reset used.
- Live checks continued beyond two polling intervals: roster/title visible, no refresh failure, no new error logs in the new tab. Original tab retains historical old-bundle crash logs from before the fix; these are not new errors.
- Live event now has 12 complete confirmed teams, no partner seekers and organizer-closed registrations. This reflects current data; this task made no signup/database changes. Nullable solo regression is proved by synthetic integration tests, not by modifying the real event.
- Proof screenshot: `C:/Users/USER/Documents/Codex/signup-hotfix-live-20260930.png`.
- Plan followed using implement-plan; no material design deviation. The pre-existing Americano test failure is recorded above and not silently changed. Existing unrelated local edits remain intact. This post-deployment evidence is a local ledger update; no extra production rebuild is needed for documentation only.
