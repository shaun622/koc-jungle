\set ON_ERROR_STOP on

begin;

do $$
declare
  owner_id constant uuid := 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  other_id constant uuid := 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
  tournament_key constant uuid := '11111111-1111-4111-8111-111111111111';
  operation_id constant uuid := '12111111-1111-4111-8111-111111111111';
  command_id constant uuid := '22222222-2222-4222-8222-222222222222';
  signup_id constant uuid := '33333333-3333-4333-8333-333333333333';
  state jsonb;
  next_state jsonb;
  reply jsonb;
  index integer;
begin
  if current_database() not like 'koc_tournament_test_%' then raise exception 'Refusing Tournament V1 contract outside an isolated database'; end if;
  insert into auth.users(id,email) values(owner_id,'owner@example.invalid'),(other_id,'other@example.invalid');
  state := jsonb_build_object(
    'schema','tournament-v1','dataVersion',2,'id',tournament_key::text,'revision','0','createdAt',1,'updatedAt',1,
    'lifecycle','setup','archivedAt',null,
    'meta',jsonb_build_object('title','Local Cup','venue','','timeZone','UTC','startsAt','2099-01-01T00:00:00.000Z','endsAt',null,'notes','','publicSlug',null,'signupOpen',false),
    'controller',jsonb_build_object('deviceId',null,'epoch','0','nextSequence',0),
    'divisions',jsonb_build_array(jsonb_build_object('id','division-a','name','Open','capacity',16,'drawPublishedAt',null,'automaticPromotion',true)),
    'players','[]'::jsonb,'entries','[]'::jsonb,'lineupRevisions','[]'::jsonb,'courts','[]'::jsonb,
    'ruleProfiles','[]'::jsonb,'stages','[]'::jsonb,'groups','[]'::jsonb,'fixtures','[]'::jsonb,
    'qualificationDecisions','[]'::jsonb,'audit','[]'::jsonb
  );

  if has_table_privilege('authenticated','public.tournament_authority_v1','select')
     or has_table_privilege('authenticated','public.tournament_operations_v1','select')
     or has_table_privilege('anon','public.tournament_commands_v1','select')
     or has_function_privilege('authenticated','public.internal_commit_tournament_v2(uuid,uuid,uuid,text,integer,bigint,text,text,bigint,integer,text,jsonb,jsonb,text,jsonb,jsonb,jsonb)','execute') then
    raise exception 'Client privileges are broader than the service-only completion contract';
  end if;

  reply := public.internal_create_tournament_v1(owner_id,operation_id,tournament_key,'create-hash',1,state);
  if reply->>'status'<>'applied' then raise exception 'Create failed: %',reply; end if;
  reply := public.internal_create_tournament_v1(owner_id,operation_id,tournament_key,'create-hash',1,state);
  if reply->>'status'<>'replayed' then raise exception 'Lost create response did not replay: %',reply; end if;
  reply := public.internal_create_tournament_v1(owner_id,operation_id,'11111111-1111-4111-8111-111111111112','other-hash',1,state);
  if reply->>'code'<>'OPERATION_ID_REUSED' then raise exception 'Cross-tournament operation reuse was not rejected: %',reply; end if;

  next_state := jsonb_set(jsonb_set(state,'{revision}','"1"'::jsonb),'{updatedAt}','2'::jsonb);
  next_state := jsonb_set(next_state,'{entries}',jsonb_build_array(jsonb_build_object('id','entry-a','divisionId','division-a','teamName','Pair','playerIds',jsonb_build_array('player-a','player-b'),'lineupRevisionIds',jsonb_build_array('lineup-a'),'admission','confirmed','readiness','not-checked-in','createdAt',2)));
  reply := public.internal_commit_tournament_v2(owner_id,tournament_key,command_id,'intent-a',1,0,'device-a','',0,0,'add-entry',next_state,'[{"entryId":"entry-a","contact":"+62000"}]'::jsonb,null,null,'{}'::jsonb,'{}'::jsonb);
  if reply->>'status'<>'applied' or (select contact from public.tournament_contacts_v1 where tournament_id=tournament_key and entry_id='entry-a')<>'+62000' then raise exception 'Atomic command/contact commit failed: %',reply; end if;
  reply := public.internal_commit_tournament_v2(owner_id,tournament_key,command_id,'intent-a',1,0,'device-a','',0,0,'add-entry',next_state,'[{"entryId":"entry-a","contact":"+62000"}]'::jsonb,null,null,'{}'::jsonb,'{}'::jsonb);
  if reply->>'status'<>'replayed' then raise exception 'Lost command response did not replay: %',reply; end if;
  reply := public.internal_commit_tournament_v2(owner_id,tournament_key,command_id,'changed',1,0,'device-a','',0,0,'add-entry',next_state,'[]'::jsonb,null,null,'{}'::jsonb,'{}'::jsonb);
  if reply->>'code'<>'COMMAND_ID_REUSED' then raise exception 'Changed immutable command was not rejected: %',reply; end if;

  next_state := jsonb_set(jsonb_set(next_state,'{revision}','"2"'::jsonb),'{meta,publicSlug}','"local-cup"'::jsonb);
  next_state := jsonb_set(next_state,'{meta,signupOpen}','true'::jsonb);
  update public.tournaments_v1 set state=next_state,revision=2 where id=tournament_key;
  insert into public.tournament_public_v1(tournament_id,public_slug,public_revision,projection)
    values(tournament_key,'local-cup',2,'{"projectionVersion":2,"tournamentId":"11111111-1111-4111-8111-111111111111"}'::jsonb);
  next_state := jsonb_set(next_state,'{revision}','"3"'::jsonb);
  next_state := jsonb_set(next_state,'{entries}',(next_state->'entries')||jsonb_build_array(jsonb_build_object('id','entry-public','divisionId','division-a','teamName','Public','playerIds',jsonb_build_array('player-c','player-d'),'lineupRevisionIds',jsonb_build_array('lineup-public'),'admission','confirmed','readiness','not-checked-in','createdAt',3)));
  reply := public.internal_public_signup_tournament_v2(tournament_key,'local-cup',signup_id,'signup-intent',1,2,'entry-public','+62111',next_state,'{"projectionVersion":2,"tournamentId":"11111111-1111-4111-8111-111111111111"}'::jsonb,'{}'::jsonb,'{"entryId":"entry-public","admission":"confirmed"}'::jsonb);
  if reply->>'status'<>'applied' or reply#>>'{result,admission}'<>'confirmed' then raise exception 'Public signup failed: %',reply; end if;
  reply := public.internal_public_signup_tournament_v2(tournament_key,'local-cup',signup_id,'signup-intent',1,2,'entry-public','+62111',next_state,'{"projectionVersion":2}'::jsonb,'{}'::jsonb,'{}'::jsonb);
  if reply->>'status'<>'replayed' or reply#>>'{result,entryId}'<>'entry-public' then raise exception 'Stable public receipt replay failed: %',reply; end if;

  for index in 1..10 loop
    reply := public.internal_attempt_tournament_signup_v1('test-ip-digest-aaaaaaaaaaaaaaaaaaaaaaaa',tournament_key);
    if coalesce((reply->>'allowed')::boolean,false)=false then raise exception 'Rate limiter rejected inside boundary: %',reply; end if;
  end loop;
  reply := public.internal_attempt_tournament_signup_v1('test-ip-digest-aaaaaaaaaaaaaaaaaaaaaaaa',tournament_key);
  if reply->>'code'<>'RATE_LIMITED' or (reply->>'retryAfter')::integer<1 then raise exception 'Rate limiter did not reject boundary+1: %',reply; end if;

  perform set_config('request.jwt.claim.sub',other_id::text,true);
  perform set_config('request.jwt.claim.role','authenticated',true);
  set local role authenticated;
  if exists(select 1 from public.tournaments_v1 where id=tournament_key) then raise exception 'RLS disclosed another owner tournament'; end if;
  reset role;

  reply := public.internal_delete_tournament_v1(owner_id,'44444444-4444-4444-8444-444444444444',tournament_key,'delete-hash',1);
  if reply->>'status'<>'applied' or not exists(select 1 from public.tournament_tombstones_v1 where tournament_id=tournament_key) then raise exception 'Delete/tombstone failed: %',reply; end if;
  if exists(select 1 from public.tournament_operations_v1 operation_row where operation_row.owner_id=owner_id and operation_row.operation_id='44444444-4444-4444-8444-444444444444') is false then raise exception 'Delete operation receipt did not survive event cascade'; end if;
end $$;

select 'Tournament V1 completion SQL contract passed' as result;
rollback;
