\set ON_ERROR_STOP on

do $$
declare
  last_slot jsonb := (select payload from public.americano_test_concurrency_payloads where name='last-slot');
  start_race jsonb := (select payload from public.americano_test_concurrency_payloads where name='start-race');
  signup_id uuid;
  event_id uuid;
  event_status text;
  signup_open boolean;
  roster_locked timestamptz;
  confirmed_count integer;
  waiting_count integer;
  foxtrot_count integer;
begin
  if current_database() not like 'koc_americano_test_%' then
    raise exception 'Refusing Americano concurrency verification outside an isolated database';
  end if;

  signup_id := (last_slot->>'signupId')::uuid;
  select count(*) filter(where row.status='confirmed'),count(*) filter(where row.status='waitlisted')
    into confirmed_count,waiting_count from public.signup_registrations row where row.signup_event_id=signup_id;
  if confirmed_count<>4 or waiting_count<>1 then
    raise exception 'Concurrent last-slot allocation was not atomic: confirmed %, waiting %',confirmed_count,waiting_count;
  end if;
  if (select count(*) from public.signup_public_requests row where row.signup_event_id=signup_id
      and row.request_id in ('63333333-3333-4333-8333-333333333331','63333333-3333-4333-8333-333333333332'))<>2 then
    raise exception 'Concurrent registration requests were not recorded exactly once';
  end if;

  signup_id := (start_race->>'signupId')::uuid;
  event_id := (start_race->>'eventId')::uuid;
  select row.state->>'status' into event_status from public.events row where row.id=event_id;
  select row.is_open,row.roster_locked_at into signup_open,roster_locked from public.signup_events row where row.id=signup_id;
  select count(*) into foxtrot_count from public.signup_registrations row where row.signup_event_id=signup_id and row.player_one='Foxtrot';

  if event_status='round-in-progress' then
    if signup_open or roster_locked is null or foxtrot_count<>0 then
      raise exception 'Start won the race but signup was partially applied/open';
    end if;
  elsif event_status='setup' then
    if not signup_open or roster_locked is not null or foxtrot_count<>1 then
      raise exception 'Signup won the race but Start partially closed/started the event';
    end if;
  else
    raise exception 'Unexpected event status after signup/Start race: %',event_status;
  end if;
end;
$$;

select 'Americano v2 separate-connection concurrency contract passed' as result;
