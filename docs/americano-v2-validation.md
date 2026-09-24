# Americano v2 implementation validation

Implementation baseline: `3c4368d2acbf34aa95e8597a2cc7fde7823b7fc4` on 2026-09-11.

Safety boundary: local implementation and synthetic fixtures only. No remote migration, deployment, push, App Store submission, or real event/signup mutation was performed.

Feature boundary: new Americano creation remains disabled by default. Local UI checks used `VITE_ENABLE_AMERICANO_V2=true`; a production build without that explicit flag keeps the feature unavailable.

Pre-existing untracked files preserved: `docs/app-store-release-2026-09-08.md`, `docs/app-store-release-2026-09-10.md`, and `scripts/capture-release-screenshots.mjs`.

## Phase evidence

| Phase | Status | Command/scenario | Fixture | Result | Artifact |
| --- | --- | --- | --- | --- | --- |
| P0 | passed | baseline characterization, typecheck, build, isolated DB bootstrap | untouched legacy fixtures and loopback PostgreSQL database `koc_americano_test_v2` | Legacy behavior preserved; disposable database gate available and guarded against non-loopback/non-test targets. | `src/tests/fixtures/legacy-events/`; `tests/db/americano-v2/run.mjs` |
| P1 | passed | versioned schema/template/import/help-theme tests | synthetic legacy/v2 payloads | Strict v2 branch, legacy readers, fresh-ID copies, template modes, and one global appearance preference verified. | `src/utils/eventSchema.ts`; focused tests |
| P2 | automated pass; physical-device timing pending | schedule and standings suites, 64-player × 64-round proxy | generated synthetic entrant IDs | Certified exact schedules, balanced/custom schedules, deterministic fingerprints, and desktop proxy generation under the two-second watchdog. A physical iPad timing run remains a release-device check. | `src/logic/americanoV2/`; schedule/standings tests |
| P3 | passed | `npm run test:db:americano` | fresh schema plus populated legacy upgrade | Migration/RPC/security/idempotency/fingerprint and separate-connection race contracts pass. | `supabase/migrations/20260911*.sql`; `tests/db/americano-v2/` |
| P4 | passed | signup, canonical projection, cloud transition, and retry suites | synthetic browser and SQL data | Public and organiser mutations converge on one roster; contacts remain private; stale/offline responses do not overwrite newer state. | signup/cloud tests and v2 RPC migrations |
| P5 | automated pass; physical devices pending | organiser/runtime/display tests and 390×844, 768×1024, 1024×768, 1920×1080 browser checks | synthetic Americano events | No horizontal overflow in either theme; score controls, TV read-only mode, corrections, finish-early, and clock behavior pass. Physical iPhone/iPad/TV/AirPlay remains a release-device check. | `src/tests/americanoV2Display.test.tsx`; responsive screenshots |
| P6 | passed locally | full regression, typecheck, production build, rotating/fixed/balanced/custom rehearsals | synthetic only | 41 files / 352 tests pass; typecheck and build pass; database contract passes. No release action performed. | this file |

## Acceptance evidence

| ID | Status | Evidence |
| --- | --- | --- |
| A01 | passed | Help inherits the saved global theme and contains no page-level light/dark switch. |
| A02 | passed | Rotating and fixed creation paths plus v2 template round-trips are covered. |
| A03 | passed | Rotating 10–14 awards each player the points won by their side. |
| A04 | passed | Fixed 10–14 awards team points once, without court-value multiplication. |
| A05 | passed | 12–12 is a valid 24-point draw. |
| A06 | passed | Blank, non-finite, decimal, negative, out-of-range, and wrong-total values are rejected at the field. |
| A07 | passed | Explicit 0–24 persists while an untouched match remains incomplete. |
| A08 | passed | Confirm, End, Next, retry, and replay are idempotent. |
| A09 | passed | Competition ranks share places correctly and podiums include all qualifying ties. |
| A10 | passed | All 31 supported exact counts satisfy round, partner, opponent, rest, and uniqueness invariants. |
| A11 | passed | Seven-player Balanced 7 produces seven rounds with four appearances and three rests each. |
| A12 | passed | Uneven Custom 6 is surfaced and cannot masquerade as acknowledged. |
| A13 | passed | Repeated exact cycles require acknowledgement and receive fresh fixture identities. |
| A14 | passed | Identical inputs remain deterministic through serialization, reload, and correction. |
| A15 | passed | Roster, order, court, and rule changes invalidate previews; public canonical projection does the same atomically. |
| A16 | passed | SQL contract proves eight rotating players fill two courts and the ninth becomes waiting position 1. |
| A17 | passed | SQL contract proves four fixed pairs fill two courts and the fifth becomes waiting position 1. |
| A18 | passed | Two independent PostgreSQL connections racing for one slot produce one confirmed and one waitlisted registration. |
| A19 | passed | Canonical organiser deletion promotes exactly the next eligible registration. |
| A20 | passed | Organiser edit/order/delete, duplicate warnings, roster sharing, and private contact handling are covered. |
| A21 | passed | Cross-owner, direct-privilege, and forged schedule/state mutations are rejected without disclosure. |
| A22 | passed | Separate-connection signup/start race has one authoritative result and closes registration atomically on start. |
| A23 | passed | Publish/start/mutation request IDs replay safely and payload mismatches are rejected. |
| A24 | passed | Stale two-device saves are retained as conflict drafts instead of overwriting current cloud state. |
| A25 | passed | Newer offline/in-flight edits survive earlier acknowledgements; request envelopes are event and owner scoped. |
| A26 | passed | Published start requires owner authority, exact revisions, and a valid canonical start payload. |
| A27 | passed | Started competition structure is locked while historical score correction remains supported. |
| A28 | passed | Finish early excludes the entire unfinished round from totals and standings. |
| A29 | passed | Historical correction recomputes official scores deterministically. |
| A30 | passed | Legacy import remains compatible; v2 import creates an unlinked fresh-ID copy; malformed/unknown data is rejected. |
| A31 | passed | Protocol-1 writers cannot mutate protocol-2 rows; grants and RPC guards are contract-tested. |
| A32 | passed | Versioned tombstones and delayed-write handling prevent event resurrection. |
| A33 | passed | Pending and retry envelopes are isolated by account and event. |
| A34 | passed | Legacy KoC scoring, existing Americano continuation, signup behavior, and serialization remain characterized in the full regression. |
| A35 | automated pass; physical devices pending | Browser checks at phone, portrait/landscape iPad, and 1080p TV widths show no horizontal overflow in light/dark themes; long/64-entry data paths are covered by automated tests. Physical device/AirPlay is not claimed. |
| A36 | passed | Confirm validates a match; End commits the round; the two actions remain distinct. |
| A37 | passed | Editing unconfirms the current result; cancel-style reads do not mutate official totals. |
| A38 | passed | Advisory clock expiry never changes match/event state and each round begins paused/reset. |
| A39 | passed | Ended-early state survives reload and excluded history stays excluded. |
| A40 | passed | Fresh-event and template copies receive new identities and preserve the selected pairing mode without linking to the source. |

## Responsive artifacts

- `americano-phone.png` — 390×844, dark
- `americano-ipad-portrait.png` — 768×1024, light
- `americano-ipad-landscape.png` — 1024×768, dark
- `americano-tv.png` — 1920×1080, dark

Artifacts were generated under the Codex visualization workspace and are not part of the application repository.

## Local preview corrections — 2026-09-11

User-approved amendment: points per match is now an editable positive whole number, not a 16/24/32-only selector. The default remains 24; the PostgreSQL integer storage maximum is 2,147,483,647. Input, runtime, schema, templates, help text, and the undeployed v2 owner migration agree on this rule. Invalid draft input stays at the field without overwriting the last valid saved value.

Setup now has a stable explicit width and a bounded desktop scroll region. The mobile shell uses document scrolling instead of nested non-scrolling containers. The pairing switch wraps without overflowing and uses the correct selected-text colour. Switching to Custom rounds initializes a valid one-round configuration before saving.

Validation for these corrections:

- `npm run typecheck` passed.
- Six focused test files / 53 tests passed: setup, runtime, standings, schema, templates, and event-night display. This includes custom point totals through scoring and serialization, invalid totals, and full/custom transitions for both pairing modes.
- `npm run test:db:americano` passed against loopback-only `koc_americano_test_v2`, including custom-point state/config validation, owner RPCs, security contracts, fingerprints, and separate-connection races. No remote migration was applied.
- `npm run build` passed; the existing large-chunk warning remains.
- Edge at 1024×768: Full, Custom, and Balanced all measured 1024px setup width and 934px hero width; scrolling reached the final Schedule preview card.
- Edge at 390×844 and 768×1024: no horizontal overflow; real scroll actions reached the Schedule preview card above the bottom navigation. Phone document scroll reached 2362px; portrait-tablet scroll reached 1449px.
- A custom value of 21 was entered successfully in the live local UI. The original draft settings (24 points, Balanced) were restored and survived refresh. Temporary viewport overrides were reset.

These are browser viewport checks, not physical-device/AirPlay certification. All changes remain local; no push, deployment, or real signup/event mutation was performed.

### Fixed-pairs form positioning follow-up

The fixed-pairs add row and both edit-form variants emitted the domain value `fixed` as a CSS class. Tailwind interprets that class as `position: fixed`, detaching the controls from the roster and making them overlap Public sign-up/Schedule preview while scrolling. All three forms now use only the existing rotating layout modifier where needed; fixed pairs retain normal document flow. This is a P5 layout correction with no material plan deviation, database change, or signup/scoring behaviour change.

- `npm test -- --run src/tests/americanoV2Setup.test.tsx`: 4 tests passed, including add/edit class regression checks for fixed and rotating modes.
- `npm run build`: passed, including TypeScript compilation; existing bundle-size warning remains.
- Edge reproduced `position: fixed` before the correction and confirmed `position: static` afterwards. Desktop scrolling moved the add row from y=661 to y=-135 while retaining its 108px offset within Teams, with no overlay on lower cards.
- At 390×844 and 1024×768, the entire add row remained within Teams with no horizontal overflow; phone scrolling reached Schedule preview with the team form offscreen. Browser viewport and original local draft mode/schedule were restored.
- No push, deployment, remote migration, or real event/signup mutation.

### Visible review-and-start action

User-approved usability follow-up: a full-width `Review & start event` action is always rendered directly below the confirmed roster, before waiting/partner lists and the public-signup editor. An underfilled roster disables it with the exact number of additional players/complete teams needed. With sufficient entrants, it generates the normal preview (or retains an existing one), scrolls/focuses the schedule review, and leaves the event in setup until the separate `Start event` confirmation. Existing acknowledgements and authoritative start logic remain unchanged.

- Setup/runtime suites: 25 tests passed, including both modes reviewing without starting, retaining an existing preview, explicit final start creating Round 1, and visible disabled controls for underfilled rosters.
- `npm run build` passed, including TypeScript compilation; existing bundle-size warning only.
- Local Edge preview visibly shows the action and minimum-roster explanation within the Players card. The refreshed preview is open for the user's testing.
- Local UI change only; no deployment or remote data changes.

### Side-by-side setup layout — 2026-09-12

User-approved layout follow-up: desktop Americano setup now places Rules & schedule and Courts in the left column, with the roster, public sign-up editor, and schedule review in the wider right column. The visible roster review/start action is retained. Below 901px the columns stack, with single-column form fields on phones. Both columns use the existing shared setup scrolling; no signup, scheduling, or scoring logic changed.

- Setup suite: 8 tests passed, including column placement and review/start behaviour for fixed and rotating pairs.
- `npm run build` passed, including TypeScript compilation; existing bundle-size warning remains.
- Local Edge at 2181×1155 and 1024×768 confirmed aligned side-by-side columns without horizontal overflow. Tablet scrolling reached Schedule preview.
- At 390×844 the columns stacked without horizontal overflow; real document scrolling reached Schedule preview above the bottom navigation. Viewport overrides were reset afterwards.
- Browser viewport checks only, not physical-device certification. No push, deployment, remote migration, or real event/signup mutation.
