-- Public, account-free team registration for published events.
--
-- Organisers are authenticated and own their signup event. Participants use
-- high-entropy share/cancellation tokens through narrow SECURITY DEFINER RPCs;
-- the tables themselves are never readable by the anonymous role. This keeps
-- contact details and cancellation tokens out of the public roster response.

create table if not exists public.signup_events (
  id uuid primary key default gen_random_uuid(),
  owner_user_id uuid not null references auth.users(id) on delete cascade,
  source_event_id text not null,
  public_slug uuid not null default gen_random_uuid() unique,
  title text not null check (char_length(title) between 1 and 120),
  venue text not null default '' check (char_length(venue) <= 160),
  starts_at timestamptz,
  ends_at timestamptz,
  capacity_teams integer not null default 16 check (capacity_teams between 1 and 128),
  details text not null default '' check (char_length(details) <= 3000),
  prizes text not null default '' check (char_length(prizes) <= 2000),
  is_open boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (owner_user_id, source_event_id),
  check (ends_at is null or starts_at is null or ends_at > starts_at)
);

create table if not exists public.signup_registrations (
  id uuid primary key default gen_random_uuid(),
  signup_event_id uuid not null references public.signup_events(id) on delete cascade,
  team_name text not null default '' check (char_length(team_name) <= 100),
  player_one text not null check (char_length(player_one) between 1 and 100),
  player_two text not null check (char_length(player_two) between 1 and 100),
  contact text not null check (char_length(contact) between 3 and 200),
  status text not null check (status in ('confirmed', 'waitlisted', 'cancelled')),
  cancel_token uuid not null default gen_random_uuid() unique,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  cancelled_at timestamptz
);

create index if not exists signup_events_owner_idx
  on public.signup_events (owner_user_id, updated_at desc);
create index if not exists signup_registrations_event_idx
  on public.signup_registrations (signup_event_id, status, created_at, id);

alter table public.signup_events enable row level security;
alter table public.signup_registrations enable row level security;

drop policy if exists "signup_events_owner_select" on public.signup_events;
create policy "signup_events_owner_select"
  on public.signup_events for select
  using (auth.uid() = owner_user_id);

drop policy if exists "signup_events_owner_insert" on public.signup_events;
create policy "signup_events_owner_insert"
  on public.signup_events for insert
  with check (auth.uid() = owner_user_id);

drop policy if exists "signup_events_owner_update" on public.signup_events;
create policy "signup_events_owner_update"
  on public.signup_events for update
  using (auth.uid() = owner_user_id)
  with check (auth.uid() = owner_user_id);

drop policy if exists "signup_events_owner_delete" on public.signup_events;
create policy "signup_events_owner_delete"
  on public.signup_events for delete
  using (auth.uid() = owner_user_id);

drop policy if exists "signup_registrations_owner_select" on public.signup_registrations;
create policy "signup_registrations_owner_select"
  on public.signup_registrations for select
  using (
    exists (
      select 1 from public.signup_events e
      where e.id = signup_event_id and e.owner_user_id = auth.uid()
    )
  );

drop policy if exists "signup_registrations_owner_update" on public.signup_registrations;
create policy "signup_registrations_owner_update"
  on public.signup_registrations for update
  using (
    exists (
      select 1 from public.signup_events e
      where e.id = signup_event_id and e.owner_user_id = auth.uid()
    )
  )
  with check (
    exists (
      select 1 from public.signup_events e
      where e.id = signup_event_id and e.owner_user_id = auth.uid()
    )
  );

drop policy if exists "signup_registrations_owner_delete" on public.signup_registrations;
create policy "signup_registrations_owner_delete"
  on public.signup_registrations for delete
  using (
    exists (
      select 1 from public.signup_events e
      where e.id = signup_event_id and e.owner_user_id = auth.uid()
    )
  );

revoke all on table public.signup_events from anon;
revoke all on table public.signup_registrations from anon;
grant select, insert, update, delete on table public.signup_events to authenticated;
grant select, update, delete on table public.signup_registrations to authenticated;

create or replace function public.get_public_signup(p_slug uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  signup public.signup_events%rowtype;
  roster jsonb;
begin
  select * into signup
  from public.signup_events
  where public_slug = p_slug;

  if not found then
    return null;
  end if;

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'id', ranked.id,
        'signupEventId', ranked.signup_event_id,
        'teamName', ranked.team_name,
        'playerOne', ranked.player_one,
        'playerTwo', ranked.player_two,
        'status', ranked.status,
        'position', ranked.position,
        'createdAt', ranked.created_at
      ) order by
        case when ranked.status = 'confirmed' then 0 else 1 end,
        ranked.created_at,
        ranked.id
    ),
    '[]'::jsonb
  ) into roster
  from (
    select
      r.*,
      row_number() over (partition by r.status order by r.created_at, r.id) as position
    from public.signup_registrations r
    where r.signup_event_id = signup.id
      and r.status in ('confirmed', 'waitlisted')
  ) ranked;

  return jsonb_build_object(
    'event', jsonb_build_object(
      'id', signup.id,
      'publicSlug', signup.public_slug,
      'title', signup.title,
      'venue', signup.venue,
      'startsAt', signup.starts_at,
      'endsAt', signup.ends_at,
      'capacityTeams', signup.capacity_teams,
      'details', signup.details,
      'prizes', signup.prizes,
      'isOpen', signup.is_open
    ),
    'registrations', roster
  );
end;
$$;

create or replace function public.register_public_team(
  p_slug uuid,
  p_team_name text,
  p_player_one text,
  p_player_two text,
  p_contact text
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  signup public.signup_events%rowtype;
  registration public.signup_registrations%rowtype;
  next_status text;
  next_position bigint;
  confirmed_count integer;
begin
  p_team_name := trim(coalesce(p_team_name, ''));
  p_player_one := trim(coalesce(p_player_one, ''));
  p_player_two := trim(coalesce(p_player_two, ''));
  p_contact := trim(coalesce(p_contact, ''));

  if char_length(p_player_one) not between 1 and 100
    or char_length(p_player_two) not between 1 and 100 then
    raise exception 'Enter both player names.';
  end if;
  if lower(p_player_one) = lower(p_player_two) then
    raise exception 'Enter two different player names.';
  end if;
  if char_length(p_team_name) > 100 then
    raise exception 'Team name is too long.';
  end if;
  if char_length(p_contact) not between 3 and 200 then
    raise exception 'Enter a WhatsApp number or email.';
  end if;

  select * into signup
  from public.signup_events
  where public_slug = p_slug
  for update;

  if not found then
    raise exception 'This sign-up link was not found.';
  end if;
  if not signup.is_open then
    raise exception 'Registrations are currently closed.';
  end if;

  if (
    select count(*) from public.signup_registrations
    where signup_event_id = signup.id and status in ('confirmed', 'waitlisted')
  ) >= 256 then
    raise exception 'This registration list has reached its limit.';
  end if;

  if exists (
    select 1
    from public.signup_registrations r
    where r.signup_event_id = signup.id
      and r.status in ('confirmed', 'waitlisted')
      and (
        lower(trim(r.player_one)) in (lower(p_player_one), lower(p_player_two))
        or lower(trim(r.player_two)) in (lower(p_player_one), lower(p_player_two))
      )
  ) then
    raise exception 'One of these players is already registered for this event.';
  end if;

  select count(*) into confirmed_count
  from public.signup_registrations
  where signup_event_id = signup.id and status = 'confirmed';

  next_status := case
    when confirmed_count < signup.capacity_teams then 'confirmed'
    else 'waitlisted'
  end;

  insert into public.signup_registrations (
    signup_event_id,
    team_name,
    player_one,
    player_two,
    contact,
    status
  ) values (
    signup.id,
    p_team_name,
    p_player_one,
    p_player_two,
    p_contact,
    next_status
  ) returning * into registration;

  select count(*) into next_position
  from public.signup_registrations
  where signup_event_id = signup.id and status = next_status;

  return jsonb_build_object(
    'registrationId', registration.id,
    'cancelToken', registration.cancel_token,
    'status', registration.status,
    'position', next_position
  );
end;
$$;

create or replace function public.cancel_public_registration(
  p_slug uuid,
  p_cancel_token uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  registration public.signup_registrations%rowtype;
  promoted_id uuid;
begin
  select r.* into registration
  from public.signup_registrations r
  join public.signup_events e on e.id = r.signup_event_id
  where e.public_slug = p_slug
    and r.cancel_token = p_cancel_token
    and r.status in ('confirmed', 'waitlisted')
  for update of r;

  if not found then
    raise exception 'This registration could not be found or was already cancelled.';
  end if;

  update public.signup_registrations
  set status = 'cancelled', cancelled_at = now(), updated_at = now()
  where id = registration.id;

  if registration.status = 'confirmed' then
    select id into promoted_id
    from public.signup_registrations
    where signup_event_id = registration.signup_event_id
      and status = 'waitlisted'
    order by created_at, id
    for update skip locked
    limit 1;

    if promoted_id is not null then
      update public.signup_registrations
      set status = 'confirmed', updated_at = now()
      where id = promoted_id;
    end if;
  end if;

  return jsonb_build_object(
    'cancelled', true,
    'promotedRegistrationId', promoted_id
  );
end;
$$;

revoke all on function public.get_public_signup(uuid) from public;
revoke all on function public.register_public_team(uuid, text, text, text, text) from public;
revoke all on function public.cancel_public_registration(uuid, uuid) from public;
grant execute on function public.get_public_signup(uuid) to anon, authenticated;
grant execute on function public.register_public_team(uuid, text, text, text, text) to anon, authenticated;
grant execute on function public.cancel_public_registration(uuid, uuid) to anon, authenticated;

