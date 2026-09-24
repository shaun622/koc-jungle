-- Americano v2 public/owner readers and mode-aware public registration.

alter table public.signup_public_requests
  drop constraint if exists signup_public_requests_operation_check;
alter table public.signup_public_requests
  add constraint signup_public_requests_operation_check
  check (operation in ('register','join','register-player-v2','register-single-v3','register-pair-v3','join-v3'));

create or replace function public.americano_normalize_name(p_value text)
returns text language sql immutable set search_path=public,pg_temp as $$
  select lower(regexp_replace(trim(normalize(coalesce(p_value,''), NFKC)), '\s+', ' ', 'g'))
$$;

create or replace function public.americano_normalize_contact(p_value text)
returns text language sql immutable set search_path=public,pg_temp as $$
  select case when normalize(coalesce(p_value,''), NFKC) !~* '[a-z@]'
    then regexp_replace(normalize(coalesce(p_value,''), NFKC), '[^0-9]', '', 'g')
    else lower(regexp_replace(trim(normalize(coalesce(p_value,''), NFKC)), '\s+', ' ', 'g')) end
$$;

create or replace function public.americano_public_rejected(p_request_id uuid,p_code text,p_message text,p_field text default null)
returns jsonb language sql immutable set search_path=public,pg_temp as $$
  select jsonb_strip_nulls(jsonb_build_object('status','rejected','requestId',p_request_id,'code',p_code,'message',p_message,'field',p_field))
$$;

create or replace function public.americano_public_position(p_registration_id uuid)
returns integer language sql stable security definer set search_path=public,pg_temp as $$
  select ranked.position::integer from (
    select row.id,row_number() over(partition by row.status order by row.organizer_rank nulls last,row.pair_completed_at nulls last,row.created_at,row.id) position
    from public.signup_registrations row
    where row.signup_event_id=(select target.signup_event_id from public.signup_registrations target where target.id=p_registration_id)
      and row.status in ('confirmed','waitlisted','looking')
  ) ranked where ranked.id=p_registration_id
$$;

create or replace function public.get_public_signup_v3(p_account_slug text,p_event_slug text)
returns jsonb language plpgsql stable security definer set search_path=public,pg_temp as $$
declare signup public.signup_events%rowtype; roster jsonb;
begin
  select * into signup from public.signup_events event where case
    when nullif(trim(coalesce(p_account_slug,'')),'') is not null then event.account_slug=trim(p_account_slug) and event.event_slug=trim(p_event_slug)
    else event.friendly_slug=trim(p_event_slug) or event.public_slug::text=trim(p_event_slug) end limit 1;
  if not found then return null; end if;
  select coalesce(jsonb_agg(jsonb_build_object(
    'id',ranked.id,'teamName',ranked.team_name,'playerOne',ranked.player_one,'playerTwo',ranked.player_two,
    'status',ranked.status,'position',ranked.position,'createdAt',ranked.created_at,'updatedAt',ranked.updated_at,
    'organizerRank',ranked.organizer_rank,'pairCompletedAt',ranked.pair_completed_at,'entryMode',ranked.entry_mode
  ) order by case ranked.status when 'confirmed' then 0 when 'looking' then 1 else 2 end,ranked.position), '[]'::jsonb) into roster
  from (select registration.*,row_number() over(partition by registration.status order by registration.organizer_rank nulls last,
    registration.pair_completed_at nulls last,registration.created_at,registration.id) position
    from public.signup_registrations registration where registration.signup_event_id=signup.id and registration.status in ('confirmed','waitlisted','looking')) ranked;
  return jsonb_build_object('event',jsonb_build_object(
    'id',signup.id,'publicSlug',signup.public_slug,'accountSlug',signup.account_slug,'eventSlug',signup.event_slug,
    'title',signup.title,'venue',signup.venue,'startsAt',signup.starts_at,'endsAt',signup.ends_at,'details',signup.details,'prizes',signup.prizes,
    'isOpen',signup.is_open,'cancelledAt',signup.cancelled_at,'cancellationMessage',coalesce(signup.cancellation_message,''),
    'timeZone',signup.time_zone,'organizerName',coalesce(signup.organizer_name,''),'publicContactMethod',signup.public_contact_method,
    'publicContactValue',coalesce(signup.public_contact_value,''),'protocolVersion',signup.protocol_version,'entryMode',signup.entry_mode,
    'capacityTeams',signup.capacity_teams,
    'capacity',case when signup.entry_mode='individual' then jsonb_build_object('unit','players','value',signup.capacity_players)
      else jsonb_build_object('unit','teams','value',signup.capacity_teams) end
  ),'registrations',roster);
end; $$;

create or replace function public.get_organizer_signup_v3(p_signup_event_id uuid)
returns jsonb language plpgsql stable security definer set search_path=public,pg_temp as $$
begin
  if auth.uid() is null or not exists(select 1 from public.signup_events event where event.id=p_signup_event_id and event.owner_user_id=auth.uid()) then
    return public.americano_public_rejected(null,'NOT_FOUND_OR_NOT_OWNED','This signup page could not be found.');
  end if;
  return public.organizer_signup_snapshot_v3_internal(p_signup_event_id);
end; $$;

create or replace function public.register_public_player_v2(p_account_slug text,p_event_slug text,p_player_name text,p_contact text,p_request_id uuid)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare signup public.signup_events%rowtype; existing public.signup_public_requests%rowtype; registration public.signup_registrations%rowtype;
  normalized_name text:=public.americano_normalize_name(p_player_name); normalized_contact text:=public.americano_normalize_contact(p_contact);
  payload_hash text; response jsonb; position integer; new_identity uuid:=gen_random_uuid();
begin
  if p_request_id is null then return public.americano_public_rejected(p_request_id,'INVALID_PAYLOAD','A request id is required.'); end if;
  if char_length(trim(coalesce(p_player_name,''))) not between 1 and 100 then return public.americano_public_rejected(p_request_id,'INVALID_PAYLOAD','Enter a player name up to 100 characters.','playerOne'); end if;
  if char_length(trim(coalesce(p_contact,''))) not between 3 and 200 then return public.americano_public_rejected(p_request_id,'INVALID_PAYLOAD','Enter a WhatsApp number or email.','contact'); end if;
  perform set_config('app.americano_v2_rpc','on',true);
  -- All v2 roster writers lock the event before the signup row. This matches
  -- organizer Start and prevents a signup/Start deadlock while preserving the
  -- exact capacity snapshot on which the decision is made.
  perform 1 from public.events source
    where source.id=(select candidate.source_event_uuid from public.signup_events candidate
      where candidate.account_slug=trim(p_account_slug) and candidate.event_slug=trim(p_event_slug))
    for update;
  select * into signup from public.signup_events event where event.account_slug=trim(p_account_slug) and event.event_slug=trim(p_event_slug) for update;
  if not found then return public.americano_public_rejected(p_request_id,'NOT_FOUND_OR_NOT_OWNED','This signup page could not be found.'); end if;
  if signup.protocol_version<>2 then return public.americano_public_rejected(p_request_id,'UPDATE_REQUIRED','Refresh the app to use this signup page.'); end if;
  if signup.entry_mode<>'individual' then return public.americano_public_rejected(p_request_id,'MODE_MISMATCH','This event accepts fixed pairs.'); end if;
  payload_hash:=public.americano_v2_payload_hash('register-player-v2',jsonb_build_object('name',normalized_name,'contact',normalized_contact));
  select * into existing from public.signup_public_requests request where request.signup_event_id=signup.id and request.operation='register-player-v2' and request.request_id=p_request_id;
  if found then
    if existing.payload_fingerprint<>payload_hash then return public.americano_public_rejected(p_request_id,'IDEMPOTENCY_MISMATCH','This request id was used for different details.'); end if;
    if existing.registration_id is null or not exists(select 1 from public.signup_registrations row where row.id=existing.registration_id and row.status<>'cancelled') then
      return jsonb_build_object('status','replayed','requestId',p_request_id,'registrationId',existing.registration_id,'entryMode','individual','registrationStatus','cancelled','position',null);
    end if;
    response:=existing.response || jsonb_build_object('status','replayed'); return response;
  end if;
  if signup.cancelled_at is not null then return public.americano_public_rejected(p_request_id,'EVENT_CANCELLED','This event has been cancelled.'); end if;
  if not signup.is_open or signup.roster_locked_at is not null or (signup.starts_at is not null and signup.starts_at<=now()) then return public.americano_public_rejected(p_request_id,'REGISTRATIONS_CLOSED','Registrations are closed.'); end if;
  if (select count(*) from public.signup_registrations row where row.signup_event_id=signup.id and row.status<>'cancelled')>=256 then return public.americano_public_rejected(p_request_id,'REGISTRATIONS_CLOSED','This signup has reached its safe entry limit.'); end if;
  if exists(select 1 from public.signup_registrations row where row.signup_event_id=signup.id and row.status<>'cancelled'
    and public.americano_normalize_name(row.player_one)=normalized_name and public.americano_normalize_contact(row.contact)=normalized_contact) then
    return public.americano_public_rejected(p_request_id,'ALREADY_REGISTERED','These signup details are already registered.');
  end if;
  insert into public.signup_registrations(signup_event_id,entry_mode,team_name,player_one,contact,status,canonical_entrant_id,canonical_player_one_id,created_at)
  values(signup.id,'individual','',trim(p_player_name),trim(p_contact),'waitlisted',new_identity,new_identity,clock_timestamp()) returning * into registration;
  perform public.rebalance_signup_event(signup.id); select * into registration from public.signup_registrations where id=registration.id;
  perform public.americano_v2_commit_roster_projection(signup.source_event_uuid,signup.id);
  position:=public.americano_public_position(registration.id);
  response:=jsonb_build_object('status','applied','requestId',p_request_id,'registrationId',registration.id,'entryMode','individual','registrationStatus',registration.status,'position',position);
  insert into public.signup_public_requests(signup_event_id,operation,request_id,payload_fingerprint,registration_id,response)
  values(signup.id,'register-player-v2',p_request_id,payload_hash,registration.id,response);
  return response;
end; $$;

create or replace function public.register_public_single_v3(p_account_slug text,p_event_slug text,p_player_one text,p_contact text,p_request_id uuid)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare signup public.signup_events%rowtype; existing public.signup_public_requests%rowtype; registration public.signup_registrations%rowtype;
  normalized_name text:=public.americano_normalize_name(p_player_one); normalized_contact text:=public.americano_normalize_contact(p_contact);
  payload_hash text; response jsonb; position integer;
begin
  if p_request_id is null then return public.americano_public_rejected(p_request_id,'INVALID_PAYLOAD','A request id is required.'); end if;
  if char_length(trim(coalesce(p_player_one,''))) not between 1 and 100 then return public.americano_public_rejected(p_request_id,'INVALID_PAYLOAD','Enter your name.','playerOne'); end if;
  if char_length(trim(coalesce(p_contact,''))) not between 3 and 200 then return public.americano_public_rejected(p_request_id,'INVALID_PAYLOAD','Enter a WhatsApp number or email.','contact'); end if;
  perform set_config('app.americano_v2_rpc','on',true);
  perform 1 from public.events source
    where source.id=(select candidate.source_event_uuid from public.signup_events candidate
      where candidate.account_slug=trim(p_account_slug) and candidate.event_slug=trim(p_event_slug))
    for update;
  select * into signup from public.signup_events event where event.account_slug=trim(p_account_slug) and event.event_slug=trim(p_event_slug) for update;
  if not found then return public.americano_public_rejected(p_request_id,'NOT_FOUND_OR_NOT_OWNED','This signup page could not be found.'); end if;
  if signup.protocol_version<>2 then return public.americano_public_rejected(p_request_id,'UPDATE_REQUIRED','Refresh the app to use this signup page.'); end if;
  if signup.entry_mode<>'fixed-pairs' then return public.americano_public_rejected(p_request_id,'MODE_MISMATCH','This event accepts individual players.'); end if;
  payload_hash:=public.americano_v2_payload_hash('register-single-v3',jsonb_build_object('one',normalized_name,'contact',normalized_contact));
  select * into existing from public.signup_public_requests request where request.signup_event_id=signup.id and request.operation='register-single-v3' and request.request_id=p_request_id;
  if found then
    if existing.payload_fingerprint<>payload_hash then return public.americano_public_rejected(p_request_id,'IDEMPOTENCY_MISMATCH','This request id was used for different details.'); end if;
    return existing.response||jsonb_build_object('status','replayed');
  end if;
  if signup.cancelled_at is not null then return public.americano_public_rejected(p_request_id,'EVENT_CANCELLED','This event has been cancelled.'); end if;
  if not signup.is_open or signup.roster_locked_at is not null or (signup.starts_at is not null and signup.starts_at<=now()) then return public.americano_public_rejected(p_request_id,'REGISTRATIONS_CLOSED','Registrations are closed.'); end if;
  if (select count(*) from public.signup_registrations row where row.signup_event_id=signup.id and row.status<>'cancelled')>=256 then return public.americano_public_rejected(p_request_id,'REGISTRATIONS_CLOSED','This signup has reached its safe entry limit.'); end if;
  if exists(select 1 from public.signup_registrations row where row.signup_event_id=signup.id and row.status<>'cancelled'
    and public.americano_normalize_name(row.player_one)=normalized_name and public.americano_normalize_contact(row.contact)=normalized_contact) then
    return public.americano_public_rejected(p_request_id,'ALREADY_REGISTERED','These signup details are already registered.');
  end if;
  insert into public.signup_registrations(signup_event_id,entry_mode,team_name,player_one,contact,status,canonical_player_one_id,created_at)
  values(signup.id,'fixed-pairs','',trim(p_player_one),trim(p_contact),'looking',gen_random_uuid(),clock_timestamp()) returning * into registration;
  perform public.americano_v2_commit_roster_projection(signup.source_event_uuid,signup.id);
  position:=public.americano_public_position(registration.id);
  response:=jsonb_build_object('status','applied','requestId',p_request_id,'registrationId',registration.id,'entryMode','fixed-pairs','registrationStatus','looking','position',position);
  insert into public.signup_public_requests(signup_event_id,operation,request_id,payload_fingerprint,registration_id,response)
  values(signup.id,'register-single-v3',p_request_id,payload_hash,registration.id,response);
  return response;
end; $$;

create or replace function public.register_public_pair_v3(p_account_slug text,p_event_slug text,p_team_name text,p_player_one text,p_player_two text,p_contact text,p_request_id uuid)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare signup public.signup_events%rowtype; existing public.signup_public_requests%rowtype; registration public.signup_registrations%rowtype;
  payload_hash text; response jsonb; position integer;
begin
  if p_request_id is null then return public.americano_public_rejected(p_request_id,'INVALID_PAYLOAD','A request id is required.'); end if;
  if char_length(trim(coalesce(p_player_one,''))) not between 1 and 100 then return public.americano_public_rejected(p_request_id,'INVALID_PAYLOAD','Enter player one.','playerOne'); end if;
  if char_length(trim(coalesce(p_player_two,''))) not between 1 and 100 then return public.americano_public_rejected(p_request_id,'INVALID_PAYLOAD','Enter player two.','playerTwo'); end if;
  if char_length(trim(coalesce(p_contact,''))) not between 3 and 200 then return public.americano_public_rejected(p_request_id,'INVALID_PAYLOAD','Enter a WhatsApp number or email.','contact'); end if;
  perform set_config('app.americano_v2_rpc','on',true);
  perform 1 from public.events source
    where source.id=(select candidate.source_event_uuid from public.signup_events candidate
      where candidate.account_slug=trim(p_account_slug) and candidate.event_slug=trim(p_event_slug))
    for update;
  select * into signup from public.signup_events event where event.account_slug=trim(p_account_slug) and event.event_slug=trim(p_event_slug) for update;
  if not found then return public.americano_public_rejected(p_request_id,'NOT_FOUND_OR_NOT_OWNED','This signup page could not be found.'); end if;
  if signup.protocol_version<>2 then return public.americano_public_rejected(p_request_id,'UPDATE_REQUIRED','Refresh the app to use this signup page.'); end if;
  if signup.entry_mode<>'fixed-pairs' then return public.americano_public_rejected(p_request_id,'MODE_MISMATCH','This event accepts individual players.'); end if;
  payload_hash:=public.americano_v2_payload_hash('register-pair-v3',jsonb_build_object('team',public.americano_normalize_name(p_team_name),'one',public.americano_normalize_name(p_player_one),'two',public.americano_normalize_name(p_player_two),'contact',public.americano_normalize_contact(p_contact)));
  select * into existing from public.signup_public_requests request where request.signup_event_id=signup.id and request.operation='register-pair-v3' and request.request_id=p_request_id;
  if found then if existing.payload_fingerprint<>payload_hash then return public.americano_public_rejected(p_request_id,'IDEMPOTENCY_MISMATCH','This request id was used for different details.'); end if; return existing.response||jsonb_build_object('status','replayed'); end if;
  if signup.cancelled_at is not null then return public.americano_public_rejected(p_request_id,'EVENT_CANCELLED','This event has been cancelled.'); end if;
  if not signup.is_open or signup.roster_locked_at is not null or (signup.starts_at is not null and signup.starts_at<=now()) then return public.americano_public_rejected(p_request_id,'REGISTRATIONS_CLOSED','Registrations are closed.'); end if;
  if (select count(*) from public.signup_registrations row where row.signup_event_id=signup.id and row.status<>'cancelled')>=256 then return public.americano_public_rejected(p_request_id,'REGISTRATIONS_CLOSED','This signup has reached its safe entry limit.'); end if;
  insert into public.signup_registrations(signup_event_id,entry_mode,team_name,player_one,player_two,contact,status,pair_completed_at,canonical_entrant_id,canonical_player_one_id,canonical_player_two_id,created_at)
  values(signup.id,'fixed-pairs',trim(coalesce(p_team_name,'')),trim(p_player_one),trim(p_player_two),trim(p_contact),'waitlisted',clock_timestamp(),gen_random_uuid(),gen_random_uuid(),gen_random_uuid(),clock_timestamp()) returning * into registration;
  perform public.rebalance_signup_event(signup.id); select * into registration from public.signup_registrations where id=registration.id; position:=public.americano_public_position(registration.id);
  perform public.americano_v2_commit_roster_projection(signup.source_event_uuid,signup.id);
  response:=jsonb_build_object('status','applied','requestId',p_request_id,'registrationId',registration.id,'entryMode','fixed-pairs','registrationStatus',registration.status,'position',position);
  insert into public.signup_public_requests(signup_event_id,operation,request_id,payload_fingerprint,registration_id,response) values(signup.id,'register-pair-v3',p_request_id,payload_hash,registration.id,response); return response;
end; $$;

create or replace function public.join_public_single_v3(p_account_slug text,p_event_slug text,p_registration_id uuid,p_player_two text,p_contact text,p_request_id uuid)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare signup public.signup_events%rowtype; registration public.signup_registrations%rowtype; existing public.signup_public_requests%rowtype; payload_hash text; response jsonb; position integer;
begin
  if p_request_id is null or char_length(trim(coalesce(p_player_two,''))) not between 1 and 100 or char_length(trim(coalesce(p_contact,''))) not between 3 and 200 then return public.americano_public_rejected(p_request_id,'INVALID_PAYLOAD','Enter player two and contact details.','playerTwo'); end if;
  perform set_config('app.americano_v2_rpc','on',true);
  perform 1 from public.events source
    where source.id=(select candidate.source_event_uuid from public.signup_events candidate
      where candidate.account_slug=trim(p_account_slug) and candidate.event_slug=trim(p_event_slug))
    for update;
  select * into signup from public.signup_events event where event.account_slug=trim(p_account_slug) and event.event_slug=trim(p_event_slug) for update;
  if not found then return public.americano_public_rejected(p_request_id,'NOT_FOUND_OR_NOT_OWNED','Signup not found.'); end if; if signup.protocol_version<>2 then return public.americano_public_rejected(p_request_id,'UPDATE_REQUIRED','Refresh the app.'); end if; if signup.entry_mode<>'fixed-pairs' then return public.americano_public_rejected(p_request_id,'MODE_MISMATCH','Rotating Americano has no partner-join action.'); end if;
  payload_hash:=public.americano_v2_payload_hash('join-v3',jsonb_build_object('registrationId',p_registration_id,'two',public.americano_normalize_name(p_player_two),'contact',public.americano_normalize_contact(p_contact)));
  select * into existing from public.signup_public_requests request where request.signup_event_id=signup.id and request.operation='join-v3' and request.request_id=p_request_id; if found then if existing.payload_fingerprint<>payload_hash then return public.americano_public_rejected(p_request_id,'IDEMPOTENCY_MISMATCH','This request id was used for different details.'); end if; return existing.response||jsonb_build_object('status','replayed'); end if;
  if signup.cancelled_at is not null then return public.americano_public_rejected(p_request_id,'EVENT_CANCELLED','This event has been cancelled.'); end if; if not signup.is_open or signup.roster_locked_at is not null or (signup.starts_at is not null and signup.starts_at<=now()) then return public.americano_public_rejected(p_request_id,'REGISTRATIONS_CLOSED','Registrations are closed.'); end if;
  select * into registration from public.signup_registrations row where row.id=p_registration_id and row.signup_event_id=signup.id for update; if not found or registration.status<>'looking' then return public.americano_public_rejected(p_request_id,'NOT_FOUND_OR_NOT_OWNED','This partner request is no longer available.'); end if;
  update public.signup_registrations row set player_two=trim(p_player_two),player_two_contact=trim(p_contact),pair_completed_at=clock_timestamp(),status='waitlisted',canonical_entrant_id=gen_random_uuid(),canonical_player_two_id=gen_random_uuid(),updated_at=clock_timestamp() where row.id=p_registration_id returning * into registration;
  perform public.rebalance_signup_event(signup.id); select * into registration from public.signup_registrations where id=registration.id; position:=public.americano_public_position(registration.id);
  perform public.americano_v2_commit_roster_projection(signup.source_event_uuid,signup.id);
  response:=jsonb_build_object('status','applied','requestId',p_request_id,'registrationId',registration.id,'entryMode','fixed-pairs','registrationStatus',registration.status,'position',position);
  insert into public.signup_public_requests(signup_event_id,operation,request_id,payload_fingerprint,registration_id,response) values(signup.id,'join-v3',p_request_id,payload_hash,registration.id,response); return response;
end; $$;

-- Legacy public readers must never present protocol 2 as the old pair-only model.
create or replace function public.get_public_signup_v2(p_account_slug text,p_event_slug text)
returns jsonb language plpgsql stable security definer set search_path=public,pg_temp as $$
declare result jsonb;
begin
  result:=public.get_public_signup_v3(p_account_slug,p_event_slug);
  if result is null then return null; end if;
  if result#>>'{event,protocolVersion}'='2' then raise exception using errcode='P0001',message='UPDATE_REQUIRED'; end if;
  return result;
end; $$;

revoke all on function public.americano_normalize_name(text) from public,anon,authenticated;
revoke all on function public.americano_normalize_contact(text) from public,anon,authenticated;
revoke all on function public.americano_public_rejected(uuid,text,text,text) from public,anon,authenticated;
revoke all on function public.americano_public_position(uuid) from public,anon,authenticated;
revoke all on function public.get_public_signup_v3(text,text) from public;
revoke all on function public.get_organizer_signup_v3(uuid) from public,anon;
revoke all on function public.register_public_player_v2(text,text,text,text,uuid) from public;
revoke all on function public.register_public_single_v3(text,text,text,text,uuid) from public;
revoke all on function public.register_public_pair_v3(text,text,text,text,text,text,uuid) from public;
revoke all on function public.join_public_single_v3(text,text,uuid,text,text,uuid) from public;
grant execute on function public.get_public_signup_v3(text,text) to anon,authenticated;
grant execute on function public.get_organizer_signup_v3(uuid) to authenticated;
grant execute on function public.register_public_player_v2(text,text,text,text,uuid) to anon,authenticated;
grant execute on function public.register_public_single_v3(text,text,text,text,uuid) to anon,authenticated;
grant execute on function public.register_public_pair_v3(text,text,text,text,text,text,uuid) to anon,authenticated;
grant execute on function public.join_public_single_v3(text,text,uuid,text,text,uuid) to anon,authenticated;
