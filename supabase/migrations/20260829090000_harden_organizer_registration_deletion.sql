-- Keep organiser registration deletion on the same event-first lock order as
-- public registration/join operations. This prevents a delete and a public
-- join from waiting on each other's row locks in opposite order.
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
  -- Resolve and lock the organiser-owned event before locking the individual
  -- registration. The EXISTS lookup does not lock the registration row.
  select event.id into event_id
  from public.signup_events event
  where event.owner_user_id = auth.uid()
    and exists (
      select 1
      from public.signup_registrations registration
      where registration.id = p_registration_id
        and registration.signup_event_id = event.id
    )
  for update;

  if event_id is null then
    raise exception 'This team could not be found or you do not own its sign-up.';
  end if;

  -- Revalidate and lock the registration after the event lock is held.
  perform 1
  from public.signup_registrations registration
  where registration.id = p_registration_id
    and registration.signup_event_id = event_id
  for update;

  if not found then
    raise exception 'This team could not be found or you do not own its sign-up.';
  end if;

  delete from public.signup_registrations
  where id = p_registration_id
    and signup_event_id = event_id;

  perform public.rebalance_signup_event(event_id);
end;
$$;

-- The RPC above is the sole organiser deletion path so queue rebalancing can
-- never be bypassed by a direct REST delete.
revoke delete on table public.signup_registrations from authenticated;
revoke all on function public.organizer_delete_signup_registration(uuid) from public;
grant execute on function public.organizer_delete_signup_registration(uuid) to authenticated;

-- Waiting-list removal has a separate atomic status guard. If a registration
-- is promoted while the confirmation dialog is open, the organiser's stale
-- "remove from waiting list" action cannot delete the newly confirmed team.
create or replace function public.organizer_delete_waitlisted_signup_registration(
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
  select event.id into event_id
  from public.signup_events event
  where event.owner_user_id = auth.uid()
    and exists (
      select 1
      from public.signup_registrations registration
      where registration.id = p_registration_id
        and registration.signup_event_id = event.id
    )
  for update;

  if event_id is null then
    raise exception 'This registration could not be found or you do not own its sign-up.';
  end if;

  perform 1
  from public.signup_registrations registration
  where registration.id = p_registration_id
    and registration.signup_event_id = event_id
    and registration.status = 'waitlisted'
  for update;

  if not found then
    raise exception 'This registration is no longer on the waiting list. Refresh and try again.';
  end if;

  delete from public.signup_registrations
  where id = p_registration_id
    and signup_event_id = event_id
    and status = 'waitlisted';

  perform public.rebalance_signup_event(event_id);
end;
$$;

revoke all on function public.organizer_delete_waitlisted_signup_registration(uuid) from public;
grant execute on function public.organizer_delete_waitlisted_signup_registration(uuid) to authenticated;

-- Reordering must use the same event-first lock order as registration, join,
-- and deletion operations. Otherwise a reorder in one organiser tab and a
-- delete in another can deadlock while each waits for the other's row lock.
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
  perform 1
  from public.signup_events event
  where event.id = p_event_id
    and event.owner_user_id = auth.uid()
  for update;

  if not found then
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

revoke all on function public.organizer_reorder_signup_registrations(uuid, uuid[]) from public;
grant execute on function public.organizer_reorder_signup_registrations(uuid, uuid[]) to authenticated;
