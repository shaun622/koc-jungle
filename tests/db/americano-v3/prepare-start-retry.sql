\set ON_ERROR_STOP on

-- Refresh the confirmed four-player preview after a wait-listed fifth public
-- registration changed signup revision but not canonical roster membership.
do $$
declare
  original jsonb := (select payload from public.americano_test_concurrency_payloads where name='v3-start-race');
  event_row public.events%rowtype;
  signup public.signup_events%rowtype;
  next_state jsonb;
  schedule jsonb;
  fingerprint text;
begin
  if current_database() not like 'koc_americano_test_%' then
    raise exception 'Refusing refreshed v3 Start setup outside an isolated database';
  end if;
  select * into event_row from public.events where id=(original->>'eventId')::uuid;
  select * into signup from public.signup_events where id=(original->>'signupId')::uuid;
  if event_row.id is null or event_row.state->>'schemaVersion'<>'3' or event_row.state->>'status'<>'setup'
    or not signup.is_open or signup.roster_locked_at is not null then
    raise exception 'V3 signup-first result was not left safely in setup/open state';
  end if;
  if (select count(*) from public.signup_registrations where signup_event_id=signup.id and status='confirmed')<>4
     or (select count(*) from public.signup_registrations where signup_event_id=signup.id and status='waitlisted')<>1 then
    raise exception 'V3 signup-first result did not retain four confirmed entrants and one waiter';
  end if;
  next_state:=event_row.state;
  next_state:=jsonb_set(next_state,'{status}','"round-in-progress"'::jsonb,true);
  schedule:=original#>'{startState,americanoSchedule}';
  schedule:=jsonb_set(schedule,'{rosterRevision}',to_jsonb(signup.roster_revision::text),true);
  schedule:=jsonb_set(schedule,'{inputFingerprint}','"pending"'::jsonb,true);
  schedule:=jsonb_set(schedule,'{acknowledgements,fingerprint}','"pending"'::jsonb,true);
  next_state:=jsonb_set(next_state,'{americanoSchedule}',schedule,true);
  next_state:=jsonb_set(next_state,'{rounds}',original#>'{startState,rounds}',true);
  fingerprint:=public.americano_v3_schedule_fingerprint(next_state);
  if fingerprint is null then raise exception 'Could not compute refreshed v3 Start fingerprint'; end if;
  next_state:=jsonb_set(next_state,'{americanoSchedule,inputFingerprint}',to_jsonb(fingerprint),true);
  next_state:=jsonb_set(next_state,'{americanoSchedule,acknowledgements,fingerprint}',to_jsonb(fingerprint),true);
  if public.americano_v3_state_error(next_state) is not null then raise exception 'Refreshed v3 Start state failed validation: %',public.americano_v3_state_error(next_state); end if;
  insert into public.americano_test_concurrency_payloads(name,payload)
    values('v3-start-race-ready',jsonb_build_object('eventId',event_row.id::text,'eventRevision',event_row.revision,
      'signupId',signup.id::text,'capacityRevision',signup.capacity_revision,'rosterRevision',signup.roster_revision,'startState',next_state));
end;
$$;

select 'Refreshed Americano v3 Start preview prepared after signup-first winner' as result;
