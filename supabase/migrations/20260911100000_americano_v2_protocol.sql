-- Americano v2 protocol storage and compatibility guards.
-- Additive only: every existing row remains protocol 1 with revision 0.

create extension if not exists pgcrypto with schema public;

alter table public.events
  add column if not exists protocol_version smallint not null default 1,
  add column if not exists revision bigint not null default 0;

alter table public.events
  drop constraint if exists events_protocol_version_check,
  drop constraint if exists events_revision_check,
  add constraint events_protocol_version_check check (protocol_version in (1, 2)) not valid,
  add constraint events_revision_check check (revision >= 0) not valid,
  add constraint events_protocol_state_check check (
    deleted_at is not null
    or (
      protocol_version = 1
      and coalesce(state ->> 'schemaVersion', '1') = '1'
    )
    or (
      protocol_version = 2
      and state ->> 'schemaVersion' = '2'
      and state ->> 'protocolVersion' = '2'
      and state ->> 'format' = 'americano'
      and state #>> '{formatConfig,rulesVersion}' = '2'
    )
  ) not valid;

alter table public.events validate constraint events_protocol_version_check;
alter table public.events validate constraint events_revision_check;
alter table public.events validate constraint events_protocol_state_check;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.events'::regclass
      and conname = 'events_id_user_id_key'
  ) then
    alter table public.events add constraint events_id_user_id_key unique (id, user_id);
  end if;
end;
$$;

alter table public.signup_events
  add column if not exists protocol_version smallint not null default 1,
  add column if not exists source_event_uuid uuid,
  add column if not exists entry_mode text not null default 'fixed-pairs',
  add column if not exists capacity_players integer,
  add column if not exists roster_revision bigint not null default 0;

alter table public.signup_events
  add constraint signup_events_protocol_version_check check (protocol_version in (1, 2)) not valid,
  add constraint signup_events_entry_mode_check check (entry_mode in ('fixed-pairs', 'individual')) not valid,
  add constraint signup_events_roster_revision_check check (roster_revision >= 0) not valid,
  add constraint signup_events_capacity_players_check check (
    capacity_players is null or capacity_players between 4 and 256
  ) not valid,
  add constraint signup_events_v2_shape_check check (
    (
      protocol_version = 1
      and source_event_uuid is null
      and entry_mode = 'fixed-pairs'
      and capacity_players is null
    )
    or (
      protocol_version = 2
      and source_event_uuid is not null
      and source_event_id = source_event_uuid::text
      and (
        (entry_mode = 'fixed-pairs' and capacity_teams between 1 and 128 and capacity_players is null)
        or (entry_mode = 'individual' and capacity_teams = 0 and capacity_players between 4 and 256)
      )
    )
  ) not valid;

alter table public.signup_events validate constraint signup_events_protocol_version_check;
alter table public.signup_events validate constraint signup_events_entry_mode_check;
alter table public.signup_events validate constraint signup_events_roster_revision_check;
alter table public.signup_events validate constraint signup_events_capacity_players_check;
alter table public.signup_events validate constraint signup_events_v2_shape_check;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.signup_events'::regclass
      and conname = 'signup_events_id_entry_mode_key'
  ) then
    alter table public.signup_events
      add constraint signup_events_id_entry_mode_key unique (id, entry_mode);
  end if;
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.signup_events'::regclass
      and conname = 'signup_events_source_event_owner_fkey'
  ) then
    alter table public.signup_events
      add constraint signup_events_source_event_owner_fkey
      foreign key (source_event_uuid, owner_user_id)
      references public.events(id, user_id) on delete cascade;
  end if;
end;
$$;

alter table public.signup_registrations
  add column if not exists entry_mode text not null default 'fixed-pairs';

alter table public.signup_registrations
  drop constraint if exists signup_registrations_roster_state_check,
  drop constraint if exists signup_registrations_pair_completed_check;

alter table public.signup_registrations
  add constraint signup_registrations_entry_mode_check
    check (entry_mode in ('fixed-pairs', 'individual')) not valid,
  add constraint signup_registrations_mode_shape_check check (
    (
      entry_mode = 'individual'
      and team_name = ''
      and player_two is null
      and player_two_contact is null
      and pair_completed_at is null
      and status in ('confirmed', 'waitlisted', 'cancelled')
    )
    or (
      entry_mode = 'fixed-pairs'
      and (
        status = 'cancelled'
        or (
          (player_two is null or trim(player_two) = '')
          and pair_completed_at is null
          and status = 'looking'
        )
        or (
          player_two is not null
          and trim(player_two) <> ''
          and pair_completed_at is not null
          and status in ('confirmed', 'waitlisted')
        )
      )
    )
  ) not valid;

alter table public.signup_registrations validate constraint signup_registrations_entry_mode_check;
alter table public.signup_registrations validate constraint signup_registrations_mode_shape_check;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.signup_registrations'::regclass
      and conname = 'signup_registrations_event_mode_fkey'
  ) then
    alter table public.signup_registrations
      add constraint signup_registrations_event_mode_fkey
      foreign key (signup_event_id, entry_mode)
      references public.signup_events(id, entry_mode) on delete cascade;
  end if;
end;
$$;

create table if not exists public.event_v2_requests (
  event_id uuid not null references public.events(id) on delete cascade,
  request_id uuid not null,
  operation text not null check (char_length(operation) between 1 and 80),
  payload_sha256 text not null check (payload_sha256 ~ '^[0-9a-f]{64}$'),
  applied_revision bigint not null check (applied_revision >= 0),
  result_ids jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  primary key (event_id, request_id)
);

alter table public.event_v2_requests enable row level security;
revoke all on table public.event_v2_requests from public, anon, authenticated;

create or replace function public.americano_v2_write_enabled()
returns boolean
language sql
stable
set search_path = public, pg_temp
as $$
  select coalesce(current_setting('app.americano_v2_rpc', true) = 'on', false)
$$;

create or replace function public.guard_event_protocol_write()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if (
    coalesce(new.protocol_version, 1) = 2
    or (tg_op = 'UPDATE' and old.protocol_version = 2)
  ) and not public.americano_v2_write_enabled() then
    raise exception using errcode = 'P0001', message = 'UPDATE_REQUIRED';
  end if;
  if tg_op = 'UPDATE' and old.protocol_version = 2 and new.protocol_version <> 2 then
    raise exception using errcode = 'P0001', message = 'UPDATE_REQUIRED';
  end if;
  if new.state is not null and new.state ->> 'id' is distinct from new.id::text then
    raise exception using errcode = '22023', message = 'Event state id does not match its row id.';
  end if;
  return new;
end;
$$;

drop trigger if exists guard_event_protocol_write on public.events;
create trigger guard_event_protocol_write
before insert or update on public.events
for each row execute function public.guard_event_protocol_write();

create or replace function public.guard_signup_protocol_write()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  related_protocol smallint;
  related_id uuid;
begin
  if coalesce(new.protocol_version, 1) = 2
     or (tg_op = 'UPDATE' and old.protocol_version = 2) then
    if not public.americano_v2_write_enabled() then
      raise exception using errcode = 'P0001', message = 'UPDATE_REQUIRED';
    end if;
  end if;

  related_id := new.source_event_uuid;
  if related_id is null and new.source_event_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then
    related_id := new.source_event_id::uuid;
  end if;
  if related_id is not null then
    select event.protocol_version into related_protocol
    from public.events as event
    where event.id = related_id and event.user_id = new.owner_user_id;
    if related_protocol = 2 and not public.americano_v2_write_enabled() then
      raise exception using errcode = 'P0001', message = 'UPDATE_REQUIRED';
    end if;
  end if;
  if tg_op = 'UPDATE' and old.protocol_version = 2 and new.protocol_version <> 2 then
    raise exception using errcode = 'P0001', message = 'UPDATE_REQUIRED';
  end if;
  return new;
end;
$$;

drop trigger if exists guard_signup_protocol_write on public.signup_events;
create trigger guard_signup_protocol_write
before insert or update on public.signup_events
for each row execute function public.guard_signup_protocol_write();

create or replace function public.validate_signup_v2_source()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  source_state jsonb;
  source_protocol smallint;
  expected_mode text;
begin
  if new.protocol_version <> 2 then return new; end if;
  select event.protocol_version, event.state into source_protocol, source_state
  from public.events as event
  where event.id = new.source_event_uuid
    and event.user_id = new.owner_user_id
    and event.deleted_at is null;
  if not found or source_protocol <> 2 then
    raise exception using errcode = '23503', message = 'Protocol 2 signup source is missing or invalid.';
  end if;
  expected_mode := case source_state #>> '{formatConfig,pairingMode}'
    when 'fixed' then 'fixed-pairs'
    when 'rotating' then 'individual'
    else null
  end;
  if expected_mode is null or new.entry_mode <> expected_mode then
    raise exception using errcode = '22023', message = 'MODE_MISMATCH';
  end if;
  return new;
end;
$$;

drop trigger if exists validate_signup_v2_source on public.signup_events;
create trigger validate_signup_v2_source
before insert or update of protocol_version, source_event_uuid, owner_user_id, entry_mode
on public.signup_events
for each row execute function public.validate_signup_v2_source();

create or replace function public.guard_signup_registration_v2_write()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  target_event_id uuid := case when tg_op = 'DELETE' then old.signup_event_id else new.signup_event_id end;
  target_protocol smallint;
begin
  select event.protocol_version into target_protocol
  from public.signup_events as event where event.id = target_event_id;
  if target_protocol = 2 and not public.americano_v2_write_enabled() then
    raise exception using errcode = 'P0001', message = 'UPDATE_REQUIRED';
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

drop trigger if exists guard_signup_registration_v2_write on public.signup_registrations;
create trigger guard_signup_registration_v2_write
before insert or update or delete on public.signup_registrations
for each row execute function public.guard_signup_registration_v2_write();

create or replace function public.bump_signup_roster_revision_v2()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  target_event_id uuid := case when tg_op = 'DELETE' then old.signup_event_id else new.signup_event_id end;
begin
  update public.signup_events as event
  set roster_revision = event.roster_revision + 1,
      updated_at = clock_timestamp()
  where event.id = target_event_id and event.protocol_version = 2;
  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

drop trigger if exists bump_signup_roster_revision_v2 on public.signup_registrations;
create trigger bump_signup_roster_revision_v2
after insert or update or delete on public.signup_registrations
for each row execute function public.bump_signup_roster_revision_v2();

create or replace function public.rebalance_signup_event(p_event_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  signup public.signup_events%rowtype;
begin
  select * into signup from public.signup_events where id = p_event_id for update;
  if not found or signup.roster_locked_at is not null then return; end if;

  perform 1 from public.signup_registrations
  where signup_event_id = p_event_id
    and status in ('confirmed', 'waitlisted', 'looking')
  order by id for update;

  if signup.protocol_version = 2 and signup.entry_mode = 'individual' then
    with ranked as (
      select registration.id,
        row_number() over (order by registration.organizer_rank nulls last,
          registration.created_at, registration.id) as queue_position
      from public.signup_registrations as registration
      where registration.signup_event_id = p_event_id
        and registration.entry_mode = 'individual'
        and registration.status in ('confirmed', 'waitlisted')
    )
    update public.signup_registrations as registration
    set status = case when ranked.queue_position <= signup.capacity_players then 'confirmed' else 'waitlisted' end,
        updated_at = clock_timestamp()
    from ranked
    where registration.id = ranked.id
      and registration.status is distinct from
        case when ranked.queue_position <= signup.capacity_players then 'confirmed' else 'waitlisted' end;
  else
    with ranked_pairs as (
      select registration.id,
        row_number() over (order by registration.organizer_rank nulls last,
          registration.pair_completed_at nulls last, registration.created_at, registration.id) as pair_position
      from public.signup_registrations as registration
      where registration.signup_event_id = p_event_id
        and registration.status in ('confirmed', 'waitlisted', 'looking')
        and registration.player_two is not null and trim(registration.player_two) <> ''
    ), desired as (
      select registration.id,
        case
          when registration.player_two is null or trim(registration.player_two) = '' then 'looking'
          when ranked_pairs.pair_position <= signup.capacity_teams then 'confirmed'
          else 'waitlisted'
        end as next_status
      from public.signup_registrations as registration
      left join ranked_pairs on ranked_pairs.id = registration.id
      where registration.signup_event_id = p_event_id
        and registration.status in ('confirmed', 'waitlisted', 'looking')
    )
    update public.signup_registrations as registration
    set status = desired.next_status, updated_at = clock_timestamp()
    from desired
    where registration.id = desired.id
      and registration.status is distinct from desired.next_status;
  end if;
end;
$$;

drop trigger if exists signup_capacity_rebalance on public.signup_events;
create trigger signup_capacity_rebalance
after update of capacity_teams, capacity_players on public.signup_events
for each row
when (old.capacity_teams is distinct from new.capacity_teams
  or old.capacity_players is distinct from new.capacity_players)
execute function public.rebalance_signup_capacity();

drop policy if exists "events_insert_own" on public.events;
create policy "events_insert_own"
  on public.events for insert
  with check (
    auth.uid() = user_id
    and deleted_at is null
    and state is not null
    and protocol_version = 1
    and coalesce(state ->> 'schemaVersion', '1') = '1'
  );

drop policy if exists "events_update_own" on public.events;
create policy "events_update_own"
  on public.events for update
  using (auth.uid() = user_id and deleted_at is null and protocol_version = 1)
  with check (
    auth.uid() = user_id
    and deleted_at is null
    and state is not null
    and protocol_version = 1
    and coalesce(state ->> 'schemaVersion', '1') = '1'
  );

drop policy if exists "signup_events_owner_insert" on public.signup_events;
create policy "signup_events_owner_insert" on public.signup_events for insert
  with check (auth.uid() = owner_user_id and protocol_version = 1 and source_event_uuid is null);

drop policy if exists "signup_events_owner_update" on public.signup_events;
create policy "signup_events_owner_update" on public.signup_events for update
  using (auth.uid() = owner_user_id and protocol_version = 1)
  with check (auth.uid() = owner_user_id and protocol_version = 1 and source_event_uuid is null);

drop policy if exists "signup_events_owner_delete" on public.signup_events;
create policy "signup_events_owner_delete" on public.signup_events for delete
  using (auth.uid() = owner_user_id and protocol_version = 1);

revoke all on function public.americano_v2_write_enabled() from public, anon, authenticated;
revoke all on function public.guard_event_protocol_write() from public, anon, authenticated;
revoke all on function public.guard_signup_protocol_write() from public, anon, authenticated;
revoke all on function public.validate_signup_v2_source() from public, anon, authenticated;
revoke all on function public.guard_signup_registration_v2_write() from public, anon, authenticated;
revoke all on function public.bump_signup_roster_revision_v2() from public, anon, authenticated;
