# Americano: games, sets, standings points and tie options

Authoritative implementation handoff: `docs/americano-v3-formats-implementation-handoff.md`.

## 1. Objective, boundaries and readiness

**Ready for implementation.** This document fixes the product behaviour, persistence contracts, compatibility strategy and tests. It authorizes no release: the current request is to produce this plan, not implement, push, migrate a shared database, publish a website or submit an App Store build. A subsequent implementation should first deliver a locally tested preview. Production and native release remain separate actions requiring authorization and the gates in section 8.

Add optional traditional games/sets scoring to both rotating and fixed-pair Americano. Organisers choose the match format, standings points per game won, and tie treatment during setup. Retain rally-points Americano and the advisory pace clock. Do not require accounts for public entrants.

### In scope

- Rally points; first-to-N games; one set; best of three sets; optional deciding match tiebreak; supported custom rules.
- A configurable integer points-per-game award and optional match-win bonus for games/sets.
- Shared ranks, score difference, fixed-pair head-to-head, and an optional championship final between exactly two tied leaders.
- Golden-point, seven-point or ten-point championship final; explicit rotating-player support-partner selection.
- Setup, score entry, corrections, history, standings, podium, public rules summary, templates, imports/exports, local/cloud persistence, validation and tests.
- Protect existing events and preserve the present schedule, roster, capacity, signup and clock behaviour.

### Non-goals

- Timed matches, automatic score finalisation at timer zero, live 15/30/40 umpiring, service rotation tracking or ball-by-ball scoring.
- Mid-event rule changes, per-round formats, late-entry substitution, walkovers, retirements, artificial awarded games or partial-set results.
- A multi-entrant championship bracket or playoff for every tied position. If more than two leaders remain tied, they share first place with an explicit explanation. Never select two finalists arbitrarily.
- Changing KoC, enabling/redesigning Tournament, changing prices/trials, native release or deployment.
- Reworking the unpublished manual-roster overflow behaviour found during earlier testing. That is a separate issue; existing capacity checks still apply.
- Automatic migration of existing Americano competitions to these new rules.

### Baseline inspected

- Date: 25 September 2026.
- Repository: `C:/Users/USER/Documents/Codex/2026-08-14/c-users-user-claude-projects-koc/work/koc-multi-event`.
- Branch: `main`; HEAD: `e312a55cab7003bebcbbeeeabc095132b5797496`.
- Pre-existing working-tree change: `docs/release-2026-09-24.md`. Preserve it; do not include it in this feature by accident.
- React 18, TypeScript 5.6, Vite 5.4, Zustand 4.5, Supabase JS 2.106, Vitest 2.1; versions are from the current package configuration.
- Repository instructions include account-aware GitHub wrappers. Do not run `gh auth switch`. No GitHub operation is needed for planning/local implementation.

### Verification actually performed while planning

Command, from repository root:

```powershell
npx vitest run src/tests/tournamentV1Scoring.test.ts src/tests/americanoV2Standings.test.ts
```

Result: **2 files, 28 tests passed**. Initial sandbox execution failed before tests because esbuild could not read an ancestor/configuration path; the same local command passed using approved host execution. This was an environment restriction, not a failed assertion.

No new-feature tests, full build, database migration or physical-device test were performed in this planning turn. Earlier v2 rehearsal reports are supporting history, not evidence that this unimplemented feature works. All new test names below are proposed unless explicitly identified as existing.

## 2. Current architecture and evidence

All paths below are repository-relative. Files marked **new** do not exist at baseline.

| Area | Verified existing targets and behaviour |
| --- | --- |
| Americano domain | `src/logic/americanoV2/types.ts`: schema 2, rules 2, protocol 2; rotating/fixed sides; one scalar score per side; integer rally target 1–2,147,483,647. |
| Lifecycle | `src/logic/americanoV2/runtime.ts`: config/roster edits invalidate previews; confirm result, end round, next round, finish early and historical corrections are distinct operations. Only completed included rounds count. |
| Fixtures | `src/logic/americanoV2/schedule.ts`, `scheduleClient.ts`, `schedule.worker.ts`, `validation.ts`, `fixtures.ts`: deterministic seeded assignments, full/balanced/custom schedules, acknowledgements, worker with 2-second watchdog. Assignment algorithm is `americano-v2.1`. |
| Rankings | `src/logic/americanoV2/standings.ts`: each rotating player receives the side's full rally score; fixed team receives it once; equal totals share competition ranks. |
| Scoring available for reuse | `supabase/functions/_shared/tournament/scoring.ts`, `types.ts`, `presets.ts`; browser barrel `src/logic/tournament/index.ts`. `validateRuleProfile` and `scoreSummary` already validate games, sets and tiebreak endpoints. Deciding match tiebreaks contribute one set win and zero games. |
| Organiser views | `src/components/americano/AmericanoSetup.tsx`, `AmericanoDisplay.tsx`, `AmericanoLeaderboard.tsx`; route dispatch in `src/routes/SetupScreen.tsx`, `DisplayScreen.tsx`, `LeaderboardScreen.tsx`. |
| Public signup | `src/routes/PublicSignupScreen.tsx`, `src/lib/signups.ts`, `src/lib/americanoV2.ts`. Public protocol-2 entry modes already distinguish individual and fixed pairs. |
| State and persistence | `src/store/eventStore.ts`, `eventCatalog.ts`, `eventRepository.ts`, `cloudSync.ts`; IndexedDB event bodies, active-event facade, per-owner dirty tracking and CAS-based protocol-2 writes. |
| Serialization | `src/utils/eventSchema.ts`, `exportImport.ts`, `src/store/templates.ts`, `src/utils/rosterShare.ts`. Unknown event versions reject; template storage currently filters unknown template versions. |
| Visibility | `src/config/features.ts`: Americano web creation released; native creation separately gated; Tournament separately gated. Creation flags must not gate event readers. |
| Server authority | `supabase/migrations/20260911100000_americano_v2_protocol.sql`, `20260911110000_americano_v2_owner_core.sql`, `20260911120000_americano_v2_owner_workflows.sql`, `20260911130000_americano_v2_public_signup.sql`, and latest overrides in `20260925100000_americano_release_safety.sql`. |
| Database tests | `tests/db/americano-v2/run.mjs`, `contract.sql`, concurrency fixtures, `release-safety.mjs`; runner rejects non-loopback hosts and database names without `koc_americano_test_`. |
| Styling/help | `src/index.css`, `src/styles/app-design.css`, `event-design.css`, `scoreboard.css`, `src/routes/HelpScreen.tsx`. Keep new selectors scoped to Americano. |

Important server details: `events.state` is JSONB; event and signup revision tokens are distinct; `event_v2_requests` records stable request IDs/payload hashes. Owner RPCs lock event, then linked signup, then registration rows. Public signup/start races are resolved within that same lock order. Published roster projection is the source of truth, not a second independently maintained list. The latest `americano_v2_state_error` and save/config/start functions accept only schema/rules 2. The present event CHECK constraint also excludes schema 3. Changing only UI would therefore be incorrect.

The existing traditional validators are the chosen scoring semantics, not a mandate to reuse Tournament's lifecycle, storage, bracket generation or UI. FIP's [Rules of Padel, effective 1 January 2026](https://www.padelfip.com/wp-content/uploads/2025/12/FIP_Rules-of-Padel.pdf), Rule 1, inform the conventional set/tiebreak presets. Points-per-game standings, short club formats and the championship golden-point final are **custom club competition policies**, not claims about an official FIP Americano ranking standard.

## 3. Acceptance criteria, invariants and fixed decisions

### Acceptance criteria

| ID | Observable requirement |
| --- | --- |
| AC-001 | New-format creation is explicitly gated; existing schema-1/2 events retain their format, scores, schedule and rankings without conversion. Readers are independent of the creation flag. |
| AC-002 | Both pairing modes offer Rally points, Games and Sets, with the presets/custom controls in section 4; valid settings survive save/reload and invalid fields are highlighted before publish/preview/start. |
| AC-003 | Rally scoring retains complement entry, arbitrary valid integer targets and legal equal scores. Traditional results use independent games/set rows, reject impossible endpoints and require a terminal winner to confirm. |
| AC-004 | Traditional standings apply the configured game award and optional match bonus exactly once per fixed team or once to each rotating partner. Set-tiebreak rallies and match-tiebreak rallies are never counted as games. |
| AC-005 | The selected tie policy produces deterministic shared competition ranks or the specified difference/head-to-head ordering. Head-to-head is unavailable in rotating mode, never orders a multiway group pairwise, and can leave ties unresolved. |
| AC-006 | A final is offered only after completion, with at least one included round and exactly two unresolved leaders. Fixed sides remain intact; rotating finalists use two explicitly chosen distinct non-finalist partners. Three or more leaders remain shared with a visible explanation. |
| AC-007 | A valid final selects champion/runner-up without changing regular-season points or other ranks. Golden-point/tiebreak results validate, persist, replay safely and appear in history and spectator output. |
| AC-008 | Corrections recalculate all derived standings. A regular-result change makes an old final stale; it is not silently applied to different standings or participants. A current eligible final can be explicitly reset or corrected. |
| AC-009 | Pairing, roster, courts, scoring, rankings and tie policy lock on start. Setup rule changes invalidate preview/acknowledgements. Fixtures are unchanged by results, corrections or finals. |
| AC-010 | End round still requires every scheduled match confirmed; only whole completed included rounds count; finishing early excludes the unfinished round. Pace zero never changes scores, confirms results or advances play. |
| AC-011 | Owner authority, RLS, server-side validation, canonical roster, capacity, request-id replay, CAS conflicts, tombstones and signup/start races remain correct for schema 3 and schema 2. |
| AC-012 | New schema validates/imports/exports/copies/templates correctly, with no signup linkage carried to a new copy. Reload/offline retry/account switching cannot reinterpret traditional scores as rally scores or erase unsupported records. |
| AC-013 | Public signup, roster share and organiser summaries describe actual pairing/scoring/ranking/tie rules without exposing phone/contact data. Updating setup rules updates the public summary from the authoritative event. |
| AC-014 | Dark/light phone, iPad and TV views remain usable: readable identities, labelled score units, touch controls, unclipped content and a clearly read-only spectator mode. No new global layout changes. |
| AC-015 | Contract vectors agree between TypeScript and PostgreSQL; focused and full regressions/build pass, and rotating/fixed end-to-end rehearsals plus migration/race/rollback tests have recorded evidence before any release. |

### Invariants

- **INV-001 — Version isolation:** schema 1/2 cannot be reinterpreted, downgraded or upgraded in place. New scoring exists only in schema 3/rules 3; protocol remains 2 for its established transport/concurrency semantics.
- **INV-002 — Single authority:** canonical published registrations determine roster; immutable score inputs determine totals, ranks and winners. Never persist an independently editable points total, winner ID or ranking override.
- **INV-003 — Unit correctness:** rally points, games, sets, match-tiebreak points and standings points are distinct quantities. A completed result has exactly one discriminated scoring representation.
- **INV-004 — Lifecycle:** only confirmed matches in completed, non-excluded rounds contribute. Scores never decide court movement/partners; this is Americano, not Mexicano.
- **INV-005 — Freeze:** started roster identities/membership/order, rules and fixtures cannot change. Correcting labels remains supported through the existing authority path.
- **INV-006 — Authority/concurrency:** owner authentication, exact version/revision, idempotency and event→signup→registration lock order apply before mutation. Conflicts never auto-merge incompatible rules or scores.
- **INV-007 — Final provenance:** a final resolves only the two leaders of its exact regular-results basis; no points inflation, no helper credit, no automatic reuse after a correction.
- **INV-008 — Safety:** current events, KoC and Tournament are not modified by feature creation or migration. Feature disablement stops creation, not reading or completing a supported event.

### Decisions

| ID | Fixed decision and reason |
| --- | --- |
| D-001 | Introduce schema/rules 3, keep protocol 2. Extending schema 2 silently would let older clients read traditional scores as rally totals; a new transport is unnecessary because owner/revision/signup contracts remain applicable. |
| D-002 | New schema-3 events default to rotating, rally target 24, full schedule, shared ranks, no final, 10-minute advisory pace disabled. Games/sets awards default to 1 per game and 0 match bonus. Existing events stay on their own defaults/rules. |
| D-003 | Use the existing portable traditional validators through an Americano adapter. Do not build a second browser scoring interpretation or start the Tournament engine. Mirror necessary validation in SQL with shared conformance fixtures. |
| D-004 | Games/sets are played to a winner, not to a combined games total. Rally scores alone complement automatically. A draw in a traditional unfinished set cannot be confirmed by entering arbitrary winners. |
| D-005 | Standings reward raw games won, including those in lost matches. Optional match-win bonus is explicit; there are no win/draw/loss table points or points-per-set in this increment. No automatic averages for unequal appearances. |
| D-006 | Head-to-head applies only to a two-team fixed-pair tie; rotating partners and multiway cycles make a generic pairwise comparison misleading. Larger groups skip that criterion. |
| D-007 | Finals resolve first place only, for exactly two leaders. Multiway ties remain shared, explicitly disclosed in setup and final standings. A mini knockout bracket is a future change, not a hidden Tournament dependency. |
| D-008 | A rotating final has one contender plus one support partner per side; organisers choose two other frozen-roster players and confirm them. Only contenders receive final ranks. Never create a singles padel match or reward both partners. |
| D-009 | Keep the pace clock advisory and retain its current 5/10/15/20/25/30-minute choices. Changing a preset does not silently alter the chosen pace. Best-of-three may take longer: show an estimate, not a deadline. |
| D-010 | Local implementation first; deploy additive database support and compatible readers before enabling creation. Pre-feature builds are not a valid rollback target once schema-3 events exist. |

Nonblocking assumptions: “points per game win” means each individual **game**, not each match; the separate bonus field makes the distinction visible. “Ties” means final standings ties, not replacing the normal score rules inside every match. A golden-point championship is a club decider, separate from Golden Point at deuce. The UI and tests must communicate these distinctions; do not reinterpret them during implementation.

## 4. Product and scoring contracts

### 4.1 Creation and presets

Retain the existing Rotating pairs / Fixed pairs selection. Add `Match scoring` with three choices. Default Rally points. Games defaults to First to 5; Sets defaults to One standard set. Switching families is an unsaved form edit until Save/Publish/Preview validates it; it never mutates an event mid-match.

| Preset key | Label | Family / best-of | Games target / margin | Set tiebreak | Deciding match tiebreak | Game ending |
| --- | --- | --- | --- | --- | --- | --- |
| `rally` | Rally points | Existing combined target | Default 24 points; 1–2,147,483,647 integer | N/A | N/A | Not tracked |
| `first-to-five` | First to 5 games (maximum 9 games) | Games / 1 | 5 / 1 | None | None | Golden Point |
| `short-set` | One short set | Sets / 1 | 4 / 2 | At 4–4, first to 7, win by 2 | None | Golden Point |
| `standard-set` | One standard set | Sets / 1 | 6 / 2 | At 6–6, first to 7, win by 2 | None | Advantage |
| `best-of-three` | Best of 3 sets | Sets / 3 | 6 / 2 | At 6–6, first to 7, win by 2 | None | Advantage |
| `best-of-three-match-tiebreak` | Best of 3 — deciding match tiebreak | Sets / 3 | 6 / 2 | At 6–6, first to 7, win by 2 | At one set each, first to 10, win by 2 | Advantage |
| `custom` | Custom games / Custom sets | Explicit fields below | Explicit fields below | Optional | Optional for best-of-3 sets | Explicit |

Custom exposes family Games or Sets; Sets exposes one set/best of three. Games target integer 1–99; margin 1 or 2; game ending Advantage / Golden Point / Star Point; set tiebreak off/on; trigger allowed by `validateRuleProfile`; target integer 1–99, default 7, always win by 2. Trigger choices: games target−1 for margin 1; games target−1 or games target for margin 2, filtered to positive integers only. If that leaves no trigger (games target 1, margin 1), disable set tiebreak and persist null/null. A match tiebreak is None / 7 / 10 and available only with best-of-3 sets. Tiebreak off persists both trigger and target as `null`. Editing any preset's scoring fields changes its preset label to Custom, retaining the edited values.

The Rules summary says what players must do at deuce; the app records completed games/sets, not the rally sequence. Reuse the existing rule descriptions; do not implement a live Star Point counter.

### 4.2 Configuration schema (new)

Define in **new** `src/logic/americanoV3/types.ts`:

```ts
type TraditionalRule = Pick<RuleProfile,
  'family' | 'bestOfSets' | 'gamesToWin' | 'gameMargin' |
  'tiebreakTrigger' | 'tiebreakTarget' | 'decidingMatchTiebreak' | 'gameEnding'>;

type MatchScoringV3 =
  | { kind: 'rally'; pointsPerMatch: number }
  | { kind: 'traditional'; preset: TraditionalPresetKey; rule: TraditionalRule;
      standings: { pointsPerGameWon: number; matchWinBonus: number } };

type RankingTiebreak = 'shared' | 'difference' | 'head-to-head' | 'head-to-head-then-difference';
type ChampionshipPolicy = 'none' | 'golden-point' | 'tiebreak-7' | 'tiebreak-10';

interface AmericanoConfigV3 {
  rulesVersion: 3;
  pairingMode: 'rotating' | 'fixed';
  scoring: MatchScoringV3;
  ranking: { tiebreak: RankingTiebreak; championship: ChampionshipPolicy };
  scheduleKind: 'full' | 'balanced' | 'custom';
  customRounds?: number; // present only for custom, integer 1–64
  paceMinutes: 5 | 10 | 15 | 20 | 25 | 30;
  paceClockEnabled: boolean;
}
```

`TraditionalPresetKey` is the five traditional keys above plus `custom`. Non-custom key must match its frozen rule definition; no trusting a label with contradictory values. Persist full rules, not only a lookup key. Do not change existing Tournament preset objects/versions.

Traditional awards: `pointsPerGameWon` integer 1–1,000, `matchWinBonus` integer 0–1,000. Reject blank, fraction, NaN, infinity and out-of-range input; no silent clamping. Bounds are club-product limits and keep arithmetic exact within JS safe integers for the supported 64-round/three-set maximum, even using the existing per-score PostgreSQL integer bound. SQL aggregates use bigint/numeric, not 32-bit integer intermediates.

Adapter constructs a `RuleProfile` with `id:'americano-v3'`, `version:2`, generated name, `estimatedMinutes:config.paceMinutes`, `restMinutes:0` and the frozen scoring rule. These administrative fields do not change traditional score semantics or import Tournament rest scheduling. Run `validateRuleProfile`, then `scoreSummary` for draft/confirmed values. No `TournamentResult` walkover/administrative variants are admitted.

### 4.3 Event and result schema

`AmericanoEventStateV3` keeps v2's event ID, protocol 2, revision string, metadata, settings, courts, fixed teams/participants, status, pending assignments and completion reason. Replace schemaVersion with 3, formatConfig with the above, rounds with the following result representation, and use `AmericanoScheduleV3`. Add optional `championshipFinal` (section 4.6). No duplicate `scoreA`/`scoreB` fields at match root.

```ts
type SetDraft =
  | { kind: 'set'; gamesA: number | null; gamesB: number | null;
      tiebreakPointsA: number | null; tiebreakPointsB: number | null }
  | { kind: 'match-tiebreak'; pointsA: number | null; pointsB: number | null };

type AmericanoResultDraftV3 =
  | { kind: 'rally'; scoreA: number | null; scoreB: number | null }
  | { kind: 'traditional'; sets: SetDraft[] };

interface AmericanoMatchV3 {
  id: string; courtId: string; sideA: AmericanoSide; sideB: AmericanoSide;
  result: AmericanoResultDraftV3;
  resultConfirmed: boolean;
}
```

Round identity/index/fixtureRoundId/timer/completedAt/excludedReason are unchanged. Ordinary set rows always include both nullable tiebreak fields; non-tiebreak rows must have them null when confirmed. A match-tiebreak row is third only, permitted at one set each and only when configured; adapt it to the shared validator's `decidingMatchTiebreak:true` representation, never call its points “games” in the UI.

- New rally draft is null/null; entering one valid score complements the other, including an explicit zero.
- New traditional draft starts with one blank set row. Values are independent; never complement games from a target.
- Score fields permit integer 0–2,147,483,647. No more than the configured set count. Drafts may be incomplete but cannot contain malformed types, extra rows or a mismatching scoring discriminator.
- Materialize complete numeric rows into `TournamentScore` and validate with `scoreSummary(..., false)` during editing. Empty/partial row input remains a UI/persisted draft, not a confirmed zero. Validate a complete result with `scoreSummary(..., true)` on confirmation, again on the server.
- Persist only structurally valid, reachable unconfirmed drafts: validate the fully populated prefix using the shared validator; permit at most one trailing incomplete row, and only after a terminal preceding set when one exists. Nullable known fields must still satisfy their numeric bounds and legal row position. Invalid text, an unreachable complete row, or later rows invalidated by an earlier edit stay in the local editor with an `Unsaved — fix highlighted score` message; do not replace the last valid persisted draft or repeatedly send rejected saves. A pending set tiebreak can be retained as a trailing incomplete row until both tiebreak scores are entered. Cancel discards editor-only changes. SQL enforces the same persisted-draft/confirmed-result distinction.
- After a completed first set, show Set 2 only for best-of-three; show a decider only when one set each. Editing an earlier set to make later rows invalid marks those rows and offers explicit `Clear later sets`; do not silently delete scores or retain a confirmed flag.
- Editing any current result clears confirmation. Cancelling the result editor restores the original value. Confirm does not end a round.
- Correcting completed history is an atomic replace with a valid complete result; cancelling keeps the old official score. A completed included round may never contain an unconfirmed/incomplete result.
- No additional zero set after a match has already been won; no draw as a completed traditional result.

### 4.4 Standings formula and examples

For each included confirmed match:

```text
rally:
  sideStandingPoints = own rally score
traditional:
  sideStandingPoints = normal games won * pointsPerGameWon
                       + (match winner ? matchWinBonus : 0)
```

For rotating, give that full amount to **each** player on the side. For fixed, give it once to the team. No court multiplier, no split between partners, no standings points from rests, and no points for an unfinished/excluded round. The champion final never affects these totals.

Derived row includes `entrantId, rank, total, unitsFor, unitsAgainst, matchesPlayed, wins, draws, losses, setsFor, setsAgainst`. `unit` is rally-points or games. Set counts are zero for Games, normal set counts for Sets, and zero for Rally. Match-tiebreak winner earns a set and the optional match bonus but **zero games** for that decider. A normal set tiebreak is already represented by the set's final games, e.g. 7–6; its 8–6 tiebreak points are not added.

| Fixture | Awards | Expected totals for side A / B |
| --- | --- | --- |
| Rally 10–14 | Rally | 10 / 14, each rotating member gets the side value |
| Games 5–3 | 2/game, 0 bonus | 10 / 6 |
| Games 5–3 | 2/game, 3 win bonus | 13 / 6 |
| Sets 6–4, 4–6, match TB 10–8 | 2/game, 3 bonus | Games 10–10; standings 23 / 20; sets 2–1 |
| One set 7–6, TB 8–6 | 1/game, 0 bonus | 7 / 6, not 15 / 12 |
| Sets 6–0, 0–6, 7–6 (valid TB) | 1/game, 0 bonus | 13 / 12 |
| Sets 6–0, 5–7, 5–7 | 1/game, 0 bonus | Match loser A earns 16, winner B earns 14 — deliberate games-won policy |

Show an always-visible short note beside the awards: `Every game counts, including games in lost matches. A match winner may earn fewer standings points unless you add a win bonus.` Different match lengths can award different totals. Unequal-appearance warnings from custom/early-finished schedules remain; do not normalize silently.

### 4.5 Tie ranking algorithm

Setup choices: `Share tied places` (default), `Score difference`, `Head-to-head` (fixed only), `Head-to-head, then score difference` (fixed only). Explain “score difference” as rally points won minus lost, or games won minus lost. Sets won is not an implicit criterion.

1. Compute totals from all included completed rounds. Partition by total descending.
2. For each tied group, apply exactly the selected secondary sequence. `shared` has no secondary criterion. Difference partitions by `unitsFor - unitsAgainst`, descending.
3. Head-to-head is eligible only if this group contains exactly two fixed teams and they have at least one included direct match. Compare each team's aggregate **standings points earned in those direct matches**, using the selected formula. If equal, missing, rotating, or more than two teams, it does not separate them. Do not run arbitrary pairwise array comparators or create a mini-table for three teams.
4. Apply difference to unresolved groups only when selected after head-to-head. No implicit fallback to names, wins, sets or entrant creation time.
5. Equal final keys share competition ranks: group rank is `1 + number of entrants in preceding groups`. Stable roster order controls display order within a tied group only, not rank.
6. Apply a current confirmed championship final as described below. Live standings use steps 1–5; finals apply only after completion.

With a fixed rally target and equal matches played, score difference may be mathematically redundant with total points. Say it can leave a tie, not that it guarantees a winner. A first-place group of three under head-to-head-only stays shared even if a pairwise comparison could order some members.

### 4.6 Optional championship final

Separate setup field: `If two players/teams still tie for first` with `Share first place`, `One golden point`, `Tiebreak to 7 (win by 2)`, `Tiebreak to 10 (win by 2)`. Help: `This decides first place only. Three or more tied leaders share first place. Other ties stay shared.` For rotating also explain that two other players must support the finalists and earn no extra standings points.

Eligibility is derived, never guessed: event `complete`, at least one included completed round, ranking steps 1–5 produce exactly two first-place entrants, and championship policy is not none. Scheduled and early completion use the same eligibility; early finish retains its visible incomplete-event warning. Zero included rounds displays `No results` and no champion/podium/final. If one leader exists, show normal champion. If more than two leaders tie, show `3 players share first — a two-player final cannot resolve this tie` (adjust noun/count) without an enabled final action.

**New** final data:

```ts
interface ChampionshipFinalV3 {
  id: string;
  basisFingerprint: string;
  contenderIds: [string, string]; // roster order; these are entrant IDs
  courtId: string;
  supportPlayerIds: [string, string] | null; // null for fixed; A helper then B helper
  outcome:
    | null
    | { kind: 'golden-point'; winner: 'A' | 'B'; confirmedAt: number }
    | { kind: 'tiebreak'; pointsA: number; pointsB: number; confirmedAt: number };
}
```

`basisFingerprint` is SHA-256 of canonical JSON containing schemaVersion, complete formatConfig, schedule inputFingerprint, ordered entrant identity/membership and every included round's fixtureRoundId plus each match ID/result/confirmation. Preserve schedule order; exclude names, contacts, timer fields, event/cloud revision, final data and timestamps. Score changes invalidate; label correction or sync acknowledgement does not. No fingerprint of only the winner IDs or only totals.

- The organiser chooses any configured court (default first court); the final is separate from the frozen schedule and begins only after ordinary play ends.
- Fixed: sides are the two intact teams. Rotating: choose exactly two distinct active frozen-roster players excluding both contenders, explicitly assign A/B, then acknowledge `Support partners do not earn points or places from this final`. Do not auto-create players or select partners silently. Minimum field four guarantees two candidates exist, but if they are unavailable the final stays pending; organiser can defer it, not invent a winner.
- `Prepare final` saves a final with current basis and null outcome. After that, labels remain editable via existing label correction but side/court edits require Reset final. There is no championship countdown or automatic result.
- Golden point: pick the side that won that single rally, then Confirm. A double fault during play can decide it; the app does not umpire. A tiebreak requires integer scores, higher score at least target and a valid win-by-two terminal endpoint (e.g. 7–5 or 8–6; not 7–6 or 9–5).
- On confirmation rank winner 1 and loser 2, retaining both regular totals, all other ranks and all regular W/D/L. Show `Won championship final`, not a fake extra game/point. History has a separate final section with both contenders and support partners if used. Keep the base shared rank available for explanation.
- On regular-result correction, compare basis; a stale final remains stored for review but **does not affect ranks**. Show `Final needs review — regular results changed`. Never automatically relink it, even if the same two leaders remain tied.
- `Reset final` requires explicit confirmation when a prepared/result final exists. It removes that final and allows a newly eligible final with a new ID/basis; if no longer eligible, only base standings remain. No superseded-result audit system is introduced here; make the loss clear in the reset confirmation and export the event before reset if the organiser wants a record.
- Final result correction is allowed only with current basis and eligible contenders; it replaces only outcome after validation. A reset/reprepare/correction uses the same CAS/retry protection as other state changes.

### 4.7 Lifecycle, UI and failure behaviour

| Action | Preconditions | Effect / failure |
| --- | --- | --- |
| Edit scoring/ranking | Setup; owner for published event | Validate complete new config; invalidate preview and acknowledgement; update server config atomically when published. After start show locked-rule summary, not editable fields. |
| Publish/update | Valid setup + existing publication checks | Canonical signup record; derived public rules summary. Invalid rule shows field error and no partial metadata publication. |
| Preview/start | Existing capacity/roster/schedule acknowledgement checks plus v3 rules | Freeze rules and fixtures; server start atomically closes signups using existing revisions. |
| Enter/confirm/end/next | Same v2 round lifecycle | Only valid completed results confirm; End disabled with a per-match explanation if any missing; Next never changes scoring rules. |
| Clock expires | Any live round | Advisory visual state only. No match, result or round mutation. |
| Finish early | Existing confirmation flow | Exclude entire unfinished round; compute included totals; final eligibility derived. |
| Correct history | Owner; completed included match; complete valid replacement | Recompute standings and final currency; no schedule rewrite or participant changes. |
| Prepare/confirm/reset final | Section 4.6 | Separate final state; no phantom extra round or extra standings points. |

Keep setup grouped into Match scoring, Standings points (traditional only), Ties, and existing Schedule/Pace. Show a concise saved rules summary on preview, match display and public signup. Distinguish games vs sets in score-entry headers and standings columns; a generic “Points” label alone is insufficient. Do not show traditional-only bonus controls in rally mode.

When a permitted empty/unpublished pairing-mode change moves Fixed to Rotating, reset a head-to-head ranking choice to Shared in the same unsaved form update and show `Head-to-head is only available for fixed pairs`. Retain a compatible difference/shared policy and championship choice. Never hide a still-selected invalid head-to-head value behind a disabled control.

Retain team name plus player names for fixed pairs; individual names for rotating. Keep large +/- controls for Games and the currently edited traditional row, direct numeric entry as well, accessible labels naming side/row/unit. Set-break score inputs only appear when needed. Raw game controls do not auto-confirm at the terminal score. Spectator mode contains no writable controls/final selection.

Validation: use `aria-invalid`, an associated inline message, an error summary on attempted action and focus the first invalid field. Avoid raw SQL/error text. Dialogs trap focus, support Escape/cancel, and return focus. Minimum 16px input/body UI; at least 44px touch targets. Result-editor content may scroll on a phone; do not create page-width overflow. Preserve current TV overview density/pagination and KoC's landscape no-scroll layout; this feature does not redesign either. Both themes must have visible focus/disabled/error states.

During network save/start/final submission, disable duplicate action, retain sealed request UUID/payload for retry, and indicate pending vs saved. Timeout is not rejection: retry the same envelope. Conflict retains local draft separately, loads current server snapshot and asks the organiser to reconcile; do not silently retry with the new revision. Auth expiry retains draft but stops transmission. A second owner/account must never replay the first's pending request.

## 5. Engineering, persistence and API contracts

### 5.1 Version dispatch and shared helpers

Create **new** `src/logic/eventVersions.ts` as canonical `VersionedEventState = EventState | AmericanoEventStateV2 | AmericanoEventStateV3` with exact v2/v3 guards and a broad `isAmericanoEvent` guard. Re-export the union from the old v2 types module for compatibility while updating consumers to the new module; avoid a runtime import cycle (type-only imports for state types). Do not change `isAmericanoEventV2` to return true for schema 3.

Create **new** `src/logic/americanoV3/{types,scoring,standings,runtime,championship,schedule,scheduleClient,schedule.worker}.ts`. Reuse v2 identity/view helpers through explicitly broadened readonly shape parameters where semantics are identical. Runtime can share extracted immutable roster/clock helpers, but v2 result functions must not accept v3 accidentally. Do not fork Tournament, cast a v3 event to v2, or populate fake rally targets to make a validator pass.

Extract scoring-independent fixture generation from v2 `schedule.ts` into **new** `src/logic/americanoV2/scheduleCore.ts`, taking only pairing/schedule parameters, entrants, courts, seed, roster revision and acknowledgements. V2 wrapper must produce the same fingerprint, assignment order, metrics and validation behaviour as baseline (generated IDs naturally differ). Leave fixture tables/checksums and `americano-v2.1` assignment algorithm unchanged.

V3 wrapper returns the same structural schedule fields with `fingerprintVersion:3`. V3 canonical fingerprint payload is:

```text
{ fingerprintVersion:3, algorithmVersion:'americano-v2.1',
  formatConfig:<complete normalized config>, seed, orderedEntrantIds,
  membership:<ordered fixed teamId/playerIds array or null>, courtIds,
  rosterRevision:<string>, fixtures:<same courtId/sideA/sideB/rest arrays as v2>, metrics }
```

Use existing `canonicalJson`/`sha256Hex`; SQL must match byte-for-byte. Omitted customRounds normalizes to omission within config; all defined null rule fields stay null. IDs of fixtures and acknowledgements are excluded like v2. The acknowledgement fingerprint equals the v3 input fingerprint. Reuse the same 2-second worker timeout; discard a late preview if current inputs no longer match the request. Freeze new schema rules after start regardless of creation flag.

### 5.2 Database support (new additive migrations)

Create **new** `supabase/migrations/20260926090000_americano_v3_scoring.sql` and `20260926091000_americano_v3_workflows.sql`. If that timestamp collides at execution, use the next free timestamp after all existing migrations without changing their order. Never edit/reapply an already-deployed migration to add this feature.

Keep existing tables, protocol value 2, RLS and revision/request tables. No row backfill, table copy, data deletion or new public contact storage is needed.

1. Extend `events_protocol_state_check` to permit the exact schema3/rules3/protocol2/formatamericano combination as well as existing combinations. Do not accept generic future versions. Add the replacement CHECK `NOT VALID`, validate it with existing rows before dropping the old check inside the migration transaction; after commit both old rows and new version are valid. No data rewrite. Schema lock acquisition is bounded by migration-session lock timeout; abort rather than hold a busy shared database indefinitely.
2. Add `americano_v3_config_error`, `americano_v3_state_error`, `americano_v3_schedule_fingerprint`, traditional-score-summary and championship validation helpers. These are internal, not executable by anonymous/authenticated users directly. Return stable error code/field paths; invalid types/large numbers must not throw unhandled casts. SQL must independently validate score rows, no extra sets, terminal endpoints, weights, standings/final eligibility and fingerprints.
3. Add internal version dispatch for common roster projection/snapshots. `americano_v2_project_roster` already preserves other JSON fields; maintain that property. Validate projected v3 states with the v3 validator and remove only stale preview state during setup. Do not reset scoring/ranking to v2 defaults.
4. Retain every v2 validator/function's schema-2 semantics. Add guards to v2 full-state/config/start writers rejecting a stored schema3 event with `UPDATE_REQUIRED`; also reject a schema2 candidate targeting schema3. Prevent schema3→schema2 via direct/protocol-2 writes in `guard_event_protocol_write`, in addition to the existing protocol downgrade guard. V3 writers similarly reject existing schema2 IDs; creating a copy requires a new ID.
5. Existing shared signup metadata/entry/label/open/cancel/delete RPCs may operate on schema3 only where they preserve rules/results and use version-aware validation. They are not a way to alter scoring. Public entrant commands retain their current API and authentication model. Event deletion/tombstones remain version-safe.
6. All regular-score/final validation runs on the server. No trusting computed totals/ranks, client winner IDs, a client-supplied eligibility boolean or a matching fingerprint alone without validating its components.

Maximum data remains 16 courts, up to 64 rotating players/32 fixed teams, up to 64 fixture rounds and up to three traditional rows per match. A final adds at most one four-player fixture. Validate these limits before expensive iteration. No extra jobs, external providers or secrets are introduced.

### 5.3 Owner RPC/client contracts

Create **new** `src/lib/americanoV3.ts`; reuse the existing sealed request-envelope implementation by extending its operation whitelist/types. Keep the same owner/event scoping; do not resend v3 requests through v2 save after an error.

New RPC signatures use the same parameter types/names as their v2 counterparts, with `_v3` names and v3 state/config:

| New RPC | Request payload (in addition to authenticated owner) | Behaviour |
| --- | --- | --- |
| `organizer_save_event_v3` | `p_event_id uuid`, `p_base_event_revision bigint`, `p_request_id uuid`, `p_state jsonb` | New unpublished event at base 0 or CAS save of exact schema3. No published setup→live bypass; validate lifecycle/freeze, drafts/confirmed scores and any final change. |
| `organizer_save_americano_config_v3` | `p_event_id uuid`, `p_base_event_revision bigint`, nullable `p_signup_event_id uuid`, `p_base_capacity_revision bigint`, `p_base_roster_revision bigint`, `p_request_id uuid`, `p_courts jsonb`, `p_format_config jsonb` | Setup only; authoritative signup linkage including null checks; config/capacity/projection update atomically; invalidate preview. |
| `organizer_start_americano_v3` | Same event/signup/revision/request fields, `p_start_state jsonb` | Exact canonical roster/config/courts/schedule checks; close registration, lock roster and commit start atomically. |

Numeric revisions are passed as validated decimal strings in JS wrappers, never converted through unsafe JS Number. When no signup is linked, send `p_signup_event_id:null` and both signup revision parameters as `'0'`, matching the existing wrappers; when linked, send its exact ID and actual revision tokens. Preserve the existing server checks when a caller claims no signup but one exists.

Return the existing protocol-2 owner envelope:

```text
applied/replayed: { status, requestId, committedEventRevision, snapshot }
conflict: { status:'conflict', requestId,
            code:EVENT_REVISION_CONFLICT|SIGNUP_REVISION_CONFLICT|ROSTER_REVISION_CONFLICT,
            snapshot }
rejected: { status:'rejected', requestId, code, message, field? }
```

Snapshot event remains `{id,protocolVersion:2,revision,updatedAt,state}`; parser dispatches schema 2/3. Reuse signup snapshot shape. Do not change the meaning of existing applied/replayed receipts. Include operation/version in request hashing; a reused UUID with a different operation/payload rejects through the existing mismatch mechanism. Under a valid matching replay, return its receipt/current authorized snapshot as the v2 implementation does, even if the first response was lost.

Add stable errors: `UPDATE_REQUIRED`, `INVALID_MATCH_RULE`, `INVALID_STANDINGS_RULE`, `INVALID_SCORE`, `INVALID_TIE_POLICY`, `FINAL_NOT_ELIGIBLE`, `INVALID_FINAL_PARTNERS`, `INVALID_FINAL_RESULT`, `FINAL_STALE`, `RULES_LOCKED`. Reuse existing request/revision/owner/capacity/frozen-schedule errors where equivalent. Field examples: `formatConfig.scoring.rule.gamesToWin`, `formatConfig.scoring.standings.pointsPerGameWon`, `rounds[0].matches[0].result.sets[0].gamesA`, `championshipFinal.supportPlayerIds`. Map SQL checks into these codes; do not expose raw PostgreSQL messages.

For final mutations: if an existing final is unchanged, a normal regular-result correction may leave it stale for review. If a final is inserted/modified, validate against the current candidate state's completed included results. If stale, only removing it by explicit Reset is allowed; changing just the basis hash to “repair” it is forbidden. New prepared final must have a fresh ID when replacing/removing a previous one. A valid current outcome may be corrected under CAS. Normal lifecycle edits cannot reopen a completed event or change a frozen schedule.

### 5.4 Public rules summary

Extend `get_public_signup_v3` with an optional allowlisted `event.competitionRules` object for source schema3 only:

```text
{ rulesVersion:3, pairingMode, scoring, ranking }
```

Use the frozen typed configuration subset above, not raw event state, not a free-form HTML description and not duplicate stored signup configuration. Existing schema1/2 responses may omit it. Existing public register/join APIs remain unchanged. Update `PublicSignup` types in `src/lib/signups.ts`, owner decoder in `src/lib/americanoV2.ts` and `PublicSignupScreen.tsx`. Render through one shared rules-label helper also used by setup/display/share. Handle absence safely; do not infer new rules from event title.

### 5.5 Local persistence, imports and old clients

- Keep the established event catalog as the source of local event bodies; extend exact schema validation and metadata dispatch. Do not store score variants in a parallel roster or scoreboard cache.
- Current reader must process catalog/cloud records individually: an unsupported future schema is retained unchanged, shown as requiring an update, excluded from writable actions, and must not prevent supported records loading/syncing. Never catch parse failure and convert to an empty/new legacy event. Add a read-only unsupported-record summary shape to the catalog layer, not to `VersionedEventState`.
- Cloud sync must branch schema3 to the v3 save endpoint; all protocol2 dirty/deletion markers retain base revisions. A stale acknowledgement may not replace newer unsent score edits. Preserve per-event queued writes and deletion barriers.
- Template schema3 uses **new key** `koc-americano-v3-templates-v1`, because an old client's save to `koc-templates-v1` filters unknown template versions and could erase them. Modern list merges the keys; save/delete target the owning key. Names are deduplicated within their versioned store only; show a legacy/new-format subtitle when names collide. Do not rewrite the old template array as a side effect of a v3 save.
- Export wrapper version3 is required for event schema3; exact wrapper/schema pairing. Existing wrapper1/2 unchanged. Import v3 gives a new event ID/revision0, unlinks signup/contact registration references as v2 does, and preserves match/entrant/court identity relationships within the imported standalone event. It may retain results/final; final basis excludes event ID/revision/link fields and must remain valid. Reject invalid/mismatched formats, not downgrade them.
- Fresh copies and templates start in setup, unpublished, with no rounds/preview/final, fresh event/entrant/player/court IDs and copied rules. Templates may include roster only through existing explicit include behaviour; they never include signup linkage/private contacts. A copy of a v2 template stays v2; no automatic “upgrade” path is part of this change.
- Older unpatched clients cannot operate schema3. Server guards prevent destructive reinterpretation, but old catalog/cloud code can still display unsupported-version/sync errors. **Do not promise transparent operation of old native builds.** Before live enablement, release compatible readers or explicitly hold new-format rollout until the supported iPad/native client can read them. Roll back to a schema3-capable compatibility build with creation disabled, not the baseline build.

## 6. Failure and edge scenarios

| Scenario / invariant | Prevention and required evidence |
| --- | --- |
| Duplicate Confirm/End/final request; lost response (INV-004/006) | Same sealed request replays, no second result, extra round, bonus or final. DB receipt/retry test, including altered payload same UUID rejection. |
| Two organisers change score vs rules/final (INV-005/006) | Exact event revision. Loser keeps draft and receives conflict snapshot; no automatic merge. Separate-connection DB tests. |
| Signup competes with Start (INV-002/006) | Existing event-first locking and exact event/roster/capacity revisions. Either entry is included before valid start or signup rejects after closure; never enters a frozen fixture silently. |
| Stale config preview response (INV-005) | Config/fingerprint request token guards application; old worker result ignored. Start rejects mismatched rules/acknowledgement. |
| Malformed/forged direct RPC (INV-003/006) | Server validates schema, rule, score endpoint, fixture side identities, owner and final basis. No client-only formula/field validation. |
| Drawn final set, extra set or 10–8 match TB (INV-003) | Reject nonterminal draws and extra sets; accept legal match TB with zero games; conformance vectors in TS/SQL. |
| A point/game edit after confirmed final (INV-007) | Basis changes; regular standings recompute; old final displayed stale and ignored. Rename-only does not invalidate. |
| Three or more leaders or no rounds (INV-007) | Explicit shared/no-results UI; final cannot be crafted through API. No arbitrary top-two selection. |
| Same helper twice/finalist chosen as helper (INV-007) | Client and server reject; fixed final cannot substitute team membership. |
| Max field/custom64/large score values (INV-003) | Bounds checked before generation; safe-integer totals/bigint SQL; worker watchdog; no infinite loop on win-by-two tails. |
| Offline/no DB support yet (INV-006/008) | New local drafts can be tested/exported; unavailable RPC surfaces “Server update required”, retains draft, never falls back to v2 writes. Published start requires server authority. |
| Account switch with pending v3 save (INV-006) | Owner/event-scoped request replay; old owner's envelope remains untouched but is not sent. |
| Older app/stale whole-state write (INV-001) | Exact schema guard prevents changing v3 to v2; runtime parser refuses unknown; release gating/compatibility rollback as section 5.5. |
| Reset/copy/import (INV-001/002) | New event identities, no signup linkage; copied setup contains no final; imported played event's structural references and final basis validate. |
| Timer reaches zero during set/TB (INV-004) | Advisory only; points, confirmation and lifecycle identical before/after expiry. |

No new timezone interpretation is introduced. Existing published start/end/timezone logic remains authoritative; this feature adds only durations and scoring rules, not timestamp conversion.

## 7. Executable implementation tasks

Commands below run from the repository root recorded in section 1. New tests/scripts are prerequisites, not claimed existing evidence. A task is not done merely because TypeScript compiles.

### T-001 — Pin compatibility and scoring examples

- **Trace/dependencies:** AC-001/003/004/015; INV-001/003/008; D-001/003. None.
- **Targets:** existing `src/tests/americanoV2{Runtime,Schedule,Standings,Display,Setup,Client,PublicSignup,Rehearsal,ReleaseSafety}.test.*`, `tournamentV1Scoring.test.ts`, `eventSchema.test.ts`, `exportImport.test.ts`; **new** `src/tests/fixtures/americano-v3/scoring-vectors.json` and `docs/americano-v3-validation.md`.
- **Work:** record baseline revision/status; preserve dirty user files. Add data-only fixtures covering every worked example, preset and invalid case from this plan. Include 0, null, wrong-total rally, decimal, negative, nonfinite test inputs (nonfinite in TS-only vectors), max/max+1, standard 6–4/7–5/7–6, short 4–2/5–3/5–4, TB 7–5/8–6 vs invalid 7–6/9–5, straight-set clinch, split-set match decider and illegal third ordinary set when match TB selected. Include no-match/no-completed-round ties and 3-way ties.
- **Verify:** `npx vitest run americanoV2 tournamentV1Scoring eventSchema exportImport`; record real outcomes and distinguish pre-existing failures. Do not snapshot only internally computed values as expected results: use section 4 arithmetic.
- **Done:** baseline evidence and executable vectors exist without application behaviour change.
- **Recovery:** data/test/docs-only task; do not update old expectations to conceal regressions.

### T-002 — Add v3 types, validators and scoring adapter

- **Trace/dependencies:** AC-002/003/004/012; INV-001/003; D-001–005. Depends T-001.
- **Targets:** **new** `src/logic/eventVersions.ts`, `src/logic/americanoV3/types.ts`, `scoring.ts`; existing `src/logic/americanoV2/types.ts`, `src/utils/eventSchema.ts`, shared Tournament scoring module as read/reuse boundary; **new** `src/tests/americanoV3Scoring.test.ts`, `americanoV3Schema.test.ts`.
- **Work:** implement sections 4.1–4.4 schemas, exact enums/defaults/presets, adapter and strict parser. Reject contradictory preset labels, impossible endpoints, both scalar/sets forms and extra confirmation fields. Add exact v3 type guard/union without widening v2 guard. Export pure match summary/award functions; derived values are not accepted as authority in JSON.
- **Verify:** `npx vitest run americanoV3Scoring americanoV3Schema tournamentV1Scoring eventSchema`; vectors yield the stated totals, rotating/fixed credits and no extra games for match TB. `npm run typecheck` once union consumers have explicit unsupported/new dispatch during development.
- **Done:** scoring/parser pass tests; v1/v2 fixtures unchanged. All public helper return units are explicit.
- **Recovery:** feature not created yet; do not alter existing Tournament preset behaviour to accommodate a new test.

### T-003 — Reuse fixture generation and add v3 lifecycle

- **Trace/dependencies:** AC-003/009/010; INV-004/005; D-003/009. Depends T-002.
- **Targets:** existing v2 schedule/client/worker/validation/runtime; **new** `scheduleCore.ts` under v2; **new** v3 `schedule.ts`, `scheduleClient.ts`, `schedule.worker.ts`, `runtime.ts`; **new** `src/tests/americanoV3Schedule.test.ts`, `americanoV3Runtime.test.ts`.
- **Work:** extract only scoring-independent assignment construction. Keep v2 hash/metrics/fixtures stable; create v3 fingerprint exactly as section 5.1. Implement config/update/preview/start/score confirmation/end/next/early finish/correction using v3 results. Preserve roster and advisory-clock helpers. Pairing-mode publication/empty-roster restrictions stay. Distinguish editing a current draft from atomically correcting a past complete result.
- **Verify:** `npx vitest run americanoV2Schedule americanoV2Runtime americanoV3Schedule americanoV3Runtime`; same seed+roster produces same side/court assignments for rally and traditional v3; changing scoring changes hash/ack, not fixture algorithm; frozen edits reject; zero timer does nothing; unfinished round excluded; late preview discarded; custom64/max-field watchdog checks.
- **Done:** lifecycle tests work for all scoring families and both pairing modes without invoking v2 score reducers.
- **Recovery:** restore behaviour of extracted v2 wrapper if baseline outputs diverge; do not recertify fixture tables as a shortcut.

### T-004 — Rankings and championship reducer

- **Trace/dependencies:** AC-004–008/010; INV-002/003/007; D-005–008. Depends T-003.
- **Targets:** **new** v3 `standings.ts`, `championship.ts`; existing v2 standings label helpers (shared readonly shape only); **new** `src/tests/americanoV3Standings.test.ts`, `americanoV3Championship.test.ts`.
- **Work:** groupwise tie algorithm, raw totals and rank explanations; final eligibility/basis hash, prepare/confirm/correct/reset and stale detection. Final ranks overlay regular ranks without score/WDL edits. Persist one final only, honour reset confirmation in later UI. Derive final state from current data, not stored status flags.
- **Verify:** `npx vitest run americanoV2Standings americanoV3Standings americanoV3Championship`; 2-/3-/4-way ties, missing/direct repeated H2H, rotating H2H rejection, H2H-then-difference, difference redundancy, zero rounds, early finish, all three final choices, illegal partners/endpoints, reload, rename vs score correction, points unchanged by final, new leader after correction.
- **Done:** deterministic rank arrays and final provenance tests pass, no arbitrary comparator tie-break.
- **Recovery:** no manual rank override fallback; keep unresolved ties shared with the specified reason.

### T-005 — Database schema and score/final authority

- **Trace/dependencies:** AC-003–011/015; INV-001–007; D-001/003/010. Depends T-004 (contracts fixed); may run independently of later UI after this.
- **Targets:** **new** migration `20260926090000_americano_v3_scoring.sql`; existing migration functions listed in section 5 as definition references, not edited historical SQL; **new** `tests/db/americano-v3/scoring.sql`, `schema.sql`; extend existing `tests/db/americano-v2/run.mjs` to run v3 contracts after base fixtures without relaxing its safety gates.
- **Work:** additive CHECK/guards, internal config/state/score/fingerprint/standings/final validators. Match TypeScript vectors, include lifecycle/frozen checks. Validate large numbers without cast overflow. Permit stale unchanged final on regular correction but not forged/new stale final. Test nonowner/internal function grants. Do not expose private helper functions through public grants.
- **Verify:** on fresh disposable loopback `koc_americano_test_*` only, `npm run test:db:americano -- --americano-only`; harness must execute old and new contracts. Seed schema1/2 events before new migrations, prove stored JSON/revisions unchanged afterward. Cross-language score/final/hash vector checks required.
- **Done:** old/new constraint, permission, unit, terminal-score and final-authority tests pass with no real Supabase mutation.
- **Recovery:** migration transaction aborts on validation/lock failure. Stop affected DB task if the isolated test target cannot be established; continue non-DB tasks, never substitute production.

### T-006 — Version-aware RPC workflows and client sync

- **Trace/dependencies:** AC-009/011/012/013/015; INV-001/002/005/006/008; D-010. Depends T-005.
- **Targets:** **new** `20260926091000_americano_v3_workflows.sql`, `src/lib/americanoV3.ts`; existing `src/lib/americanoV2.ts`, `src/lib/signups.ts`, `src/store/cloudSync.ts`; **new** `src/tests/americanoV3Client.test.ts`, `tests/db/americano-v3/workflows.sql`, `concurrency.mjs`; existing cloud tests and DB runner.
- **Work:** new owner save/config/start RPCs and exact envelopes; shared signup projection/snapshot dispatch; safe public competitionRules. Extend sealed envelopes/decoding for schema3, preserve all canonical roster, close/start and tombstone protections. Add downgrade guards to v2 writers. Replays/conflicts/unavailable-RPC errors follow section 5.3. Existing shared deletion and entry paths remain valid without interpreting scoring.
- **Verify:** `npx vitest run americanoV3Client americanoV2Client cloudSync publicSignupCompatibility`; isolated `npm run test:db:americano -- --americano-only` with separate connections for two saves, config/start, public last-slot, signup/start, score/final conflict; lost-response retry; mismatched UUID; cross-owner; old v2 overwrite v3; v3 overwrite v2; tombstone/no resurrection; event linkage null bypass attempt.
- **Done:** client/server contracts and races pass; no v3 write can fall through to legacy direct upsert or v2 RPC.
- **Recovery:** preserve queued drafts on any transport/validation error; do not retry with a fresh request ID/new revision automatically. SQL rollout not performed here.

### T-007 — Catalog, import/export, templates and creation dispatch

- **Trace/dependencies:** AC-001/012; INV-001/006/008; D-001/002/010. Depends T-003, T-006.
- **Targets:** existing `src/store/{eventStore,eventCatalog,eventRepository,templates}.ts`, `src/utils/{eventSchema,exportImport}.ts`, `src/config/features.ts`, route dispatch files; **new** `src/tests/americanoV3Persistence.test.ts`; existing catalog/template/import/feature tests.
- **Work:** exact schema dispatch and current-version reader support regardless flag; process unknown records individually without overwrite; export/import3; new template key with merged listing; fresh copy resets final/results/links; protect owner-scoped pending data. Add `ENABLE_AMERICANO_V3` from `VITE_ENABLE_AMERICANO_V3 === 'true'` AND existing Americano creation availability. Default false everywhere. When false new creation remains existing v2; when true new Americano creation uses v3, with no existing-event upgrade. Native creation gate remains unchanged.
- **Verify:** `npx vitest run americanoV3Persistence eventCatalog eventStoreCatalog eventSchema exportImport templates features cloudSync`; mix v1/v2/v3 and unknown future schema, offline reload, cross-tab, account switch, v3 template then simulated old-key save, import with valid/stale final, unsupported version, delete barrier. Test flag off can open/complete v3 but cannot create it.
- **Done:** normal catalog works for supported events, unsupported rows are retained/read-only, v3 copy has fresh identities/no final, no old-template loss.
- **Recovery:** do not clear localStorage/IndexedDB to make hydration pass. Unknown and failed imports remain recoverable as raw data; malformed untrusted input never enters playable state.

### T-008 — Setup and public rules UI

- **Trace/dependencies:** AC-002/009/013/014; INV-003/005/008; D-002/004–009. Depends T-004, T-006, T-007.
- **Targets:** **new** `src/components/americano/AmericanoSetupV3.tsx`, `AmericanoRulesSummary.tsx`, `src/logic/americanoV3/labels.ts`; existing setup route, public signup, help/share and scoped CSS; **new** `src/tests/americanoV3Setup.test.tsx`, `americanoV3PublicSignup.test.tsx`.
- **Work:** all preset/custom/awards/tie fields with summaries, locked-rule display and field errors; hide H2H rotating; championship limitation/help; schedule/pace remain familiar. Shared labels in public read-only summary and roster share. Clear only incompatible unsaved form branches when switching family, using new family's documented defaults; show pending saved/unsaved state. Existing published update/config flow remains atomic.
- **Verify:** `npx vitest run americanoV3Setup americanoV3PublicSignup americanoV2Setup americanoV2PublicSignup publicSignupScreen`; every preset/custom bounds, null TB pair, invalid award, rotating H2H forged config, post-start locks, public summary updates and no contact leakage, loss/retry/focus handling.
- **Done:** organiser can configure and publish/preview v3 correctly in both modes without DB terminology or duplicate signup/roster controls.
- **Recovery:** no changing a running event to a new format just to demonstrate UI; use fresh synthetic events.

### T-009 — Live results, standings, history and final UI

- **Trace/dependencies:** AC-003–008/010/014; INV-002–005/007; D-004–009. Depends T-004, T-007, T-008.
- **Targets:** **new** `src/components/americano/AmericanoDisplayV3.tsx`, `AmericanoLeaderboardV3.tsx`, `AmericanoResultEditorV3.tsx`, `AmericanoChampionshipFinal.tsx`; existing display/leaderboard route dispatch and scoped CSS; **new** `src/tests/americanoV3Display.test.tsx`, `americanoV3FinalUI.test.tsx`.
- **Work:** independent games/set score editor, clear-later-set confirmation, accessible +/- and direct entry, draft/confirmed states, complete-match checks, history correction and unit-labelled rankings. Championship panel/partner selection/outcome/reset/stale states follow section 4.6; spectator mode only displays. Separate final from round count and pace timer. Preserve fixed-pair names and individual identities in history/standings.
- **Verify:** `npx vitest run americanoV3Display americanoV3FinalUI americanoV2Display`; enter 5–3 and all set/TB examples; cancel vs save; edit earlier set invalidates later rows; confirm vs End; pending/error/conflict; first-place ties2/3; helper selection; reset confirmation; historical correction invalidates final; spectator controls absent; timer expiry unchanged.
- **Done:** complete events are playable from setup through ordinary/final standings with no manual JSON/backend intervention.
- **Recovery:** never hide a blocked action without explanation; do not add a generic “force winner” escape hatch.

### T-010 — Local integrated rehearsals and handoff evidence

- **Trace/dependencies:** AC-001–015; all invariants/decisions. Depends T-005–009.
- **Targets:** **new** `src/tests/americanoV3Rehearsal.test.ts`, `docs/americano-v3-validation.md`; existing test/build scripts and guarded DB runner. No release configuration change that enables production creation.
- **Work:** automate fixtures in section 7.1; test responsive browser UI in both themes; record exact revision/commands/screenshots/outcomes. Verify compatibility rollback build can read v3 with creation off. Document physical-device tests separately from viewport emulation. Review diff for accidental KoC/Tournament changes and unrelated dirty files.
- **Verify:** `npx vitest run americanoV3`; `npm test`; `npm run typecheck`; `npm run build`; `npm run test:db:americano -- --americano-only`. Use isolated test database prerequisites below. Check a build with flag false and an explicitly local flag-true dev server; avoid writing production environment variables. Test DB both from empty baseline and populated schema2 upgrade.
- **Done:** acceptance matrix has actual evidence per criterion, remaining physical-device/release gates explicit; local preview link and two synthetic events supplied to user. A test failure is not converted to a pass by weakening legacy requirements.
- **Recovery:** maintain flag off; fix failed affected checks locally. No remote migration, push, deployment, screenshots upload or App Store submission is part of task completion.

### 7.1 Required rehearsal fixtures and expected observations

1. **Rotating rally:** 8 named players/2 courts/full7 rounds/24 points; draws and unequal results, finish normally, same per-player totals as v2. Optional two-leader golden final with explicit non-finalist partners; no helper points.
2. **Fixed games:** 4 named pairs/2 courts/full3 rounds/first-to5, two points/game and three match bonus. Include 5–3 =>13/6, perform a history correction, verify H2H/difference and freeze checks.
3. **Rotating sets:** 8 players/2 courts/custom2 (acknowledge unequal appearances if generator requires); one standard set, games awarded to each member. Include 7–6/TB8–6; games7/6 only. End the clock at zero mid-set and observe no automatic completion.
4. **Fixed best-of-three:** 4 teams/2 courts; use 6–4,4–6,[10–8]. Verify games10–10, sets2–1, optional win bonus. Reload before/after confirmation; reject entering the deciding TB as a normal 10-game set.
5. **Ties:** synthetic two-team top tie resolved by each of shared/difference/H2H/final; three-way cycle remains shared under H2H-only; head-to-head-then-difference can split group by difference but never arbitrarily selects a finalist. Equal 24-point totals with equal appearances illustrate difference redundancy.
6. **Final correction:** complete a valid final, rename a player (final stays current), correct one ordinary result (final stale even if totals happen to keep same leaders), reset, reprepare if still eligible. New leader/no tie removes eligibility; no residual champion badge.
7. **Boundary field:** 64 rotating players/16 courts/custom64 and 32 fixed teams/16 courts, long names, both themes; generation watchdog, exact numeric totals, responsive navigation, no unbounded score row layout.
8. **Signup integration:** schema3 individual and fixed published to disposable local backend only; overflow remains waiting; organiser editing config before start preserves entrant IDs/order; race signup/start, confirm canonical result/reload. No contact in public summary/roster share.

Use browser checks at 390×844, 768×1024, 1024×768 and 1920×1080. Check keyboard and touch-sized controls, long first/team names, set/TB labels, opened editor, final modal, no horizontal overflow and no clipped timer. Physical iPad landscape/AirPlay/TV is a separate release check; emulator screenshots do not prove it.

### 7.2 Acceptance-to-verification matrix

| AC | Tasks | Required evidence |
| --- | --- | --- |
| 001 | T-001/002/007/010 | Legacy fixtures unchanged; flag on/off/read tests; compatibility build rehearsal. |
| 002 | T-002/008/010 | All presets/custom validity/default/reload/field-focus cases in setup/schema tests. |
| 003 | T-001/002/003/005/009 | Score conformance vectors TS+SQL, nullable draft tests, UI confirm rejection/acceptance. |
| 004 | T-002/004/005/010 | Worked arithmetic, fixed/rotating credit, decider zero-game tests. |
| 005 | T-004/005/008/010 | Deterministic group ranking, H2H applicability, multiway/shared and redundancy fixtures. |
| 006 | T-004/005/009/010 | Zero/one/two/three-leader and helper validity, UI/API eligibility tests. |
| 007 | T-004/005/006/009/010 | All final outcomes, replay, reload, history and totals-invariant tests. |
| 008 | T-004/005/009/010 | Correct/rename/reset/stale basis tests plus end-to-end correction. |
| 009 | T-003/005/006/008/010 | Frozen edits, rule/fingerprint invalidation, stale preview/start rejection. |
| 010 | T-003/004/009/010 | Confirm/end separation, early exclusion, zero timer invariant. |
| 011 | T-005/006/010 | Isolated DB permissions, replay/CAS, signup/start/last-slot and tombstone race evidence. |
| 012 | T-002/006/007/010 | Versioned catalog/template/import/export, queued/offline and account-switch tests. |
| 013 | T-006/008/010 | Derived public rules, update/reload and privacy tests. |
| 014 | T-008/009/010 | Both-theme responsive/keyboard/browser screenshots; physical-device gate reported separately. |
| 015 | T-001/005/006/010 | Baseline vs final commands, TS/SQL vector match, full build/regression, migration rehearsal. |

## 8. Migration, release and recovery sequence

Implementation is local by default. No real event signup data, Supabase project or App Store build is an acceptable fixture. Database runner requires an explicit `KOC_TEST_DATABASE_URL` using loopback and database name prefix `koc_americano_test_`; optional `KOC_TEST_PSQL_PATH` points to an installed test psql binary. Never print credentials. No production URL fallback is allowed. Reuse the runner's existing bootstrap and receipt/race setup, extending it for v3. An isolated DB not being available blocks DB verification, not authorizes substituting a live database.

Future release steps, **only after separate approval**:

1. Finish T-010 and preserve a known-good, schema3-readable compatibility build with creation off. Record build commit and available rollback artifact. Export/backup existing data under the project's normal operator procedure; do not assume an export includes private signup data.
2. Apply the two additive migrations to an isolated staging target first, then the authorized production target. Verify CHECK/grants/functions and old-event canary reads; no writes to a real ongoing event. Use short lock timeout and maintenance window if needed. No backfill jobs or per-event conversion.
3. Deploy compatible web readers with `VITE_ENABLE_AMERICANO_V3=false`. Keep currently supported v2 creation, signup and event running. Verify supported native/iPad clients can read schema3 before enabling it for users sharing events across platforms; native creation availability remains a separate decision.
4. In an authorized synthetic account/event, verify new save/config/start/public-signup/score/final paths on the deployed backend and discard only explicitly identified synthetic data through normal deletion. Keep contacts synthetic.
5. Enable new creation only after all client/DB/device gates pass. Monitor stable error code counts, conflicts, request replay, rejected stale-finals and unsupported-client events. Log event/request identifiers and code/version only, not player/contact details or whole payloads. Expected conflicts are not “fixable” by weakening CAS.
6. Native/App Store release remains separate: compatible reader binaries, screenshots/metadata/submission are not implied by this web feature.

Rollback: first turn off new creation. Continue to read/edit existing v3 competitions in a schema3-capable build. Leave additive database validators/RPCs/check allowance installed while any v3 record or pending request exists. Do not downgrade JSON, drop v3 support, wipe local storage or rerun earlier migrations. A corrected compatibility build is safer than rolling back below the reader floor. Failed migration before commit is transactionally rolled back; after v3 writes exist, recovery is forward fixes and targeted restore from verified backup, not a fictitious lossless down-migration.

## 9. Risks, freedoms and executor boundary

- Games-won totals deliberately reward longer matches; a losing pair can earn more games points than a winning pair. Explain it and offer the configured bonus; do not silently switch to match-win tables.
- Two-player rotating finals require available helpers; inability to find helpers leaves an honest pending decision, not an automatic champion. Multiway first-place finals are explicitly deferred.
- Shared Tournament scoring code is a useful dependency but a regression risk. Reuse it without changing its semantics; TS/SQL conformance and existing scoring tests are mandatory.
- SQL validation duplicates some portable score semantics because current authoritative writes are PostgreSQL RPCs. Contract vectors are mandatory to keep them aligned; moving all authority to a new Edge service is outside this plan.
- Existing unpatched clients do not understand new schemas. Release-reader compatibility is a real gate, especially for the iPad/TV workflow; server write protection alone is not a complete user-experience fix.
- No unresolved product or architecture decision blocks local implementation. Test infrastructure and physical-device availability are execution/release prerequisites, not permission to skip their evidence.

Implementation freedoms: private helper names, colocated component extraction and test-fixture organization may vary if public contracts, accepted behaviours, exact score/tie semantics and version boundaries stay intact. Reuse a present shared component instead of duplicating markup where that does not widen scope. Do not change the chosen two-finalist limitation, standings formula, rule bounds, migration policy or deployment scope without reporting the deviation first.

**Executor instruction:** Read this entire plan and applicable repository instructions. Verify the baseline and preserve unrelated work. Implement T-001 through T-010 in dependency order, validating against every row of the acceptance matrix. Use only local/synthetic test data until a separate release is authorized. Pause only affected work before a material deviation; do not silently redesign scoring, ties or compatibility. The authoritative plan is `docs/americano-v3-formats-implementation-handoff.md` in the repository identified in section 1.
