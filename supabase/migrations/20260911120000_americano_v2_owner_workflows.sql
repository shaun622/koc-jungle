-- Americano v2 canonical roster, publication, owner mutations and atomic start.

alter table public.signup_registrations
  add column if not exists canonical_entrant_id uuid,
  add column if not exists canonical_player_one_id uuid,
  add column if not exists canonical_player_two_id uuid;

alter table public.signup_registrations
  add constraint signup_registrations_v2_identity_check check (
    entry_mode = 'fixed-pairs'
      and (canonical_entrant_id is null or (canonical_player_one_id is not null and canonical_player_two_id is not null))
    or entry_mode = 'individual'
      and (canonical_entrant_id is null or (canonical_player_one_id = canonical_entrant_id and canonical_player_two_id is null))
  ) not valid;
alter table public.signup_registrations validate constraint signup_registrations_v2_identity_check;

create or replace function public.americano_v2_project_roster(p_event_id uuid, p_signup_event_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  event_state jsonb;
  mode text;
  projected jsonb;
begin
  select event.state into event_state from public.events as event where event.id = p_event_id;
  select signup.entry_mode into mode from public.signup_events as signup where signup.id = p_signup_event_id;
  if event_state is null or mode is null then return event_state; end if;

  if mode = 'individual' then
    select coalesce(jsonb_agg(jsonb_build_object(
      'id', registration.canonical_entrant_id::text,
      'name', registration.player_one,
      'active', true,
      'createdAt', floor(extract(epoch from registration.created_at) * 1000)::bigint,
      'signupRegistrationId', registration.id::text
    ) order by registration.organizer_rank nulls last, registration.created_at, registration.id), '[]'::jsonb)
    into projected
    from public.signup_registrations as registration
    where registration.signup_event_id = p_signup_event_id
      and registration.entry_mode = 'individual' and registration.status = 'confirmed';
    event_state := jsonb_set(jsonb_set(event_state,'{participants}',projected,true),'{teams}','[]'::jsonb,true);
  else
    select coalesce(jsonb_agg(jsonb_build_object(
      'id', registration.canonical_entrant_id::text,
      'name', coalesce(nullif(registration.team_name,''), registration.player_one || ' & ' || registration.player_two),
      'players', jsonb_build_array(
        jsonb_build_object('id',registration.canonical_player_one_id::text,'name',registration.player_one),
        jsonb_build_object('id',registration.canonical_player_two_id::text,'name',registration.player_two)
      ),
      'createdAt', floor(extract(epoch from registration.created_at) * 1000)::bigint,
      'active', true,
      'signupRegistrationId', registration.id::text
    ) order by registration.organizer_rank nulls last, registration.pair_completed_at nulls last, registration.created_at, registration.id), '[]'::jsonb)
    into projected
    from public.signup_registrations as registration
    where registration.signup_event_id = p_signup_event_id
      and registration.entry_mode = 'fixed-pairs' and registration.status = 'confirmed';
    event_state := jsonb_set(jsonb_set(event_state,'{teams}',projected,true),'{participants}','[]'::jsonb,true);
  end if;
  return event_state;
end;
$$;

create or replace function public.americano_v2_commit_roster_projection(p_event_id uuid, p_signup_event_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  current_revision bigint;
  next_state jsonb;
begin
  select event.revision into current_revision
  from public.events as event
  where event.id=p_event_id and event.deleted_at is null
  for update;
  if not found then raise exception using errcode='P0001',message='EVENT_DELETED'; end if;

  -- Any canonical queue change invalidates a preview because Start compares the
  -- frozen roster revision. Confirmed entries are projected into the event in
  -- the same transaction; waiting/looking entries remain in the private signup
  -- record and are visible to the organiser through the owner reader.
  next_state:=public.americano_v2_project_roster(p_event_id,p_signup_event_id)-'americanoSchedule';
  next_state:=jsonb_set(next_state,'{revision}',to_jsonb((current_revision+1)::text),true);
  update public.events as event
  set state=next_state,revision=current_revision+1,updated_at=clock_timestamp()
  where event.id=p_event_id;
end;
$$;

create or replace function public.americano_v2_receipt_reply(
  p_event_id uuid, p_owner_id uuid, p_request_id uuid,
  p_operation text, p_payload_hash text
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare receipt public.event_v2_requests%rowtype;
begin
  select * into receipt from public.event_v2_requests as request
  where request.event_id=p_event_id and request.request_id=p_request_id;
  if not found then return null; end if;
  if receipt.operation <> p_operation or receipt.payload_sha256 <> p_payload_hash then
    return public.americano_v2_rejected(p_request_id,'IDEMPOTENCY_MISMATCH','This request id was already used for different data.');
  end if;
  return jsonb_build_object('status','replayed','requestId',p_request_id,
    'committedEventRevision',receipt.applied_revision::text,
    'snapshot',public.owner_event_snapshot_v2_internal(p_event_id,p_owner_id));
end;
$$;

create or replace function public.organizer_save_signup_event_v3(
  p_event_id uuid, p_base_event_revision bigint,
  p_signup_event_id uuid, p_base_capacity_revision bigint,
  p_base_roster_revision bigint, p_request_id uuid,
  p_metadata jsonb, p_initial_entries jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  owner_id uuid := auth.uid();
  event_row public.events%rowtype;
  signup public.signup_events%rowtype;
  existing_reply jsonb;
  payload_hash text;
  allowed_keys text[] := array['accountSlug','title','venue','startsAt','endsAt','details','prizes','timeZone','organizerName','publicContactMethod','publicContactValue'];
  supplied_keys text[];
  mode text;
  capacity integer;
  entry jsonb;
  source_item jsonb;
  registration_id uuid;
  next_revision bigint;
  next_state jsonb;
  start_time timestamptz;
  end_time timestamptz;
  seeded_ids text[] := array[]::text[];
begin
  if owner_id is null then return public.americano_v2_rejected(p_request_id,'NOT_AUTHENTICATED','Sign in to publish this event.'); end if;
  if p_request_id is null or jsonb_typeof(p_metadata) <> 'object' or jsonb_typeof(p_initial_entries) <> 'array' then
    return public.americano_v2_rejected(p_request_id,'INVALID_PAYLOAD','Publication data is invalid.');
  end if;
  select array_agg(key order by key) into supplied_keys from jsonb_object_keys(p_metadata) key;
  if supplied_keys is distinct from (select array_agg(value order by value) from unnest(allowed_keys) value) then
    return public.americano_v2_rejected(p_request_id,'INVALID_PAYLOAD','Publication metadata contains missing or unsupported fields.','metadata');
  end if;
  begin
    start_time := nullif(p_metadata ->> 'startsAt','')::timestamptz;
    end_time := nullif(p_metadata ->> 'endsAt','')::timestamptz;
  exception when others then
    return public.americano_v2_rejected(p_request_id,'INVALID_PAYLOAD','Enter valid start and end dates.','startsAt');
  end;
  if coalesce(trim(p_metadata ->> 'title'),'') = '' or char_length(trim(p_metadata ->> 'title')) > 120 then
    return public.americano_v2_rejected(p_request_id,'INVALID_PAYLOAD','Enter an event title up to 120 characters.','title');
  end if;
  if end_time is not null and start_time is not null and end_time <= start_time then
    return public.americano_v2_rejected(p_request_id,'INVALID_PAYLOAD','End time must be after start time.','endsAt');
  end if;
  perform set_config('app.americano_v2_rpc','on',true);
  payload_hash := public.americano_v2_payload_hash('organizer_save_signup_event_v3',jsonb_build_object(
    'baseEventRevision',p_base_event_revision,'signupEventId',p_signup_event_id,
    'baseCapacityRevision',p_base_capacity_revision,'baseRosterRevision',p_base_roster_revision,
    'metadata',p_metadata,'initialEntries',p_initial_entries));
  select * into event_row from public.events as event where event.id=p_event_id and event.user_id=owner_id for update;
  if not found then return public.americano_v2_rejected(p_request_id,'NOT_FOUND_OR_NOT_OWNED','This event could not be found.'); end if;
  if event_row.deleted_at is not null then return public.americano_v2_rejected(p_request_id,'EVENT_DELETED','This event was deleted.'); end if;
  if event_row.protocol_version <> 2 then return public.americano_v2_rejected(p_request_id,'UPDATE_REQUIRED','This event uses the legacy publication flow.'); end if;
  existing_reply := public.americano_v2_receipt_reply(p_event_id,owner_id,p_request_id,'organizer_save_signup_event_v3',payload_hash);
  if existing_reply is not null then return existing_reply; end if;
  if event_row.revision <> p_base_event_revision then
    return jsonb_build_object('status','conflict','requestId',p_request_id,'code','EVENT_REVISION_CONFLICT','snapshot',public.owner_event_snapshot_v2_internal(p_event_id,owner_id));
  end if;
  mode := case event_row.state #>> '{formatConfig,pairingMode}' when 'rotating' then 'individual' else 'fixed-pairs' end;
  capacity := jsonb_array_length(event_row.state -> 'courts') * case when mode='individual' then 4 else 2 end;
  select * into signup from public.signup_events as row where row.source_event_uuid=p_event_id and row.owner_user_id=owner_id for update;

  if not found then
    if p_signup_event_id is not null or coalesce(p_base_capacity_revision,0) <> 0 or coalesce(p_base_roster_revision,0) <> 0 then
      return public.americano_v2_rejected(p_request_id,'SIGNUP_REVISION_CONFLICT','A new signup must start with null id and zero revisions.');
    end if;
    if event_row.state ->> 'status' <> 'setup' then return public.americano_v2_rejected(p_request_id,'MODE_LOCKED','Publish before starting play.'); end if;
    if jsonb_array_length(p_initial_entries) <> (case when mode='individual' then jsonb_array_length(event_row.state->'participants') else jsonb_array_length(event_row.state->'teams') end) then
      return public.americano_v2_rejected(p_request_id,'INVALID_PAYLOAD','Initial entries must match the saved roster exactly.','initialEntries');
    end if;

    -- Validate the complete seed before creating the signup row. Returning a
    -- rejection from the insertion loop would otherwise commit any rows that
    -- had already been inserted earlier in this function invocation.
    for entry in select value from jsonb_array_elements(p_initial_entries) loop
      source_item := null;
      if coalesce(entry->>'localEntrantId','') = '' or (entry->>'localEntrantId') = any(seeded_ids) then
        return public.americano_v2_rejected(p_request_id,'INVALID_PAYLOAD','Initial entrant ids must be unique.','initialEntries');
      end if;
      seeded_ids := array_append(seeded_ids,entry->>'localEntrantId');
      if mode='individual' then
        select value into source_item from jsonb_array_elements(event_row.state->'participants')
          where value->>'id'=entry->>'localEntrantId' and coalesce((value->>'active')::boolean,false) limit 1;
        if source_item is null or trim(entry->>'playerOne') <> source_item->>'name'
           or nullif(trim(coalesce(entry->>'playerTwo','')),'') is not null then
          return public.americano_v2_rejected(p_request_id,'INVALID_PAYLOAD','Initial player does not match the saved roster.','initialEntries');
        end if;
      else
        select value into source_item from jsonb_array_elements(event_row.state->'teams')
          where value->>'id'=entry->>'localEntrantId' and coalesce((value->>'active')::boolean,false) limit 1;
        if source_item is null or trim(entry->>'playerOne') <> source_item#>>'{players,0,name}'
           or trim(entry->>'playerTwo') <> source_item#>>'{players,1,name}' then
          return public.americano_v2_rejected(p_request_id,'INVALID_PAYLOAD','Initial pair does not match the saved roster.','initialEntries');
        end if;
      end if;
    end loop;

    insert into public.signup_events(
      owner_user_id,source_event_id,source_event_uuid,protocol_version,entry_mode,
      account_slug,title,venue,starts_at,ends_at,capacity_teams,capacity_players,
      details,prizes,is_open,auto_add_pairs,capacity_revision,roster_revision,
      cancelled_at,time_zone,organizer_name,public_contact_method,public_contact_value,updated_at
    ) values (
      owner_id,p_event_id::text,p_event_id,2,mode,
      trim(p_metadata->>'accountSlug'),trim(p_metadata->>'title'),trim(coalesce(p_metadata->>'venue','')),
      start_time,end_time,case when mode='fixed-pairs' then capacity else 0 end,
      case when mode='individual' then capacity else null end,
      trim(coalesce(p_metadata->>'details','')),trim(coalesce(p_metadata->>'prizes','')),
      start_time is null or start_time > now(),false,1,0,null,
      nullif(trim(coalesce(p_metadata->>'timeZone','')),''),nullif(trim(coalesce(p_metadata->>'organizerName','')),''),
      nullif(trim(coalesce(p_metadata->>'publicContactMethod','')),''),nullif(trim(coalesce(p_metadata->>'publicContactValue','')),''),clock_timestamp()
    ) returning * into signup;

    for entry in select value from jsonb_array_elements(p_initial_entries) loop
      source_item := null;
      if mode='individual' then
        select value into source_item from jsonb_array_elements(event_row.state->'participants')
          where value->>'id'=entry->>'localEntrantId' and coalesce((value->>'active')::boolean,false) limit 1;
        insert into public.signup_registrations(signup_event_id,entry_mode,team_name,player_one,player_two,contact,status,
          organizer_rank,pair_completed_at,canonical_entrant_id,canonical_player_one_id,canonical_player_two_id)
        values(signup.id,'individual','',trim(entry->>'playerOne'),null,coalesce(nullif(trim(entry->>'contact'),''),'Not provided'),
          'waitlisted',(entry->>'rank')::bigint,null,(entry->>'localEntrantId')::uuid,(entry->>'localEntrantId')::uuid,null)
        returning id into registration_id;
      else
        select value into source_item from jsonb_array_elements(event_row.state->'teams')
          where value->>'id'=entry->>'localEntrantId' and coalesce((value->>'active')::boolean,false) limit 1;
        insert into public.signup_registrations(signup_event_id,entry_mode,team_name,player_one,player_two,contact,status,
          organizer_rank,pair_completed_at,canonical_entrant_id,canonical_player_one_id,canonical_player_two_id)
        values(signup.id,'fixed-pairs',trim(coalesce(entry->>'teamName','')),trim(entry->>'playerOne'),trim(entry->>'playerTwo'),
          coalesce(nullif(trim(entry->>'contact'),''),'Not provided'),'waitlisted',(entry->>'rank')::bigint,clock_timestamp(),
          (entry->>'localEntrantId')::uuid,(source_item#>>'{players,0,id}')::uuid,(source_item#>>'{players,1,id}')::uuid)
        returning id into registration_id;
      end if;
    end loop;
    perform public.rebalance_signup_event(signup.id);
    update public.signup_events set roster_seeded_at=clock_timestamp() where id=signup.id returning * into signup;
  else
    if signup.id is distinct from p_signup_event_id then return public.americano_v2_rejected(p_request_id,'NOT_FOUND_OR_NOT_OWNED','Signup id does not match this event.'); end if;
    if signup.capacity_revision <> p_base_capacity_revision then
      return jsonb_build_object('status','conflict','requestId',p_request_id,'code','SIGNUP_REVISION_CONFLICT','snapshot',public.owner_event_snapshot_v2_internal(p_event_id,owner_id));
    end if;
    if signup.roster_revision <> p_base_roster_revision then
      return jsonb_build_object('status','conflict','requestId',p_request_id,'code','ROSTER_REVISION_CONFLICT','snapshot',public.owner_event_snapshot_v2_internal(p_event_id,owner_id));
    end if;
    if jsonb_array_length(p_initial_entries) <> 0 then return public.americano_v2_rejected(p_request_id,'ROSTER_LOCKED','Published rosters cannot be reseeded.','initialEntries'); end if;
    update public.signup_events as row set
      account_slug=trim(p_metadata->>'accountSlug'),title=trim(p_metadata->>'title'),venue=trim(coalesce(p_metadata->>'venue','')),
      starts_at=start_time,ends_at=end_time,details=trim(coalesce(p_metadata->>'details','')),prizes=trim(coalesce(p_metadata->>'prizes','')),
      time_zone=nullif(trim(coalesce(p_metadata->>'timeZone','')),''),organizer_name=nullif(trim(coalesce(p_metadata->>'organizerName','')),''),
      public_contact_method=nullif(trim(coalesce(p_metadata->>'publicContactMethod','')),''),
      public_contact_value=nullif(trim(coalesce(p_metadata->>'publicContactValue','')),''),
      capacity_revision=row.capacity_revision+1,updated_at=clock_timestamp()
    where row.id=signup.id returning * into signup;
  end if;

  next_revision := event_row.revision + 1;
  next_state := public.americano_v2_project_roster(p_event_id,signup.id);
  next_state := jsonb_set(next_state,'{name}',to_jsonb(signup.title),true);
  next_state := jsonb_set(next_state,'{venue}',to_jsonb(signup.venue),true);
  next_state := jsonb_set(next_state,'{revision}',to_jsonb(next_revision::text),true);
  next_state := jsonb_set(next_state,'{settings,publishedSignupId}',to_jsonb(signup.id::text),true);
  next_state := jsonb_set(next_state,'{settings,publishedStartsAt}',coalesce(to_jsonb(signup.starts_at), 'null'::jsonb),true);
  next_state := jsonb_set(next_state,'{settings,publishedEndsAt}',coalesce(to_jsonb(signup.ends_at), 'null'::jsonb),true);
  next_state := jsonb_set(next_state,'{settings,publishedSignupOpen}',to_jsonb(signup.is_open),true);
  update public.events as row set state=next_state,revision=next_revision,updated_at=clock_timestamp() where row.id=p_event_id;
  insert into public.event_v2_requests(event_id,request_id,operation,payload_sha256,applied_revision,result_ids)
    values(p_event_id,p_request_id,'organizer_save_signup_event_v3',payload_hash,next_revision,jsonb_build_object('signupEventId',signup.id));
  return jsonb_build_object('status','applied','requestId',p_request_id,'committedEventRevision',next_revision::text,
    'snapshot',public.owner_event_snapshot_v2_internal(p_event_id,owner_id));
exception when invalid_text_representation or check_violation then
  return public.americano_v2_rejected(p_request_id,'INVALID_PAYLOAD','Publication data is invalid.');
end;
$$;

create or replace function public.organizer_mutate_signup_entry_v2(
  p_event_id uuid, p_base_event_revision bigint,
  p_signup_event_id uuid, p_base_capacity_revision bigint,
  p_base_roster_revision bigint, p_request_id uuid, p_command jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  owner_id uuid := auth.uid(); event_row public.events%rowtype; signup public.signup_events%rowtype;
  registration public.signup_registrations%rowtype; payload_hash text; existing_reply jsonb;
  command_type text; entry jsonb; requested_ids uuid[]; active_count integer; next_revision bigint; next_state jsonb; new_identity uuid;
begin
  if owner_id is null then return public.americano_v2_rejected(p_request_id,'NOT_AUTHENTICATED','Sign in to edit the roster.'); end if;
  if jsonb_typeof(p_command)<>'object' then return public.americano_v2_rejected(p_request_id,'INVALID_PAYLOAD','Roster command is invalid.'); end if;
  perform set_config('app.americano_v2_rpc','on',true);
  payload_hash := public.americano_v2_payload_hash('organizer_mutate_signup_entry_v2',jsonb_build_object(
    'baseEventRevision',p_base_event_revision,'signupEventId',p_signup_event_id,'baseCapacityRevision',p_base_capacity_revision,
    'baseRosterRevision',p_base_roster_revision,'command',p_command));
  select * into event_row from public.events as row where row.id=p_event_id and row.user_id=owner_id for update;
  if not found then return public.americano_v2_rejected(p_request_id,'NOT_FOUND_OR_NOT_OWNED','This event could not be found.'); end if;
  if event_row.deleted_at is not null then return public.americano_v2_rejected(p_request_id,'EVENT_DELETED','This event was deleted.'); end if;
  if event_row.protocol_version<>2 then return public.americano_v2_rejected(p_request_id,'UPDATE_REQUIRED','This event uses the legacy roster flow.'); end if;
  existing_reply := public.americano_v2_receipt_reply(p_event_id,owner_id,p_request_id,'organizer_mutate_signup_entry_v2',payload_hash);
  if existing_reply is not null then return existing_reply; end if;
  select * into signup from public.signup_events as row where row.id=p_signup_event_id and row.source_event_uuid=p_event_id and row.owner_user_id=owner_id for update;
  if not found then return public.americano_v2_rejected(p_request_id,'NOT_FOUND_OR_NOT_OWNED','The signup page could not be found.'); end if;
  if signup.roster_locked_at is not null or event_row.state->>'status'<>'setup' then return public.americano_v2_rejected(p_request_id,'ROSTER_LOCKED','Roster membership is locked after play starts.'); end if;
  if event_row.revision<>p_base_event_revision then return jsonb_build_object('status','conflict','requestId',p_request_id,'code','EVENT_REVISION_CONFLICT','snapshot',public.owner_event_snapshot_v2_internal(p_event_id,owner_id)); end if;
  if signup.capacity_revision<>p_base_capacity_revision then return jsonb_build_object('status','conflict','requestId',p_request_id,'code','SIGNUP_REVISION_CONFLICT','snapshot',public.owner_event_snapshot_v2_internal(p_event_id,owner_id)); end if;
  if signup.roster_revision<>p_base_roster_revision then return jsonb_build_object('status','conflict','requestId',p_request_id,'code','ROSTER_REVISION_CONFLICT','snapshot',public.owner_event_snapshot_v2_internal(p_event_id,owner_id)); end if;
  command_type := p_command->>'type'; entry := p_command->'entry';
  if command_type='add' then
    if coalesce(trim(entry->>'playerOne'),'')='' then return public.americano_v2_rejected(p_request_id,'INVALID_PAYLOAD','Enter a player name.','playerOne'); end if;
    if signup.entry_mode='individual' and nullif(trim(coalesce(entry->>'playerTwo','')),'') is not null then return public.americano_v2_rejected(p_request_id,'MODE_MISMATCH','Rotating Americano accepts individual players.','playerTwo'); end if;
    if signup.entry_mode='fixed-pairs' and coalesce(trim(entry->>'playerTwo'),'')='' then return public.americano_v2_rejected(p_request_id,'INVALID_PAYLOAD','Enter player two.','playerTwo'); end if;
    if exists(select 1 from public.signup_registrations as row where row.signup_event_id=signup.id and row.status<>'cancelled'
      and lower(trim(row.player_one))=lower(trim(entry->>'playerOne')) and lower(trim(row.contact))=lower(trim(coalesce(entry->>'contact','Not provided'))))
      and not coalesce((p_command->>'acknowledgePossibleDuplicate')::boolean,false) then
      return public.americano_v2_rejected(p_request_id,'POSSIBLE_DUPLICATE','A similar active entry already exists.');
    end if;
    if signup.entry_mode='individual' then
      new_identity:=gen_random_uuid();
      insert into public.signup_registrations(signup_event_id,entry_mode,team_name,player_one,contact,status,organizer_rank,
        canonical_entrant_id,canonical_player_one_id)
      values(signup.id,'individual','',trim(entry->>'playerOne'),coalesce(nullif(trim(entry->>'contact'),''),'Not provided'),'waitlisted',
        (select coalesce(max(row.organizer_rank),0)+1 from public.signup_registrations row where row.signup_event_id=signup.id),new_identity,new_identity)
      returning * into registration;
    else
      insert into public.signup_registrations(signup_event_id,entry_mode,team_name,player_one,player_two,contact,status,organizer_rank,pair_completed_at,
        canonical_entrant_id,canonical_player_one_id,canonical_player_two_id)
      values(signup.id,'fixed-pairs',trim(coalesce(entry->>'teamName','')),trim(entry->>'playerOne'),trim(entry->>'playerTwo'),
        coalesce(nullif(trim(entry->>'contact'),''),'Not provided'),'waitlisted',
        (select coalesce(max(row.organizer_rank),0)+1 from public.signup_registrations row where row.signup_event_id=signup.id),clock_timestamp(),
        gen_random_uuid(),gen_random_uuid(),gen_random_uuid()) returning * into registration;
    end if;
  elsif command_type in ('edit','delete') then
    select * into registration from public.signup_registrations as row
      where row.id=(p_command->>'registrationId')::uuid and row.signup_event_id=signup.id for update;
    if not found then return public.americano_v2_rejected(p_request_id,'NOT_FOUND_OR_NOT_OWNED','This registration could not be found.'); end if;
    if registration.status<>p_command->>'expectedStatus' or registration.updated_at<>(p_command->>'expectedUpdatedAt')::timestamptz then
      return jsonb_build_object('status','conflict','requestId',p_request_id,'code','ROSTER_REVISION_CONFLICT','snapshot',public.owner_event_snapshot_v2_internal(p_event_id,owner_id));
    end if;
    if command_type='delete' then delete from public.signup_registrations where id=registration.id;
    else
      if coalesce(trim(entry->>'playerOne'),'')='' then return public.americano_v2_rejected(p_request_id,'INVALID_PAYLOAD','Enter a player name.','playerOne'); end if;
      if signup.entry_mode='fixed-pairs' and coalesce(trim(entry->>'playerTwo'),'')='' then return public.americano_v2_rejected(p_request_id,'INVALID_PAYLOAD','Enter player two.','playerTwo'); end if;
      update public.signup_registrations as row set team_name=case when signup.entry_mode='individual' then '' else trim(coalesce(entry->>'teamName','')) end,
        player_one=trim(entry->>'playerOne'),player_two=case when signup.entry_mode='individual' then null else trim(entry->>'playerTwo') end,
        contact=coalesce(nullif(trim(entry->>'contact'),''),row.contact),updated_at=clock_timestamp()
      where row.id=registration.id;
    end if;
  elsif command_type='reorder' then
    select array_agg(value::uuid order by ordinal) into requested_ids
      from jsonb_array_elements_text(p_command->'registrationIds') with ordinality ids(value,ordinal);
    select count(*) into active_count from public.signup_registrations as row where row.signup_event_id=signup.id
      and row.status in ('confirmed','waitlisted') and (signup.entry_mode='individual' or row.player_two is not null);
    if coalesce(array_length(requested_ids,1),0)<>active_count or (select count(distinct id) from unnest(requested_ids) id)<>active_count
       or exists(select 1 from unnest(requested_ids) id where not exists(select 1 from public.signup_registrations row where row.id=id and row.signup_event_id=signup.id and row.status in ('confirmed','waitlisted'))) then
      return public.americano_v2_rejected(p_request_id,'INVALID_PAYLOAD','Reorder must contain every queued entry exactly once.','registrationIds');
    end if;
    update public.signup_registrations as row set organizer_rank=rank.ordinal,updated_at=clock_timestamp()
    from unnest(requested_ids) with ordinality rank(id,ordinal) where row.id=rank.id and row.organizer_rank is distinct from rank.ordinal;
  else return public.americano_v2_rejected(p_request_id,'INVALID_PAYLOAD','Unsupported roster command.','type');
  end if;
  perform public.rebalance_signup_event(signup.id);
  next_revision:=event_row.revision+1; next_state:=public.americano_v2_project_roster(p_event_id,signup.id);
  next_state:=jsonb_set(next_state,'{revision}',to_jsonb(next_revision::text),true);
  update public.events as row set state=next_state,revision=next_revision,updated_at=clock_timestamp() where row.id=p_event_id;
  insert into public.event_v2_requests(event_id,request_id,operation,payload_sha256,applied_revision,result_ids)
    values(p_event_id,p_request_id,'organizer_mutate_signup_entry_v2',payload_hash,next_revision,jsonb_build_object('registrationId',registration.id));
  return jsonb_build_object('status','applied','requestId',p_request_id,'committedEventRevision',next_revision::text,'snapshot',public.owner_event_snapshot_v2_internal(p_event_id,owner_id));
exception when invalid_text_representation or check_violation then return public.americano_v2_rejected(p_request_id,'INVALID_PAYLOAD','Roster command is invalid.');
end;
$$;

create or replace function public.organizer_correct_signup_labels_v2(
  p_event_id uuid,p_base_event_revision bigint,p_signup_event_id uuid,p_base_capacity_revision bigint,
  p_base_roster_revision bigint,p_request_id uuid,p_registration_id uuid,p_expected_updated_at timestamptz,p_labels jsonb
)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare owner_id uuid:=auth.uid(); event_row public.events%rowtype; signup public.signup_events%rowtype; registration public.signup_registrations%rowtype;
  payload_hash text; existing_reply jsonb; next_revision bigint; next_state jsonb;
begin
  if owner_id is null then return public.americano_v2_rejected(p_request_id,'NOT_AUTHENTICATED','Sign in to correct this entry.'); end if;
  perform set_config('app.americano_v2_rpc','on',true);
  if jsonb_typeof(p_labels)<>'object' or exists(select 1 from jsonb_object_keys(p_labels) key where key not in ('teamName','playerOne','playerTwo','contact','playerTwoContact')) then
    return public.americano_v2_rejected(p_request_id,'INVALID_PAYLOAD','Correction fields are invalid.'); end if;
  payload_hash:=public.americano_v2_payload_hash('organizer_correct_signup_labels_v2',jsonb_build_object('baseEventRevision',p_base_event_revision,'signupEventId',p_signup_event_id,'baseCapacityRevision',p_base_capacity_revision,'baseRosterRevision',p_base_roster_revision,'registrationId',p_registration_id,'expectedUpdatedAt',p_expected_updated_at,'labels',p_labels));
  select * into event_row from public.events row where row.id=p_event_id and row.user_id=owner_id for update;
  if not found then return public.americano_v2_rejected(p_request_id,'NOT_FOUND_OR_NOT_OWNED','This event could not be found.'); end if;
  existing_reply:=public.americano_v2_receipt_reply(p_event_id,owner_id,p_request_id,'organizer_correct_signup_labels_v2',payload_hash); if existing_reply is not null then return existing_reply; end if;
  select * into signup from public.signup_events row where row.id=p_signup_event_id and row.source_event_uuid=p_event_id and row.owner_user_id=owner_id for update;
  if not found then return public.americano_v2_rejected(p_request_id,'NOT_FOUND_OR_NOT_OWNED','Signup page not found.'); end if;
  if event_row.revision<>p_base_event_revision or signup.capacity_revision<>p_base_capacity_revision or signup.roster_revision<>p_base_roster_revision then return jsonb_build_object('status','conflict','requestId',p_request_id,'code','ROSTER_REVISION_CONFLICT','snapshot',public.owner_event_snapshot_v2_internal(p_event_id,owner_id)); end if;
  select * into registration from public.signup_registrations row where row.id=p_registration_id and row.signup_event_id=signup.id for update;
  if not found then return public.americano_v2_rejected(p_request_id,'NOT_FOUND_OR_NOT_OWNED','Registration not found.'); end if;
  if registration.updated_at<>p_expected_updated_at then return jsonb_build_object('status','conflict','requestId',p_request_id,'code','ROSTER_REVISION_CONFLICT','snapshot',public.owner_event_snapshot_v2_internal(p_event_id,owner_id)); end if;
  if p_labels ? 'playerOne' and coalesce(trim(p_labels->>'playerOne'),'')='' then return public.americano_v2_rejected(p_request_id,'INVALID_PAYLOAD','Player one cannot be empty.','playerOne'); end if;
  if signup.entry_mode='fixed-pairs' and p_labels ? 'playerTwo' and coalesce(trim(p_labels->>'playerTwo'),'')='' then return public.americano_v2_rejected(p_request_id,'INVALID_PAYLOAD','Player two cannot be empty.','playerTwo'); end if;
  update public.signup_registrations row set team_name=case when signup.entry_mode='individual' then '' else coalesce(nullif(trim(p_labels->>'teamName'),''),row.team_name) end,
    player_one=case when p_labels?'playerOne' then trim(p_labels->>'playerOne') else row.player_one end,
    player_two=case when p_labels?'playerTwo' then trim(p_labels->>'playerTwo') else row.player_two end,
    contact=case when p_labels?'contact' then trim(p_labels->>'contact') else row.contact end,
    player_two_contact=case when p_labels?'playerTwoContact' then nullif(trim(p_labels->>'playerTwoContact'),'') else row.player_two_contact end,
    updated_at=clock_timestamp() where row.id=p_registration_id;
  next_revision:=event_row.revision+1; next_state:=public.americano_v2_project_roster(p_event_id,signup.id); next_state:=jsonb_set(next_state,'{revision}',to_jsonb(next_revision::text),true);
  update public.events row set state=next_state,revision=next_revision,updated_at=clock_timestamp() where row.id=p_event_id;
  insert into public.event_v2_requests values(p_event_id,p_request_id,'organizer_correct_signup_labels_v2',payload_hash,next_revision,jsonb_build_object('registrationId',p_registration_id),clock_timestamp());
  return jsonb_build_object('status','applied','requestId',p_request_id,'committedEventRevision',next_revision::text,'snapshot',public.owner_event_snapshot_v2_internal(p_event_id,owner_id));
end; $$;

create or replace function public.organizer_start_americano_v2(
  p_event_id uuid,p_base_event_revision bigint,p_signup_event_id uuid,p_base_capacity_revision bigint,
  p_base_roster_revision bigint,p_request_id uuid,p_start_state jsonb
)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare owner_id uuid:=auth.uid(); event_row public.events%rowtype; signup public.signup_events%rowtype; payload_hash text; existing_reply jsonb;
  validation_error text; next_revision bigint; next_state jsonb; server_ids text[]; candidate_ids text[];
begin
  if owner_id is null then return public.americano_v2_rejected(p_request_id,'NOT_AUTHENTICATED','Sign in to start this event.'); end if;
  perform set_config('app.americano_v2_rpc','on',true);
  payload_hash:=public.americano_v2_payload_hash('organizer_start_americano_v2',jsonb_build_object('baseEventRevision',p_base_event_revision,'signupEventId',p_signup_event_id,'baseCapacityRevision',p_base_capacity_revision,'baseRosterRevision',p_base_roster_revision,'startState',p_start_state));
  select * into event_row from public.events row where row.id=p_event_id and row.user_id=owner_id for update;
  if not found then return public.americano_v2_rejected(p_request_id,'NOT_FOUND_OR_NOT_OWNED','This event could not be found.'); end if;
  if event_row.deleted_at is not null then return public.americano_v2_rejected(p_request_id,'EVENT_DELETED','This event was deleted.'); end if;
  existing_reply:=public.americano_v2_receipt_reply(p_event_id,owner_id,p_request_id,'organizer_start_americano_v2',payload_hash); if existing_reply is not null then return existing_reply; end if;
  if event_row.state->>'status'<>'setup' then return public.americano_v2_rejected(p_request_id,'MODE_LOCKED','This event has already started.'); end if;
  if event_row.revision<>p_base_event_revision then return jsonb_build_object('status','conflict','requestId',p_request_id,'code','EVENT_REVISION_CONFLICT','snapshot',public.owner_event_snapshot_v2_internal(p_event_id,owner_id)); end if;
  validation_error:=public.americano_v2_state_error(p_start_state); if validation_error is not null or p_start_state->>'status'='setup' then return public.americano_v2_rejected(p_request_id,'INVALID_SCHEDULE','The start preview is invalid.'); end if;
  if p_start_state->>'id'<>p_event_id::text or p_start_state->'courts' is distinct from event_row.state->'courts'
     or p_start_state->'teams' is distinct from event_row.state->'teams' or p_start_state->'participants' is distinct from event_row.state->'participants'
     or p_start_state->'formatConfig' is distinct from event_row.state->'formatConfig' then return public.americano_v2_rejected(p_request_id,'PREVIEW_STALE','The roster or settings changed after preview.'); end if;
  if p_signup_event_id is not null then
    select * into signup from public.signup_events row where row.id=p_signup_event_id and row.source_event_uuid=p_event_id and row.owner_user_id=owner_id for update;
    if not found then return public.americano_v2_rejected(p_request_id,'NOT_FOUND_OR_NOT_OWNED','Signup page not found.'); end if;
    if signup.capacity_revision<>p_base_capacity_revision then return jsonb_build_object('status','conflict','requestId',p_request_id,'code','SIGNUP_REVISION_CONFLICT','snapshot',public.owner_event_snapshot_v2_internal(p_event_id,owner_id)); end if;
    if signup.roster_revision<>p_base_roster_revision then return jsonb_build_object('status','conflict','requestId',p_request_id,'code','ROSTER_REVISION_CONFLICT','snapshot',public.owner_event_snapshot_v2_internal(p_event_id,owner_id)); end if;
    select array_agg(row.canonical_entrant_id::text order by row.organizer_rank nulls last,row.created_at,row.id) into server_ids from public.signup_registrations row where row.signup_event_id=signup.id and row.status='confirmed';
    select array_agg(value #>> '{}' order by ordinal) into candidate_ids from jsonb_array_elements(p_start_state#>'{americanoSchedule,orderedEntrantIds}') with ordinality ids(value,ordinal);
    if server_ids is distinct from candidate_ids or p_start_state#>>'{americanoSchedule,rosterRevision}'<>signup.roster_revision::text then return public.americano_v2_rejected(p_request_id,'PREVIEW_STALE','The confirmed roster changed after preview.'); end if;
    update public.signup_events row set is_open=false,roster_locked_at=clock_timestamp(),capacity_revision=row.capacity_revision+1,updated_at=clock_timestamp() where row.id=signup.id;
  elsif coalesce(p_base_capacity_revision,0)<>0 or coalesce(p_base_roster_revision,0)<>0 then return public.americano_v2_rejected(p_request_id,'INVALID_PAYLOAD','Unpublished start revisions must be zero.'); end if;
  next_revision:=event_row.revision+1; next_state:=jsonb_set(p_start_state,'{revision}',to_jsonb(next_revision::text),true);
  if p_signup_event_id is not null then next_state:=jsonb_set(next_state,'{settings,publishedSignupOpen}','false'::jsonb,true); end if;
  update public.events row set state=next_state,revision=next_revision,updated_at=clock_timestamp() where row.id=p_event_id;
  insert into public.event_v2_requests values(p_event_id,p_request_id,'organizer_start_americano_v2',payload_hash,next_revision,'{}',clock_timestamp());
  return jsonb_build_object('status','applied','requestId',p_request_id,'committedEventRevision',next_revision::text,'snapshot',public.owner_event_snapshot_v2_internal(p_event_id,owner_id));
end; $$;

create or replace function public.organizer_set_signup_open_v2(p_event_id uuid,p_base_event_revision bigint,p_signup_event_id uuid,p_base_capacity_revision bigint,p_request_id uuid,p_is_open boolean)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare owner_id uuid:=auth.uid(); event_row public.events%rowtype; signup public.signup_events%rowtype; payload_hash text; existing_reply jsonb; next_revision bigint; next_state jsonb;
begin
  if owner_id is null then return public.americano_v2_rejected(p_request_id,'NOT_AUTHENTICATED','Sign in to change registration.'); end if; perform set_config('app.americano_v2_rpc','on',true);
  payload_hash:=public.americano_v2_payload_hash('organizer_set_signup_open_v2',jsonb_build_object('baseEventRevision',p_base_event_revision,'signupEventId',p_signup_event_id,'baseCapacityRevision',p_base_capacity_revision,'isOpen',p_is_open));
  select * into event_row from public.events row where row.id=p_event_id and row.user_id=owner_id for update; if not found then return public.americano_v2_rejected(p_request_id,'NOT_FOUND_OR_NOT_OWNED','Event not found.'); end if;
  existing_reply:=public.americano_v2_receipt_reply(p_event_id,owner_id,p_request_id,'organizer_set_signup_open_v2',payload_hash); if existing_reply is not null then return existing_reply; end if;
  select * into signup from public.signup_events row where row.id=p_signup_event_id and row.source_event_uuid=p_event_id and row.owner_user_id=owner_id for update; if not found then return public.americano_v2_rejected(p_request_id,'NOT_FOUND_OR_NOT_OWNED','Signup not found.'); end if;
  if event_row.revision<>p_base_event_revision then return jsonb_build_object('status','conflict','requestId',p_request_id,'code','EVENT_REVISION_CONFLICT','snapshot',public.owner_event_snapshot_v2_internal(p_event_id,owner_id)); end if;
  if signup.capacity_revision<>p_base_capacity_revision then return jsonb_build_object('status','conflict','requestId',p_request_id,'code','SIGNUP_REVISION_CONFLICT','snapshot',public.owner_event_snapshot_v2_internal(p_event_id,owner_id)); end if;
  if p_is_open and (signup.roster_locked_at is not null or signup.cancelled_at is not null or event_row.state->>'status'<>'setup' or (signup.starts_at is not null and signup.starts_at<=now())) then return public.americano_v2_rejected(p_request_id,'REGISTRATIONS_CLOSED','This signup cannot be reopened.'); end if;
  update public.signup_events row set is_open=p_is_open,capacity_revision=row.capacity_revision+case when row.is_open is distinct from p_is_open then 1 else 0 end,updated_at=clock_timestamp() where row.id=signup.id;
  next_revision:=event_row.revision+1; next_state:=jsonb_set(jsonb_set(event_row.state,'{settings,publishedSignupOpen}',to_jsonb(p_is_open),true),'{revision}',to_jsonb(next_revision::text),true);
  update public.events row set state=next_state,revision=next_revision,updated_at=clock_timestamp() where row.id=p_event_id;
  insert into public.event_v2_requests values(p_event_id,p_request_id,'organizer_set_signup_open_v2',payload_hash,next_revision,'{}',clock_timestamp());
  return jsonb_build_object('status','applied','requestId',p_request_id,'committedEventRevision',next_revision::text,'snapshot',public.owner_event_snapshot_v2_internal(p_event_id,owner_id));
end; $$;

create or replace function public.organizer_cancel_signup_event_v2(p_event_id uuid,p_base_event_revision bigint,p_signup_event_id uuid,p_base_capacity_revision bigint,p_request_id uuid,p_message text)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare owner_id uuid:=auth.uid(); event_row public.events%rowtype; signup public.signup_events%rowtype; payload_hash text; existing_reply jsonb; next_revision bigint; next_state jsonb; next_message text:=nullif(trim(coalesce(p_message,'')),'');
begin
  if owner_id is null then return public.americano_v2_rejected(p_request_id,'NOT_AUTHENTICATED','Sign in to cancel this event.'); end if; if char_length(coalesce(next_message,''))>500 then return public.americano_v2_rejected(p_request_id,'INVALID_PAYLOAD','Cancellation message is too long.','message'); end if; perform set_config('app.americano_v2_rpc','on',true);
  payload_hash:=public.americano_v2_payload_hash('organizer_cancel_signup_event_v2',jsonb_build_object('baseEventRevision',p_base_event_revision,'signupEventId',p_signup_event_id,'baseCapacityRevision',p_base_capacity_revision,'message',next_message));
  select * into event_row from public.events row where row.id=p_event_id and row.user_id=owner_id for update; if not found then return public.americano_v2_rejected(p_request_id,'NOT_FOUND_OR_NOT_OWNED','Event not found.'); end if;
  existing_reply:=public.americano_v2_receipt_reply(p_event_id,owner_id,p_request_id,'organizer_cancel_signup_event_v2',payload_hash); if existing_reply is not null then return existing_reply; end if;
  select * into signup from public.signup_events row where row.id=p_signup_event_id and row.source_event_uuid=p_event_id and row.owner_user_id=owner_id for update; if not found then return public.americano_v2_rejected(p_request_id,'NOT_FOUND_OR_NOT_OWNED','Signup not found.'); end if;
  if event_row.revision<>p_base_event_revision then return jsonb_build_object('status','conflict','requestId',p_request_id,'code','EVENT_REVISION_CONFLICT','snapshot',public.owner_event_snapshot_v2_internal(p_event_id,owner_id)); end if; if signup.capacity_revision<>p_base_capacity_revision then return jsonb_build_object('status','conflict','requestId',p_request_id,'code','SIGNUP_REVISION_CONFLICT','snapshot',public.owner_event_snapshot_v2_internal(p_event_id,owner_id)); end if;
  update public.signup_events row set cancelled_at=coalesce(row.cancelled_at,clock_timestamp()),cancellation_message=coalesce(row.cancellation_message,next_message),is_open=false,capacity_revision=row.capacity_revision+case when row.cancelled_at is null or row.is_open then 1 else 0 end,updated_at=clock_timestamp() where row.id=signup.id;
  next_revision:=event_row.revision+1; next_state:=jsonb_set(jsonb_set(jsonb_set(event_row.state,'{settings,publishedSignupOpen}','false',true),'{settings,publishedCancelledAt}',to_jsonb(clock_timestamp()),true),'{revision}',to_jsonb(next_revision::text),true);
  update public.events row set state=next_state,revision=next_revision,updated_at=clock_timestamp() where row.id=p_event_id;
  insert into public.event_v2_requests values(p_event_id,p_request_id,'organizer_cancel_signup_event_v2',payload_hash,next_revision,'{}',clock_timestamp()); return jsonb_build_object('status','applied','requestId',p_request_id,'committedEventRevision',next_revision::text,'snapshot',public.owner_event_snapshot_v2_internal(p_event_id,owner_id));
end; $$;

create or replace function public.organizer_delete_event_v2(p_event_id uuid,p_base_event_revision bigint,p_request_id uuid)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare owner_id uuid:=auth.uid(); event_row public.events%rowtype; payload_hash text; receipt public.event_v2_requests%rowtype; deletion_time timestamptz;
begin
  if owner_id is null then return public.americano_v2_rejected(p_request_id,'NOT_AUTHENTICATED','Sign in to delete this event.'); end if; perform set_config('app.americano_v2_rpc','on',true);
  payload_hash:=public.americano_v2_payload_hash('organizer_delete_event_v2',jsonb_build_object('baseEventRevision',p_base_event_revision));
  select * into event_row from public.events row where row.id=p_event_id and row.user_id=owner_id for update; if not found then return public.americano_v2_rejected(p_request_id,'NOT_FOUND_OR_NOT_OWNED','Event not found.'); end if;
  if event_row.deleted_at is not null then return jsonb_build_object('status','replayed','requestId',p_request_id,'eventId',p_event_id,'deletedAt',event_row.deleted_at); end if;
  if event_row.protocol_version<>2 then return public.americano_v2_rejected(p_request_id,'UPDATE_REQUIRED','Use the legacy delete action for this event.'); end if;
  if event_row.revision<>p_base_event_revision then return jsonb_build_object('status','conflict','requestId',p_request_id,'code','EVENT_REVISION_CONFLICT','snapshot',public.owner_event_snapshot_v2_internal(p_event_id,owner_id)); end if;
  deletion_time:=clock_timestamp(); update public.signup_events row set cancelled_at=coalesce(row.cancelled_at,deletion_time),cancellation_message=coalesce(row.cancellation_message,'This event has been cancelled by the organiser.'),is_open=false,capacity_revision=row.capacity_revision+1,updated_at=deletion_time where row.source_event_uuid=p_event_id and row.owner_user_id=owner_id;
  insert into public.event_tombstones(user_id,event_id,deleted_at) values(owner_id,p_event_id,deletion_time) on conflict(user_id,event_id) do update set deleted_at=least(public.event_tombstones.deleted_at,excluded.deleted_at);
  update public.events row set state=null,deleted_at=deletion_time,updated_at=deletion_time where row.id=p_event_id;
  return jsonb_build_object('status','applied','requestId',p_request_id,'eventId',p_event_id,'deletedAt',deletion_time);
end; $$;

revoke all on function public.americano_v2_project_roster(uuid,uuid) from public,anon,authenticated;
revoke all on function public.americano_v2_commit_roster_projection(uuid,uuid) from public,anon,authenticated;
revoke all on function public.americano_v2_receipt_reply(uuid,uuid,uuid,text,text) from public,anon,authenticated;
revoke all on function public.organizer_save_signup_event_v3(uuid,bigint,uuid,bigint,bigint,uuid,jsonb,jsonb) from public,anon;
revoke all on function public.organizer_mutate_signup_entry_v2(uuid,bigint,uuid,bigint,bigint,uuid,jsonb) from public,anon;
revoke all on function public.organizer_correct_signup_labels_v2(uuid,bigint,uuid,bigint,bigint,uuid,uuid,timestamptz,jsonb) from public,anon;
revoke all on function public.organizer_start_americano_v2(uuid,bigint,uuid,bigint,bigint,uuid,jsonb) from public,anon;
revoke all on function public.organizer_set_signup_open_v2(uuid,bigint,uuid,bigint,uuid,boolean) from public,anon;
revoke all on function public.organizer_cancel_signup_event_v2(uuid,bigint,uuid,bigint,uuid,text) from public,anon;
revoke all on function public.organizer_delete_event_v2(uuid,bigint,uuid) from public,anon;
grant execute on function public.organizer_save_signup_event_v3(uuid,bigint,uuid,bigint,bigint,uuid,jsonb,jsonb) to authenticated;
grant execute on function public.organizer_mutate_signup_entry_v2(uuid,bigint,uuid,bigint,bigint,uuid,jsonb) to authenticated;
grant execute on function public.organizer_correct_signup_labels_v2(uuid,bigint,uuid,bigint,bigint,uuid,uuid,timestamptz,jsonb) to authenticated;
grant execute on function public.organizer_start_americano_v2(uuid,bigint,uuid,bigint,bigint,uuid,jsonb) to authenticated;
grant execute on function public.organizer_set_signup_open_v2(uuid,bigint,uuid,bigint,uuid,boolean) to authenticated;
grant execute on function public.organizer_cancel_signup_event_v2(uuid,bigint,uuid,bigint,uuid,text) to authenticated;
grant execute on function public.organizer_delete_event_v2(uuid,bigint,uuid) to authenticated;
