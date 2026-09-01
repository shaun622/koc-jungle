-- Event start time is the hard public registration cutoff. Organisers remain
-- able to correct their own roster after the event starts.
update public.signup_events
set
  is_open = false,
  capacity_revision = capacity_revision + 1,
  updated_at = now()
where is_open
  and starts_at is not null
  and starts_at <= now();

create or replace function public.enforce_signup_event_start_cutoff()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  signup public.signup_events%rowtype;
begin
  select * into signup
  from public.signup_events
  where id = new.signup_event_id;

  if found
    and signup.starts_at is not null
    and signup.starts_at <= now()
    and coalesce(auth.role(), '') <> 'service_role'
    and (auth.uid() is null or auth.uid() <> signup.owner_user_id)
  then
    raise exception 'This event has already started. Registrations are closed.';
  end if;

  return new;
end;
$$;

revoke all on function public.enforce_signup_event_start_cutoff() from public;

drop trigger if exists enforce_signup_event_start_cutoff on public.signup_registrations;
create trigger enforce_signup_event_start_cutoff
before insert or update of team_name, player_one, player_two, contact, player_two_contact, status
on public.signup_registrations
for each row
execute function public.enforce_signup_event_start_cutoff();
