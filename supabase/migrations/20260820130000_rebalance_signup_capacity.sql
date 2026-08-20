-- Keep confirmed and waiting teams in registration order whenever the
-- organiser changes the confirmed-team limit.

create or replace function public.rebalance_signup_capacity()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  with ranked as (
    select
      id,
      row_number() over (order by created_at, id) as queue_position
    from public.signup_registrations
    where signup_event_id = new.id
      and status in ('confirmed', 'waitlisted')
  ), desired as (
    select
      id,
      case
        when queue_position <= new.capacity_teams then 'confirmed'
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

  return new;
end;
$$;

drop trigger if exists signup_capacity_rebalance on public.signup_events;
create trigger signup_capacity_rebalance
after update of capacity_teams on public.signup_events
for each row
when (old.capacity_teams is distinct from new.capacity_teams)
execute function public.rebalance_signup_capacity();

revoke all on function public.rebalance_signup_capacity() from public;
