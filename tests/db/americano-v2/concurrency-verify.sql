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
  entrant_count integer;
  foxtrot_status text;
  golf_count integer;
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
  select row.state->>'status',jsonb_array_length(row.state->'participants')
    into event_status,entrant_count from public.events row where row.id=event_id;
  select row.is_open,row.roster_locked_at into signup_open,roster_locked from public.signup_events row where row.id=signup_id;
  select row.status into foxtrot_status from public.signup_registrations row where row.signup_event_id=signup_id and row.player_one='Foxtrot';
  select count(*) into golf_count from public.signup_registrations row where row.signup_event_id=signup_id and row.player_one='Golf';
  select count(*) filter(where row.status='confirmed'),count(*) filter(where row.status='waitlisted')
    into confirmed_count,waiting_count from public.signup_registrations row where row.signup_event_id=signup_id;

  if event_status<>'round-in-progress' or entrant_count<>4 or signup_open or roster_locked is null then
    raise exception 'Start-first winner did not atomically start/freeze the four-player roster';
  end if;
  if foxtrot_status<>'waitlisted' or golf_count<>0 or confirmed_count<>4 or waiting_count<>1 then
    raise exception 'Both winner outcomes were not preserved: expected Foxtrot wait-listed and later Golf rejected';
  end if;
end;
$$;

select 'Americano separate-connection start/signup race passed in both winner orders; roster closed atomically' as result;
