\set ON_ERROR_STOP on

begin;

do $$
declare
  owner_id constant uuid := 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  other_id constant uuid := 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
  event_id constant uuid := '11111111-1111-4111-8111-111111111111';
  legacy_id constant uuid := '99999999-9999-4999-8999-999999999999';
  request_save constant uuid := '10000000-0000-4000-8000-000000000001';
  request_publish constant uuid := '10000000-0000-4000-8000-000000000002';
  request_fourth constant uuid := '10000000-0000-4000-8000-000000000003';
  request_fifth constant uuid := '10000000-0000-4000-8000-000000000004';
  request_duplicate constant uuid := '10000000-0000-4000-8000-000000000005';
  request_mutate constant uuid := '10000000-0000-4000-8000-000000000006';
  request_start constant uuid := '10000000-0000-4000-8000-000000000007';
  request_delete constant uuid := '10000000-0000-4000-8000-000000000008';
  state jsonb;
  next_state jsonb;
  schedule jsonb;
  reply jsonb;
  public_snapshot jsonb;
  signup_id uuid;
  first_registration public.signup_registrations%rowtype;
  event_revision bigint;
  capacity_revision bigint;
  roster_revision bigint;
  entrant_ids text[];
  court_id text := '21111111-1111-4111-8111-111111111111';
  computed_fingerprint text;
  guard_failed boolean := false;
begin
  if current_database() not like 'koc_americano_test_%' then
    raise exception 'Refusing Americano contract tests outside an isolated database';
  end if;
  insert into auth.users(id,email) values(owner_id,'owner@example.invalid'),(other_id,'other@example.invalid');
  perform set_config('request.jwt.claim.sub',owner_id::text,true);
  perform set_config('request.jwt.claim.role','authenticated',true);

  if (select expected.event_state from public.americano_test_legacy_expected expected) is distinct from
      (select legacy.state from public.events legacy where legacy.id='88888888-8888-4888-8888-888888888888')
     or (select expected.friendly_slug from public.americano_test_legacy_expected expected) is distinct from
      (select legacy.friendly_slug from public.signup_events legacy where legacy.id='77777777-7777-4777-8777-777777777777')
     or (select expected.event_slug from public.americano_test_legacy_expected expected) is distinct from
      (select legacy.event_slug from public.signup_events legacy where legacy.id='77777777-7777-4777-8777-777777777777')
     or (select expected.capacity_teams from public.americano_test_legacy_expected expected) is distinct from
      (select legacy.capacity_teams from public.signup_events legacy where legacy.id='77777777-7777-4777-8777-777777777777')
     or (select expected.registrations from public.americano_test_legacy_expected expected) is distinct from
      (select jsonb_agg(jsonb_build_object('id',legacy.id,'status',legacy.status,'team',legacy.team_name,'one',legacy.player_one,'two',legacy.player_two) order by legacy.id)
        from public.signup_registrations legacy where legacy.signup_event_id='77777777-7777-4777-8777-777777777777') then
    raise exception 'Americano migrations changed the populated legacy fixture';
  end if;

  insert into public.events(id,user_id,state) values(legacy_id,owner_id,jsonb_build_object(
    'id',legacy_id::text,'name','Legacy fixture','createdAt',1,'status','setup','settings','{}'::jsonb,
    'courts','[]'::jsonb,'teams','[]'::jsonb,'rounds','[]'::jsonb,'format','king-of-the-court'
  ));
  if (select protocol_version from public.events where id=legacy_id)<>1 or (select revision from public.events where id=legacy_id)<>0 then
    raise exception 'Legacy defaults changed';
  end if;

  state := jsonb_build_object(
    'schemaVersion',2,'protocolVersion',2,'revision','0','id',event_id::text,'name','Synthetic rotating Americano',
    'venue','Test Court','createdAt',1700000000000,'status','setup',
    'settings',jsonb_build_object('defaultRoundDurationMs',600000,'tieRule','split-points','soundOnTimerEnd',false,
      'warningAtMs',60000,'roundsTotal',0,'announceRoundStart',false,'qualifierEnabled',false),
    'courts',jsonb_build_array(jsonb_build_object('id',court_id,'position',1,'name','Court 1','pointValue',1)),
    'teams','[]'::jsonb,
    'participants',jsonb_build_array(
      jsonb_build_object('id','31111111-1111-4111-8111-111111111111','name','Alpha','active',true,'createdAt',1),
      jsonb_build_object('id','31111111-1111-4111-8111-111111111112','name','Bravo','active',true,'createdAt',2),
      jsonb_build_object('id','31111111-1111-4111-8111-111111111113','name','Charlie','active',true,'createdAt',3)
    ),
    'rounds','[]'::jsonb,'format','americano',
    'formatConfig',jsonb_build_object('rulesVersion',2,'pairingMode','rotating','pointsPerMatch',24,
      'scheduleKind','full','paceMinutes',10,'paceClockEnabled',false)
  );

  begin
    insert into public.events(id,user_id,state,protocol_version,revision) values(event_id,owner_id,state,2,0);
  exception when others then guard_failed := true; end;
  if not guard_failed or exists(select 1 from public.events where id=event_id) then raise exception 'Direct protocol-2 insert bypassed the guard'; end if;

  reply := public.organizer_save_event_v2(event_id,0,request_save,state);
  if reply->>'status'<>'applied' or reply#>>'{snapshot,event,revision}'<>'1' then raise exception 'Initial v2 save failed: %',reply; end if;
  reply := public.organizer_save_event_v2(event_id,0,request_save,state);
  if reply->>'status'<>'replayed' or reply->>'committedEventRevision'<>'1' then raise exception 'Save replay failed: %',reply; end if;
  reply := public.organizer_save_event_v2(event_id,0,request_save,jsonb_set(state,'{name}','"Different"'::jsonb));
  if reply#>>'{code}'<>'IDEMPOTENCY_MISMATCH' then raise exception 'Idempotency mismatch was not detected'; end if;

  reply := public.organizer_save_signup_event_v3(event_id,1,null,0,0,request_publish,
    jsonb_build_object('accountSlug','test-owner','title','Synthetic rotating Americano','venue','Test Court',
      'startsAt',null,'endsAt',null,'details','Synthetic only','prizes','','timeZone','Asia/Singapore',
      'organizerName','Test Owner','publicContactMethod',null,'publicContactValue',null),
    jsonb_build_array(
      jsonb_build_object('localEntrantId','31111111-1111-4111-8111-111111111111','playerOne','Alpha','contact','alpha@example.invalid','rank',1),
      jsonb_build_object('localEntrantId','31111111-1111-4111-8111-111111111112','playerOne','Bravo','contact','bravo@example.invalid','rank',2),
      jsonb_build_object('localEntrantId','31111111-1111-4111-8111-111111111113','playerOne','Charlie','contact','charlie@example.invalid','rank',3)
    ));
  if reply->>'status'<>'applied' or reply#>>'{snapshot,signup,entryMode}'<>'individual' then raise exception 'First publication failed: %',reply; end if;
  signup_id := (reply#>>'{snapshot,signup,id}')::uuid;
  if reply#>>'{snapshot,signup,capacity,unit}'<>'players' or reply#>>'{snapshot,signup,capacity,value}'<>'4' then raise exception 'Player capacity was not derived from courts'; end if;

  public_snapshot:=public.get_public_signup_v3('test-owner',(reply#>>'{snapshot,signup,eventSlug}'));
  if public_snapshot#>>'{event,protocolVersion}'<>'2' or public_snapshot#>>'{event,capacity,unit}'<>'players' then raise exception 'Public v3 metadata is wrong'; end if;
  if exists(select 1 from jsonb_array_elements(public_snapshot->'registrations') row where row ? 'contact') then raise exception 'Public v3 leaked a contact'; end if;

  perform set_config('request.jwt.claim.sub',other_id::text,true);
  reply:=public.organizer_save_event_v2(event_id,2,'10000000-0000-4000-8000-000000000021',state);
  if reply->>'code'<>'NOT_FOUND_OR_NOT_OWNED' or reply ? 'snapshot' then raise exception 'Cross-owner save disclosed or changed the event: %',reply; end if;
  reply:=public.get_organizer_signup_v3(signup_id);
  if reply->>'code'<>'NOT_FOUND_OR_NOT_OWNED' or reply ? 'registrations' then raise exception 'Cross-owner signup read disclosed private roster data: %',reply; end if;
  if has_table_privilege('anon','public.signup_registrations','update')
     or has_table_privilege('authenticated','public.signup_registrations','update')
     or has_function_privilege('anon','public.organizer_mutate_signup_entry_v2(uuid,bigint,uuid,bigint,bigint,uuid,jsonb)','execute') then
    raise exception 'Public/cross-owner mutation privileges are broader than the v2 contract';
  end if;

  perform set_config('request.jwt.claim.sub','',true);
  reply:=public.register_public_player_v2('test-owner',public_snapshot#>>'{event,eventSlug}','Delta','delta@example.invalid',request_fourth);
  if reply->>'status'<>'applied' or reply->>'registrationStatus'<>'confirmed' then raise exception 'Last available player was not confirmed: %',reply; end if;
  reply:=public.register_public_player_v2('test-owner',public_snapshot#>>'{event,eventSlug}','Echo','echo@example.invalid',request_fifth);
  if reply->>'registrationStatus'<>'waitlisted' then raise exception 'Overflow player was not waitlisted: %',reply; end if;
  reply:=public.register_public_player_v2('test-owner',public_snapshot#>>'{event,eventSlug}','Echo','echo@example.invalid',request_duplicate);
  if reply->>'code'<>'ALREADY_REGISTERED' then raise exception 'Exact individual duplicate was not rejected: %',reply; end if;
  reply:=public.register_public_player_v2('test-owner',public_snapshot#>>'{event,eventSlug}','Delta','delta@example.invalid',request_fourth);
  if reply->>'status'<>'replayed' then raise exception 'Public registration replay failed'; end if;

  perform set_config('request.jwt.claim.sub',owner_id::text,true);
  select revision into event_revision from public.events where id=event_id;
  select se.capacity_revision,se.roster_revision into capacity_revision,roster_revision from public.signup_events se where id=signup_id;
  select * into first_registration from public.signup_registrations where signup_event_id=signup_id and player_one='Alpha';
  reply:=public.organizer_mutate_signup_entry_v2(event_id,event_revision,signup_id,capacity_revision,roster_revision,request_mutate,
    jsonb_build_object('type','delete','registrationId',first_registration.id,'expectedStatus',first_registration.status,'expectedUpdatedAt',first_registration.updated_at));
  if reply->>'status'<>'applied' then raise exception 'Owner delete/rebalance failed: %',reply; end if;
  if (select count(*) from public.signup_registrations where signup_event_id=signup_id and status='confirmed')<>4
     or (select count(*) from public.signup_registrations where signup_event_id=signup_id and status='waitlisted')<>0 then raise exception 'Deletion did not promote exactly the newly available place'; end if;
  reply:=public.organizer_mutate_signup_entry_v2(event_id,event_revision,signup_id,capacity_revision,roster_revision,request_mutate,
    jsonb_build_object('type','delete','registrationId',first_registration.id,'expectedStatus',first_registration.status,'expectedUpdatedAt',first_registration.updated_at));
  if reply->>'status'<>'replayed' then raise exception 'Owner mutation replay failed'; end if;

  select revision,e.state into event_revision,state from public.events e where id=event_id;
  select se.capacity_revision,se.roster_revision into capacity_revision,roster_revision from public.signup_events se where id=signup_id;
  select array_agg(row.canonical_entrant_id::text order by row.organizer_rank nulls last,row.created_at,row.id)
    into entrant_ids from public.signup_registrations row where row.signup_event_id=signup_id and row.status='confirmed';
  schedule:=jsonb_build_object(
    'id','schedule-test','algorithmVersion','americano-v2.1','seed',42,'inputFingerprint','pending',
    'orderedEntrantIds',to_jsonb(entrant_ids),'courtIds',jsonb_build_array(court_id),
    'rounds',jsonb_build_array(
      jsonb_build_object('id','fixture-round-1','index',1,'matches',jsonb_build_array(jsonb_build_object('id','fixture-1','courtId',court_id,
        'sideA',jsonb_build_object('kind','rotating-pair','playerIds',jsonb_build_array(entrant_ids[1],entrant_ids[2])),
        'sideB',jsonb_build_object('kind','rotating-pair','playerIds',jsonb_build_array(entrant_ids[3],entrant_ids[4])))),'restingEntrantIds','[]'::jsonb,'unusedCourtIds','[]'::jsonb),
      jsonb_build_object('id','fixture-round-2','index',2,'matches',jsonb_build_array(jsonb_build_object('id','fixture-2','courtId',court_id,
        'sideA',jsonb_build_object('kind','rotating-pair','playerIds',jsonb_build_array(entrant_ids[1],entrant_ids[3])),
        'sideB',jsonb_build_object('kind','rotating-pair','playerIds',jsonb_build_array(entrant_ids[2],entrant_ids[4])))),'restingEntrantIds','[]'::jsonb,'unusedCourtIds','[]'::jsonb),
      jsonb_build_object('id','fixture-round-3','index',3,'matches',jsonb_build_array(jsonb_build_object('id','fixture-3','courtId',court_id,
        'sideA',jsonb_build_object('kind','rotating-pair','playerIds',jsonb_build_array(entrant_ids[1],entrant_ids[4])),
        'sideB',jsonb_build_object('kind','rotating-pair','playerIds',jsonb_build_array(entrant_ids[2],entrant_ids[3])))),'restingEntrantIds','[]'::jsonb,'unusedCourtIds','[]'::jsonb)
    ),
    'metrics',jsonb_build_object(
      'appearances',jsonb_build_object(entrant_ids[1],3,entrant_ids[2],3,entrant_ids[3],3,entrant_ids[4],3),
      'rests',jsonb_build_object(entrant_ids[1],0,entrant_ids[2],0,entrant_ids[3],0,entrant_ids[4],0),
      'uniquePartners',jsonb_build_object(entrant_ids[1],3,entrant_ids[2],3,entrant_ids[3],3,entrant_ids[4],3),
      'uniqueOpponents',jsonb_build_object(entrant_ids[1],3,entrant_ids[2],3,entrant_ids[3],3,entrant_ids[4],3),
      'minimumPartnerFrequency',1,'maximumPartnerFrequency',1,'minimumOpponentFrequency',2,'maximumOpponentFrequency',2,'repeatedCompleteMatchups',0,'appearancesEqual',true,'maximumAppearanceSpread',0),
    'acknowledgements',jsonb_build_object('fingerprint','pending','unevenAppearances',false,'repeatedCycle',false),
    'rosterRevision',roster_revision::text
  );
  next_state:=jsonb_set(jsonb_set(state,'{status}','"round-in-progress"'::jsonb,true),'{americanoSchedule}',schedule,true);
  computed_fingerprint:=public.americano_v2_schedule_fingerprint(next_state);
  schedule:=jsonb_set(jsonb_set(schedule,'{inputFingerprint}',to_jsonb(computed_fingerprint),true),'{acknowledgements,fingerprint}',to_jsonb(computed_fingerprint),true);
  next_state:=jsonb_set(next_state,'{americanoSchedule}',schedule,true);
  next_state:=jsonb_set(next_state,'{rounds}',jsonb_build_array(jsonb_build_object(
    'id','live-round-1','index',1,'fixtureRoundId','fixture-round-1','totalPausedMs',0,'durationMs',600000,
    'matches',jsonb_build_array(jsonb_build_object('id','live-match-1','courtId',court_id,
      'sideA',schedule#>'{rounds,0,matches,0,sideA}','sideB',schedule#>'{rounds,0,matches,0,sideB}',
      'scoreA',null,'scoreB',null,'resultConfirmed',false))
  )),true);
  reply:=public.organizer_start_americano_v2(event_id,event_revision,signup_id,capacity_revision,roster_revision,
    '10000000-0000-4000-8000-000000000023',jsonb_set(next_state,'{americanoSchedule,inputFingerprint}','"forged"'::jsonb,true));
  if reply->>'code'<>'INVALID_SCHEDULE'
     or not (select row.is_open from public.signup_events row where row.id=signup_id)
     or (select row.state->>'status' from public.events row where row.id=event_id)<>'setup' then
    raise exception 'Forged preview was not atomically rejected: %',reply;
  end if;
  reply:=public.organizer_start_americano_v2(event_id,event_revision,signup_id,capacity_revision,roster_revision,request_start,next_state);
  if reply->>'status'<>'applied' or reply#>>'{snapshot,event,state,status}'<>'round-in-progress' or reply#>>'{snapshot,signup,isOpen}'<>'false' then raise exception 'Atomic start failed: %',reply; end if;
  reply:=public.organizer_start_americano_v2(event_id,event_revision,signup_id,capacity_revision,roster_revision,request_start,next_state);
  if reply->>'status'<>'replayed' then raise exception 'Lost start response replay failed'; end if;
  perform set_config('request.jwt.claim.sub','',true);
  reply:=public.register_public_player_v2('test-owner',public_snapshot#>>'{event,eventSlug}','Foxtrot','foxtrot@example.invalid','10000000-0000-4000-8000-000000000009');
  if reply->>'code'<>'REGISTRATIONS_CLOSED' then raise exception 'Started roster accepted a new registration'; end if;

  guard_failed:=false;
  begin perform public.get_public_signup_v2('test-owner',public_snapshot#>>'{event,eventSlug}'); exception when others then guard_failed:=sqlerrm='UPDATE_REQUIRED'; end;
  if not guard_failed then raise exception 'Legacy public reader accepted protocol 2'; end if;
  perform set_config('request.jwt.claim.sub',owner_id::text,true);
  perform set_config('app.americano_v2_rpc','off',true);
  guard_failed:=false;
  begin perform public.delete_event(event_id); exception when others then guard_failed:=sqlerrm='UPDATE_REQUIRED'; end;
  if not guard_failed then raise exception 'Legacy delete accepted protocol 2'; end if;
  guard_failed:=false;
  begin update public.events row set state=row.state where row.id=event_id; exception when others then guard_failed:=sqlerrm='UPDATE_REQUIRED'; end;
  if not guard_failed then raise exception 'Direct legacy-style update accepted protocol 2'; end if;

  select revision into event_revision from public.events where id=event_id;
  reply:=public.organizer_delete_event_v2(event_id,event_revision,request_delete);
  if reply->>'status'<>'applied' then raise exception 'Versioned delete failed: %',reply; end if;
  reply:=public.organizer_delete_event_v2(event_id,event_revision,request_delete);
  if reply->>'status'<>'replayed' or reply->>'deletedAt' is null then raise exception 'Versioned delete replay failed'; end if;
  reply:=public.organizer_save_event_v2(event_id,event_revision,'10000000-0000-4000-8000-000000000022',next_state);
  if reply->>'code'<>'EVENT_DELETED' or (select row.state is not null from public.events row where row.id=event_id) then
    raise exception 'A delayed save resurrected a tombstoned event: %',reply;
  end if;
  if has_table_privilege('authenticated','public.event_v2_requests','select') then raise exception 'Receipt table is directly readable'; end if;
end;
$$;

do $$
declare
  owner_id constant uuid := 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  event_id constant uuid := '55555555-5555-4555-8555-555555555555';
  state jsonb;
  reply jsonb;
  public_snapshot jsonb;
  signup_id uuid;
  solo_id uuid;
begin
  perform set_config('request.jwt.claim.sub',owner_id::text,true);
  perform set_config('request.jwt.claim.role','authenticated',true);
  state:=jsonb_build_object(
    'schemaVersion',2,'protocolVersion',2,'revision','0','id',event_id::text,'name','Synthetic fixed Americano',
    'venue','Fixed Test Court','createdAt',1700000000000,'status','setup',
    'settings',jsonb_build_object('defaultRoundDurationMs',600000,'tieRule','split-points','soundOnTimerEnd',false,
      'warningAtMs',60000,'roundsTotal',0,'announceRoundStart',false,'qualifierEnabled',false),
    'courts',jsonb_build_array(
      jsonb_build_object('id','51111111-1111-4111-8111-111111111111','position',1,'name','Court 1','pointValue',1),
      jsonb_build_object('id','51111111-1111-4111-8111-111111111112','position',2,'name','Court 2','pointValue',1)
    ),
    'teams',jsonb_build_array(
      jsonb_build_object('id','52222222-2222-4222-8222-222222222221','name','Pair One','active',true,'createdAt',1,'players',jsonb_build_array(jsonb_build_object('id','53333333-3333-4333-8333-333333333331','name','A One'),jsonb_build_object('id','53333333-3333-4333-8333-333333333332','name','A Two'))),
      jsonb_build_object('id','52222222-2222-4222-8222-222222222222','name','Pair Two','active',true,'createdAt',2,'players',jsonb_build_array(jsonb_build_object('id','53333333-3333-4333-8333-333333333333','name','B One'),jsonb_build_object('id','53333333-3333-4333-8333-333333333334','name','B Two'))),
      jsonb_build_object('id','52222222-2222-4222-8222-222222222223','name','Pair Three','active',true,'createdAt',3,'players',jsonb_build_array(jsonb_build_object('id','53333333-3333-4333-8333-333333333335','name','C One'),jsonb_build_object('id','53333333-3333-4333-8333-333333333336','name','C Two'))),
      jsonb_build_object('id','52222222-2222-4222-8222-222222222224','name','Pair Four','active',true,'createdAt',4,'players',jsonb_build_array(jsonb_build_object('id','53333333-3333-4333-8333-333333333337','name','D One'),jsonb_build_object('id','53333333-3333-4333-8333-333333333338','name','D Two')))
    ),
    'participants','[]'::jsonb,'rounds','[]'::jsonb,'format','americano',
    'formatConfig',jsonb_build_object('rulesVersion',2,'pairingMode','fixed','pointsPerMatch',24,
      'scheduleKind','full','paceMinutes',10,'paceClockEnabled',false)
  );
  reply:=public.organizer_save_event_v2(event_id,0,'56666666-6666-4666-8666-666666666661',state);
  if reply->>'status'<>'applied' then raise exception 'Fixed event save failed: %',reply; end if;
  reply:=public.organizer_save_signup_event_v3(event_id,1,null,0,0,'56666666-6666-4666-8666-666666666662',
    jsonb_build_object('accountSlug','fixed-owner','title','Synthetic fixed Americano','venue','Fixed Test Court',
      'startsAt',null,'endsAt',null,'details','Synthetic only','prizes','','timeZone','Asia/Singapore',
      'organizerName','Test Owner','publicContactMethod',null,'publicContactValue',null),
    jsonb_build_array(
      jsonb_build_object('localEntrantId','52222222-2222-4222-8222-222222222221','teamName','Pair One','playerOne','A One','playerTwo','A Two','contact','pair1@example.invalid','rank',1),
      jsonb_build_object('localEntrantId','52222222-2222-4222-8222-222222222222','teamName','Pair Two','playerOne','B One','playerTwo','B Two','contact','pair2@example.invalid','rank',2),
      jsonb_build_object('localEntrantId','52222222-2222-4222-8222-222222222223','teamName','Pair Three','playerOne','C One','playerTwo','C Two','contact','pair3@example.invalid','rank',3),
      jsonb_build_object('localEntrantId','52222222-2222-4222-8222-222222222224','teamName','Pair Four','playerOne','D One','playerTwo','D Two','contact','pair4@example.invalid','rank',4)
    ));
  if reply->>'status'<>'applied' or reply#>>'{snapshot,signup,capacity,value}'<>'4' then raise exception 'Fixed publication failed: %',reply; end if;
  signup_id:=(reply#>>'{snapshot,signup,id}')::uuid;

  perform set_config('request.jwt.claim.sub','',true);
  reply:=public.register_public_pair_v3('fixed-owner',reply#>>'{snapshot,signup,eventSlug}','Overflow Pair','E One','E Two','overflow@example.invalid','56666666-6666-4666-8666-666666666663');
  if reply->>'registrationStatus'<>'waitlisted' or reply->>'position'<>'1' then raise exception 'Fixed fifth pair was not first waiting: %',reply; end if;
  reply:=public.register_public_single_v3('fixed-owner',(select event_slug from public.signup_events where id=signup_id),'Solo One','solo@example.invalid','56666666-6666-4666-8666-666666666664');
  if reply->>'registrationStatus'<>'looking' or reply->>'position'<>'1' then raise exception 'Fixed solo was not added to Looking: %',reply; end if;
  solo_id:=(reply->>'registrationId')::uuid;
  reply:=public.register_public_single_v3('fixed-owner',(select event_slug from public.signup_events where id=signup_id),'Solo One','solo@example.invalid','56666666-6666-4666-8666-666666666665');
  if reply->>'code'<>'ALREADY_REGISTERED' then raise exception 'Exact fixed solo duplicate was not rejected: %',reply; end if;
  reply:=public.join_public_single_v3('fixed-owner',(select event_slug from public.signup_events where id=signup_id),solo_id,'Solo Two','solo2@example.invalid','56666666-6666-4666-8666-666666666666');
  if reply->>'registrationStatus'<>'waitlisted' or reply->>'position'<>'2' then raise exception 'Completed fixed solo pair was not queued: %',reply; end if;
  if not exists(select 1 from public.signup_registrations row where row.id=solo_id and row.canonical_entrant_id is not null
    and row.canonical_player_one_id is not null and row.canonical_player_two_id is not null) then
    raise exception 'Completing a fixed solo did not assign stable canonical identities';
  end if;
  if (select count(*) from public.signup_registrations row where row.signup_event_id=signup_id and row.status='confirmed')<>4
     or (select count(*) from public.signup_registrations row where row.signup_event_id=signup_id and row.status='waitlisted')<>2
     or exists(select 1 from public.signup_registrations row where row.signup_event_id=signup_id and row.status='looking') then
    raise exception 'Fixed capacity/partner queue diverged';
  end if;
  if (select jsonb_array_length(event.state->'teams') from public.events event where event.id=event_id)<>4
     or (select event.state ? 'americanoSchedule' from public.events event where event.id=event_id) then
    raise exception 'Public fixed signup did not atomically project the confirmed roster or invalidate preview';
  end if;
  public_snapshot:=public.get_public_signup_v3('fixed-owner',(select event_slug from public.signup_events where id=signup_id));
  if exists(select 1 from jsonb_array_elements(public_snapshot->'registrations') row where row ? 'contact') then
    raise exception 'Fixed public roster leaked contact details';
  end if;
end;
$$;

do $$
declare
  owner_id constant uuid := 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
  event_id constant uuid := '66666666-6666-4666-8666-666666666666';
  state jsonb;
  roster jsonb := '[]'::jsonb;
  participants jsonb := '[]'::jsonb;
  point_value jsonb;
  reply jsonb;
  signup_id uuid;
  entrant_id uuid;
  i integer;
begin
  for i in 1..8 loop
    entrant_id := ('7' || lpad(i::text,7,'0') || '-7777-4777-8777-' || lpad(i::text,12,'0'))::uuid;
    participants := participants || jsonb_build_array(jsonb_build_object(
      'id',entrant_id::text,'name','Player ' || i,'active',true,'createdAt',i
    ));
    roster := roster || jsonb_build_array(jsonb_build_object(
      'localEntrantId',entrant_id::text,'playerOne','Player ' || i,
      'contact','player' || i || '@example.invalid','rank',i
    ));
  end loop;

  perform set_config('request.jwt.claim.sub',owner_id::text,true);
  perform set_config('request.jwt.claim.role','authenticated',true);
  state:=jsonb_build_object(
    'schemaVersion',2,'protocolVersion',2,'revision','0','id',event_id::text,'name','Two-court rotating capacity',
    'venue','Capacity Test Court','createdAt',1700000000000,'status','setup',
    'settings',jsonb_build_object('defaultRoundDurationMs',600000,'tieRule','split-points','soundOnTimerEnd',false,
      'warningAtMs',60000,'roundsTotal',0,'announceRoundStart',false,'qualifierEnabled',false),
    'courts',jsonb_build_array(
      jsonb_build_object('id','71111111-1111-4111-8111-111111111111','position',1,'name','Court 1','pointValue',1),
      jsonb_build_object('id','71111111-1111-4111-8111-111111111112','position',2,'name','Court 2','pointValue',1)
    ),
    'teams','[]'::jsonb,'participants',participants,'rounds','[]'::jsonb,'format','americano',
    'formatConfig',jsonb_build_object('rulesVersion',2,'pairingMode','rotating','pointsPerMatch',24,
      'scheduleKind','full','paceMinutes',10,'paceClockEnabled',false)
  );
  for point_value in select value from jsonb_array_elements('[0,-1,2.5,2147483648,"21",null]'::jsonb) loop
    if public.americano_v2_state_error(jsonb_set(state,'{formatConfig,pointsPerMatch}',point_value)) is null then
      raise exception 'Invalid point total was accepted: %',point_value;
    end if;
  end loop;
  for point_value in select value from jsonb_array_elements('[1,21,100,2147483647]'::jsonb) loop
    if public.americano_v2_state_error(jsonb_set(state,'{formatConfig,pointsPerMatch}',point_value)) is not null then
      raise exception 'Custom point total was rejected: %',point_value;
    end if;
  end loop;
  state:=jsonb_set(state,'{formatConfig,pointsPerMatch}','21'::jsonb);
  reply:=public.organizer_save_event_v2(event_id,0,'76666666-6666-4666-8666-666666666661',state);
  if reply->>'status'<>'applied' then raise exception 'Two-court rotating event save failed: %',reply; end if;
  reply:=public.organizer_save_signup_event_v3(event_id,1,null,0,0,'76666666-6666-4666-8666-666666666662',
    jsonb_build_object('accountSlug','capacity-owner','title','Two-court rotating capacity','venue','Capacity Test Court',
      'startsAt',null,'endsAt',null,'details','Synthetic only','prizes','','timeZone','Asia/Singapore',
      'organizerName','Capacity Owner','publicContactMethod',null,'publicContactValue',null),
    roster);
  if reply->>'status'<>'applied' or reply#>>'{snapshot,signup,capacity,value}'<>'8' then
    raise exception 'Two-court rotating publication did not derive eight places: %',reply;
  end if;
  signup_id:=(reply#>>'{snapshot,signup,id}')::uuid;

  reply:=public.organizer_save_americano_config_v2(event_id,
    (select revision from public.events where id=event_id),signup_id,
    (select capacity_revision from public.signup_events where id=signup_id),
    (select roster_revision from public.signup_events where id=signup_id),
    '76666666-6666-4666-8666-666666666664',state->'courts',jsonb_set(state->'formatConfig','{pointsPerMatch}','20'::jsonb));
  if reply->>'status'<>'applied' or reply#>>'{snapshot,event,state,formatConfig,pointsPerMatch}'<>'20' then
    raise exception 'Published custom point change failed: %',reply;
  end if;
  for point_value in select value from jsonb_array_elements('[0,-1,2.5,2147483648,"21",null]'::jsonb) loop
    reply:=public.organizer_save_americano_config_v2(event_id,
      (select revision from public.events where id=event_id),signup_id,
      (select capacity_revision from public.signup_events where id=signup_id),
      (select roster_revision from public.signup_events where id=signup_id),gen_random_uuid(),
      state->'courts',jsonb_set(state->'formatConfig','{pointsPerMatch}',point_value));
    if reply->>'status'<>'rejected' or reply->>'field'<>'formatConfig.pointsPerMatch' then
      raise exception 'Invalid published points did not return a field error: %',reply;
    end if;
  end loop;

  perform set_config('request.jwt.claim.sub','',true);
  reply:=public.register_public_player_v2('capacity-owner',(select event_slug from public.signup_events where id=signup_id),
    'Player 9','player9@example.invalid','76666666-6666-4666-8666-666666666663');
  if reply->>'registrationStatus'<>'waitlisted' or reply->>'position'<>'1' then
    raise exception 'Ninth rotating player on two courts was not first waiting: %',reply;
  end if;
  if (select count(*) from public.signup_registrations row where row.signup_event_id=signup_id and row.status='confirmed')<>8
     or (select count(*) from public.signup_registrations row where row.signup_event_id=signup_id and row.status='waitlisted')<>1
     or (select jsonb_array_length(event.state->'participants') from public.events event where event.id=event_id)<>8 then
    raise exception 'Two-court rotating capacity or canonical event projection diverged';
  end if;
end;
$$;

select 'Americano v2 migration and RPC contract passed' as result;

rollback;
