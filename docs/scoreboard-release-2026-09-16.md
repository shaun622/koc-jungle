# KoC scoreboard release — 16 September 2026

## Approved scope

Integrated the approved quiet local scoreboard design into the existing KoC
display. Standings show every pair and their player names together with faint
row separators. Courts keep always-visible, named minus/score/plus controls.
The middle timer is larger and uses the available space without clipping.
The existing light/dark preference still applies.

This release is isolated from the unfinished Americano v2 and Tournament v1
work in the original working directory. It has no database migrations, API,
signup, scoring-rule, scheduling, event-store or persistence changes.
Other formats retain their existing paginated standings. Omitted legacy format
values are treated as KoC, consistent with event repository metadata.

## Validation

- Full Vitest suite: 266 tests in 32 files passed; production TypeScript/Vite
  build and service-worker generation passed (existing bundle-size warning).
- `node scripts/check-scoreboard.mjs` against the isolated Vite server at
  `http://127.0.0.1:4183` (override with `SCOREBOARD_CHECK_URL`).
- 60 production-font layout cases: 3, 7 and 8 courts; light/dark; normal and
  all matches tied; 1920×1080, 1366×768, 1180×820, 1024×768, 1024×650.
- Browser checks assert all ranks and score buttons exist, no document or
  court-column scrolling, and player/score/timer/control bounds stay inside
  their allocated rows/cards. Includes real keyboard/mouse score changes,
  timer pause/resume, and switching to/from phone portrait.
- Unit coverage verifies exact single-click score changes and zero clamping,
  render/resize nonmutation, names, and non-KoC pagination compatibility.
- Completion podium/awards bounds checked separately on desktop/tablet sizes.
- Browser fixtures use synthetic data in fresh contexts, with event-service
  network requests blocked. Physical iPad/Safari was not available to test.

## Publishing

Use the existing GitHub main → Cloudflare Pages `koc-jungle` integration.
Only this clean release checkout is eligible for the push; do not stage the
unrelated dirty files in `koc-multi-event`. The repository also has an existing
Xcode Cloud build trigger; publishing the web change does not submit an App
Store release. Existing PWAs pick up the new assets through their normal
update prompt; no event-state migration is required.

Baseline before this release: `3c4368d2acbf34aa95e8597a2cc7fde7823b7fc4`.
If necessary, revert this release commit and let the same Pages integration
redeploy. No database rollback would be needed.
