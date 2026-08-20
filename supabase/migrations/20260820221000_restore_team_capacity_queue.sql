-- Capacity represents tournament team slots. A solo registration temporarily
-- occupies one slot; complete pairs rank ahead of solos. Existing signup rows
-- are left untouched until their organiser syncs that event's capacity.

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

  with ranked as (
    select
      id,
      row_number() over (
        order by
          case when player_two is not null and trim(player_two) <> '' then 0 else 1 end,
          created_at,
          id
      ) as priority_position
    from public.signup_registrations
    where signup_event_id = p_event_id
      and status in ('confirmed', 'waitlisted')
  ), desired as (
    select
      id,
      case
        when priority_position <= event_capacity then 'confirmed'
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

revoke all on function public.rebalance_signup_event(uuid) from public;
