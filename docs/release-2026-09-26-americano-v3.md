# Americano v3 website release — 26 September 2026

Scope: user-authorized production website/database rollout and synthetic live rehearsal. This supersedes the local-only release restriction recorded in `americano-v3-validation.md`; it does not claim App Store submission or physical-device certification.

## Released

- Web Americano v3 creation enabled by `VITE_ENABLE_AMERICANO_V3=true`. Native Americano and Tournament creation gates remain unchanged.
- Existing authenticated Supabase CLI access used; no new password, token or login was required.
- Applied migrations `20260926090000`, `20260926091000`, `20260926092000`, `20260926093000`, and `20260926094000`. The unrelated Tournament migrations were excluded from the verified release staging directory.
- Cloudflare Pages successful releases confirmed for the web activation and subsequent fixes. Production: https://koc-jungle.pages.dev/.

## Issues found and corrected during live rehearsal

1. Cloud acknowledgements discarded unsaved format/rule selections. Drafts now reset only when saved values actually change.
2. Explicit setup operations raced their own pending autosaves. They now settle the selected event and use its acknowledged revision; server responses are applied without becoming new mutations.
3. Edits during an in-flight save retained an obsolete revision. Only edits descending from that successful local save advance to its acknowledged revision. Genuine server conflicts are not overwritten.
4. Version-3 events could not use the normal owner deletion RPC. The schema guard now permits only the authenticated, tombstoned, exact-owner deletion transition. Tests retain nonowner, stale-revision and resurrection rejection.
5. Other browser tabs tried to upload the operator's same draft. V3 broadcasts are display-only; older tabs ignore the new operation. A receiving tab with its own pending edit does not overwrite that edit.
6. Published previews omitted the signup roster revision, so Start rejected an unchanged roster. Preview now records the current published revision; server Start still validates roster/order and revision.
7. Clock acknowledgements cleared unfinished score inputs. Score drafts now reset only on a changed saved result or match.
8. A golden-point champion could appear below the runner-up despite having rank 1. The final standings overlay now orders by the resulting rank, without changing totals.

## Verification

- Full automated suite: 76 files / 556 tests passed after the score-draft fix. The subsequent champion ordering assertion and display tests also passed.
- TypeScript and production build passed, including PWA generation. Existing main-bundle size warning remains (~1.38 MB minified / 376 KB gzip).
- Isolated loopback PostgreSQL contracts passed: v2/v3 compatibility, scoring validation, fingerprint parity, CAS/idempotent replay, signup/start races, normal deletion, owner restriction, stale delete and no resurrection.
- Production privilege checks: owner mutations unavailable to anonymous users; internal validator unavailable to anonymous/authenticated callers.

### Actual Edge production rehearsal

Only synthetic events were operated on. Other pre-existing app tabs remained open during successful tests.

**Fixed pairs** (`d418adc2-049e-4c1f-b35a-c10da27f5d17`): one court, two named teams, first to five games, two points/game plus three-point win bonus. Published signup showed both teams and correct rules. Preview and Start succeeded; registration closed. A 5–3 result completed with standings 13–6, survived reload, and correction to 3–5 reversed the standings to 6–13. The read-only TV page showed the correction without editing controls. Database verification confirmed the corrected completed result.

**Rotating pairs** (`874f5442-18fb-4c0d-9fb7-bf369d543231`): one court, four players, full three-round rotation, 24 rally points, advisory clock, optional golden-point final. Published signup, preview and Start succeeded. Partnerships changed every round. Results 24–0, 12–12, 12–12 yielded two leaders on 48 and two players on 24. Start/Pause clock acknowledgement no longer cleared draft scores. Explicit nonfinalist support players were selected for the decider; Cam won the golden point without changing any regular totals. Database verification confirmed all three completed rounds and the final outcome.

The two completed rehearsal events are hidden on this device, not permanently deleted, so their evidence can be recovered from Hidden. Their signups are closed. Three failed disposable setup attempts from this release were cleaned up by exact ID using the normal owner tombstone RPC; their signup histories, where present, remain cancelled.

## Data safety and remaining limits

Immediately before/after the initial four migrations, original event and signup fingerprints matched (23 events, 14 signup pages, 52 registrations). After browser rehearsal, excluding the named synthetic fixtures, the 14 signup pages and 52 registrations still matched their original hashes. Other event rows changed/appeared concurrently; no claim is made that the later whole-event-table hash is unchanged. Those other events were not edited or deleted as part of this rehearsal.

This is a verified website smoke release, not exhaustive certification. The remaining broad recovery, account-switch, all-RPC authorization combinations, populated-upgrade, accessibility and physical iPad/TV acceptance work documented in `americano-v3-validation.md` is not implied complete. Traditional set/tiebreak variations have automated coverage; the live traditional rehearsal used first-to-five games. Browser screenshot capture timed out, so live proof here is DOM and persisted database state rather than new visual screenshots.

Users with a cached PWA should apply its **New version available → Refresh** prompt before creating/testing new events. Existing event data is retained. Website deployment does not submit a new App Store release.
