-- Reusable organiser-owned presets for recurring sign-up pages.

create table if not exists public.signup_templates (
  id uuid primary key default gen_random_uuid(),
  owner_user_id uuid not null references auth.users(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 80),
  title text not null default '' check (char_length(title) <= 120),
  venue text not null default '' check (char_length(venue) <= 160),
  capacity_teams integer not null default 16 check (capacity_teams between 1 and 128),
  details text not null default '' check (char_length(details) <= 3000),
  prizes text not null default '' check (char_length(prizes) <= 2000),
  starts_weekday smallint check (starts_weekday between 0 and 6),
  starts_time time,
  duration_minutes integer check (duration_minutes between 1 and 2880),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (owner_user_id, name)
);

alter table public.signup_templates enable row level security;

drop policy if exists "signup_templates_owner_select" on public.signup_templates;
create policy "signup_templates_owner_select"
  on public.signup_templates for select
  using (auth.uid() = owner_user_id);

drop policy if exists "signup_templates_owner_insert" on public.signup_templates;
create policy "signup_templates_owner_insert"
  on public.signup_templates for insert
  with check (auth.uid() = owner_user_id);

drop policy if exists "signup_templates_owner_update" on public.signup_templates;
create policy "signup_templates_owner_update"
  on public.signup_templates for update
  using (auth.uid() = owner_user_id)
  with check (auth.uid() = owner_user_id);

drop policy if exists "signup_templates_owner_delete" on public.signup_templates;
create policy "signup_templates_owner_delete"
  on public.signup_templates for delete
  using (auth.uid() = owner_user_id);

revoke all on table public.signup_templates from anon;
grant select, insert, update, delete on table public.signup_templates to authenticated;
