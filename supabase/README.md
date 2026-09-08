# Supabase setup

1. Run `schema.sql` for a new project.
2. Run each file in `migrations/` in filename order.

`20260820000000_public_event_signups.sql` adds the no-account public event
registration page, confirmed list, automatic waiting list and cancellations.

## Multi-event deletion contract

`20260829120000_multi_event_deletion_safety.sql` makes tournament deletion
event-scoped and durable:

- Call `delete_event(p_event_id uuid)` as an authenticated user. The function
  derives the owner from `auth.uid()`, tombstones exactly that event, and
  returns its original `deleted_at` timestamp on idempotent retries.
- Active events remain readable from `events`. Tombstoned event rows retain
  their UUID with `state = null` and are hidden by RLS, so a stale client
  cannot recreate them with an upsert.
- Authenticated sync clients may read only their own
  `event_tombstones(event_id, deleted_at)` rows and subscribe to that table's
  Realtime inserts/updates. They cannot insert, update, or delete tombstones.
- Direct `DELETE` on `events` is revoked. Account deletion is unchanged:
  `delete_account()` runs as its owner, physically removes all event rows, and
  deleting `auth.users` cascades the user's tombstone ledger and sign-up data.

## Launch-safety migration

`20260906100000_launch_signup_safety.sql` supersedes the public sign-up portion
of the deletion contract: deleting an organiser's tournament also cancels its
linked sign-up page. The public URL and registration history remain readable;
new registrations and reopening a cancelled page are rejected. Applying the
migration itself does not cancel events or rewrite their rosters or dates.

The migration adds versioned registration and metadata RPCs, retry protection,
organiser contact/time-zone metadata, and organiser-only promotion notices.
Existing RPCs remain available for compatibility. Apply this migration before
publishing the frontend that calls the new RPCs. Do not roll back by dropping
tables or columns containing registrations or request history.

### Password recovery configuration

The new recovery screen expects a link to `/auth/recovery` with a `token_hash`
query parameter containing the recovery token hash. The direct path is rewritten
to the app's hash route on entry. Configure the hosted authentication recovery
email and allowed redirect URLs to match this contract before enabling the
feature in production; the default email flow has not been verified against it.
Verify an actual recovery email in an isolated test account before release.

### Release verification

- Back up live events and sign-up registrations before applying the migration.
- Compare existing event IDs, URLs, dates, court capacity, confirmed teams,
  waiting lists and solo registrations before and after migration.
- Test registration retries, an overflow pair, partner joining, cancellation,
  promotion notices and organiser-only access in a disposable event.
- Run a practice qualifier and main round, reload/resume it, and check score
  updates on a second device. Do not use a real customer's event for this test.
- Verify recovery email delivery and browser sync against the hosted test
  environment; unit tests and an isolated database cannot establish these.
