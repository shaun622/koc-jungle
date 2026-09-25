\set ON_ERROR_STOP on

-- Use only a dedicated fixture owner and synthetic rows in the disposable DB.
select set_config('request.jwt.claim.sub','cccccccc-cccc-4ccc-8ccc-cccccccccccc',false);
select set_config('request.jwt.claim.role','authenticated',false);

do $$
declare event_id uuid:='99999999-9999-4999-8999-999999999901'; state jsonb; reply jsonb; signup_id uuid; slug text; public_view jsonb;
  metadata jsonb;
begin
  state:=jsonb_build_object(
    'id',event_id,'schemaVersion',3,'protocolVersion',2,'format','americano','name','V3 public rules fixture',
    'venue','Synthetic court','createdAt',1790340000000,'revision','0','status','setup','settings','{}'::jsonb,
    'courts',jsonb_build_array(jsonb_build_object('id','99999999-9999-4999-8999-999999999902','name','Court 1','position',1,'pointValue',1)),
    'teams','[]'::jsonb,'participants','[]'::jsonb,'rounds','[]'::jsonb,
    'formatConfig','{"rulesVersion":3,"pairingMode":"rotating","scoring":{"kind":"rally","pointsPerMatch":24},"ranking":{"tiebreak":"shared","championship":"golden-point"},"scheduleKind":"full","paceMinutes":10,"paceClockEnabled":false}'::jsonb
  );
  reply:=public.organizer_save_event_v3(event_id,0,'99999999-9999-4999-8999-999999999903',state);
  if reply->>'status'<>'applied' then raise exception 'could not save v3 public-rules fixture: %',reply; end if;

  metadata:='{"accountSlug":"americano-v3-contract","title":"V3 Public Rules Fixture","venue":"Synthetic court","startsAt":null,"endsAt":null,"details":"","prizes":"","timeZone":"Asia/Singapore","organizerName":"Test owner","publicContactMethod":null,"publicContactValue":""}'::jsonb;
  reply:=public.organizer_save_signup_event_v3(event_id,1,null,0,0,'99999999-9999-4999-8999-999999999904',metadata,'[]'::jsonb);
  if reply->>'status'<>'applied' then raise exception 'could not publish v3 public-rules fixture: %',reply; end if;
  signup_id:=(reply#>>'{snapshot,signup,id}')::uuid;
  select event_slug into slug from public.signup_events where id=signup_id;
  if slug is null then raise exception 'v3 signup fixture did not receive a public slug'; end if;

  reply:=public.register_public_player_v2('americano-v3-contract',slug,'V3 Public Player','v3-private@example.invalid','99999999-9999-4999-8999-999999999905');
  if reply->>'status'<>'applied' then raise exception 'public registration through the v3-linked v2 contract failed: %',reply; end if;
  public_view:=public.get_public_signup_v3('americano-v3-contract',slug);
  if public_view#>>'{event,competitionRules,rulesVersion}'<>'3'
     or public_view#>>'{event,competitionRules,pairingMode}'<>'rotating'
     or public_view#>>'{event,competitionRules,scoring,pointsPerMatch}'<>'24'
     or public_view#>>'{event,competitionRules,ranking,championship}'<>'golden-point' then
    raise exception 'public v3 reader omitted or altered the allowlisted rules: %',public_view->'event';
  end if;
  if public_view#>'{registrations,0}' ? 'contact' then raise exception 'public v3 reader exposed a private registration contact'; end if;
  if public_view#>>'{registrations,0,playerOne}'<>'V3 Public Player' then raise exception 'public v3 reader omitted the roster entry'; end if;
end;
$$;

select 'Americano v3 public signup and privacy contract passed' as result;
