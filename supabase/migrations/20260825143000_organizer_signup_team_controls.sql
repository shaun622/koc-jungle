-- Keep organiser team edits, deletion and ordering synchronized with the
-- public sign-up roster. Contacts remain private and all organiser mutations
-- verify ownership through auth.uid().

alter table public.signup_registrations
  add column if not exists organizer_rank bigint;

with ranked as (
  select
    id,
    row_number() over (
      partition by signup_event_id
      order by
        case when player_two is not null and trim(player_two) <> '' then 0 else 1 end,
        created_at,
        id
    ) as next_rank
  from public.signup_registrations
  where status in ('confirmed', 'waitlisted')
)
update public.signup_registrations registration
set organizer_rank = ranked.next_rank
from ranked
where registration.id = ranked.id
  and registration.organizer_rank is null;

create index if not exists signup_registrations_organizer_order_idx
  on public.signup_registrations (signup_event_id, status, organizer_rank, created_at, id);

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

  if event_capacity is null then return; end if;

  with ranked as (
    select
      id,
      row_number() over (
        order by
          case when player_two is not null and trim(player_two) <> '' then 0 else 1 end,
          organizer_rank nulls last,
          created_at,
          id
      ) as priority_position
    from public.signup_registrations
    where signup_event_id = p_event_id
      and status in ('confirmed', 'waitlisted')
  ), desired as (
    select
      id,
      case when priority_position <= event_capacity then 'confirmed' else 'waitlisted' end as next_status
    from ranked
  )
  update public.signup_registrations registration
  set status = desired.next_status, updated_at = now()
  from desired
  where registration.id = desired.id
    and registration.status is distinct from desired.next_status;
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

  if not found then return null; end if;

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
        'createdAt', ranked.created_at,
        'organizerRank', ranked.organizer_rank
      ) order by
        case when ranked.status = 'confirmed' then 0 else 1 end,
        case when ranked.player_two is not null and trim(ranked.player_two) <> '' then 0 else 1 end,
        ranked.organizer_rank nulls last,
        ranked.created_at,
        ranked.id
    ),
    '[]'::jsonb
  ) into roster
  from (
    select
      registration.*,
      row_number() over (
        partition by registration.status
        order by
          case when registration.player_two is not null and trim(registration.player_two) <> '' then 0 else 1 end,
          registration.organizer_rank nulls last,
          registration.created_at,
          registration.id
      ) as position
    from public.signup_registrations registration
    where registration.signup_event_id = signup.id
      and registration.status in ('confirmed', 'waitlisted')
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

create or replace function public.organizer_delete_signup_registration(
  p_registration_id uuid
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  event_id uuid;
begin
  select registration.signup_event_id into event_id
  from public.signup_registrations registration
  join public.signup_events event on event.id = registration.signup_event_id
  where registration.id = p_registration_id
    and event.owner_user_id = auth.uid();

  if event_id is null then
    raise exception 'This team could not be found or you do not own its sign-up.';
  end if;

  delete from public.signup_registrations where id = p_registration_id;
  perform public.rebalance_signup_event(event_id);
end;
$$;

create or replace function public.organizer_reorder_signup_registrations(
  p_event_id uuid,
  p_registration_ids uuid[]
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if not exists (
    select 1 from public.signup_events
    where id = p_event_id and owner_user_id = auth.uid()
  ) then
    raise exception 'This sign-up could not be found or you do not own it.';
  end if;

  if exists (
    select 1
    from unnest(p_registration_ids) registration_id
    left join public.signup_registrations registration
      on registration.id = registration_id
      and registration.signup_event_id = p_event_id
    where registration.id is null
  ) then
    raise exception 'One or more teams do not belong to this sign-up.';
  end if;

  update public.signup_registrations registration
  set organizer_rank = ordered.ordinality, updated_at = now()
  from unnest(p_registration_ids) with ordinality ordered(id, ordinality)
  where registration.id = ordered.id
    and registration.signup_event_id = p_event_id;

  perform public.rebalance_signup_event(p_event_id);
end;
$$;

revoke all on function public.organizer_delete_signup_registration(uuid) from public;
revoke all on function public.organizer_reorder_signup_registrations(uuid, uuid[]) from public;
grant execute on function public.organizer_delete_signup_registration(uuid) to authenticated;
grant execute on function public.organizer_reorder_signup_registrations(uuid, uuid[]) to authenticated;
