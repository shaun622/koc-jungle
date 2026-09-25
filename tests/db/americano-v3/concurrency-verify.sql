\set ON_ERROR_STOP on

do $$
declare
  race jsonb := (select payload from public.americano_test_concurrency_payloads where name='v3-start-race');
  signup_id uuid;
  event_id uuid;
  event_status text;
  signup_open boolean;
  roster_locked timestamptz;
  confirmed_count integer;
  waiting_count integer;
  entrant_count integer;
  waitlist_status text;
  golf_count integer;
begin
  if current_database() not like 'koc_americano_test_%' then
    raise exception 'Refusing Americano v3 concurrency verification outside an isolated database';
  end if;

  signup_id := (race->>'signupId')::uuid;
  event_id := (race->>'eventId')::uuid;
  select row.state->>'status',jsonb_array_length(row.state->'participants')
    into event_status,entrant_count from public.events row where row.id=event_id;
  select row.is_open,row.roster_locked_at into signup_open,roster_locked
    from public.signup_events row where row.id=signup_id;
  select row.status into waitlist_status from public.signup_registrations row
    where row.signup_event_id=signup_id and row.player_one='V3 Waitlist';
  select count(*) into golf_count from public.signup_registrations row
    where row.signup_event_id=signup_id and row.player_one='V3 Golf';
  select count(*) filter(where row.status='confirmed'),count(*) filter(where row.status='waitlisted')
    into confirmed_count,waiting_count from public.signup_registrations row where row.signup_event_id=signup_id;

  if event_status<>'round-in-progress' or entrant_count<>4 or signup_open or roster_locked is null then
    raise exception 'V3 Start-first winner did not atomically start/freeze the four-player roster';
  end if;
  if waitlist_status<>'waitlisted' or golf_count<>0 or confirmed_count<>4 or waiting_count<>1 then
    raise exception 'V3 race winner outcomes differ: expected V3 Waitlist retained and later V3 Golf rejected';
  end if;
end;
$$;

select 'Americano v3 separate-connection start/signup race passed in both winner orders; roster closed atomically' as result;
