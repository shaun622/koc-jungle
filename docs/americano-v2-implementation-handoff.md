# Americano v2 — strict implementation handoff

Status: implementation specification for approval. This document does not authorize execution, production access, migration application, push, deployment, or App Store submission.

Prepared: 2026-09-11. Inspected repository: `work/koc-multi-event`, package version `1.1.1`, HEAD `3c4368d2acbf34aa95e8597a2cc7fde7823b7fc4`. Absolute repository path on this machine: `C:\Users\USER\Documents\Codex\2026-08-14\c-users-user-claude-projects-koc\work\koc-multi-event`.

## 0. Execution contract — read first

After the user authorizes implementation, implement this specification, not a reinterpretation of the preceding conversation. Read the available `implement-plan` skill before starting. This document is authoritative for scope, defaults, contracts and acceptance criteria. Earlier discussion is context only.

**No deviation means:** do not substitute algorithms, silently reduce supported functionality, change scoring, remove tests, migrate legacy events, bypass conflict handling, add another roster, or expand the feature set. Small private helper names/component extraction may differ if every specified public contract and behaviour remains identical; record those organizational differences. Any material difference requires the user's approval first.

If a requirement conflicts with the repository, a mathematical invariant fails, a safety gate cannot be tested, or a necessary decision is not specified, stop the affected phase. Report the exact conflict and proposed amendment. Continue independent safe work only. Do not invent a fallback or describe partial work as complete.

Implementation authority, when subsequently granted, is **local implementation and isolated testing only**. Do not push, deploy, apply remote migrations, modify real events/signups, change subscription plans, upload an iOS build, or submit an app release without a separate explicit instruction. Do not use the real Kriss events as fixtures.

Preserve existing untracked files observed during planning: `docs/app-store-release-2026-09-08.md`, `docs/app-store-release-2026-09-10.md`, `scripts/capture-release-screenshots.mjs`. Recheck the worktree before editing; do not assume these are the only later changes. Do not reset, clean, stash or overwrite unrelated work.

## 1. Scope and fixed product decisions

### 1.1 Required release

1. Remove the redundant light/dark control inside Help & guides. Keep the existing global/menu appearance controls and theme persistence. Help still inherits the selected theme.
2. New event creation offers one **Americano** card, followed by **Rotating pairs** and **Fixed pairs**.
3. Rotating mode admits individual players, creates changing match partnerships and ranks individuals. Fixed mode admits permanent two-player teams and ranks teams.
4. Both new modes score actual rally points, not KoC court-win awards.
5. Offer full schedules and custom rounds; offer explicitly labelled balanced schedules for participant counts without an exact full rotating cycle.
6. Integrate setup, public signup, waiting lists, templates, sharing, scoring, standings, podium, match history, announcements, phone/iPad/TV layouts, storage, imports and cloud sync. A toggle without this end-to-end integration is incomplete.
7. Preserve all existing KoC and legacy-format event behaviour and data.

### 1.2 Defaults and supported bounds

These are decisions frozen by this handoff, not invitations for the implementation agent to choose defaults:

| Setting | Contract |
| --- | --- |
| New Americano default | Rotating pairs, 24 total points, Full rotation when available |
| Points options | User amendment, 2026-09-11: editable positive whole number; default 24. Stored as a PostgreSQL integer (maximum 2,147,483,647); no games/sets option. |
| Courts | 1–16 for new Americano only; existing other/legacy format bounds unchanged |
| Confirmed capacity | Fixed: courts × 2 teams. Rotating: courts × 4 players. Never an independent capacity control |
| Start minimum | Two complete fixed teams or four individual players, at least one court; roster need not fill every court |
| Supported confirmed field | Up to 32 fixed teams / 64 rotating players, additionally bounded by configured courts |
| Custom rounds | Integer 1–64; explicit warning/acknowledgement for uneven appearances or repeated cycles |
| Unpublished setup | Empty roster allowed; insufficient participants block Start, not saving the draft |
| Service guidance | Two serves at a time, cycling through all four players; guidance only, no serve tracking/control in this release |
| Match pace estimate | 10 minutes per match/round, editable 5–30 in five-minute steps; labelled an estimate, not a match-ending rule |
| Advisory pace clock | Off by default; if enabled in setup, countdown starts only on explicit Start clock, supports pause/resume/reset and is reset paused for each new round |
| Tied final totals | Shared competition placing: 1, 1, 3. No sporting tiebreaker |
| Theme/type/touch | Existing light/dark design, minimum 16 CSS px text, interactive hit areas at least 44×44 CSS px |

Limits protect a tested first release; do not claim unlimited support. The public registration safety ceiling of 256 active rows remains unchanged and is distinct from confirmed capacity. An odd/underfilled confirmed roster does not authorize accepting an over-capacity entrant.

### 1.3 Explicit exclusions

- No new logos, homepage redesign, payments, offers, accounts for participants, email/WhatsApp automation, Mexicano changes, tournament brackets or new rankings service.
- No timed-scoring Americano, average-points ranking, groups, mixed/gender/skill constraints or manual court/partner swaps.
- No admitting larger confirmed fields in waves. Existing legacy wave behaviour remains unchanged.
- No new mid-event admissions, withdrawals, substitutions or changes to fixed-team membership in v2. Once started, add/delete/move roster actions are disabled with an explanation. Name typo corrections remain allowed without changing identity. Use Finish early and create another event if membership must change. Do not secretly implement substitutions by renaming players.
- No automatic conversion of an existing event or published signup to new rules, including old Americano drafts. No bulk data cleanup.
- No rewrite of cloud synchronization for every format; version/revision protection introduced here applies to new protocol-2 events.

## 2. Baseline facts and compatibility invariants

Verified implementation points:

- `src/routes/HelpScreen.tsx` imports and renders its own `ThemeSwitch`.
- `src/logic/formats/americano.ts` uses fixed-team Berger opponent rotation. It rebuilds from the active pool and repeats the cycle modulo its length.
- `src/logic/scoring.ts` and `src/store/selectors.ts` award the winner the court value. `eventStore.endRound` requires unresolved ties to be settled. These are not the new Americano rules.
- `src/logic/validation.ts` and `src/routes/QualifierScreen.tsx` already demonstrate fixed-total validation and complementary final-score entry.
- `src/types/domain.ts` uses fixed `Team.players` tuples and team IDs in matches; no independent entrant roster exists.
- `src/utils/rosterReconciliation.ts`, `signupRosterView.ts` and the SQL roster constraints treat an incomplete pair as Looking for a partner. A UI-only rotating toggle cannot work.
- `src/store/templates.ts` does not currently save format/config. `src/utils/exportImport.ts` accepts any numeric export version without validating the event shape.
- `src/store/cloudSync.ts` uses unconditional whole-event upsert. Local queues do not provide cross-device compare-and-swap.

**Legacy invariant:** an event with schemaVersion absent or explicitly1 is legacy. Unknown versions (including3+) are unsupported, not legacy. Missing Americano `rulesVersion: 2` must never opt into new rally scoring; schemaVersion2 with missing/wrong rulesVersion is invalid, not a legacy fallback. No legacy state JSON, schedule, score, standings result, event ID, signup URL, event date, queue order or stored capacity may be rewritten merely by upgrading/loading.

Keep the existing KoC qualifier wrapper, tie rules, court promotion/relegation, court-win scoring, clocks and display behaviour. Do not globally change `getFormat` fallback semantics for legacy data. New unknown schemas must be rejected before reaching that fallback.

## 3. UI and lifecycle contracts

### 3.1 Setup and publication

- Labels: `Rotating pairs` / `Change partners each round. Points belong to each player.` and `Fixed pairs` / `Keep your partner. Points belong to your team.`
- Rotating roster fields: player name, optional organiser-entered phone/WhatsApp. Public submission requires the same valid contact standard as current public signup. No team name/player-two or partner-request tab.
- Fixed roster: retain team name optional, two player names, contact and existing partner-request workflow.
- Pairing mode can change only while unpublished, in setup, with no entrant rows. Otherwise offer `Create a new event` preserving settings, without copying or transforming registrations. Publishing permanently fixes the mode for that event.
- Points/schedule/pace settings may change before start. Any change to these, roster membership/order or courts invalidates the current schedule preview and acknowledgement. Fixed/rotating mode cannot change just because a signup has subsequently closed.
- Court changes on a published event are server-authoritative, revision-checked and rebalance the queue. Never let polling restore an old court count or derive a new limit from signup list length.
- Confirmed entrants appear once in the organiser's main roster. Waiting and (fixed mode only) partner requests remain secondary sections, not a second editable confirmed roster.

### 3.2 Schedule preview

`Preview schedule` must show: schedule label, points per match, rounds, estimated duration, confirmed count/capacity, each entrant's matches/rests, partner/opponent coverage, repeated pairings and unused courts. Duration is rounds × pace estimate; do not present it as a guaranteed finish time.

Exact unavailable counts show `A complete once-with-every-partner rotation is not available for this player count. Use a balanced schedule.` Do not silently change the chosen mode. A failed exact fixture invariant is a defect, not the same as an unsupported exact count.

`Start event` requires a validated preview built from the latest roster/settings revisions; pressing Start accepts a normal preview (no extra universal checkbox). Unequal appearances require a checkbox acknowledging that totals can favour people playing more matches. A repeated cycle requires its own acknowledgement. Persist acknowledgement against the preview fingerprint; changing the preview clears it.

### 3.3 Play and results

- Start uses normal main rounds, never `event.qualifier`/seeding. No King's Court, winner ladder, weighted courts or forced draw resolution in v2.
- Each match has editable draft result and a distinct `Confirm result` action. Entering A auto-fills B = target − A and vice versa. Live `+/-` scoring must not use that complementary final-entry rule: in this release v2 uses final-result entry rather than inheriting live point buttons with ambiguous semantics.
- Empty is not zero. `0–24` is valid after explicit confirmation; untouched `0–0` is not a completed match. All inputs must be finite nonnegative integers no greater than target and sum to target. Never clamp invalid input into a valid result silently.
- Confirming every court enables a separate `End round` action; it does not advance automatically. End round atomically commits all valid confirmed results. A nonfinal round enters between-rounds; committing the last scheduled round completes the event with completionReason='scheduled'. Error focuses the first invalid match. `12–12` is valid at target 24. Editing a current-round confirmed result clears its confirmation until confirmed again.
- Points-based matches do not end on a timer. Retain an optional pace clock/estimate using existing clock primitives, but hide KoC end-of-time winner prompts for v2. TV center panel shows round/progress and `${pointsPerMatch} points per match`; pace timing is secondary and explicitly advisory. Pace-clock visibility and duration are fixed at start; when enabled, Start/Pause/Resume/Reset affect only its countdown. Reset returns it paused to paceMinutes. At zero it stays at zero, with no buzzer, forced result, modal or progression. Each new round resets paused.
- Only completed rounds contribute to official standings. A confirmed result in the current round is visible on its court, but standings are labelled `Through round N` until all results in that round are committed.
- `Next round` is a transition from between-rounds only. Double-clicks/retries do not create another round. The next fixture comes from the saved schedule, not another scheduling run.
- Correcting completed scores uses a separate draft and explicit `Save correction`; cancel leaves the original untouched and official totals retain the original until commit. Save recalculates standings/history without reopening the completed round, changing schedules or appending point adjustments. If an active future round exists, it keeps its original matchups. All corrections require the same fixed-total validation.
- `Finish early` retains completed rounds. If a round is unfinished, explicitly confirm that the whole unfinished round will be excluded; never count only some courts. Retain its drafts and confirmed court results as history with excludedReason='ended-early'; it cannot later be committed. completionReason='early' is terminal. Final screen/share says `Ended early` and warns when match counts differ. No results is `No completed rounds`, not a champion.
- For v2, Reset offers `Create a fresh event from these settings` and does not unlock, erase or reopen the original. This action and mode-change's Create new copy only mode/rules/pace and court labels/order, using fresh IDs and title `Copy of <event name>`; roster is empty, dates/publication are unset. Legacy Reset is unchanged. Templates retain their existing roster-inclusion behaviour and support individual entrants, always with new identities and no contacts/linkage.

## 4. Domain and identity contracts

Add a typed versioned branch; do not make malformed new data appear legacy through permissive casts.

```ts
type PairingMode = 'rotating' | 'fixed';
type ScheduleKind = 'full' | 'balanced' | 'custom';
interface AmericanoConfigV2 {
  rulesVersion: 2;
  pairingMode: PairingMode;
  pointsPerMatch: number; // positive integer, validated against the storage range
  scheduleKind: ScheduleKind;
  customRounds?: number;             // only custom; 1..64
  paceMinutes: number;               // 5,10,15,20,25,30
  paceClockEnabled: boolean;         // false default; fixed at start
}
interface IndividualEntrant {
  id: string;
  name: string;
  avatar?: PlayerAvatar;
  active: boolean;
  createdAt: number;
  signupRegistrationId?: string;
}
type AmericanoSide =
  | { kind: 'fixed-team'; teamId: string; playerIds: [string, string] }
  | { kind: 'rotating-pair'; playerIds: [string, string] };
interface AmericanoMatchV2 {
  id: string;
  courtId: string;
  sideA: AmericanoSide;
  sideB: AmericanoSide;
  scoreA: number | null;
  scoreB: number | null;
  resultConfirmed: boolean;
}
```

New event: `schemaVersion: 2`, `format: 'americano'`, `formatConfig: AmericanoConfigV2`. Reuse event base metadata/settings/status/timer primitives through explicit types. Add `participants: IndividualEntrant[]` for rotating; `teams` is empty in that branch. Fixed mode uses genuine existing teams/players; `participants` is empty. Do not create synthetic teams for rotating mode.

Use a discriminated versioned match/round/assignment union and explicit type guards. Existing team matches remain intact. Add shared side/entrant view selectors for renderers, announcements and history instead of unsafe `.teamAId` assumptions or duplicating rendering rules on each device.

Persist `americanoSchedule` containing `id`, `algorithmVersion`, `seed`, `inputFingerprint`, frozen ordered entrant IDs, court IDs, full fixtures, per-round rests, coverage metrics, acknowledgements and the roster revision used at start. A schedule fixture uses immutable side membership. Played rounds reference its fixture IDs; they never own a separately generated partnership list.

For v2, total rounds is derived from the saved schedule. At start set the compatibility field settings.roundsTotal to that length and settings.defaultRoundDurationMs to paceMinutes×60000; neither is a second editable source of truth. Every v2 round's advisory duration uses the frozen pace setting. UI/completion logic uses the saved schedule, not the old six-round default or20-round settings cap. No schema-less consumer may silently apply KoC defaults to v2.

IDs are internal only. No account or visible ID fields. Names are not keys. Two people may have the same display name. Rename changes labels, not identity, scores, partnership history or queue membership. Never put private contacts into the event state/TV/shared message; retain them in the organiser-only signup data. Before publication, store manually entered contacts in a separate owner/event/entrant-keyed IndexedDB `privateEntryDrafts` store, excluded from broadcasts, templates and event exports. First publish passes these in the private seed request. Remove those draft contacts only after the successful canonical response has been persisted locally. A failed publish must not lose them. No new contact data is sent to analytics or another service.

For canonical signup projection use deterministic identities: individual `registration:<registration UUID>`, fixed team `registration:<registration UUID>` with player IDs suffixed `:1` and `:2`. Existing v1 IDs are untouched. On first publication, adopt canonical IDs only in the new unstarted v2 event; invalidate preview. Never perform name-based identity merging for v2.

## 5. Scoring and scheduling specification

### 5.1 Scoring

For each match in a completed v2 round, fixed team A receives scoreA once, B scoreB once. Rotating side A's two players each receive scoreA; side B's each receive scoreB. Derive totals from confirmed results; do not increment a stored total on submission/retry.

Standings include total points, matches played, points for and against; wins/draws are informational, never tiebreakers. Sort total descending then frozen entrant order for deterministic display. Assign rank as `1 + number of entrants with strictly greater total`. Podium membership means competition rank ≤3, not first three rows or first three score groups. It must display every qualifying tied entrant, allowing more than three people. An unplayed entrant has zero matches, not a phantom 0–0 draw, and retains its tied zero-point rank with `0 matches` visible; do not invent a hidden eligibility tiebreaker. If no completed rounds exist, do not display a podium at all. No points overrides in v2; corrections edit the source match.

### 5.2 Determinism and court packing

- Store an unsigned 32-bit seed generated once for a draft preview; regenerating is an explicit setup-only `Reshuffle` action. Use a checked-in deterministic PRNG (xorshift32, zero seed mapped to `0x9e3779b9`) and Fisher–Yates to relabel ordered entrant IDs. Persist algorithm version `americano-v2.1`.
- Each round contains at most `floor(N/4)` rotating matches or `floor(T/2)` fixed matches, never more than configured courts. No entrant twice in a round and no court twice in a round. Unused courts are shown as unused; they do not create fake opponents.
- Court ordering is saved setup order, independent of point value. Assign match j in round r to court `(j+r) mod C`. Court exposure is reported; no promise of mathematically equal court exposure.
- Hash canonical JSON with SHA-256 for input/preview fingerprints. Sort object keys and preserve intentional array order. Document this serializer once and share its test vectors between client/server. No runtime network scheduling dependency or runtime exhaustive solver.
- Fixture, round and match IDs are assigned once when the preview is constructed and retained through retries/start/reload. These random IDs are excluded from comparisons of seeded scheduling determinism; compare entrant/court assignments and metrics.

### 5.3 Fixed pairs

Use existing `bergerRounds` for seed-shuffled frozen team IDs, using the same saved seed/base-order contract as rotating mode. Normalize each fixture by ascending base-order team indices and sort each round numerically before the `(j+r)%C` court assignment. Full schedule has T−1 rounds if T even, T rounds if odd. Every team faces each other exactly once; odd fields rest once each. Full and balanced are identical for fixed mode, so do not show a separate Balanced button.

Custom ≤ full length uses a prefix. Custom > full length repeats complete cycles followed by a prefix only after explicit repeat acknowledgement. Never silently apply current modulo-wrap behaviour. Prefix/rest imbalance is surfaced; do not award rest points or normalize totals.

### 5.4 Rotating pairs

Exact schedules and the deterministic balanced algorithm are specified in Appendix A. Full requires the exact fixture validator to pass. For non-exact counts, the organiser selects Balanced or Custom explicitly. Custom with an exact base uses the prefix/repeated-cycle rule above; Custom without an exact base uses the balanced algorithm for exactly the chosen rounds.

Balanced default rounds = N / gcd(N, 4×floor(N/4)); this is the smallest equal-appearance cycle for the playing slots available under the court-derived limit. This is a social schedule, not a claim of complete partner/opponent coverage. For 7 players it is 7 rounds, four matches and three rests per person.

Metrics are computed independently of generation: appearances/rests, unique partners/opponents, maximum/minimum pair frequencies, repeated complete matchups and whether appearances are equal. Validate all fixtures before saving or starting. A generation/validation defect blocks start; never drop matches to make it pass.

## 6. Canonical signup and database contract

All new Americano events, including fixed pairs, use protocol 2. Existing tables/rows/APIs remain legacy-compatible. New columns have legacy defaults; no existing roster rebalance, date change, cancellation or state rewrite during migration.

Required schema additions:

- `events.protocol_version smallint not null default 1` (1 or 2), `events.revision bigint not null default 0`. Protocol 2 requires matching state.schemaVersion=2 and rulesVersion=2. Deleted-state exception remains valid. Protocol cannot be downgraded.
- `signup_events.protocol_version` legacy default 1; `source_event_uuid uuid`; `entry_mode` fixed-pairs default; nullable `capacity_players`; `roster_revision bigint default 0`. Add `UNIQUE(events.id,events.user_id)` and composite FK `(source_event_uuid,owner_user_id) → events(id,user_id) ON DELETE CASCADE`. Protocol1 keeps source_event_uuid NULL; protocol2 requires it and requires existing source_event_id to equal its text form. New protocol-2 signup must reference an owned protocol-2 source event with matching pairing mode. Keep existing `capacity_revision` for metadata/capacity changes.
- Fixed: `capacity_teams=C×2`, `capacity_players=NULL`; rotating: `capacity_teams=0` compatibility sentinel, `capacity_players=C×4`. New API exposes `capacity:{unit:'teams'|'players',value:number}`. Never expose the sentinel as the public limit.
- `signup_registrations.entry_mode` fixed-pairs default. Add `UNIQUE(signup_events.id,signup_events.entry_mode)` and composite FK `(signup_event_id,entry_mode) → signup_events(id,entry_mode)` to enforce event/row consistency. For individual mode, player_one is required; player_two, player_two_contact and pair_completed_at are NULL; team_name is the empty string (the existing column is NOT NULL). Confirmed/waitlisted/cancelled are valid; looking is forbidden. Fixed-mode constraints remain unchanged.
- Add private, RPC-only mutation receipt storage keyed by event/request UUID, including operation, server payload SHA-256, original committed revision and result IDs, not stored event/contact response bodies. Retain receipts while the event exists; deleted-event tombstones always prevent resurrection. No direct authenticated/anonymous table access and no bearer credentials in receipts. See Appendix B.

Do not modify old migration files. Add ordered, independently testable migrations for protocol writes, mode-aware signup operations and compatibility guards. Update fresh-install schema/documentation consistently without changing historical migration meaning.

### 6.1 API rules

Appendix B is the exact RPC inventory. Each mutating new RPC accepts `requestId`; update operations also accept applicable expected event, metadata and/or roster revisions. Ownership is derived from `auth.uid()`, never a client owner field. Replies use a discriminated `status` of `applied`, `replayed`, `conflict` or `rejected`, plus canonical data/revisions on success/conflict and a stable error code on rejection.

Same request ID and same server-normalized payload acknowledges the original applied revision without applying twice, even if revisions have advanced, and returns the latest authorized canonical snapshot. Never install an obsolete saved response after newer changes. A deleted event returns EVENT_DELETED with no state. Same ID with different payload is `IDEMPOTENCY_MISMATCH`. A conflict does not turn into an unconditional write; a deliberate fresh operation uses a new ID after review. Caller-supplied fingerprints alone are not trusted. Serialize bigint revision tokens as decimal strings in new JSON APIs; clients compare them as opaque tokens.

Lock ordering: source cloud event → signup event → registration rows in stable UUID order. Anonymous registration need only lock the signup event before its rows; it must not subsequently acquire the cloud event lock. All mutators follow this order to avoid deletion/start deadlocks.

Queue membership is canonical on the server. In rotating mode each single is complete and queues by admission timestamp, then UUID, subject to explicit organiser rank. In fixed mode preserve complete-pair timing priority and partner requests. Rebalance once per transaction. Cancellation/deletion before start promotes at most the newly available capacity, without duplicate promotion notices. Waiting players do not also appear as confirmed or looking.

Public signup: no account requirement; preserve current input limits, cutoff checks, anti-abuse mechanisms, 256-active-row ceiling and retry UX. New individual duplicate protection compares normalized name plus normalized contact within the event, not name alone or shared contact alone. An exact duplicate returns `ALREADY_REGISTERED` without creating or returning another person's private data. Admin may deliberately add a same-name individual with a distinct identity; flag the possible duplicate for review rather than merge.

Public response omits contacts, owner IDs, private source state, receipt bodies and conflict tokens. Public cannot edit/cancel/change someone else's signup. Fixed-mode voluntary partner joining remains supported as currently intended, through a v2-aware endpoint; rotating mode has no join-partner operation.

### 6.2 Publication, capacity and atomic start

- First publish submits the current unstarted v2 event and seed roster in a single idempotent owner operation. Create signup, seed registrations, derive canonical identities and save their projection atomically. Existing friendly-link/account-slug generation rules remain; return canonical URL. No second seed-only handshake for new v2 events.
- After publication, generic cloud state saves cannot overwrite roster/court-capacity fields. These change through mode-aware owner RPCs, which update the canonical registration projection and event revision. Public registration changes only the signup queue/roster revision, so the persisted event projection can temporarily lag. Before play, organiser roster/share/preview use the authoritative signup query snapshot as a read-only view; polling must not dirty/save another projection. Owner mutations and Start refresh the persisted projection atomically. Generic save preserves protected persisted fields, not a polled replacement. This is one authoritative roster with a cache, not two writable lists.
- Starting is **one transaction**, not close signup → compute → save. Submit the candidate preview/start state with expected event revision, capacity revision and roster revision. Lock and check them; validate canonical confirmed identities, membership, bounds, points, schedule invariants and acknowledgements. Then close/lock signup and commit the frozen first-round state together. Conflict or rejection changes neither.
- A signup arriving after preview invalidates the start attempt. Refetch and show the changed roster/new preview; never start a different roster without acknowledgement.
- If the start response is lost, retry the persisted identical request. Return committed state; do not create another schedule, reopen signup or start another round.
- Unpublished, never-cloud-saved local-only start is a single validated local repository transition. Any cloud-saved event (published or not) starts through the authoritative RPC and requires connectivity and the owning account. After a successful start, local scoring can continue offline against its saved revision; cloud conflict handling still applies later. First cloud save of a never-published local event may create a new v2 UUID with its already-started valid history; validate the complete frozen schedule/history and reject an existing conflicting UUID/tombstone. This is not an upgrade or a way to skip locking a published signup.
- At roster lock, further public additions, joining, promotions and organiser membership/court changes reject. Name/contact typo corrections remain guarded updates and preserve IDs; public labels update, contacts stay private.

## 7. Storage, conflicts, templates and old clients

- Keep legacy writes on the existing path. New protocol-2 cloud saves must use owner-checked server CAS, server timestamps and schema validation. Expected revision mismatch returns canonical remote state, not last-writer-wins.
- On conflict keep the unsaved local draft and offer `Use saved version` or `Export my unsynced copy`. No automatic merge or force overwrite in this release. Export never silently makes a second public event.
- Per-event pending requests include owner, event ID, base revision, request ID and exact payload. On event/account switch, do not route another event's response or queue into the active editor. Tombstones win over any pending write.
- Keep coalesced v2 snapshots rather than introducing an action-journal architecture. Persist at most one sealed in-flight request per event plus its newer unsent local snapshot. Once sent, request ID/base revision/payload are immutable through retry. After an acknowledgement, hydrate the returned snapshot only if no newer local edits exist. With newer local edits, advance their known base token only when the returned latest revision equals this operation's committedEventRevision; then send a newly sealed request for the newer snapshot. If the returned latest revision is greater, another write occurred: preserve local work and surface conflict, never automatically rebase/overwrite it.
- Hydration is monotonic against the highest server revision already known locally, even without unsent edits. If realtime revision8 arrives before an RPC acknowledgement7, acknowledge receipt7 but retain snapshot8; never roll back to7. Preserve any unsent candidate and surface its conflict rather than rebasing it silently. Compare revision strings as big integers, not lexicographically or through lossy Number conversion.
- Offline End/Next/correction actions may coalesce into a legal multi-round extension on reconnect. Server CAS validates the entire candidate against the frozen schedule, not merely a single adjacent UI action: all intermediate newly completed rounds must be present, confirmed and valid; previous rounds cannot disappear/reopen; completed score corrections remain allowed; at most one current uncompleted round exists; completed/early-terminal events never resume. This validates the complete resulting history without requiring a journal. Persisted in-flight requests and later local drafts survive crashes separately; an earlier replay cannot discard newer local work.
- Direct event table inserts/updates remain allowed only for protocol-1 rows, including both old-row USING and new-row WITH CHECK restrictions. Explicitly block insertion of protocol-2 state disguised as protocol 1 and downgrades. Restrict direct signup INSERT/DELETE so a protocol-2 source cannot be republished as a legacy row or deleted around RPC guards. Registrations remain RPC-write-only.
- Legacy SECURITY DEFINER RPCs bypass RLS; add explicit guards rejecting protocol-2 targets with `UPDATE_REQUIRED`. This includes legacy deletion. New deletion follows the existing tombstone/cancel-link semantics through the versioned owner API. Explicit account deletion remains account-wide and unchanged.
- New clients validate cloud, IndexedDB, import and broadcast payloads before hydration. Unknown newer schema is read-only/update-required, never converted to KoC. Do not strip unknown data and save it back. Retain a recoverable raw import on rejection if a UI recovery file is offered.
- Older installed clients cannot retroactively be made to show a correct update prompt. Server guards prevent their writes, not their incorrect rendering. Compatible-client rollout and old-build tests are required before enabling creation. Do not claim otherwise.
- Templates must store format, pairing mode, rules version, points, schedule choice/custom count and pace settings. Loading generates fresh event/team/player/court IDs; strips schedule, results, revisions, signup identities, confirmations, publication flags/timestamps/cancellation and source registrations. No template changes an existing event.
- Version new exports as 2; continue emitting/accepting valid legacy export version 1. Reject unsupported versions and malformed side/member references explicitly. Import of a v2 snapshot is an unlinked local copy with new event ID and preserved internal match/participant relationships; no cloud/public mutation until explicit publication, which is permitted only for an unstarted new event.

## 8. Phased work packages

All file paths below are relative to the repository root. New helper files listed are intended destinations, not existing files to assume present. Do not expand a phase without approval.

### P0 — Baseline characterization and isolated harness

Files: existing tests under `src/tests`, new `src/tests/fixtures/legacy-events`, SQL harness under `tests/db/americano-v2`, `package.json` dev-only test script if needed.

Record git baseline and dirty files; run existing tests/typecheck/build locally. Add representative legacy fixtures for KoC setup/qualifier/in-progress/completed and old Americano, plus signup pairs/looking/waiting. Record exact derived standings/rotations and serialization before change. Do not snapshot real client contacts.

Create/reuse a disposable local PostgreSQL harness for migrations/RLS/transactions; existing `outputs/sql-verification/verify.mjs` is reference only and belongs outside the application repo. PGlite can supplement syntax tests but does not replace separate-connection PostgreSQL concurrency tests. No production credentials or linked remote-project commands.

Gate: baseline failures recorded and distinguished; disposable DB target positively verified. Stop if no isolated database is available for required SQL verification; do not substitute live testing.

### P1 — Help and versioned domain/persistence readers

Files: `HelpScreen.tsx`, `types/domain.ts`, new `logic/americanoV2/types.ts`, new `utils/eventSchema.ts`, `store/eventRepository.ts`, `eventCatalog.ts`, `templates.ts`, `utils/exportImport.ts`, `hooks/useStorageBroadcast.ts`, corresponding tests.

Remove Help's extra switch only. Implement discriminated types and validating readers; correct new templates/imports without converting old events. Add typed side/entrant selector interfaces for later consumers. Keep new creation disabled.

Gate: Help theme inheritance, old event round-trips, fresh template identities and malformed/unknown-schema tests. No DB migration or new event exposed yet.

### P2 — Pure scheduling, scoring and validators

Files: new `logic/americanoV2/{schedule,fixtures,validation,standings}.ts`, `logic/formats/index.ts`, `logic/formats/americano.ts`, `logic/validation.ts`, `logic/scoring.ts`, `store/selectors.ts`; new focused tests.

Retain legacy format path. Implement Appendix A and generic fixed-total control/validator with a backward-compatible KoC qualifier wrapper. Add schedule metrics/fingerprint and versioned standings/side/history adapters. Do not modify UI to fake independent players through Team.

Gate: every supported exact starter expands to certified invariants; every balanced/custom supported count/round boundary passes integrity/fairness tests; 64-player ×64-round performance is measured on an iPad-class browser. Generation must finish within 2 seconds there without UI freezing; run in a worker if needed without changing algorithm/output. If budget fails, stop and report instead of lowering scope/quality.

### P3 — Additive backend and legacy-write protection

Files: new sequential files in `supabase/migrations`, `supabase/schema.sql`, `supabase/README.md`, SQL contract/concurrency tests. Dependencies: P1/P2 contracts fixed.

Implement section 6/7 and Appendix B, including first-publish seeding and atomic start. Independently validate submitted schedule/roster rules server-side; client validation is not authorization. Keep functions' search paths fixed, qualify SQL aliases, revoke default PUBLIC execution and grant minimum roles.

Gate: apply fresh schema+all migrations and upgrade an already populated legacy fixture DB. Compare legacy payloads, URLs, counts and scores; no changes other than added legacy-default columns. Test old/new API matrix, direct-write bypasses, separate-owner access, last-slot concurrency, start/signup race, receipts and tombstone retries. No remote application.

### P4 — Signup, canonical projection and v2 cloud transitions

Files: `lib/signups.ts`, new `lib/americanoV2.ts`, `utils/rosterReconciliation.ts`, `signupRosterView.ts`, `rosterShare.ts`, `store/eventStore.ts`, `cloudSync.ts`, `eventRepository.ts`, `components/EventSignupPanel.tsx`, `routes/PublicSignupScreen.tsx`.

Wire mode-aware APIs and per-event revisions. Ensure no duplicate confirmed list/auto-add pipeline appears. Implement atomic start, protected writes, conflict export/reload, safe offline-after-start behavior and versioned deletion. Derive catalog counts/units correctly.

Gate: individual signup → organiser → share/public agrees, fixed/legacy partner requests unchanged, no contacts leak, no poll overwrites, interrupted publication/start recover, switching accounts/events cannot cross-apply responses.

### P5 — Complete organiser, scoring and display UI

Files: `routes/HomeScreen.tsx`, `SetupScreen.tsx`, `DisplayScreen.tsx`, `LeaderboardScreen.tsx`, `components/MobileDisplay.tsx`, `TvStandings.tsx`, `SettingsModal.tsx`, `RosterShareModal.tsx`, `hooks/useAnnouncements.ts`, `content/formatRules.ts`, new `components/americano/*`; relevant appearance styles/tests.

Implement full mode-specific controls, preview/acknowledgement, final-result editor, neutral court views, standings/tied podium/history, finish early, immutable started membership and settings. Hide irrelevant KoC controls in v2 only. Label cards/templates/share as rotating or fixed. Roster sharing keeps plain numbered lines and native Share/Copy; do not restore Open WhatsApp.

Gate: interaction tests plus visual/browser checks at 390×844 phone, 768×1024 iPad portrait, 1024×768 iPad landscape, 1920×1080 TV, light and dark. Large standings paginate/scroll in a readable controlled way; do not shrink below 16px to fit 64 names. TV read-only controls cannot edit results. Verify AirPlay/second-screen path on actual available hardware; if unavailable record the unverified gate, do not claim it passed.

### P6 — End-to-end rehearsal and handback

Dependencies: all previous phases. Create synthetic local/test events only. Run acceptance matrix below, full suite, typecheck and production build. Rehearse all rounds for 8 rotating players/2 courts, 4 fixed teams/2 courts, 7 balanced players/2 courts and 5-player full rotation/2 courts. Exercise two organiser clients and a read-only TV plus signup visitor.

Hand back changed-file summary, test commands/results, screenshots, migration files NOT APPLIED remotely, remaining limitations and explicit risk list. Keep feature creation behind `VITE_ENABLE_AMERICANO_V2=false` by default; enable only in the isolated test build for verification. The flag gates creation, never readers/writers of already-existing v2 events. No push/deploy/release in this task.

## 9. Acceptance matrix — required, not optional examples

| ID | Given / action | Required result |
| --- | --- | --- |
| A01 | Open Help in each theme | No page-level light/dark switch; inherited theme and menu control work |
| A02 | Create either mode, save/load template | Correct mode/rules/defaults; fresh IDs; no linked signup/status/results |
| A03 | Rotating 10–14 | First side's two players each +10; second side's each +14 |
| A04 | Fixed 10–14 | Teams +10/+14, no doubling/court award |
| A05 | Confirm 12–12 at24 | Valid draw; no tie-winner prompt; correct points |
| A06 | Blank, NaN, Infinity, decimal, negative, 25–−1, 10–10 at24 | Field-level error; no round completion or silent clamping |
| A07 | Confirm0–24 then reload | Confirmed valid result persists; untouched0–0 remains incomplete |
| A08 | Double Confirm/End/Next, lost response retry | Exactly one state transition; no duplicate matches/points |
| A09 | Tie at finish | Shared1,1,3 placing; all tied entrants shown; names not winner tiebreaker |
| A10 | Every exact supported size | Full partner/opponent/rest invariants pass; no duplicate participant/court |
| A11 | Seven players, Balanced7 | Four appearances and three rests each; not labelled exact/full |
| A12 | Seven players, Custom6 | Visible uneven-appearance warning and required acknowledgement |
| A13 | Custom exceeds exact cycle | Explicit repeat acknowledgement; deterministic cycles, no hidden wrap |
| A14 | Same input/seed, reload/score correction/device change | Identical persisted fixtures and historical side membership |
| A15 | Reorder/court/points/signup change after preview | Preview invalidated; old acknowledgement cannot authorize start |
| A16 | 2 courts, ninth rotating signup | Eight confirmed; ninth waiting, not looking; no additional court auto-created |
| A17 | 2 courts, fifth fixed pair | Four confirmed; fifth waiting; legacy solo still looking |
| A18 | Two concurrent entrants for last slot | One confirmed, other waiting; retries create no duplicate |
| A19 | Delete confirmed/waiting before start | Canonical removal everywhere; correct single-slot promotion; no duplicate notices |
| A20 | Admin edit/order, duplicate display names | One identity per entry; share/public/admin agree; contacts stay private |
| A21 | Public edits, cross-owner IDs, forged mode/capacity/protocol | Rejected; no data disclosed or altered |
| A22 | Signup races acknowledged Start | Atomic success on exact snapshot or conflict/no mutation; never half-start |
| A23 | Lost publish/Start response | Same request recovers existing URL/start state; no new event/roster |
| A24 | Two-device stale score/metadata save | Conflict, local draft retained; no automatic overwrite |
| A25 | Offline after successful start, advance several rounds, edit again during an in-flight save | Legal complete-history extension syncs; sealed retry stays identical; later local edits survive acknowledgement; a newer remote revision conflicts rather than being overwritten |
| A26 | Attempt published Start offline or as wrong owner | Blocked without closing/changing event |
| A27 | Started v2 membership/points/court changes | Blocked with explanatory message; name correction preserves identity |
| A28 | Finish early with incomplete current round | Confirmation; whole incomplete round excluded; early/unequal status visible |
| A29 | Correct old result, including after completion | Totals/history recalculate exactly once; next fixtures unchanged |
| A30 | Import old/v2/unknown/malformed export | Legacy works, v2 unlinked copy works, unknown/malformed safely rejected |
| A31 | Old client direct upsert/delete/signup RPC to v2 | Rejected without downgrade or damage; account deletion retains intentional semantics |
| A32 | Deleted event plus delayed write | Tombstone prevents resurrection; signup remains cancelled/readable as designed |
| A33 | Switch event/account with pending request | Response/queue remains scoped; no data appears in another event |
| A34 | Existing KoC + legacy Americano fixtures after upgrade | Exact pre-change results, rotations, signup behaviour and timer semantics |
| A35 | Phone/iPad/TV both themes, long/repeated names/64 rows | Legible ≥16px, usable hit targets, correct side names, no overflow hiding actions |
| A36 | Confirm final court / End nonfinal or final round | Confirm alone never advances; End commits once to between-rounds or scheduled completion |
| A37 | Edit confirmed current result / cancel historical correction | Current result becomes unconfirmed; cancelled historical edit leaves original official score intact |
| A38 | Advisory clock Start/Pause/Reset/expiry | Countdown only; zero never closes a match/round or forces a score; next round resets paused |
| A39 | End early then reload/edit excluded round | Excluded results retained, clearly labelled and never counted or subsequently committed |
| A40 | Fresh event / mode-change copy | Empty roster, fresh court/event IDs, no dates/signups/results; original unchanged |

## 10. Validation commands and release boundary

Run from the inspected repository, using the installed Node/npm runtime:

```text
npm test
npm run typecheck
npm run build
npm run test:db:americano
```

The implementation adds `test:db:americano` as a dev-only script using a disposable PostgreSQL connection named `KOC_TEST_DATABASE_URL`. It must reject non-loopback hosts and any database whose name does not start `koc_americano_test_`. It must not read production `.env` credentials as fallback or execute a reset against a linked Supabase project. If PostgreSQL is not available, stop that test phase and report the missing prerequisite. Build/test failures must be fixed within scope or reported; never remove assertions to pass.

Execution handback is **not** production readiness until DB upgrade, old-client and actual-device gates have passed. No CI/prod environment variable changes are authorized here. Future deployment order: backup/verify real data under separate permission → additive backend/guards → compatible clients and update guidance → verify → enable creation. If problems appear, disable new creation, retain v2 readers/writers for existing v2 events, and preserve all new rows/receipts. Do not roll back by dropping columns/tables or forcing v2 JSON through a legacy build.

## 11. Stop conditions and completion checklist

Stop and ask for an amended plan if: inspected baseline materially changed; a legacy fixture result changes; exact schedule certification fails; a schema/API cannot enforce stated invariants; old-client mutation bypass remains; target capacity/format bounds must change; new production authority is required; test isolation cannot be established; or a hardware/DB acceptance gate cannot be verified.

Use `All acceptance gates passed` only when all P0–P6 work and A01–A40 evidence are complete, full tests/typecheck/build pass, migrations pass fresh/upgrade verification, hardware gates pass and no real data was modified. If code is finished but a required gate is unavailable, report `Implementation finished; <specific> verification blocked` and keep that acceptance row blocked. Do not call P0–P6 fully verified or the app release-ready in that state.

## Appendix A — scheduling fixture and balanced-generation contract

### A.1 Exact fixture inputs: no algorithm research during implementation

Support every N from4–64 where N mod4 is0 or1. Other counts expose Balanced/Custom, not Full. Use checked-in numeric starter data, expanded deterministically, not a runtime search. Source for mechanical fixture transcription: [Durango Bill's mathematical scheduling tables](https://www.durangobill.com/BridgeCyclicSolutions.html). Use the first main solution for each count, not alternatives/mirror-image/directed tables. Four uses `[[0,1,2,3]]`; eight uses the first initial solution; twelve the first example; thirteen the first shorthand summary. For the other counts use the first main N-player table, taking exactly floor(N/4) tuples. Numeric tuples mean `[a,b] versus [c,d]`.

For N mod4=0, map a starter index x at round r to `x===0 ? 0 : 1+((x-1+r)%(N-1))`, r=0..N−2. For N mod4=1, map `(x+r)%N`, r=0..N−1; the absent index rests. Nine is the explicit exception below, not modular expansion.

Canonical input validation: assemble a JSON object keyed by numeric N ascending, all30 supported counts except9, compact `JSON.stringify` UTF-8 with no newline/BOM. It must be3491 bytes and SHA-256 `d06e38b88ffdb57c936ab02ca9a80079f7a17d1b2b00887ef884e3ddd9b00f72`. This exact checksum fixes which source alternatives are authorized. Transcription is a mechanical implementation task, not permission to choose another schedule. If source data is unavailable or checksum differs, stop rather than invent another starter.

The already expanded nine-player schedule is:

```json
[[[1,2,3,6],[4,8,5,7]],[[2,0,4,7],[5,6,3,8]],[[0,1,5,8],[3,7,4,6]],[[4,5,6,0],[7,2,8,1]],[[5,3,7,1],[8,0,6,2]],[[3,4,8,2],[6,1,7,0]],[[7,8,0,3],[1,5,2,4]],[[8,6,1,4],[2,3,0,5]],[[6,7,2,5],[0,4,1,3]]]
```

Its compact UTF-8 JSON is199 bytes; SHA-256 `aadd8cdd7459a8b7c62026a0cbf352ce937c317be1912342ba25957e400bf7d8`.

During planning a separate read-only check expanded all31 eligible counts (10,928 matches) and verified uniqueness/partner/opponent/rest invariants. This feasibility check is not an application test and does not replace P2 tests.

Relabel numeric indices through the saved seed-shuffled entrant order. Canonicalize each side by ascending base-order index; place the lexicographically earlier side at A, sort the round's fixtures numerically by their four-index arrays, then assign courts as specified in§5.2. Use numeric element-by-element comparison, never locale/name/UUID/default string sorting. Repeated custom cycles reuse the same matchup order without reshuffling; court round offset continues across cycles.

### A.2 Exact invariants

- N mod4=0: N−1 rounds; each player every round; each unordered partnership once and each unordered opposition twice.
- N mod4=1: N rounds; each player N−1 appearances and exactly one rest; same partner/opponent counts.
- Exactly floor(N/4) matches per rotating round, or floor(T/2) per fixed round. Require equality, not just a maximum, so missing fixtures cannot pass validation.
- Every match has four distinct real players. No entrant/court duplicated in a round. Round and fixture/match IDs are globally unique within the whole event schedule, including repeated cycles; repeating a matchup never reuses a previous fixture ID. Retries reuse the already-existing identities. Playing and resting sets partition the entire frozen entrant roster; no extra/missing/waitlisted identity.
- Full fixed schedule: every unordered team matchup exactly once and correct bye counts. Custom exact/fixed schedules must equal the expected repeated-cycle/prefix construction.
- All generated schedules have exactly the requested rounds and max appearance spread≤1 at every prefix. Final exact schedules have equal appearances. Required warnings are derived from the independently recomputed metrics.

### A.3 Balanced/custom generation — exact heuristic, not an optimization claim

Let N be entrant count, C court count, M=floor(N/4), R be the chosen round count (or Balanced default in§5.4). Generate **exactly eight candidates k=0..7** with isolated history, select the best with the rules below. No backtracking, adaptive retries, extra random seeds, optimization service or reduced candidate count.

PRNG: unsigned state, zero mapped to `0x9e3779b9`; step `x ^= x << 13; x ^= x >>> 17; x ^= x << 5; state=x>>>0`; random value `state/4294967296`. Fisher–Yates runs i=N−1 down to1, j=floor(random×(i+1)). Base order is the shuffle of frozen ordered entrant IDs using the saved seed.

For each candidate initialize played counts and all unordered partner/opponent counts to0, lastPlayedRound=-1, lastPartner=null, lastOpponents=empty. For each round r=0..R−1:

1. Build fresh round ranks by shuffling base order with unsigned seed `(seed ^ Math.imul(k+1,0x9e3779b9) ^ Math.imul(r+1,0x85ebca6b))>>>0`.
2. Select exactly4M players sorted by `(played ascending, lastPlayedRound ascending, roundRank ascending)`. Others rest. No history is changed yet.
3. Among selected unpaired players, choose the earliest roundRank player a. Choose partner b minimizing `(historical partnership count(a,b), [lastPartner(a)==b]+[lastPartner(b)==a], roundRank(b))`. Remove both and append pair to creation order; repeat until all selected players are paired.
4. Take the first unmatched pair in creation order. Choose its opposing pair minimizing `(maximum of the four historical cross-side opponent counts, sum of those four counts, directional last-appearance opponent-repeat flags, opposing pair creation index)`. The repeat flags sum `[y in lastOpponents(x)]+[x in lastOpponents(y)]` over the four cross-side pairs (0..8). Remove both pairs and append the fixture; repeat.
5. Canonicalize fixtures and assign courts as A.1/§5.2. Commit the whole round to candidate history once, incrementing appearances and unordered counts. Last partner/opponents refer to the most recent appearance, ignoring rest rounds.

After R rounds compute the candidate quality vector:

```text
[max partnership count,
 sum of squared unordered partnership counts,
 total directional last-appearance partner repeats,
 max opposition count,
 sum of squared unordered opposition counts,
 total directional last-appearance opponent repeats,
 repeated complete matchup count]
```

The repeated complete matchup count is sum(max(0, frequency−1)) over canonical normalized matchups. All counts cover the entire frozen roster, including zero-frequency pairs for coverage/minimum metrics. Select the lexicographically smallest vector. Tie: numerically compare flattened canonical base-index fixture arrays round-by-round; still tied: lower k. Metrics/invariants must be recomputed by a separate validator, not copied from the generator's counters.

This guarantees a defined reproducible selection policy, not mathematically optimal opposition/partnership variety. UI says Balanced, never Complete/Perfect for this path. Arbitrary custom round counts remain allowed with the explicit unequal-appearance acknowledgement; do not reject them merely because totals are unequal.

### A.4 Bounded computation and failure

Count every potential-partner/opposing-pair evaluation. With supported bounds the conservative bound is 655,360 evaluations; hard cap 1,000,000. Exceeding it is `GENERATION_BUDGET_EXCEEDED`, not a partial schedule. Run generation in a worker; a 2-second watchdog reports `SCHEDULE_TIMEOUT`, retains draft/previous preview and never auto-starts. A retained preview with a fingerprint/revision mismatch remains visibly stale and cannot authorize Start. The iPad performance acceptance gate remains ≤2 seconds. Build/schema/client/server validators must distinguish `COUNT_HAS_NO_EXACT_CYCLE` (supported Balanced alternative) from `EXACT_FIXTURE_INVALID` (defect; stop).

Fingerprint payload is the canonical object containing algorithmVersion, pairingMode, pointsPerMatch, scheduleKind, customRounds or null, paceMinutes, paceClockEnabled, seed, frozen ordered entrant IDs/membership, courts in saved order, applicable roster revision, generated base-index fixtures/rests and coverage metrics. Exclude score values, timestamps, private contacts, random schedule/fixture IDs and acknowledgements. The acknowledgement records this fingerprint. Name correction before start changes roster revision and invalidates preview; after start it changes labels only.

## Appendix B — new RPC names and envelopes

### B.1 Common owner envelope, receipts and field errors

All SQL revisions are bigint; transport revisions are decimal strings. The protocol/schema/rules versions are numeric small integers. All following owner functions return JSON with:

```ts
type OwnerSnapshotV2 = {
  event: { id: string; protocolVersion: 2; revision: string;
    updatedAt: string; state: AmericanoEventStateV2 };
  signup: null | OrganizerSignupSnapshotV3;
};
type OwnerReply =
  | { status: 'applied'|'replayed'; requestId: string;
      committedEventRevision: string; snapshot: OwnerSnapshotV2 }
  | { status: 'conflict'; requestId: string;
      code: 'EVENT_REVISION_CONFLICT'|'SIGNUP_REVISION_CONFLICT'|'ROSTER_REVISION_CONFLICT';
      snapshot: OwnerSnapshotV2 }
  | { status: 'rejected'; requestId: string; code: string;
      message: string; field?: string };
```

`OrganizerSignupSnapshotV3` has existing owner metadata/registration fields from `lib/signups.ts`, plus protocolVersion, entryMode, normalized capacity, capacityRevision and rosterRevision. Do not omit canonical registration IDs/updatedAt/expected status information needed for guarded mutations. Contacts exist only in owner snapshots. Owner reads return a consistent snapshot, not revisions from one fetch and rows from another.

Stable rejection codes: NOT_AUTHENTICATED, NOT_FOUND_OR_NOT_OWNED, EVENT_DELETED, UPDATE_REQUIRED, UNSUPPORTED_SCHEMA, INVALID_PAYLOAD, IDEMPOTENCY_MISMATCH, MODE_MISMATCH, MODE_LOCKED, ROSTER_LOCKED, REGISTRATIONS_CLOSED, EVENT_CANCELLED, INVALID_SCHEDULE, PREVIEW_STALE, ALREADY_REGISTERED, POSSIBLE_DUPLICATE. Schedule errors also use A.4's typed codes. `field` uses stable paths such as `playerOne`, `contact`, `formatConfig.customRounds`, `rounds.<roundId>.matches.<matchId>.scoreA`. UI maps these to controls; do not expose raw SQL error messages as field-validation instructions.

Private receipt table `event_v2_requests`: event_id FK events, request_id UUID, operation, payload_sha256, applied_revision bigint, result_ids jsonb, created_at; PK(event_id,request_id). Owner is established by event ownership. Server-normalized request hash includes operation, expected tokens and payload, preventing cross-operation ID reuse. No direct table permissions, contact payload copies or cached state bodies. Idempotent replays return latest authorized snapshots and original committed revision. Check deletion before returning any state. Successful no-op may retain revisions. Failed/conflicting requests do not reserve an ID as an applied operation.

### B.2 Event save and setup configuration

```sql
organizer_save_event_v2(
  p_event_id uuid, p_base_event_revision bigint,
  p_request_id uuid, p_state jsonb
) returns jsonb

organizer_save_americano_config_v2(
  p_event_id uuid, p_base_event_revision bigint,
  p_signup_event_id uuid, p_base_capacity_revision bigint,
  p_base_roster_revision bigint, p_request_id uuid,
  p_courts jsonb, p_format_config jsonb
) returns jsonb
```

Save creates only a new protocol-2 UUID at base0 (first revision1). Existing protocol1/tombstone rejects. First creation may include valid started history from a never-cloud-saved, unpublished local event; it must have no signup linkage and must pass full frozen-history validation. Unpublished setup edits are allowed under strict schema validation. Published identity/membership/order/labels/courts/published markers/pairing mode must equal stored protected fields; a polled signup projection cannot be replayed through this endpoint. For an existing cloud event it cannot start/reset/unlock/reopen or replace a frozen schedule. Post-start it accepts the specified validated score, correction, clock, End/Next/Finish-early transitions, including section7's legal multi-round offline extensions. With no signup attached it also permits label-only name/team-name corrections preserving every ID/member/fixture/result; this covers cloud-saved unpublished events. Published corrections use B.4. The SQL state validator enforces these rules independently of the UI.

Config is setup-only. Signup arguments are NULL when unpublished. It accepts full Court array and exact AmericanoConfigV2, validates unique IDs/bounds, rejects published mode changes, derives capacity, rebalances once, updates canonical event projection and invalidates preview atomically. It increments event revision; capacity revision only when metadata/capacity changes, roster revision on actual affected registration changes. No generic capacity number argument.

### B.3 Publication/metadata

```sql
organizer_save_signup_event_v3(
  p_event_id uuid, p_base_event_revision bigint,
  p_signup_event_id uuid, p_base_capacity_revision bigint,
  p_base_roster_revision bigint, p_request_id uuid,
  p_metadata jsonb, p_initial_entries jsonb
) returns jsonb
```

First publication requires an already-saved v2 setup cloud event, NULL signup ID, signup revision tokens0. Metadata keys exactly: accountSlug, title, venue, startsAt, endsAt, details, prizes, timeZone, organizerName, publicContactMethod, publicContactValue. Nullable date/contact-method fields match existing standards. Existing signup title/venue edits also update event name/venue consistently. Owner/source/protocol/mode/capacity/isOpen are not accepted. First publish opens only if existing server date/cancellation rules allow; later open/close uses B.6.

Initial entries are `{localEntrantId, teamName?, playerOne, playerTwo?, contact?, rank}`. They must represent the saved active local roster exactly once in roster order with matching player names/membership, plus optional private contacts. Map by localEntrantId, never name. Create new canonical registrations, rebalance, set roster_seeded_at (even empty), save published markers/canonical projection and increment event revision in one transaction. Return canonical URL and identities. Subsequent saves require empty initial_entries and cannot reseed. Persist returned identities before clearing local private contact drafts.

### B.4 Entry mutations and corrections

```sql
organizer_mutate_signup_entry_v2(
  p_event_id uuid, p_base_event_revision bigint,
  p_signup_event_id uuid, p_base_capacity_revision bigint,
  p_base_roster_revision bigint, p_request_id uuid, p_command jsonb
) returns jsonb

organizer_correct_signup_labels_v2(
  p_event_id uuid, p_base_event_revision bigint,
  p_signup_event_id uuid, p_base_capacity_revision bigint,
  p_base_roster_revision bigint, p_request_id uuid,
  p_registration_id uuid, p_expected_updated_at timestamptz,
  p_labels jsonb
) returns jsonb
```

EntryFields = teamName?, playerOne, playerTwo?, contact?. Commands:

```ts
{ type:'add'; entry:EntryFields; acknowledgePossibleDuplicate:boolean }
{ type:'edit'; registrationId:string; expectedStatus:'confirmed'|'waitlisted'|'looking';
  expectedUpdatedAt:string; entry:EntryFields }
{ type:'delete'; registrationId:string; expectedStatus:'confirmed'|'waitlisted'|'looking';
  expectedUpdatedAt:string }
{ type:'reorder'; registrationIds:string[] }
```

Mutation is setup/unlocked only. Reject unknown keys/mode-inconsistent entries/foreign IDs. Reorder contains every complete-pair queue entry for fixed mode, or every individual queue entry for rotating, exactly once; excludes looking/cancelled. Organiser order determines which entries fall within confirmed capacity, so preview the resulting confirmed/waiting movement before committing. Main-roster drag UI constructs the full queue by appending existing waiting order, not a partial RPC array. Partner requests can be edited/deleted but are not reordered into confirmed pairs. Possible duplicate warning uses name+contact; add with explicit acknowledgement creates a distinct entry, never merges. Delete/rebalance/notices/projection/event revision commit together.

Correction is separate and allowed after start. p_labels keys only teamName?, playerOne?, playerTwo?, contact?, playerTwoContact?. Omitted unchanged; required existing player names cannot become empty. No IDs/status/order/member-count/admission-time changes, no rebalance, no promotion. Retain start's frozen roster revision as historical metadata; current roster revision advances with corrected labels/contact. Update corresponding event labels by canonical IDs and increment event revision. Unpublished local events perform the identical label-only validation locally; no signup RPC is needed.

### B.5 Atomic start

```sql
organizer_start_americano_v2(
  p_event_id uuid, p_base_event_revision bigint,
  p_signup_event_id uuid, p_base_capacity_revision bigint,
  p_base_roster_revision bigint, p_request_id uuid,
  p_start_state jsonb
) returns jsonb
```

Flush prior local saves before obtaining the preview input snapshot. Start request is persisted locally before sending. Check all applicable revisions; a cloud-saved but unpublished event uses NULL signup tokens and validates the saved local entrant set. Published start validates current canonical confirmed registrations, not stale stored event projection. Candidate contains the acknowledged complete schedule and first round with NULL/unconfirmed results and an unstarted advisory clock. No unrelated metadata/config changes are accepted.

Server independently validates field capacity/minimum, all identity/court/schedule invariants, acknowledgements and fingerprint. It then closes/locks any attached signup, increments applicable capacity/event revisions and saves frozen event state atomically. Lost response replays existing request, returning latest authorized snapshot; never another local schedule or automatic unlock. No reservation/reset/recovery-unlock endpoint. Only unpublished, never-cloud-saved local events may start offline; any cloud-saved event starts online through this RPC.

### B.6 Open/close/cancel/delete

```sql
organizer_set_signup_open_v2(
  p_event_id uuid, p_base_event_revision bigint,
  p_signup_event_id uuid, p_base_capacity_revision bigint,
  p_request_id uuid, p_is_open boolean
) returns jsonb

organizer_cancel_signup_event_v2(
  p_event_id uuid, p_base_event_revision bigint,
  p_signup_event_id uuid, p_base_capacity_revision bigint,
  p_request_id uuid, p_message text
) returns jsonb

organizer_delete_event_v2(
  p_event_id uuid, p_base_event_revision bigint, p_request_id uuid
) returns jsonb
```

Open/close/cancel updates signup metadata and source published markers atomically, preserving current canonical membership, schedule and scores. It cannot open a locked/started/cancelled/past-cutoff event. No reset/unlock RPC exists. Cancel does not erase results or unlock. Delete uses existing private tombstone/cancel-link helper and returns `{status:'applied'|'replayed',requestId,eventId,deletedAt}` with no state; stale revision conflict has normal owner conflict envelope while live. Repeated authorized deletion returns original deletion timestamp. Legacy delete_event rejects protocol2. Intentional account deletion remains unchanged.

### B.7 Public submission/read contracts

```sql
register_public_player_v2(
  p_account_slug text, p_event_slug text, p_player_name text,
  p_contact text, p_request_id uuid
) returns jsonb

register_public_pair_v3(
  p_account_slug text, p_event_slug text, p_team_name text,
  p_player_one text, p_player_two text, p_contact text,
  p_request_id uuid
) returns jsonb

join_public_single_v3(
  p_account_slug text, p_event_slug text, p_registration_id uuid,
  p_player_two text, p_contact text, p_request_id uuid
) returns jsonb

get_public_signup_v3(p_account_slug text,p_event_slug text) returns jsonb
get_organizer_signup_v3(p_signup_event_id uuid) returns jsonb
```

Player registration requires protocol2 individual mode, no account/owner/capacity/mode parameters. Public name length1–100, contact3–200 after trim, existing anti-abuse/cutoff/lock rules. Normalize name NFKC/trim/collapse whitespace/lowercase. Normalize contact similarly; phone-like contact containing no letters or @ compares digits only. Store trimmed original privately. Active exact name+contact duplicate with a new request ID yields ALREADY_REGISTERED without exposing another record. Same name with different contact or different name sharing one contact is allowed. A client request token may recover only its own submission outcome; a replay after deletion/cancellation never reinserts.

Public success envelope: `{status:'applied'|'replayed',requestId,registrationId,entryMode,registrationStatus:'confirmed'|'waitlisted'|'looking'|'cancelled',position:number|null}`. Player mode never returns looking; fixed pair/partner-request calls may. Rejection uses stable code/message/field without other entries' private data or concurrency tokens. UUID request IDs persist through timeouts/double-clicks; changing form content creates a new logical request. New pair/join calls retain legacy fixed workflow semantics but operate only on protocol2 fixed signups. Factor guarded private logic; do not call legacy wrappers that now reject protocol2.

The new public reader supports both protocols, returns `event.protocolVersion:1|2`, explicit mode/normalized capacity and each canonical registration once, with no owner/source IDs/contacts/request bodies/revision tokens. Client writes route by protocol AND mode: protocol1 uses existing register_public_team_v2/join_public_single_v2, protocol2 fixed uses register_public_pair_v3/join_public_single_v3, protocol2 individual uses register_public_player_v2. Entry mode alone is insufficient to distinguish legacy fixed from new fixed. Legacy public readers must reject protocol2 with UPDATE_REQUIRED rather than returning a misleading pair-based projection. New clients use the v3 reader. Owner reader returns metadata, all canonical registrations and both signup revisions in one MVCC-consistent snapshot. Existing URL routing/slug resolution stays unchanged. Private promotion-notice read/ack routines retain ownership checks; reuse them without granting any new public access.

Extend existing private public-request ledger operations to distinguish player/pair/join v2 operations. Compute payload hashes server-side; retain legacy operation values/behaviour. No contact response copies. Missing row on replay returns cancelled/missing outcome for that request, not a new registration.

### B.8 Required legacy guards and SQL validation

Before first write, legacy routines reject protocol2 source/target, including first-publication calls where no signup row exists yet:

- organizer_save_signup_event and organizer_save_signup_event_v2;
- organizer_update_signup_registration private base and guarded wrapper;
- organizer_lock_signup_roster, organizer_unlock_signup_roster, organizer_set_signup_open, organizer_cancel_signup_event;
- organizer_reorder_signup_registrations, organizer_sync_signup_roster, organizer_seed_signup_roster, organizer_add_signup_pair;
- organizer_delete_signup_registration_if_status and already-revoked deletion private bases;
- delete_event;
- every UUID/single-slug/namespaced register_public_team and join_public_single overload, including their v2 wrappers.

Keep already-revoked public cancellation/unguarded delete routines revoked. Check all permissive RLS policies, because they combine with OR; adding one restrictive-looking permissive policy does not negate an older permissive policy. Signup protocol/entry_mode and source event must match through both FK and private validation; no direct client can create a legacy signup for a new source.

Postgres `rebalance_signup_capacity` trigger must dispatch by protocol to the correct helper and never send individual capacity0 through legacy pair logic. Mode2 roster_revision trigger increments on actual INSERT/UPDATE/DELETE; multiple rows can advance the token multiple times. Treat it as opaque equality, not operation count. Avoid writes on idempotent/no-op paths. Frozen rosters reject automatic rebalancing. Parent-event creation/deletion uses the same lock order as owner mutation/start.

Server start validation mirrors A.2 integrity/coverage, exact-cycle/custom fixture equivalence and balanced appearance/count/acknowledgement checks. It does not need to rerun the eight-candidate heuristic: it validates the submitted legal balanced schedule and independently recomputes its metrics/fingerprint. This is deliberate, not permission to bypass participant/capacity/rule validation.

## Appendix C — implementation status record

Create `docs/americano-v2-validation.md` during implementation with one row per P0–P6 and A01–A40: pending/passed/failed/blocked, command or scenario, test-fixture identity, result and artifact path. Keep it free of real contact details/secrets. Distinguish `Implementation finished; device verification blocked` from `All acceptance gates passed`. Planning feasibility checks above must not be entered as application test passes.

## Appendix D — copyable execution instruction

> Use the implement-plan skill. Implement docs/americano-v2-implementation-handoff.md exactly, with no material deviation. Complete phases P0–P6 and provide evidence for A01–A40 in docs/americano-v2-validation.md. Preserve all current/legacy events and signups. Work locally and use only isolated synthetic-data databases. Do not push, deploy, apply remote migrations, modify production data, or submit an App Store build. If a requirement conflicts with the repository or cannot be verified, stop that phase and ask before changing the plan. Do not silently narrow scope, substitute scoring/scheduling, or report partial work as complete.
