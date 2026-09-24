\set ON_ERROR_STOP on

drop table if exists public.americano_test_concurrency_payloads;
create table public.americano_test_concurrency_payloads (
  name text primary key,
  payload jsonb not null
);

do $$
declare
  owner_id constant uuid := 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
  event_id uuid;
  court_id uuid;
  request_id uuid;
  state jsonb;
  reply jsonb;
  signup_id uuid;
  event_revision bigint;
  capacity_revision bigint;
  roster_revision bigint;
  entrant_ids text[];
  schedule jsonb;
  start_state jsonb;
  computed_fingerprint text;
begin
  if current_database() not like 'koc_americano_test_%' then
    raise exception 'Refusing Americano concurrency setup outside an isolated database';
  end if;

  insert into auth.users(id,email) values(owner_id,'race-owner@example.invalid');
  perform set_config('request.jwt.claim.sub',owner_id::text,true);
  perform set_config('request.jwt.claim.role','authenticated',true);

  -- A18: three of four rotating-player slots are populated before two
  -- independent clients race for the final slot.
  event_id := '22222222-2222-4222-8222-222222222222';
  court_id := '23333333-3333-4333-8333-333333333333';
  state := jsonb_build_object(
    'schemaVersion',2,'protocolVersion',2,'revision','0','id',event_id::text,'name','Last slot race',
    'venue','Isolated Court','createdAt',1700000000000,'status','setup',
    'settings',jsonb_build_object('defaultRoundDurationMs',600000,'tieRule','split-points','soundOnTimerEnd',false,
      'warningAtMs',60000,'roundsTotal',0,'announceRoundStart',false,'qualifierEnabled',false),
    'courts',jsonb_build_array(jsonb_build_object('id',court_id,'position',1,'name','Court 1','pointValue',1)),
    'teams','[]'::jsonb,
    'participants',jsonb_build_array(
      jsonb_build_object('id','24444444-4444-4444-8444-444444444441','name','Alpha','active',true,'createdAt',1),
      jsonb_build_object('id','24444444-4444-4444-8444-444444444442','name','Bravo','active',true,'createdAt',2),
      jsonb_build_object('id','24444444-4444-4444-8444-444444444443','name','Charlie','active',true,'createdAt',3)
    ),
    'rounds','[]'::jsonb,'format','americano',
    'formatConfig',jsonb_build_object('rulesVersion',2,'pairingMode','rotating','pointsPerMatch',24,
      'scheduleKind','full','paceMinutes',10,'paceClockEnabled',false)
  );
  reply := public.organizer_save_event_v2(event_id,0,'61111111-1111-4111-8111-111111111111',state);
  if reply->>'status'<>'applied' then raise exception 'Last-slot event save failed: %',reply; end if;
  reply := public.organizer_save_signup_event_v3(event_id,1,null,0,0,'61111111-1111-4111-8111-111111111112',
    jsonb_build_object('accountSlug','race-owner','title','Last slot race','venue','Isolated Court','startsAt',null,'endsAt',null,
      'details','Synthetic only','prizes','','timeZone','Asia/Singapore','organizerName','Race Owner',
      'publicContactMethod',null,'publicContactValue',null),
    jsonb_build_array(
      jsonb_build_object('localEntrantId','24444444-4444-4444-8444-444444444441','playerOne','Alpha','contact','alpha@example.invalid','rank',1),
      jsonb_build_object('localEntrantId','24444444-4444-4444-8444-444444444442','playerOne','Bravo','contact','bravo@example.invalid','rank',2),
      jsonb_build_object('localEntrantId','24444444-4444-4444-8444-444444444443','playerOne','Charlie','contact','charlie@example.invalid','rank',3)
    ));
  if reply->>'status'<>'applied' then raise exception 'Last-slot signup publication failed: %',reply; end if;
  insert into public.americano_test_concurrency_payloads(name,payload) values('last-slot',jsonb_build_object(
    'accountSlug',reply#>>'{snapshot,signup,accountSlug}','eventSlug',reply#>>'{snapshot,signup,eventSlug}',
    'eventId',event_id::text,'signupId',reply#>>'{snapshot,signup,id}'
  ));

  -- A22: a full rotating field has an acknowledged candidate start state while
  -- a new public registration races that exact roster revision.
  event_id := '42222222-2222-4222-8222-222222222222';
  court_id := '43333333-3333-4333-8333-333333333333';
  state := jsonb_build_object(
    'schemaVersion',2,'protocolVersion',2,'revision','0','id',event_id::text,'name','Start signup race',
    'venue','Isolated Court','createdAt',1700000000000,'status','setup',
    'settings',jsonb_build_object('defaultRoundDurationMs',600000,'tieRule','split-points','soundOnTimerEnd',false,
      'warningAtMs',60000,'roundsTotal',0,'announceRoundStart',false,'qualifierEnabled',false),
    'courts',jsonb_build_array(jsonb_build_object('id',court_id,'position',1,'name','Court 1','pointValue',1)),
    'teams','[]'::jsonb,
    'participants',jsonb_build_array(
      jsonb_build_object('id','44444444-4444-4444-8444-444444444441','name','One','active',true,'createdAt',1),
      jsonb_build_object('id','44444444-4444-4444-8444-444444444442','name','Two','active',true,'createdAt',2),
      jsonb_build_object('id','44444444-4444-4444-8444-444444444443','name','Three','active',true,'createdAt',3),
      jsonb_build_object('id','44444444-4444-4444-8444-444444444444','name','Four','active',true,'createdAt',4)
    ),
    'rounds','[]'::jsonb,'format','americano',
    'formatConfig',jsonb_build_object('rulesVersion',2,'pairingMode','rotating','pointsPerMatch',24,
      'scheduleKind','full','paceMinutes',10,'paceClockEnabled',false)
  );
  reply := public.organizer_save_event_v2(event_id,0,'62222222-2222-4222-8222-222222222221',state);
  if reply->>'status'<>'applied' then raise exception 'Start-race event save failed: %',reply; end if;
  reply := public.organizer_save_signup_event_v3(event_id,1,null,0,0,'62222222-2222-4222-8222-222222222222',
    jsonb_build_object('accountSlug','race-owner','title','Start signup race','venue','Isolated Court','startsAt',null,'endsAt',null,
      'details','Synthetic only','prizes','','timeZone','Asia/Singapore','organizerName','Race Owner',
      'publicContactMethod',null,'publicContactValue',null),
    jsonb_build_array(
      jsonb_build_object('localEntrantId','44444444-4444-4444-8444-444444444441','playerOne','One','contact','one@example.invalid','rank',1),
      jsonb_build_object('localEntrantId','44444444-4444-4444-8444-444444444442','playerOne','Two','contact','two@example.invalid','rank',2),
      jsonb_build_object('localEntrantId','44444444-4444-4444-8444-444444444443','playerOne','Three','contact','three@example.invalid','rank',3),
      jsonb_build_object('localEntrantId','44444444-4444-4444-8444-444444444444','playerOne','Four','contact','four@example.invalid','rank',4)
    ));
  if reply->>'status'<>'applied' then raise exception 'Start-race signup publication failed: %',reply; end if;
  signup_id := (reply#>>'{snapshot,signup,id}')::uuid;
  select row.revision,row.state into event_revision,state from public.events row where row.id=event_id;
  select row.capacity_revision,row.roster_revision into capacity_revision,roster_revision from public.signup_events row where row.id=signup_id;
  select array_agg(row.canonical_entrant_id::text order by row.organizer_rank nulls last,row.created_at,row.id)
    into entrant_ids from public.signup_registrations row where row.signup_event_id=signup_id and row.status='confirmed';
  schedule := jsonb_build_object(
    'id','start-race-schedule','algorithmVersion','americano-v2.1','seed',42,'inputFingerprint','pending',
    'orderedEntrantIds',to_jsonb(entrant_ids),'courtIds',jsonb_build_array(court_id),
    'rounds',jsonb_build_array(
      jsonb_build_object('id','race-fixture-round-1','index',1,'matches',jsonb_build_array(jsonb_build_object('id','race-fixture-1','courtId',court_id,
        'sideA',jsonb_build_object('kind','rotating-pair','playerIds',jsonb_build_array(entrant_ids[1],entrant_ids[2])),
        'sideB',jsonb_build_object('kind','rotating-pair','playerIds',jsonb_build_array(entrant_ids[3],entrant_ids[4])))),'restingEntrantIds','[]'::jsonb,'unusedCourtIds','[]'::jsonb),
      jsonb_build_object('id','race-fixture-round-2','index',2,'matches',jsonb_build_array(jsonb_build_object('id','race-fixture-2','courtId',court_id,
        'sideA',jsonb_build_object('kind','rotating-pair','playerIds',jsonb_build_array(entrant_ids[1],entrant_ids[3])),
        'sideB',jsonb_build_object('kind','rotating-pair','playerIds',jsonb_build_array(entrant_ids[2],entrant_ids[4])))),'restingEntrantIds','[]'::jsonb,'unusedCourtIds','[]'::jsonb),
      jsonb_build_object('id','race-fixture-round-3','index',3,'matches',jsonb_build_array(jsonb_build_object('id','race-fixture-3','courtId',court_id,
        'sideA',jsonb_build_object('kind','rotating-pair','playerIds',jsonb_build_array(entrant_ids[1],entrant_ids[4])),
        'sideB',jsonb_build_object('kind','rotating-pair','playerIds',jsonb_build_array(entrant_ids[2],entrant_ids[3])))),'restingEntrantIds','[]'::jsonb,'unusedCourtIds','[]'::jsonb)
    ),
    'metrics',jsonb_build_object(
      'appearances',jsonb_build_object(entrant_ids[1],3,entrant_ids[2],3,entrant_ids[3],3,entrant_ids[4],3),
      'rests',jsonb_build_object(entrant_ids[1],0,entrant_ids[2],0,entrant_ids[3],0,entrant_ids[4],0),
      'uniquePartners',jsonb_build_object(entrant_ids[1],3,entrant_ids[2],3,entrant_ids[3],3,entrant_ids[4],3),
      'uniqueOpponents',jsonb_build_object(entrant_ids[1],3,entrant_ids[2],3,entrant_ids[3],3,entrant_ids[4],3),
      'minimumPartnerFrequency',1,'maximumPartnerFrequency',1,'minimumOpponentFrequency',2,'maximumOpponentFrequency',2,
      'repeatedCompleteMatchups',0,'appearancesEqual',true,'maximumAppearanceSpread',0),
    'acknowledgements',jsonb_build_object('fingerprint','pending','unevenAppearances',false,'repeatedCycle',false),
    'rosterRevision',roster_revision::text
  );
  start_state := jsonb_set(jsonb_set(state,'{status}','"round-in-progress"'::jsonb,true),'{americanoSchedule}',schedule,true);
  computed_fingerprint := public.americano_v2_schedule_fingerprint(start_state);
  schedule := jsonb_set(jsonb_set(schedule,'{inputFingerprint}',to_jsonb(computed_fingerprint),true),'{acknowledgements,fingerprint}',to_jsonb(computed_fingerprint),true);
  start_state := jsonb_set(start_state,'{americanoSchedule}',schedule,true);
  start_state := jsonb_set(start_state,'{rounds}',jsonb_build_array(jsonb_build_object(
    'id','race-live-round-1','index',1,'fixtureRoundId','race-fixture-round-1','totalPausedMs',0,'durationMs',600000,
    'matches',jsonb_build_array(jsonb_build_object('id','race-live-match-1','courtId',court_id,
      'sideA',schedule#>'{rounds,0,matches,0,sideA}','sideB',schedule#>'{rounds,0,matches,0,sideB}',
      'scoreA',null,'scoreB',null,'resultConfirmed',false))
  )),true);
  insert into public.americano_test_concurrency_payloads(name,payload) values('start-race',jsonb_build_object(
    'accountSlug',reply#>>'{snapshot,signup,accountSlug}','eventSlug',reply#>>'{snapshot,signup,eventSlug}',
    'eventId',event_id::text,'signupId',signup_id::text,'eventRevision',event_revision,
    'capacityRevision',capacity_revision,'rosterRevision',roster_revision,'startState',start_state
  ));
end;
$$;

select 'Americano v2 concurrency fixtures prepared' as result;
