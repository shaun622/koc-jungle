-- Stage 2.4 — cloud sync schema for King of the Court.
--
-- One table: `events`, owned by auth.users. The full EventState JSON is
-- stored as JSONB. The app upserts the whole row on every save, and
-- listens on a Realtime channel for changes from the same user_id.
--
-- Run this in the Supabase SQL editor once after creating a fresh
-- project (or via the Supabase CLI: `supabase db push`).

create table if not exists public.events (
  id uuid primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  state jsonb not null,
  updated_at timestamptz not null default now()
);

create index if not exists events_user_idx on public.events (user_id);
create index if not exists events_updated_idx on public.events (user_id, updated_at desc);

-- Row Level Security: every user only sees / writes their own events.
alter table public.events enable row level security;

drop policy if exists "events_select_own" on public.events;
create policy "events_select_own"
  on public.events for select
  using (auth.uid() = user_id);

drop policy if exists "events_insert_own" on public.events;
create policy "events_insert_own"
  on public.events for insert
  with check (auth.uid() = user_id);

drop policy if exists "events_update_own" on public.events;
create policy "events_update_own"
  on public.events for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "events_delete_own" on public.events;
create policy "events_delete_own"
  on public.events for delete
  using (auth.uid() = user_id);

-- Enable Postgres CDC (Realtime) on the events table. The Supabase
-- dashboard equivalent: Database → Replication → events → ON.
alter publication supabase_realtime add table public.events;

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
