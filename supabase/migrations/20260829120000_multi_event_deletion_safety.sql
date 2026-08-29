-- Multi-event deletion safety.
--
-- A deleted event keeps a state-less row in public.events. Keeping the UUID
-- occupied is deliberate: an older/offline client that still has the full
-- EventState cannot recreate it with INSERT .. ON CONFLICT. Normal RLS hides
-- these rows, while event_tombstones is the small owner-readable deletion
-- ledger consumed by multi-event sync.

alter table public.events
  add column if not exists deleted_at timestamptz;

alter table public.events
  alter column state drop not null;

alter table public.events
  drop constraint if exists events_state_matches_deletion_check;

alter table public.events
  add constraint events_state_matches_deletion_check
  check (
    (deleted_at is null and state is not null)
    or (deleted_at is not null and state is null)
  ) not valid;

alter table public.events
  validate constraint events_state_matches_deletion_check;

create index if not exists events_active_user_updated_idx
  on public.events (user_id, updated_at desc)
  where deleted_at is null;

create table if not exists public.event_tombstones (
  user_id uuid not null references auth.users(id) on delete cascade,
  event_id uuid not null,
  deleted_at timestamptz not null default now(),
  primary key (user_id, event_id)
);

create index if not exists event_tombstones_user_deleted_idx
  on public.event_tombstones (user_id, deleted_at desc);

-- Idempotent repair for a database restored from the final schema or from a
-- partial backup where state-less event rows already exist.
insert into public.event_tombstones (user_id, event_id, deleted_at)
select user_id, id, deleted_at
from public.events
where deleted_at is not null
on conflict (user_id, event_id) do update
set deleted_at = least(
  public.event_tombstones.deleted_at,
  excluded.deleted_at
);

alter table public.event_tombstones enable row level security;
alter table public.event_tombstones replica identity full;

drop policy if exists "event_tombstones_select_own" on public.event_tombstones;
create policy "event_tombstones_select_own"
  on public.event_tombstones for select
  using (auth.uid() = user_id);

-- Tombstones are written only by delete_event(). Clients may read their own
-- ledger, but cannot forge, move, or remove a deletion marker.
revoke all on table public.event_tombstones from public, anon, authenticated;
grant select on table public.event_tombstones to authenticated;

-- Tombstoned rows must be invisible and immutable to normal authenticated
-- table access. In particular, an old client's upsert finds the retained UUID
-- but cannot pass this UPDATE policy or the state/deleted_at check constraint.
drop policy if exists "events_select_own" on public.events;
create policy "events_select_own"
  on public.events for select
  using (auth.uid() = user_id and deleted_at is null);

drop policy if exists "events_insert_own" on public.events;
create policy "events_insert_own"
  on public.events for insert
  with check (
    auth.uid() = user_id
    and deleted_at is null
    and state is not null
  );

drop policy if exists "events_update_own" on public.events;
create policy "events_update_own"
  on public.events for update
  using (auth.uid() = user_id and deleted_at is null)
  with check (
    auth.uid() = user_id
    and deleted_at is null
    and state is not null
  );

-- No authenticated client may issue either a scoped or account-wide direct
-- DELETE. Account removal still runs as the owner of delete_account(), and an
-- individual event is removed through the exact-id RPC below.
drop policy if exists "events_delete_own" on public.events;
revoke delete on table public.events from public, anon, authenticated;

create or replace function public.delete_event(p_event_id uuid)
returns timestamptz
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  caller_id uuid := auth.uid();
  existing_deleted_at timestamptz;
  deletion_time timestamptz;
begin
  if caller_id is null then
    raise exception 'Not authenticated';
  end if;

  -- Lock exactly the caller-owned event. This serialises deletion with an
  -- in-flight upsert of the same UUID; unrelated events remain independent.
  select event.deleted_at into existing_deleted_at
  from public.events event
  where event.id = p_event_id
    and event.user_id = caller_id
  for update;

  if not found then
    raise exception 'This event could not be found or you do not own it.';
  end if;

  -- Idempotent retries preserve the original deletion timestamp.
  deletion_time := coalesce(existing_deleted_at, clock_timestamp());

  insert into public.event_tombstones (user_id, event_id, deleted_at)
  values (caller_id, p_event_id, deletion_time)
  on conflict (user_id, event_id) do update
  set deleted_at = least(
    public.event_tombstones.deleted_at,
    excluded.deleted_at
  );

  update public.events
  set
    state = null,
    deleted_at = deletion_time,
    updated_at = deletion_time
  where id = p_event_id
    and user_id = caller_id
    and deleted_at is null;

  return deletion_time;
end;
$$;

revoke all on function public.delete_event(uuid) from public, anon;
grant execute on function public.delete_event(uuid) to authenticated;

-- Publish the deletion ledger once. The guarded block keeps this migration
-- safe for a fresh project whose final schema was installed before migrations.
do $$
begin
  if not exists (
    select 1
    from pg_catalog.pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'event_tombstones'
  ) then
    alter publication supabase_realtime add table public.event_tombstones;
  end if;
end;
$$;
