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
