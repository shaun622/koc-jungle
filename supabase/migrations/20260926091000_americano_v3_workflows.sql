-- Americano v3 owner workflows. Keep transport protocol 2 and the existing
-- event -> signup -> registration row lock order. No historical migration edit.

create or replace function public.organizer_save_event_v3(
  p_event_id uuid,p_base_event_revision bigint,p_request_id uuid,p_state jsonb
)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare owner_id uuid:=auth.uid(); event_row public.events%rowtype; receipt public.event_v2_requests%rowtype;
  payload_hash text; validation_error text; next_revision bigint; next_state jsonb; signup_id uuid;
  old_final jsonb; new_final jsonb;
begin
  if owner_id is null then return public.americano_v2_rejected(p_request_id,'NOT_AUTHENTICATED','Sign in to save this event.'); end if;
  if p_request_id is null or p_base_event_revision is null or p_base_event_revision<0 then return public.americano_v2_rejected(p_request_id,'INVALID_PAYLOAD','A request id and non-negative base revision are required.'); end if;
  validation_error:=public.americano_v3_state_error(p_state);
  if validation_error is not null then return public.americano_v2_rejected(p_request_id,validation_error,'The Americano event payload is invalid.'); end if;
  if p_state->>'id'<>p_event_id::text then return public.americano_v2_rejected(p_request_id,'INVALID_PAYLOAD','Event id does not match the payload.','id'); end if;
  perform set_config('app.americano_v2_rpc','on',true);
  perform set_config('app.americano_v3_rpc','on',true);
  payload_hash:=public.americano_v2_payload_hash('organizer_save_event_v3',jsonb_build_object('baseEventRevision',p_base_event_revision,'state',p_state));
  select * into event_row from public.events row where row.id=p_event_id and row.user_id=owner_id for update;
  if found and event_row.deleted_at is not null then return public.americano_v2_rejected(p_request_id,'EVENT_DELETED','This event was deleted.'); end if;
  if found then
    select * into receipt from public.event_v2_requests row where row.event_id=p_event_id and row.request_id=p_request_id;
    if found then
      if receipt.operation<>'organizer_save_event_v3' or receipt.payload_sha256<>payload_hash then return public.americano_v2_rejected(p_request_id,'IDEMPOTENCY_MISMATCH','This request id was already used for different data.'); end if;
      return jsonb_build_object('status','replayed','requestId',p_request_id,'committedEventRevision',receipt.applied_revision::text,'snapshot',public.owner_event_snapshot_v2_internal(p_event_id,owner_id));
    end if;
    if event_row.protocol_version<>2 or event_row.state->>'schemaVersion'<>'3' then return public.americano_v2_rejected(p_request_id,'UPDATE_REQUIRED','This event does not use Americano rules 3.'); end if;
    if event_row.revision<>p_base_event_revision then return jsonb_build_object('status','conflict','requestId',p_request_id,'code','EVENT_REVISION_CONFLICT','snapshot',public.owner_event_snapshot_v2_internal(p_event_id,owner_id)); end if;
    select signup.id into signup_id from public.signup_events signup where signup.source_event_uuid=p_event_id and signup.owner_user_id=owner_id;
    if signup_id is not null and event_row.state->>'status'='setup' and p_state->>'status'<>'setup' then return public.americano_v2_rejected(p_request_id,'START_REQUIRED','Use Start event to close registration and freeze the roster.'); end if;
    if event_row.state->>'status'<>'setup' and p_state->>'status'='setup' then return public.americano_v2_rejected(p_request_id,'MODE_LOCKED','A started event cannot be reset to setup.'); end if;
    if event_row.state->>'status'<>'setup' and (
      event_row.state->'formatConfig' is distinct from p_state->'formatConfig'
      or event_row.state->'courts' is distinct from p_state->'courts'
      or event_row.state#>'{americanoSchedule}' is distinct from p_state#>'{americanoSchedule}'
      or event_row.state#>'{teams}' is distinct from p_state#>'{teams}'
      or event_row.state#>'{participants}' is distinct from p_state#>'{participants}'
    ) then return public.americano_v2_rejected(p_request_id,'RULES_LOCKED','Rules, roster membership and fixtures are frozen after play starts.'); end if;
    if event_row.state->>'status'='complete' and p_state->>'status'<>'complete' then return public.americano_v2_rejected(p_request_id,'MODE_LOCKED','A completed event cannot be reopened.'); end if;
    old_final:=event_row.state->'championshipFinal'; new_final:=p_state->'championshipFinal';
    if old_final is distinct from new_final and new_final is not null and new_final<>'null'::jsonb then
      if old_final is not null and old_final<>'null'::jsonb
        and jsonb_build_object('id',old_final->'id','basisFingerprint',old_final->'basisFingerprint','contenderIds',old_final->'contenderIds','courtId',old_final->'courtId','supportPlayerIds',old_final->'supportPlayerIds')
          is distinct from jsonb_build_object('id',new_final->'id','basisFingerprint',new_final->'basisFingerprint','contenderIds',new_final->'contenderIds','courtId',new_final->'courtId','supportPlayerIds',new_final->'supportPlayerIds') then
        return public.americano_v2_rejected(p_request_id,'FINAL_NOT_ELIGIBLE','Reset the prepared final before changing its sides, court or support partners.','championshipFinal');
      end if;
      validation_error:=public.americano_v3_final_shape_error(p_state);
      if validation_error is null then validation_error:=public.americano_v3_final_eligibility_error(p_state,new_final); end if;
      if validation_error is not null then
        return public.americano_v2_rejected(p_request_id,validation_error,
          case validation_error when 'FINAL_STALE' then 'Regular results changed. Reset and prepare the championship final again.' else 'The current results do not allow this championship final.' end,
          'championshipFinal');
      end if;
    end if;
    next_revision:=event_row.revision+1;
    next_state:=jsonb_set(p_state,'{revision}',to_jsonb(next_revision::text),true);
    update public.events row set state=next_state,revision=next_revision,updated_at=clock_timestamp() where row.id=p_event_id;
  else
    if exists(select 1 from public.events row where row.id=p_event_id)
       or exists(select 1 from public.event_tombstones tombstone where tombstone.event_id=p_event_id and tombstone.user_id<>owner_id) then return public.americano_v2_rejected(p_request_id,'NOT_FOUND_OR_NOT_OWNED','This event could not be found or is owned by another account.'); end if;
    if exists(select 1 from public.event_tombstones tombstone where tombstone.user_id=owner_id and tombstone.event_id=p_event_id) then return public.americano_v2_rejected(p_request_id,'EVENT_DELETED','This event was deleted.'); end if;
    if p_base_event_revision<>0 then return public.americano_v2_rejected(p_request_id,'EVENT_REVISION_CONFLICT','A new event must start at revision 0.'); end if;
    if p_state->>'status'<>'setup' then return public.americano_v2_rejected(p_request_id,'INVALID_SCHEDULE','A new event must be saved in setup before it starts.'); end if;
    next_revision:=1;
    next_state:=jsonb_set(p_state,'{revision}',to_jsonb('1'::text),true);
    insert into public.events(id,user_id,state,protocol_version,revision,updated_at) values(p_event_id,owner_id,next_state,2,1,clock_timestamp());
  end if;
  insert into public.event_v2_requests(event_id,request_id,operation,payload_sha256,applied_revision,result_ids)
    values(p_event_id,p_request_id,'organizer_save_event_v3',payload_hash,next_revision,'{}'::jsonb);
  return jsonb_build_object('status','applied','requestId',p_request_id,'committedEventRevision',next_revision::text,'snapshot',public.owner_event_snapshot_v2_internal(p_event_id,owner_id));
exception when unique_violation then return public.americano_v2_rejected(p_request_id,'IDEMPOTENCY_MISMATCH','This request id was already used.');
end;
$$;

create or replace function public.organizer_save_americano_config_v3(
  p_event_id uuid,p_base_event_revision bigint,p_signup_event_id uuid,p_base_capacity_revision bigint,
  p_base_roster_revision bigint,p_request_id uuid,p_courts jsonb,p_format_config jsonb
)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare owner_id uuid:=auth.uid(); event_row public.events%rowtype; signup public.signup_events%rowtype;
  receipt public.event_v2_requests%rowtype; payload_hash text; validation_error text; next_revision bigint; next_state jsonb;
  capacity integer; mode text; changed boolean;
begin
  if owner_id is null then return public.americano_v2_rejected(p_request_id,'NOT_AUTHENTICATED','Sign in to change this event.'); end if;
  validation_error:=public.americano_v3_config_error(p_format_config);
  if validation_error is not null then return public.americano_v2_rejected(p_request_id,validation_error,'Check the Americano rules and schedule fields.','formatConfig'); end if;
  if jsonb_typeof(p_courts)<>'array' or jsonb_array_length(p_courts) not between 1 and 16
    or (select count(distinct court->>'id') from jsonb_array_elements(p_courts) court)<>jsonb_array_length(p_courts)
    or exists(select 1 from jsonb_array_elements(p_courts) court where coalesce(trim(court->>'id'),'')='' or coalesce(trim(court->>'name'),'')='') then
    return public.americano_v2_rejected(p_request_id,'INVALID_SCHEDULE','Use 1–16 uniquely named courts.','courts'); end if;
  perform set_config('app.americano_v2_rpc','on',true);
  perform set_config('app.americano_v3_rpc','on',true);
  payload_hash:=public.americano_v2_payload_hash('organizer_save_americano_config_v3',jsonb_build_object('baseEventRevision',p_base_event_revision,
    'signupEventId',p_signup_event_id,'baseCapacityRevision',p_base_capacity_revision,'baseRosterRevision',p_base_roster_revision,'courts',p_courts,'formatConfig',p_format_config));
  select * into event_row from public.events row where row.id=p_event_id and row.user_id=owner_id for update;
  if not found then return public.americano_v2_rejected(p_request_id,'NOT_FOUND_OR_NOT_OWNED','This event could not be found.'); end if;
  if event_row.deleted_at is not null then return public.americano_v2_rejected(p_request_id,'EVENT_DELETED','This event was deleted.'); end if;
  if event_row.protocol_version<>2 or event_row.state->>'schemaVersion'<>'3' then return public.americano_v2_rejected(p_request_id,'UPDATE_REQUIRED','This event does not use Americano rules 3.'); end if;
  select * into receipt from public.event_v2_requests row where row.event_id=p_event_id and row.request_id=p_request_id;
  if found then
    if receipt.operation<>'organizer_save_americano_config_v3' or receipt.payload_sha256<>payload_hash then return public.americano_v2_rejected(p_request_id,'IDEMPOTENCY_MISMATCH','This request id was already used for different data.'); end if;
    return jsonb_build_object('status','replayed','requestId',p_request_id,'committedEventRevision',receipt.applied_revision::text,'snapshot',public.owner_event_snapshot_v2_internal(p_event_id,owner_id));
  end if;
  if event_row.state->>'status'<>'setup' then return public.americano_v2_rejected(p_request_id,'RULES_LOCKED','Settings are locked after play starts.'); end if;
  if event_row.revision<>p_base_event_revision then return jsonb_build_object('status','conflict','requestId',p_request_id,'code','EVENT_REVISION_CONFLICT','snapshot',public.owner_event_snapshot_v2_internal(p_event_id,owner_id)); end if;
  select * into signup from public.signup_events row where row.source_event_uuid=p_event_id and row.owner_user_id=owner_id for update;
  if signup.id is distinct from p_signup_event_id then return public.americano_v2_rejected(p_request_id,'SIGNUP_REVISION_CONFLICT','Reload the linked sign-up before saving settings.'); end if;
  if p_signup_event_id is not null then
    if signup.capacity_revision<>p_base_capacity_revision then return jsonb_build_object('status','conflict','requestId',p_request_id,'code','SIGNUP_REVISION_CONFLICT','snapshot',public.owner_event_snapshot_v2_internal(p_event_id,owner_id)); end if;
    if signup.roster_revision<>p_base_roster_revision then return jsonb_build_object('status','conflict','requestId',p_request_id,'code','ROSTER_REVISION_CONFLICT','snapshot',public.owner_event_snapshot_v2_internal(p_event_id,owner_id)); end if;
    mode:=case p_format_config->>'pairingMode' when 'rotating' then 'individual' else 'fixed-pairs' end;
    if signup.entry_mode<>mode then return public.americano_v2_rejected(p_request_id,'MODE_LOCKED','Pairing mode cannot change after publishing.','formatConfig.pairingMode'); end if;
    capacity:=jsonb_array_length(p_courts)*case when mode='individual' then 4 else 2 end;
    changed:=signup.capacity_teams is distinct from case when mode='fixed-pairs' then capacity else 0 end
      or signup.capacity_players is distinct from case when mode='individual' then capacity else null end;
    update public.signup_events row set capacity_teams=case when mode='fixed-pairs' then capacity else 0 end,
      capacity_players=case when mode='individual' then capacity else null end,
      capacity_revision=row.capacity_revision+case when changed then 1 else 0 end,updated_at=clock_timestamp() where row.id=signup.id;
    perform public.rebalance_signup_event(signup.id);
  elsif coalesce(p_base_capacity_revision,0)<>0 or coalesce(p_base_roster_revision,0)<>0 then
    return public.americano_v2_rejected(p_request_id,'INVALID_PAYLOAD','Unpublished sign-up revisions must be zero.');
  end if;
  next_revision:=event_row.revision+1;
  next_state:=case when signup.id is not null then public.americano_v2_project_roster(p_event_id,signup.id) else event_row.state end;
  next_state:=jsonb_set(jsonb_set(jsonb_set(next_state-'americanoSchedule','{courts}',p_courts,true),'{formatConfig}',p_format_config,true),'{revision}',to_jsonb(next_revision::text),true);
  validation_error:=public.americano_v3_state_error(next_state);
  if validation_error is not null then return public.americano_v2_rejected(p_request_id,validation_error,'Projected sign-up roster does not fit these settings.','courts'); end if;
  update public.events row set state=next_state,revision=next_revision,updated_at=clock_timestamp() where row.id=p_event_id;
  insert into public.event_v2_requests(event_id,request_id,operation,payload_sha256,applied_revision,result_ids)
    values(p_event_id,p_request_id,'organizer_save_americano_config_v3',payload_hash,next_revision,'{}'::jsonb);
  return jsonb_build_object('status','applied','requestId',p_request_id,'committedEventRevision',next_revision::text,'snapshot',public.owner_event_snapshot_v2_internal(p_event_id,owner_id));
exception when unique_violation then return public.americano_v2_rejected(p_request_id,'IDEMPOTENCY_MISMATCH','This request id was already used.');
end;
$$;

create or replace function public.organizer_start_americano_v3(
  p_event_id uuid,p_base_event_revision bigint,p_signup_event_id uuid,p_base_capacity_revision bigint,
  p_base_roster_revision bigint,p_request_id uuid,p_start_state jsonb
)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare owner_id uuid:=auth.uid(); event_row public.events%rowtype; signup public.signup_events%rowtype;
  payload_hash text; existing_reply jsonb; validation_error text; next_revision bigint; next_state jsonb;
  server_ids text[]; candidate_ids text[];
begin
  if owner_id is null then return public.americano_v2_rejected(p_request_id,'NOT_AUTHENTICATED','Sign in to start this event.'); end if;
  perform set_config('app.americano_v2_rpc','on',true);
  perform set_config('app.americano_v3_rpc','on',true);
  payload_hash:=public.americano_v2_payload_hash('organizer_start_americano_v3',jsonb_build_object('baseEventRevision',p_base_event_revision,'signupEventId',p_signup_event_id,
    'baseCapacityRevision',p_base_capacity_revision,'baseRosterRevision',p_base_roster_revision,'startState',p_start_state));
  select * into event_row from public.events row where row.id=p_event_id and row.user_id=owner_id for update;
  if not found then return public.americano_v2_rejected(p_request_id,'NOT_FOUND_OR_NOT_OWNED','This event could not be found.'); end if;
  if event_row.deleted_at is not null then return public.americano_v2_rejected(p_request_id,'EVENT_DELETED','This event was deleted.'); end if;
  if event_row.protocol_version<>2 or event_row.state->>'schemaVersion'<>'3' then return public.americano_v2_rejected(p_request_id,'UPDATE_REQUIRED','This event does not use Americano rules 3.'); end if;
  existing_reply:=public.americano_v2_receipt_reply(p_event_id,owner_id,p_request_id,'organizer_start_americano_v3',payload_hash);
  if existing_reply is not null then return existing_reply; end if;
  if event_row.state->>'status'<>'setup' then return public.americano_v2_rejected(p_request_id,'MODE_LOCKED','This event has already started.'); end if;
  if event_row.revision<>p_base_event_revision then return jsonb_build_object('status','conflict','requestId',p_request_id,'code','EVENT_REVISION_CONFLICT','snapshot',public.owner_event_snapshot_v2_internal(p_event_id,owner_id)); end if;
  validation_error:=public.americano_v3_state_error(p_start_state);
  if validation_error is not null or p_start_state->>'status'='setup' then return public.americano_v2_rejected(p_request_id,coalesce(validation_error,'INVALID_SCHEDULE'),'The start preview is invalid.'); end if;
  if p_start_state->>'id'<>p_event_id::text or p_start_state->'courts' is distinct from event_row.state->'courts'
    or p_start_state->'teams' is distinct from event_row.state->'teams' or p_start_state->'participants' is distinct from event_row.state->'participants'
    or p_start_state->'formatConfig' is distinct from event_row.state->'formatConfig' then return public.americano_v2_rejected(p_request_id,'PREVIEW_STALE','Roster or settings changed after preview.'); end if;
  select * into signup from public.signup_events row where row.source_event_uuid=p_event_id and row.owner_user_id=owner_id for update;
  if signup.id is distinct from p_signup_event_id then return public.americano_v2_rejected(p_request_id,'SIGNUP_REQUIRED','Reload the published sign-up before continuing.'); end if;
  if p_signup_event_id is not null then
    if signup.capacity_revision<>p_base_capacity_revision then return jsonb_build_object('status','conflict','requestId',p_request_id,'code','SIGNUP_REVISION_CONFLICT','snapshot',public.owner_event_snapshot_v2_internal(p_event_id,owner_id)); end if;
    if signup.roster_revision<>p_base_roster_revision then return jsonb_build_object('status','conflict','requestId',p_request_id,'code','ROSTER_REVISION_CONFLICT','snapshot',public.owner_event_snapshot_v2_internal(p_event_id,owner_id)); end if;
    select array_agg(registration.canonical_entrant_id::text order by registration.organizer_rank nulls last,
      case when signup.entry_mode='fixed-pairs' then registration.pair_completed_at end nulls last,registration.created_at,registration.id)
      into server_ids from public.signup_registrations registration where registration.signup_event_id=signup.id and registration.status='confirmed';
    select array_agg(value #>> '{}' order by ordinal) into candidate_ids from jsonb_array_elements(p_start_state#>'{americanoSchedule,orderedEntrantIds}') with ordinality ids(value,ordinal);
    if server_ids is distinct from candidate_ids or p_start_state#>>'{americanoSchedule,rosterRevision}'<>signup.roster_revision::text then return public.americano_v2_rejected(p_request_id,'PREVIEW_STALE','The confirmed roster changed after preview.'); end if;
    update public.signup_events row set is_open=false,roster_locked_at=clock_timestamp(),capacity_revision=row.capacity_revision+1,updated_at=clock_timestamp() where row.id=signup.id;
  elsif coalesce(p_base_capacity_revision,0)<>0 or coalesce(p_base_roster_revision,0)<>0 then
    return public.americano_v2_rejected(p_request_id,'INVALID_PAYLOAD','Unpublished start revisions must be zero.');
  end if;
  next_revision:=event_row.revision+1; next_state:=jsonb_set(p_start_state,'{revision}',to_jsonb(next_revision::text),true);
  if p_signup_event_id is not null then next_state:=jsonb_set(next_state,'{settings,publishedSignupOpen}','false'::jsonb,true); end if;
  update public.events row set state=next_state,revision=next_revision,updated_at=clock_timestamp() where row.id=p_event_id;
  insert into public.event_v2_requests(event_id,request_id,operation,payload_sha256,applied_revision,result_ids)
    values(p_event_id,p_request_id,'organizer_start_americano_v3',payload_hash,next_revision,'{}'::jsonb);
  return jsonb_build_object('status','applied','requestId',p_request_id,'committedEventRevision',next_revision::text,'snapshot',public.owner_event_snapshot_v2_internal(p_event_id,owner_id));
exception when unique_violation then return public.americano_v2_rejected(p_request_id,'IDEMPOTENCY_MISMATCH','This request id was already used.');
end;
$$;

revoke all on function public.organizer_save_event_v3(uuid,bigint,uuid,jsonb) from public,anon;
revoke all on function public.organizer_save_americano_config_v3(uuid,bigint,uuid,bigint,bigint,uuid,jsonb,jsonb) from public,anon;
revoke all on function public.organizer_start_americano_v3(uuid,bigint,uuid,bigint,bigint,uuid,jsonb) from public,anon;
grant execute on function public.organizer_save_event_v3(uuid,bigint,uuid,jsonb) to authenticated;
grant execute on function public.organizer_save_americano_config_v3(uuid,bigint,uuid,bigint,bigint,uuid,jsonb,jsonb) to authenticated;
grant execute on function public.organizer_start_americano_v3(uuid,bigint,uuid,bigint,bigint,uuid,jsonb) to authenticated;
