\set ON_ERROR_STOP on

-- Exercise version-aware owner workflows only with the synthetic v3 signup
-- fixture created by public-signup.sql and the isolated local test owner.
select set_config('request.jwt.claim.sub','cccccccc-cccc-4ccc-8ccc-cccccccccccc',false);
select set_config('request.jwt.claim.role','authenticated',false);

do $$
declare
  v3_id uuid:='99999999-9999-4999-8999-999999999901';
  v2_id uuid:='99999999-9999-4999-8999-999999999931';
  event_row public.events%rowtype; signup_row public.signup_events%rowtype;
  reply jsonb; config jsonb; courts jsonb; v2_state jsonb; v3_state jsonb; request_id uuid;
  entrant_ids text[]; court_ids text[]; schedule jsonb; metrics jsonb; start_state jsonb; live_round jsonb; fingerprint text;
begin
  select * into event_row from public.events where id=v3_id and user_id=auth.uid();
  select * into signup_row from public.signup_events where source_event_uuid=v3_id and owner_user_id=auth.uid();
  if event_row.id is null or signup_row.id is null then raise exception 'Expected the linked v3 public-signup fixture.'; end if;

  -- Updating schema-3 courts grows linked capacity and keeps the event format.
  courts:=event_row.state->'courts'||jsonb_build_array(jsonb_build_object(
    'id','99999999-9999-4999-8999-999999999906','name','Court 2','position',2,'pointValue',1));
  config:=event_row.state->'formatConfig';
  request_id:='99999999-9999-4999-8999-999999999915';
  reply:=public.organizer_save_americano_config_v3(v3_id,event_row.revision,signup_row.id,signup_row.capacity_revision,
    signup_row.roster_revision,request_id,courts,config);
  if reply->>'status'<>'applied' then raise exception 'v3 config/capacity update failed: %',reply; end if;
  reply:=public.organizer_save_americano_config_v3(v3_id,event_row.revision,signup_row.id,signup_row.capacity_revision,
    signup_row.roster_revision,request_id,courts,config);
  if reply->>'status'<>'replayed' then raise exception 'v3 config request did not replay idempotently: %',reply; end if;

  -- A schema-2 client cannot overwrite or reconfigure the schema-3 record.
  select * into event_row from public.events where id=v3_id and user_id=auth.uid();
  reply:=public.organizer_save_event_v2(v3_id,event_row.revision,'99999999-9999-4999-8999-999999999916',
    jsonb_build_object('schemaVersion',2,'protocolVersion',2,'id',v3_id::text));
  if reply->>'status'<>'rejected' or reply->>'code'<>'UPDATE_REQUIRED' then raise exception 'v2 full-state writer did not protect schema 3: %',reply; end if;
  reply:=public.organizer_save_americano_config_v2(v3_id,event_row.revision,signup_row.id,signup_row.capacity_revision,
    signup_row.roster_revision,'99999999-9999-4999-8999-999999999917','[]'::jsonb,
    '{"rulesVersion":2,"pairingMode":"rotating","pointsPerMatch":24,"scheduleKind":"full","paceMinutes":10,"paceClockEnabled":false}'::jsonb);
  if reply->>'status'<>'rejected' or reply->>'code'<>'UPDATE_REQUIRED' then raise exception 'v2 config writer did not protect schema 3: %',reply; end if;
  reply:=public.organizer_start_americano_v2(v3_id,event_row.revision,signup_row.id,signup_row.capacity_revision,
    signup_row.roster_revision,'99999999-9999-4999-8999-999999999918',jsonb_build_object('schemaVersion',2,'protocolVersion',2));
  if reply->>'status'<>'rejected' or reply->>'code'<>'UPDATE_REQUIRED' then raise exception 'v2 start writer did not protect schema 3: %',reply; end if;

  -- Create a valid schema-2 event owned by this fixture user, then prove a v3
  -- writer cannot reuse that UUID for a different wire schema.
  v2_state:=jsonb_build_object(
    'schemaVersion',2,'protocolVersion',2,'revision','0','id',v2_id::text,'name','Synthetic schema two','format','americano',
    'createdAt',1790340000000,'status','setup','settings',jsonb_build_object('roundsTotal',0,'defaultRoundDurationMs',600000,
      'tieRule','split-points','soundOnTimerEnd',false,'warningAtMs',60000,'announceRoundStart',false,'qualifierEnabled',false),
    'courts',jsonb_build_array(jsonb_build_object('id','99999999-9999-4999-8999-999999999932','name','Court 1','position',1,'pointValue',1)),
    'teams','[]'::jsonb,'participants','[]'::jsonb,'rounds','[]'::jsonb,
    'formatConfig','{"rulesVersion":2,"pairingMode":"rotating","pointsPerMatch":24,"scheduleKind":"full","paceMinutes":10,"paceClockEnabled":false}'::jsonb
  );
  reply:=public.organizer_save_event_v2(v2_id,0,'99999999-9999-4999-8999-999999999933',v2_state);
  if reply->>'status'<>'applied' then raise exception 'could not create isolated schema-2 version-guard fixture: %',reply; end if;
  v3_state:=jsonb_build_object(
    'schemaVersion',3,'protocolVersion',2,'revision','0','id',v2_id::text,'name','Wrong-version attempt','format','americano',
    'createdAt',1790340000000,'status','setup','settings','{}'::jsonb,'courts',
    jsonb_build_array(jsonb_build_object('id','99999999-9999-4999-8999-999999999932','name','Court 1','position',1,'pointValue',1)),
    'teams','[]'::jsonb,'participants','[]'::jsonb,'rounds','[]'::jsonb,
    'formatConfig','{"rulesVersion":3,"pairingMode":"rotating","scoring":{"kind":"rally","pointsPerMatch":24},"ranking":{"tiebreak":"shared","championship":"none"},"scheduleKind":"full","paceMinutes":10,"paceClockEnabled":false}'::jsonb
  );
  reply:=public.organizer_save_event_v3(v2_id,1,'99999999-9999-4999-8999-999999999934',v3_state);
  if reply->>'status'<>'rejected' or reply->>'code'<>'UPDATE_REQUIRED' then raise exception 'v3 writer reused a schema-2 event id: %',reply; end if;

  -- Admit three more synthetic entrants to the v3 page. With two courts there
  -- is spare capacity for a fifth registration during the later start race.
  reply:=public.register_public_player_v2('americano-v3-contract',signup_row.event_slug,'Second Player','second-v3@example.invalid','99999999-9999-4999-8999-999999999910');
  if reply->>'status'<>'applied' then raise exception 'second synthetic public entry failed: %',reply; end if;
  reply:=public.register_public_player_v2('americano-v3-contract',signup_row.event_slug,'Third Player','third-v3@example.invalid','99999999-9999-4999-8999-999999999911');
  if reply->>'status'<>'applied' then raise exception 'third synthetic public entry failed: %',reply; end if;
  reply:=public.register_public_player_v2('americano-v3-contract',signup_row.event_slug,'Fourth Player','fourth-v3@example.invalid','99999999-9999-4999-8999-999999999912');
  if reply->>'status'<>'applied' then raise exception 'fourth synthetic public entry failed: %',reply; end if;

  -- Fill the original one-court capacity so the concurrent fifth entry is a
  -- wait-listed roster change, then build a fully valid four-player v3 start.
  select * into event_row from public.events where id=v3_id and user_id=auth.uid();
  select * into signup_row from public.signup_events where source_event_uuid=v3_id and owner_user_id=auth.uid();
  courts:=jsonb_build_array(event_row.state->'courts'->0);
  reply:=public.organizer_save_americano_config_v3(v3_id,event_row.revision,signup_row.id,signup_row.capacity_revision,
    signup_row.roster_revision,'99999999-9999-4999-8999-999999999935',courts,event_row.state->'formatConfig');
  if reply->>'status'<>'applied' then raise exception 'could not restore full four-player capacity: %',reply; end if;
  select * into event_row from public.events where id=v3_id and user_id=auth.uid();
  select * into signup_row from public.signup_events where source_event_uuid=v3_id and owner_user_id=auth.uid();
  select array_agg(registration.canonical_entrant_id::text order by registration.organizer_rank nulls last,registration.created_at,registration.id)
    into entrant_ids from public.signup_registrations registration where registration.signup_event_id=signup_row.id and registration.status='confirmed';
  select array_agg(court->>'id' order by ordinal) into court_ids from jsonb_array_elements(event_row.state->'courts') with ordinality court_rows(court,ordinal);
  if cardinality(entrant_ids)<>4 or cardinality(court_ids)<>1 then raise exception 'Unexpected v3 start-race fixture roster/courts'; end if;
  if (select array_agg(participant->>'id' order by ordinal) from jsonb_array_elements(event_row.state->'participants') with ordinality participant_rows(participant,ordinal)) is distinct from entrant_ids then
    raise exception 'v3 start-race fixture event projection differs from canonical signup order'; end if;

  metrics:=jsonb_build_object(
    'appearances',jsonb_build_object(entrant_ids[1],3,entrant_ids[2],3,entrant_ids[3],3,entrant_ids[4],3),
    'rests',jsonb_build_object(entrant_ids[1],0,entrant_ids[2],0,entrant_ids[3],0,entrant_ids[4],0),
    'uniquePartners',jsonb_build_object(entrant_ids[1],3,entrant_ids[2],3,entrant_ids[3],3,entrant_ids[4],3),
    'uniqueOpponents',jsonb_build_object(entrant_ids[1],3,entrant_ids[2],3,entrant_ids[3],3,entrant_ids[4],3),
    'minimumPartnerFrequency',1,'maximumPartnerFrequency',1,'minimumOpponentFrequency',2,'maximumOpponentFrequency',2,
    'repeatedCompleteMatchups',0,'appearancesEqual',true,'maximumAppearanceSpread',0);
  schedule:=jsonb_build_object(
    'id','99999999-9999-4999-8999-999999999960','fingerprintVersion',3,'algorithmVersion','americano-v2.1','seed',42,
    'inputFingerprint','pending','orderedEntrantIds',to_jsonb(entrant_ids),'courtIds',to_jsonb(court_ids),'metrics',metrics,
    'acknowledgements',jsonb_build_object('fingerprint','pending','unevenAppearances',false,'repeatedCycle',false),
    'rosterRevision',signup_row.roster_revision::text,
    'rounds',jsonb_build_array(
      jsonb_build_object('id','99999999-9999-4999-8999-999999999961','index',1,'matches',jsonb_build_array(jsonb_build_object(
        'id','99999999-9999-4999-8999-999999999971','courtId',court_ids[1],
        'sideA',jsonb_build_object('kind','rotating-pair','playerIds',jsonb_build_array(entrant_ids[1],entrant_ids[2])),
        'sideB',jsonb_build_object('kind','rotating-pair','playerIds',jsonb_build_array(entrant_ids[3],entrant_ids[4])))),
        'restingEntrantIds','[]'::jsonb,'unusedCourtIds','[]'::jsonb),
      jsonb_build_object('id','99999999-9999-4999-8999-999999999962','index',2,'matches',jsonb_build_array(jsonb_build_object(
        'id','99999999-9999-4999-8999-999999999972','courtId',court_ids[1],
        'sideA',jsonb_build_object('kind','rotating-pair','playerIds',jsonb_build_array(entrant_ids[1],entrant_ids[3])),
        'sideB',jsonb_build_object('kind','rotating-pair','playerIds',jsonb_build_array(entrant_ids[2],entrant_ids[4])))),
        'restingEntrantIds','[]'::jsonb,'unusedCourtIds','[]'::jsonb),
      jsonb_build_object('id','99999999-9999-4999-8999-999999999963','index',3,'matches',jsonb_build_array(jsonb_build_object(
        'id','99999999-9999-4999-8999-999999999973','courtId',court_ids[1],
        'sideA',jsonb_build_object('kind','rotating-pair','playerIds',jsonb_build_array(entrant_ids[1],entrant_ids[4])),
        'sideB',jsonb_build_object('kind','rotating-pair','playerIds',jsonb_build_array(entrant_ids[2],entrant_ids[3])))),
        'restingEntrantIds','[]'::jsonb,'unusedCourtIds','[]'::jsonb)
    ));
  start_state:=jsonb_set(jsonb_set(event_row.state,'{status}','"round-in-progress"'::jsonb,true),'{americanoSchedule}',schedule,true);
  fingerprint:=public.americano_v3_schedule_fingerprint(start_state);
  schedule:=jsonb_set(jsonb_set(schedule,'{inputFingerprint}',to_jsonb(fingerprint),true),'{acknowledgements,fingerprint}',to_jsonb(fingerprint),true);
  start_state:=jsonb_set(start_state,'{americanoSchedule}',schedule,true);
  live_round:=jsonb_build_object('id','99999999-9999-4999-8999-999999999961','index',1,'fixtureRoundId','99999999-9999-4999-8999-999999999961',
    'durationMs',600000,'totalPausedMs',0,'matches',jsonb_build_array(jsonb_build_object(
      'id','99999999-9999-4999-8999-999999999981','courtId',court_ids[1],
      'sideA',schedule#>'{rounds,0,matches,0,sideA}','sideB',schedule#>'{rounds,0,matches,0,sideB}',
      'result',jsonb_build_object('kind','rally','scoreA',null,'scoreB',null),'resultConfirmed',false)));
  start_state:=jsonb_set(start_state,'{rounds}',jsonb_build_array(live_round),true);
  if public.americano_v3_state_error(start_state) is not null then raise exception 'v3 concurrent Start fixture failed state validation: %',public.americano_v3_state_error(start_state); end if;
  insert into public.americano_test_concurrency_payloads(name,payload) values('v3-start-race',jsonb_build_object(
    'accountSlug',signup_row.account_slug,'eventSlug',signup_row.event_slug,'eventId',v3_id::text,'signupId',signup_row.id::text,
    'eventRevision',event_row.revision,'capacityRevision',signup_row.capacity_revision,'rosterRevision',signup_row.roster_revision,'startState',start_state));

  insert into public.americano_test_concurrency_payloads(name,payload) values('v3-save-race',jsonb_build_object(
    'eventId',v3_id::text,'eventRevision',event_row.revision,'state',event_row.state
  ));
end;
$$;

select 'Americano v3 owner RPC and version guard contract passed' as result;
