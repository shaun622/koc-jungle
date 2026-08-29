-- Stage 2.4 — cloud sync schema for King of the Court.
--
-- `events` stores one full EventState JSON document per tournament. Deleted
-- event UUIDs remain as state-less tombstones so an offline client cannot
-- recreate them; `event_tombstones` is the owner-readable sync ledger.
--
-- Run this in the Supabase SQL editor once after creating a fresh
-- project (or via the Supabase CLI: `supabase db push`).

create table if not exists public.events (
  id uuid primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  state jsonb,
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  constraint events_state_matches_deletion_check check (
    (deleted_at is null and state is not null)
    or (deleted_at is not null and state is null)
  )
);

create index if not exists events_user_idx on public.events (user_id);
create index if not exists events_updated_idx on public.events (user_id, updated_at desc);
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

-- Row Level Security: every user only sees / writes their own events.
alter table public.events enable row level security;
alter table public.event_tombstones enable row level security;

-- Realtime DELETE payloads need the former user_id as well as the primary
-- key so the per-user subscription filter can deliver cancellations.
alter table public.events replica identity full;
alter table public.event_tombstones replica identity full;

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

drop policy if exists "events_delete_own" on public.events;
revoke delete on table public.events from public, anon, authenticated;

drop policy if exists "event_tombstones_select_own" on public.event_tombstones;
create policy "event_tombstones_select_own"
  on public.event_tombstones for select
  using (auth.uid() = user_id);

revoke all on table public.event_tombstones from public, anon, authenticated;
grant select on table public.event_tombstones to authenticated;

-- Enable Postgres CDC (Realtime) on the events table. The Supabase
-- dashboard equivalent: Database → Replication → events → ON.
alter publication supabase_realtime add table public.events;

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

-- Exact-event deletion. The caller identity is always derived from auth.uid(),
-- and the retained state-less row makes deletion durable against stale upserts.
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

  select event.deleted_at into existing_deleted_at
  from public.events event
  where event.id = p_event_id
    and event.user_id = caller_id
  for update;

  if not found then
    raise exception 'This event could not be found or you do not own it.';
  end if;

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

-- Account deletion (App Store Guideline 5.1.1(v)).
--
-- The anon key runs as the `authenticated` role, which cannot touch the
-- protected `auth` schema, so a user can't delete their own auth.users
-- record directly. This SECURITY DEFINER function runs as its owner and
-- re-derives the caller from auth.uid() (never a client-supplied id, so
-- one user can't delete another). It removes the user's events and then
-- their auth record. The events row is also ON DELETE CASCADE, so the
-- explicit delete is belt-and-suspenders.
create or replace function public.delete_account()
returns void
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  uid uuid := auth.uid();
begin
  if uid is null then
    raise exception 'Not authenticated';
  end if;
  delete from public.events where user_id = uid;
  delete from auth.users where id = uid;
end;
$$;

-- Only signed-in users may call it; never anon or public.
revoke all on function public.delete_account() from public, anon;
grant execute on function public.delete_account() to authenticated;
