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

Public sign-up tables and friendly links are not coupled to event tombstones.
