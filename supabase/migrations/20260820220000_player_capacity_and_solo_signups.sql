-- Treat signup capacity as player places while preserving the existing
-- capacity_teams column name for backwards-compatible clients. A pair uses
-- two places, a solo player uses one, and complete pairs are always ranked
-- ahead of solo registrations.

alter table public.signup_registrations
  alter column player_two drop not null;

alter table public.signup_registrations
  drop constraint if exists signup_registrations_player_two_check;

alter table public.signup_registrations
  add constraint signup_registrations_player_two_check
  check (player_two is null or char_length(player_two) between 1 and 100);

alter table public.signup_registrations
  add column if not exists player_two_contact text;

alter table public.signup_registrations
  drop constraint if exists signup_registrations_player_two_contact_check;

alter table public.signup_registrations
  add constraint signup_registrations_player_two_contact_check
  check (player_two_contact is null or char_length(player_two_contact) between 3 and 200);

create or replace function public.rebalance_signup_event(p_event_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  event_capacity integer;
begin
  select capacity_teams into event_capacity
  from public.signup_events
  where id = p_event_id
  for update;

  if event_capacity is null then
    return;
  end if;

  with active as (
    select
      id,
      created_at,
      player_two is not null and trim(player_two) <> '' as is_pair
    from public.signup_registrations
    where signup_event_id = p_event_id
      and status in ('confirmed', 'waitlisted')
  ), ranked as (
    select
      id,
      is_pair,
      row_number() over (partition by is_pair order by created_at, id) as priority_position,
      count(*) filter (where is_pair) over () as pair_count
    from active
  ), desired as (
    select
      id,
      case
        when is_pair
          and priority_position <= (event_capacity / 2)::bigint
          then 'confirmed'
        when not is_pair
          and priority_position <= greatest(
            event_capacity::bigint
              - least(pair_count, (event_capacity / 2)::bigint) * 2,
            0::bigint
          )
          then 'confirmed'
        else 'waitlisted'
      end as next_status
    from ranked
  )
  update public.signup_registrations registration
  set
    status = desired.next_status,
    updated_at = now()
  from desired
  where registration.id = desired.id
    and registration.status is distinct from desired.next_status;
end;
$$;

create or replace function public.rebalance_signup_capacity()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  perform public.rebalance_signup_event(new.id);
  return new;
end;
$$;

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
        'playerTwo', coalesce(ranked.player_two, ''),
        'status', ranked.status,
        'position', ranked.position,
        'createdAt', ranked.created_at
      ) order by
        case when ranked.status = 'confirmed' then 0 else 1 end,
        case when ranked.player_two is not null and trim(ranked.player_two) <> '' then 0 else 1 end,
        ranked.created_at,
        ranked.id
    ),
    '[]'::jsonb
  ) into roster
  from (
    select
      r.*,
      row_number() over (
        partition by r.status
        order by
          case when r.player_two is not null and trim(r.player_two) <> '' then 0 else 1 end,
          r.created_at,
          r.id
      ) as position
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
  next_position bigint;
begin
  p_team_name := trim(coalesce(p_team_name, ''));
  p_player_one := trim(coalesce(p_player_one, ''));
  p_player_two := nullif(trim(coalesce(p_player_two, '')), '');
  p_contact := trim(coalesce(p_contact, ''));

  if char_length(p_player_one) not between 1 and 100 then
    raise exception 'Enter your name.';
  end if;
  if p_player_two is not null and char_length(p_player_two) not between 1 and 100 then
    raise exception 'Enter a valid second player name.';
  end if;
  if p_player_two is not null and lower(p_player_one) = lower(p_player_two) then
    raise exception 'Enter two different player names.';
  end if;
  if char_length(p_team_name) > 100 then
    raise exception 'Pair name is too long.';
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
        lower(trim(r.player_one)) = lower(p_player_one)
        or lower(trim(coalesce(r.player_two, ''))) = lower(p_player_one)
        or (
          p_player_two is not null
          and (
            lower(trim(r.player_one)) = lower(p_player_two)
            or lower(trim(coalesce(r.player_two, ''))) = lower(p_player_two)
          )
        )
      )
  ) then
    raise exception 'One of these players is already registered for this event.';
  end if;

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
    'waitlisted'
  ) returning * into registration;

  perform public.rebalance_signup_event(signup.id);

  select * into registration
  from public.signup_registrations
  where id = registration.id;

  select ranked.position into next_position
  from (
    select
      r.id,
      row_number() over (
        order by
          case when r.player_two is not null and trim(r.player_two) <> '' then 0 else 1 end,
          r.created_at,
          r.id
      ) as position
    from public.signup_registrations r
    where r.signup_event_id = signup.id
      and r.status = registration.status
  ) ranked
  where ranked.id = registration.id;

  return jsonb_build_object(
    'registrationId', registration.id,
    'cancelToken', registration.cancel_token,
    'status', registration.status,
    'position', next_position
  );
end;
$$;

create or replace function public.join_public_single(
  p_slug uuid,
  p_registration_id uuid,
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
  next_position bigint;
begin
  p_player_two := trim(coalesce(p_player_two, ''));
  p_contact := trim(coalesce(p_contact, ''));

  if char_length(p_player_two) not between 1 and 100 then
    raise exception 'Enter your name.';
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

  select * into registration
  from public.signup_registrations
  where id = p_registration_id
    and signup_event_id = signup.id
    and status in ('confirmed', 'waitlisted')
  for update;

  if not found then
    raise exception 'This solo registration could not be found.';
  end if;
  if registration.player_two is not null and trim(registration.player_two) <> '' then
    raise exception 'This player already has a partner.';
  end if;
  if lower(trim(registration.player_one)) = lower(p_player_two) then
    raise exception 'Enter a different player name.';
  end if;

  if exists (
    select 1
    from public.signup_registrations r
    where r.signup_event_id = signup.id
      and r.id <> registration.id
      and r.status in ('confirmed', 'waitlisted')
      and (
        lower(trim(r.player_one)) = lower(p_player_two)
        or lower(trim(coalesce(r.player_two, ''))) = lower(p_player_two)
      )
  ) then
    raise exception 'This player is already registered for the event.';
  end if;

  update public.signup_registrations
  set
    player_two = p_player_two,
    player_two_contact = p_contact,
    updated_at = now()
  where id = registration.id;

  perform public.rebalance_signup_event(signup.id);

  select * into registration
  from public.signup_registrations
  where id = registration.id;

  select ranked.position into next_position
  from (
    select
      r.id,
      row_number() over (
        order by
          case when r.player_two is not null and trim(r.player_two) <> '' then 0 else 1 end,
          r.created_at,
          r.id
      ) as position
    from public.signup_registrations r
    where r.signup_event_id = signup.id
      and r.status = registration.status
  ) ranked
  where ranked.id = registration.id;

  return jsonb_build_object(
    'registrationId', registration.id,
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

  perform public.rebalance_signup_event(registration.signup_event_id);

  return jsonb_build_object('cancelled', true);
end;
$$;

create or replace function public.join_public_single(
  p_share_slug text,
  p_registration_id uuid,
  p_player_two text,
  p_contact text
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  resolved_uuid uuid;
begin
  select public_slug into resolved_uuid
  from public.signup_events
  where friendly_slug = p_share_slug or public_slug::text = p_share_slug
  limit 1;

  if resolved_uuid is null then raise exception 'This sign-up link was not found.'; end if;
  return public.join_public_single(resolved_uuid, p_registration_id, p_player_two, p_contact);
end;
$$;

create or replace function public.join_public_single(
  p_account_slug text,
  p_event_slug text,
  p_registration_id uuid,
  p_player_two text,
  p_contact text
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  resolved_uuid uuid;
begin
  select public_slug into resolved_uuid
  from public.signup_events
  where account_slug = p_account_slug and event_slug = p_event_slug;

  if resolved_uuid is null then raise exception 'This sign-up link was not found.'; end if;
  return public.join_public_single(resolved_uuid, p_registration_id, p_player_two, p_contact);
end;
$$;

-- Recalculate existing events immediately so their display matches the new
-- player-based interpretation before the updated client is loaded.
do $$
declare
  signup record;
begin
  for signup in select id from public.signup_events loop
    perform public.rebalance_signup_event(signup.id);
  end loop;
end;
$$;

revoke all on function public.rebalance_signup_event(uuid) from public;
revoke all on function public.rebalance_signup_capacity() from public;
revoke all on function public.get_public_signup(uuid) from public;
revoke all on function public.register_public_team(uuid, text, text, text, text) from public;
revoke all on function public.join_public_single(uuid, uuid, text, text) from public;
revoke all on function public.cancel_public_registration(uuid, uuid) from public;
revoke all on function public.join_public_single(text, uuid, text, text) from public;
revoke all on function public.join_public_single(text, text, uuid, text, text) from public;

grant execute on function public.get_public_signup(uuid) to anon, authenticated;
grant execute on function public.register_public_team(uuid, text, text, text, text) to anon, authenticated;
grant execute on function public.join_public_single(uuid, uuid, text, text) to anon, authenticated;
grant execute on function public.cancel_public_registration(uuid, uuid) to anon, authenticated;
grant execute on function public.join_public_single(text, uuid, text, text) to anon, authenticated;
grant execute on function public.join_public_single(text, text, uuid, text, text) to anon, authenticated;
