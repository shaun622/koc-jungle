-- Tournament V1 completion is additive and service-only. It intentionally
-- runs after 20260912100000_tournament_v1.sql and never touches legacy event
-- or Americano rows.
begin;

create extension if not exists pgcrypto;

alter table public.tournaments_v1
  add column if not exists contract_version smallint not null default 1,
  add column if not exists data_version smallint not null default 1;

do $$ begin
  alter table public.tournaments_v1 add constraint tournaments_v1_contract_version_check check (contract_version in (1,2));
exception when duplicate_object then null; end $$;
do $$ begin
  alter table public.tournaments_v1 add constraint tournaments_v1_data_version_check check (data_version in (1,2));
exception when duplicate_object then null; end $$;

alter table public.tournament_commands_v1
  add column if not exists contract_version smallint not null default 1,
  add column if not exists hash_key_version integer,
  add column if not exists receipt_result jsonb not null default '{}'::jsonb;

alter table public.tournament_claim_receipts_v1
  add column if not exists request_hash text,
  add column if not exists request_hash_key_version integer,
  add column if not exists grant_kind text,
  add column if not exists resulting_revision bigint;

create table if not exists public.tournament_authority_v1 (
  tournament_id uuid primary key references public.tournaments_v1(id) on delete cascade,
  owner_id uuid not null references auth.users(id) on delete cascade,
  current_claim_id uuid,
  capability_hash text,
  capability_key_version integer,
  updated_at timestamptz not null default now(),
  foreign key (owner_id, tournament_id) references public.tournaments_v1(owner_id, id) on delete cascade
);

create table if not exists public.tournament_operations_v1 (
  owner_id uuid not null references auth.users(id) on delete cascade,
  operation_id uuid not null,
  tournament_id uuid not null,
  kind text not null,
  request_hash text not null,
  hash_key_version integer not null,
  result_json jsonb not null,
  accepted_at timestamptz not null default now(),
  primary key (owner_id, operation_id)
);
create index if not exists tournament_operations_v1_tournament_idx on public.tournament_operations_v1(owner_id, tournament_id, accepted_at desc);

create table if not exists public.tournament_rate_attempts_v1 (
  id bigint generated always as identity primary key,
  ip_digest text not null,
  tournament_id uuid,
  attempted_at timestamptz not null default clock_timestamp()
);
create index if not exists tournament_rate_attempts_v1_ip_time_idx on public.tournament_rate_attempts_v1(ip_digest, attempted_at);
create index if not exists tournament_rate_attempts_v1_time_idx on public.tournament_rate_attempts_v1(attempted_at);

alter table public.tournament_authority_v1 enable row level security;
alter table public.tournament_operations_v1 enable row level security;
alter table public.tournament_rate_attempts_v1 enable row level security;

revoke all on public.tournament_authority_v1, public.tournament_operations_v1,
  public.tournament_rate_attempts_v1, public.tournament_claim_receipts_v1,
  public.tournament_commands_v1 from public, anon, authenticated;
grant all on public.tournament_authority_v1, public.tournament_operations_v1,
  public.tournament_rate_attempts_v1, public.tournament_claim_receipts_v1,
  public.tournament_commands_v1 to service_role;

-- Old capability hashes are deliberately not promoted into usable grants.
-- Existing live rows remain readable and require explicit takeover.
drop function if exists public.internal_commit_tournament_v1(uuid,uuid,uuid,text,bigint,text,text,bigint,integer,text,jsonb,text,jsonb,jsonb);
drop function if exists public.internal_public_signup_tournament_v1(text,uuid,text,bigint,text,text,jsonb,jsonb,jsonb);
alter table public.tournaments_v1 drop column if exists controller_capability_hash;

create or replace function public.internal_get_tournament_v1(
  p_owner_id uuid,
  p_tournament_id uuid
) returns jsonb
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  event_row public.tournaments_v1%rowtype;
  contacts jsonb;
begin
  select * into event_row from public.tournaments_v1
    where id=p_tournament_id and owner_id=p_owner_id;
  if not found then
    if exists(select 1 from public.tournament_tombstones_v1 where tournament_id=p_tournament_id and owner_id=p_owner_id) then
      return jsonb_build_object('status','deleted');
    end if;
    return jsonb_build_object('status','not_found');
  end if;
  select coalesce(jsonb_object_agg(entry_id,contact),'{}'::jsonb) into contacts
    from public.tournament_contacts_v1 where tournament_id=p_tournament_id and owner_id=p_owner_id;
  return jsonb_build_object(
    'status','found','snapshot',event_row.state,'contacts',contacts,
    'revision',event_row.revision::text,
    'controller',jsonb_build_object('deviceId',event_row.controller_device_id,'epoch',event_row.controller_epoch::text,'nextSequence',event_row.controller_next_sequence),
    'archivedAt',event_row.archived_at,'updatedAt',event_row.updated_at,
    'requiresTakeover',event_row.lifecycle='live' and not exists(select 1 from public.tournament_authority_v1 authority where authority.tournament_id=event_row.id and authority.current_claim_id is not null)
  );
end $$;

create or replace function public.internal_import_tournament_v1(
  p_owner_id uuid,
  p_operation_id uuid,
  p_tournament_id uuid,
  p_request_hash text,
  p_hash_key_version integer,
  p_initial_state jsonb,
  p_initial_contacts jsonb
) returns jsonb
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  prior public.tournament_operations_v1%rowtype;
  result jsonb;
  contact_row record;
begin
  perform pg_advisory_xact_lock(hashtextextended('tournament-operation:'||p_owner_id::text||':'||p_operation_id::text,0));
  select * into prior from public.tournament_operations_v1 where owner_id=p_owner_id and operation_id=p_operation_id;
  if found then
    if prior.tournament_id<>p_tournament_id or prior.kind<>'import-copy' or prior.request_hash<>p_request_hash or prior.hash_key_version<>p_hash_key_version then
      return jsonb_build_object('status','rejected','code','OPERATION_ID_REUSED');
    end if;
    return jsonb_build_object('status','replayed','result',prior.result_json);
  end if;
  perform pg_advisory_xact_lock(hashtextextended('tournament-v1:'||p_tournament_id::text,0));
  if exists(select 1 from public.tournament_tombstones_v1 where tournament_id=p_tournament_id) then return jsonb_build_object('status','rejected','code','TOURNAMENT_DELETED'); end if;
  if exists(select 1 from public.tournaments_v1 where id=p_tournament_id) then return jsonb_build_object('status','rejected','code','TOURNAMENT_EXISTS'); end if;
  if p_initial_state->>'id'<>p_tournament_id::text or p_initial_state->>'revision'<>'0'
     or (p_initial_state->>'dataVersion')::integer<>2 or p_initial_state->>'lifecycle'<>'setup'
     or nullif(p_initial_state#>>'{controller,deviceId}','') is not null
     or nullif(p_initial_state#>>'{meta,publicSlug}','') is not null
     or coalesce((p_initial_state#>>'{meta,signupOpen}')::boolean,false) then
    return jsonb_build_object('status','rejected','code','STATE_SHAPE');
  end if;
  if jsonb_typeof(coalesce(p_initial_contacts,'{}'::jsonb))<>'object' then return jsonb_build_object('status','rejected','code','CONTACT_SHAPE'); end if;
  insert into public.tournaments_v1(id,owner_id,schema_version,revision,lifecycle,controller_device_id,controller_epoch,controller_next_sequence,state,contract_version,data_version)
    values(p_tournament_id,p_owner_id,'tournament-v1',0,'setup',null,0,0,p_initial_state,2,2);
  for contact_row in select key,value from jsonb_each_text(coalesce(p_initial_contacts,'{}'::jsonb)) loop
    if char_length(btrim(contact_row.value))>100 then raise exception 'CONTACT_LENGTH'; end if;
    if btrim(contact_row.value)<>'' then
      insert into public.tournament_contacts_v1(tournament_id,entry_id,owner_id,contact,updated_at)
        values(p_tournament_id,contact_row.key,p_owner_id,btrim(contact_row.value),clock_timestamp());
    end if;
  end loop;
  result := jsonb_build_object('tournamentId',p_tournament_id,'revision','0');
  insert into public.tournament_operations_v1(owner_id,operation_id,tournament_id,kind,request_hash,hash_key_version,result_json)
    values(p_owner_id,p_operation_id,p_tournament_id,'import-copy',p_request_hash,p_hash_key_version,result);
  return jsonb_build_object('status','applied','result',result);
end $$;

create or replace function public.internal_create_tournament_v1(
  p_owner_id uuid,
  p_operation_id uuid,
  p_tournament_id uuid,
  p_request_hash text,
  p_hash_key_version integer,
  p_initial_state jsonb
) returns jsonb
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  prior public.tournament_operations_v1%rowtype;
  result jsonb;
begin
  perform pg_advisory_xact_lock(hashtextextended('tournament-operation:'||p_owner_id::text||':'||p_operation_id::text,0));
  select * into prior from public.tournament_operations_v1 where owner_id=p_owner_id and operation_id=p_operation_id;
  if found then
    if prior.tournament_id<>p_tournament_id or prior.kind<>'create' or prior.request_hash<>p_request_hash or prior.hash_key_version<>p_hash_key_version then
      return jsonb_build_object('status','rejected','code','OPERATION_ID_REUSED');
    end if;
    return jsonb_build_object('status','replayed','result',prior.result_json);
  end if;
  perform pg_advisory_xact_lock(hashtextextended('tournament-v1:'||p_tournament_id::text,0));
  if exists(select 1 from public.tournament_tombstones_v1 where tournament_id=p_tournament_id) then
    return jsonb_build_object('status','rejected','code','TOURNAMENT_DELETED');
  end if;
  if exists(select 1 from public.tournaments_v1 where id=p_tournament_id) then
    return jsonb_build_object('status','rejected','code','TOURNAMENT_EXISTS');
  end if;
  if p_initial_state->>'id'<>p_tournament_id::text or p_initial_state->>'revision'<>'0'
     or (p_initial_state->>'dataVersion')::integer<>2 or p_initial_state->>'lifecycle'<>'setup' then
    return jsonb_build_object('status','rejected','code','STATE_SHAPE');
  end if;
  insert into public.tournaments_v1(id,owner_id,schema_version,revision,lifecycle,controller_device_id,controller_epoch,controller_next_sequence,state,contract_version,data_version)
    values(p_tournament_id,p_owner_id,'tournament-v1',0,'setup',null,0,0,p_initial_state,2,2);
  result := jsonb_build_object('tournamentId',p_tournament_id,'revision','0');
  insert into public.tournament_operations_v1(owner_id,operation_id,tournament_id,kind,request_hash,hash_key_version,result_json)
    values(p_owner_id,p_operation_id,p_tournament_id,'create',p_request_hash,p_hash_key_version,result);
  return jsonb_build_object('status','applied','result',result);
end $$;

create or replace function public.internal_commit_tournament_v2(
  p_owner_id uuid,
  p_tournament_id uuid,
  p_command_id uuid,
  p_intent_hash text,
  p_hash_key_version integer,
  p_expected_revision bigint,
  p_device_id text,
  p_capability_hash text,
  p_controller_epoch bigint,
  p_sequence integer,
  p_kind text,
  p_next_state jsonb,
  p_private_contact_changes jsonb,
  p_public_slug text,
  p_public_projection jsonb,
  p_redacted_audit jsonb,
  p_receipt_result jsonb default '{}'::jsonb
) returns jsonb
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  current_row public.tournaments_v1%rowtype;
  prior public.tournament_commands_v1%rowtype;
  authority public.tournament_authority_v1%rowtype;
  next_revision bigint;
  delta jsonb;
  entry_key text;
  contact_value text;
begin
  perform pg_advisory_xact_lock(hashtextextended('tournament-v1:'||p_tournament_id::text,0));
  if exists(select 1 from public.tournament_tombstones_v1 where tournament_id=p_tournament_id and owner_id=p_owner_id) then
    return jsonb_build_object('status','rejected','code','TOURNAMENT_DELETED');
  end if;
  select * into current_row from public.tournaments_v1 where id=p_tournament_id and owner_id=p_owner_id for update;
  if not found then return jsonb_build_object('status','rejected','code','NOT_FOUND'); end if;
  select * into prior from public.tournament_commands_v1 where tournament_id=p_tournament_id and command_id=p_command_id;
  if found then
    if prior.contract_version<>2 or prior.hash_key_version is distinct from p_hash_key_version or prior.payload_hash<>p_intent_hash then
      return jsonb_build_object('status','rejected','code','COMMAND_ID_REUSED');
    end if;
    return jsonb_build_object('status','replayed','receipt',jsonb_build_object('commandId',p_command_id,'resultingRevision',prior.resulting_revision::text),'result',prior.receipt_result);
  end if;
  if current_row.contract_version<>2 or current_row.data_version<>2 then return jsonb_build_object('status','rejected','code','UPDATE_REQUIRED'); end if;
  if current_row.revision<>p_expected_revision then return jsonb_build_object('status','conflict','code','REVISION_CONFLICT','currentRevision',current_row.revision::text); end if;
  if current_row.lifecycle='live' then
    select * into authority from public.tournament_authority_v1 where tournament_id=p_tournament_id;
    if current_row.controller_device_id is distinct from p_device_id or current_row.controller_epoch<>p_controller_epoch
       or current_row.controller_next_sequence<>p_sequence or authority.capability_hash is distinct from p_capability_hash then
      return jsonb_build_object('status','conflict','code','AUTHORITY_CHANGED','currentRevision',current_row.revision::text);
    end if;
  elsif p_sequence<>0 then
    return jsonb_build_object('status','rejected','code','COMMAND_SEQUENCE');
  end if;
  next_revision := current_row.revision+1;
  if p_next_state->>'id'<>p_tournament_id::text or p_next_state->>'revision'<>next_revision::text
     or (p_next_state->>'dataVersion')::integer<>2 then
    return jsonb_build_object('status','rejected','code','STATE_SHAPE');
  end if;
  if jsonb_typeof(coalesce(p_private_contact_changes,'[]'::jsonb))<>'array' or jsonb_array_length(coalesce(p_private_contact_changes,'[]'::jsonb))>128 then
    return jsonb_build_object('status','rejected','code','CONTACT_SHAPE');
  end if;
  if (select count(*) from jsonb_array_elements(coalesce(p_private_contact_changes,'[]'::jsonb))) <>
     (select count(distinct item->>'entryId') from jsonb_array_elements(coalesce(p_private_contact_changes,'[]'::jsonb)) item) then
    return jsonb_build_object('status','rejected','code','CONTACT_DUPLICATE');
  end if;
  for delta in select value from jsonb_array_elements(coalesce(p_private_contact_changes,'[]'::jsonb)) loop
    entry_key := delta->>'entryId'; contact_value := delta->>'contact';
    if entry_key is null or not exists(select 1 from jsonb_array_elements(p_next_state->'entries') entry where entry->>'id'=entry_key) then
      return jsonb_build_object('status','rejected','code','CONTACT_ENTRY');
    end if;
    if delta ? 'contact' and jsonb_typeof(delta->'contact') not in ('string','null') then return jsonb_build_object('status','rejected','code','CONTACT_SHAPE'); end if;
    if contact_value is not null and char_length(contact_value)>100 then return jsonb_build_object('status','rejected','code','CONTACT_LENGTH'); end if;
  end loop;
  if p_public_slug is not null and (p_public_projection->>'projectionVersion')::integer<>2 then
    return jsonb_build_object('status','rejected','code','PROJECTION_VERSION');
  end if;
  update public.tournaments_v1 set
    state=p_next_state, revision=next_revision, lifecycle=p_next_state->>'lifecycle',
    controller_device_id=nullif(p_next_state#>>'{controller,deviceId}',''),
    controller_epoch=(p_next_state#>>'{controller,epoch}')::bigint,
    controller_next_sequence=(p_next_state#>>'{controller,nextSequence}')::integer,
    archived_at=case when p_next_state->>'archivedAt' is null then null else to_timestamp((p_next_state->>'archivedAt')::double precision/1000) end,
    contract_version=2,data_version=2,updated_at=clock_timestamp()
    where id=p_tournament_id and owner_id=p_owner_id;
  if p_next_state->>'lifecycle' in ('complete','cancelled') or nullif(p_next_state#>>'{controller,deviceId}','') is null then
    delete from public.tournament_authority_v1 where tournament_id=p_tournament_id;
  end if;
  for delta in select value from jsonb_array_elements(coalesce(p_private_contact_changes,'[]'::jsonb)) loop
    entry_key := delta->>'entryId'; contact_value := delta->>'contact';
    if contact_value is null or btrim(contact_value)='' then
      delete from public.tournament_contacts_v1 where tournament_id=p_tournament_id and entry_id=entry_key;
    else
      insert into public.tournament_contacts_v1(tournament_id,entry_id,owner_id,contact,updated_at)
        values(p_tournament_id,entry_key,p_owner_id,btrim(contact_value),clock_timestamp())
        on conflict(tournament_id,entry_id) do update set contact=excluded.contact,updated_at=excluded.updated_at;
    end if;
  end loop;
  if p_public_slug is null then delete from public.tournament_public_v1 where tournament_id=p_tournament_id;
  else
    insert into public.tournament_public_v1(tournament_id,public_slug,public_revision,projection,updated_at)
      values(p_tournament_id,p_public_slug,next_revision,p_public_projection,clock_timestamp())
      on conflict(tournament_id) do update set public_slug=excluded.public_slug,public_revision=excluded.public_revision,projection=excluded.projection,updated_at=excluded.updated_at;
  end if;
  insert into public.tournament_commands_v1(tournament_id,command_id,owner_id,payload_hash,kind,actor_device_id,controller_epoch,sequence,resulting_revision,redacted_audit,contract_version,hash_key_version,receipt_result)
    values(p_tournament_id,p_command_id,p_owner_id,p_intent_hash,p_kind,p_device_id,p_controller_epoch,p_sequence,next_revision,p_redacted_audit,2,p_hash_key_version,p_receipt_result);
  return jsonb_build_object('status','applied','receipt',jsonb_build_object('commandId',p_command_id,'resultingRevision',next_revision::text),'result',p_receipt_result);
end $$;

create or replace function public.internal_grant_tournament_v1(
  p_owner_id uuid,
  p_operation_id uuid,
  p_tournament_id uuid,
  p_action text,
  p_request_hash text,
  p_hash_key_version integer,
  p_expected_revision bigint,
  p_expected_epoch bigint,
  p_device_id text,
  p_nonce_hash text,
  p_capability_hash text,
  p_capability_key_version integer,
  p_next_state jsonb
) returns jsonb
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  operation_row public.tournament_operations_v1%rowtype;
  current_row public.tournaments_v1%rowtype;
  current_authority public.tournament_authority_v1%rowtype;
  receipt public.tournament_claim_receipts_v1%rowtype;
  next_revision bigint;
  next_epoch bigint;
  result jsonb;
begin
  if p_action not in ('begin','claim','takeover','reopen') then return jsonb_build_object('status','rejected','code','GRANT_ACTION'); end if;
  perform pg_advisory_xact_lock(hashtextextended('tournament-operation:'||p_owner_id::text||':'||p_operation_id::text,0));
  select * into operation_row from public.tournament_operations_v1 where owner_id=p_owner_id and operation_id=p_operation_id;
  if found then
    if operation_row.tournament_id<>p_tournament_id or operation_row.kind<>('grant-'||p_action) or operation_row.request_hash<>p_request_hash or operation_row.hash_key_version<>p_hash_key_version then
      return jsonb_build_object('status','rejected','code','OPERATION_ID_REUSED');
    end if;
    perform pg_advisory_xact_lock(hashtextextended('tournament-v1:'||p_tournament_id::text,0));
    select * into current_authority from public.tournament_authority_v1 where tournament_id=p_tournament_id;
    select * into receipt from public.tournament_claim_receipts_v1 where tournament_id=p_tournament_id and claim_id=p_operation_id;
    if not found or current_authority.current_claim_id is distinct from p_operation_id or current_authority.capability_hash is distinct from receipt.capability_hash then
      return jsonb_build_object('status','conflict','code','AUTHORITY_CHANGED');
    end if;
    return jsonb_build_object('status','replayed','result',operation_row.result_json,'capabilityKeyVersion',receipt.derivation_key_version);
  end if;
  perform pg_advisory_xact_lock(hashtextextended('tournament-v1:'||p_tournament_id::text,0));
  if exists(select 1 from public.tournament_tombstones_v1 where tournament_id=p_tournament_id and owner_id=p_owner_id) then return jsonb_build_object('status','rejected','code','TOURNAMENT_DELETED'); end if;
  select * into current_row from public.tournaments_v1 where id=p_tournament_id and owner_id=p_owner_id for update;
  if not found then return jsonb_build_object('status','rejected','code','NOT_FOUND'); end if;
  if current_row.revision<>p_expected_revision then return jsonb_build_object('status','conflict','code','REVISION_CONFLICT','currentRevision',current_row.revision::text); end if;
  if current_row.controller_epoch<>p_expected_epoch then return jsonb_build_object('status','conflict','code','AUTHORITY_CHANGED'); end if;
  if (p_action='begin' and current_row.lifecycle<>'setup')
     or (p_action='claim' and (current_row.lifecycle<>'live' or current_row.controller_device_id is not null))
     or (p_action='takeover' and current_row.lifecycle<>'live')
     or (p_action='reopen' and current_row.lifecycle not in ('complete','cancelled')) then
    return jsonb_build_object('status','conflict','code','LIFECYCLE_CONFLICT');
  end if;
  next_revision:=current_row.revision+1; next_epoch:=current_row.controller_epoch+1;
  if p_next_state->>'id'<>p_tournament_id::text or p_next_state->>'revision'<>next_revision::text
     or p_next_state->>'lifecycle'<>'live' or p_next_state#>>'{controller,deviceId}'<>p_device_id
     or (p_next_state#>>'{controller,epoch}')::bigint<>next_epoch or (p_next_state#>>'{controller,nextSequence}')::integer<>1
     or coalesce((p_next_state#>>'{meta,signupOpen}')::boolean,false)<>false then
    return jsonb_build_object('status','rejected','code','STATE_SHAPE');
  end if;
  update public.tournaments_v1 set state=p_next_state,revision=next_revision,lifecycle='live',controller_device_id=p_device_id,controller_epoch=next_epoch,controller_next_sequence=1,updated_at=clock_timestamp() where id=p_tournament_id;
  insert into public.tournament_authority_v1(tournament_id,owner_id,current_claim_id,capability_hash,capability_key_version,updated_at)
    values(p_tournament_id,p_owner_id,p_operation_id,p_capability_hash,p_capability_key_version,clock_timestamp())
    on conflict(tournament_id) do update set owner_id=excluded.owner_id,current_claim_id=excluded.current_claim_id,capability_hash=excluded.capability_hash,capability_key_version=excluded.capability_key_version,updated_at=excluded.updated_at;
  insert into public.tournament_claim_receipts_v1(tournament_id,claim_id,owner_id,device_id,granted_epoch,nonce_hash,capability_hash,derivation_key_version,request_hash,request_hash_key_version,grant_kind,resulting_revision)
    values(p_tournament_id,p_operation_id,p_owner_id,p_device_id,next_epoch,p_nonce_hash,p_capability_hash,p_capability_key_version,p_request_hash,p_hash_key_version,p_action,next_revision);
  result:=jsonb_build_object('tournamentId',p_tournament_id,'claimId',p_operation_id,'deviceId',p_device_id,'grantedEpoch',next_epoch::text,'resultingRevision',next_revision::text);
  insert into public.tournament_operations_v1(owner_id,operation_id,tournament_id,kind,request_hash,hash_key_version,result_json)
    values(p_owner_id,p_operation_id,p_tournament_id,'grant-'||p_action,p_request_hash,p_hash_key_version,result);
  return jsonb_build_object('status','applied','result',result,'capabilityKeyVersion',p_capability_key_version);
end $$;

create or replace function public.internal_release_tournament_v1(
  p_owner_id uuid,
  p_operation_id uuid,
  p_tournament_id uuid,
  p_request_hash text,
  p_hash_key_version integer,
  p_expected_revision bigint,
  p_expected_epoch bigint,
  p_expected_sequence integer,
  p_device_id text,
  p_capability_hash text,
  p_next_state jsonb
) returns jsonb
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare operation_row public.tournament_operations_v1%rowtype; current_row public.tournaments_v1%rowtype; authority public.tournament_authority_v1%rowtype; next_revision bigint; next_epoch bigint; result jsonb;
begin
  perform pg_advisory_xact_lock(hashtextextended('tournament-operation:'||p_owner_id::text||':'||p_operation_id::text,0));
  select * into operation_row from public.tournament_operations_v1 where owner_id=p_owner_id and operation_id=p_operation_id;
  if found then
    if operation_row.tournament_id<>p_tournament_id or operation_row.kind<>'release' or operation_row.request_hash<>p_request_hash or operation_row.hash_key_version<>p_hash_key_version then return jsonb_build_object('status','rejected','code','OPERATION_ID_REUSED'); end if;
    return jsonb_build_object('status','replayed','result',operation_row.result_json);
  end if;
  perform pg_advisory_xact_lock(hashtextextended('tournament-v1:'||p_tournament_id::text,0));
  select * into current_row from public.tournaments_v1 where id=p_tournament_id and owner_id=p_owner_id for update;
  if not found then return jsonb_build_object('status','rejected','code','NOT_FOUND'); end if;
  select * into authority from public.tournament_authority_v1 where tournament_id=p_tournament_id;
  if current_row.revision<>p_expected_revision or current_row.lifecycle<>'live' or current_row.controller_device_id is distinct from p_device_id
     or current_row.controller_epoch<>p_expected_epoch or current_row.controller_next_sequence<>p_expected_sequence
     or authority.capability_hash is distinct from p_capability_hash then return jsonb_build_object('status','conflict','code','AUTHORITY_CHANGED'); end if;
  next_revision:=current_row.revision+1; next_epoch:=current_row.controller_epoch+1;
  if p_next_state->>'revision'<>next_revision::text or p_next_state#>>'{controller,deviceId}' is not null
     or (p_next_state#>>'{controller,epoch}')::bigint<>next_epoch or (p_next_state#>>'{controller,nextSequence}')::integer<>0 then return jsonb_build_object('status','rejected','code','STATE_SHAPE'); end if;
  update public.tournaments_v1 set state=p_next_state,revision=next_revision,controller_device_id=null,controller_epoch=next_epoch,controller_next_sequence=0,updated_at=clock_timestamp() where id=p_tournament_id;
  delete from public.tournament_authority_v1 where tournament_id=p_tournament_id;
  result:=jsonb_build_object('tournamentId',p_tournament_id,'released',true,'resultingRevision',next_revision::text,'epoch',next_epoch::text);
  insert into public.tournament_operations_v1(owner_id,operation_id,tournament_id,kind,request_hash,hash_key_version,result_json) values(p_owner_id,p_operation_id,p_tournament_id,'release',p_request_hash,p_hash_key_version,result);
  return jsonb_build_object('status','applied','result',result);
end $$;

create or replace function public.internal_lookup_tournament_receipt_v1(
  p_owner_id uuid,
  p_tournament_id uuid,
  p_command_id uuid,
  p_intent_hash text,
  p_hash_key_version integer,
  p_public_only boolean default false
) returns jsonb
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare current_owner uuid; prior public.tournament_commands_v1%rowtype;
begin
  perform pg_advisory_xact_lock(hashtextextended('tournament-v1:'||p_tournament_id::text,0));
  if exists(select 1 from public.tournament_tombstones_v1 where tournament_id=p_tournament_id) then return jsonb_build_object('status','deleted'); end if;
  select owner_id into current_owner from public.tournaments_v1 where id=p_tournament_id for update;
  if not found or (not p_public_only and current_owner is distinct from p_owner_id) then return jsonb_build_object('status','not_found'); end if;
  select * into prior from public.tournament_commands_v1 where tournament_id=p_tournament_id and command_id=p_command_id;
  if not found then return jsonb_build_object('status','absent'); end if;
  if p_public_only and prior.kind<>'public-signup' then return jsonb_build_object('status','not_found'); end if;
  if prior.contract_version<>2 or prior.hash_key_version is distinct from p_hash_key_version or prior.payload_hash<>p_intent_hash then return jsonb_build_object('status','rejected','code','COMMAND_ID_REUSED'); end if;
  return jsonb_build_object('status','replayed','receipt',jsonb_build_object('commandId',p_command_id,'resultingRevision',prior.resulting_revision::text),'result',prior.receipt_result);
end $$;

create or replace function public.internal_public_signup_tournament_v2(
  p_tournament_id uuid,
  p_public_slug text,
  p_command_id uuid,
  p_intent_hash text,
  p_hash_key_version integer,
  p_expected_revision bigint,
  p_entry_id text,
  p_contact text,
  p_next_state jsonb,
  p_public_projection jsonb,
  p_redacted_audit jsonb,
  p_receipt_result jsonb
) returns jsonb
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  resolved_id uuid;
  current_row public.tournaments_v1%rowtype;
  prior public.tournament_commands_v1%rowtype;
  next_revision bigint;
begin
  select tournament_id into resolved_id from public.tournament_public_v1 where public_slug=p_public_slug;
  if not found or resolved_id<>p_tournament_id then return jsonb_build_object('status','rejected','code','NOT_FOUND'); end if;
  perform pg_advisory_xact_lock(hashtextextended('tournament-v1:'||p_tournament_id::text,0));
  if exists(select 1 from public.tournament_tombstones_v1 where tournament_id=p_tournament_id) then return jsonb_build_object('status','rejected','code','NOT_FOUND'); end if;
  select * into current_row from public.tournaments_v1 where id=p_tournament_id for update;
  if not found then return jsonb_build_object('status','rejected','code','NOT_FOUND'); end if;
  if not exists(select 1 from public.tournament_public_v1 where tournament_id=p_tournament_id and public_slug=p_public_slug) then return jsonb_build_object('status','rejected','code','NOT_FOUND'); end if;
  select * into prior from public.tournament_commands_v1 where tournament_id=p_tournament_id and command_id=p_command_id;
  if found then
    if prior.contract_version<>2 or prior.hash_key_version is distinct from p_hash_key_version or prior.payload_hash<>p_intent_hash then return jsonb_build_object('status','rejected','code','COMMAND_ID_REUSED'); end if;
    return jsonb_build_object('status','replayed','receipt',jsonb_build_object('commandId',p_command_id,'resultingRevision',prior.resulting_revision::text),'result',prior.receipt_result);
  end if;
  if current_row.contract_version<>2 or current_row.data_version<>2 then return jsonb_build_object('status','rejected','code','UPDATE_REQUIRED'); end if;
  if current_row.revision<>p_expected_revision then return jsonb_build_object('status','conflict','code','REVISION_CONFLICT','currentRevision',current_row.revision::text); end if;
  if current_row.lifecycle<>'setup' or coalesce((current_row.state#>>'{meta,signupOpen}')::boolean,false)=false
     or (nullif(current_row.state#>>'{meta,startsAt}','') is not null and (current_row.state#>>'{meta,startsAt}')::timestamptz<=clock_timestamp()) then
    return jsonb_build_object('status','rejected','code','SIGNUP_CLOSED');
  end if;
  next_revision:=current_row.revision+1;
  if p_next_state->>'id'<>p_tournament_id::text or p_next_state->>'revision'<>next_revision::text
     or (p_next_state->>'dataVersion')::integer<>2 or (p_public_projection->>'projectionVersion')::integer<>2 then
    return jsonb_build_object('status','rejected','code','STATE_SHAPE');
  end if;
  if char_length(p_contact)>100 then return jsonb_build_object('status','rejected','code','CONTACT_LENGTH'); end if;
  update public.tournaments_v1 set state=p_next_state,revision=next_revision,updated_at=clock_timestamp() where id=p_tournament_id;
  if btrim(p_contact)<>'' then
    insert into public.tournament_contacts_v1(tournament_id,entry_id,owner_id,contact,updated_at)
      values(p_tournament_id,p_entry_id,current_row.owner_id,btrim(p_contact),clock_timestamp())
      on conflict(tournament_id,entry_id) do update set contact=excluded.contact,updated_at=excluded.updated_at;
  end if;
  update public.tournament_public_v1 set public_revision=next_revision,projection=p_public_projection,updated_at=clock_timestamp() where tournament_id=p_tournament_id;
  insert into public.tournament_commands_v1(tournament_id,command_id,owner_id,payload_hash,kind,actor_device_id,controller_epoch,sequence,resulting_revision,redacted_audit,contract_version,hash_key_version,receipt_result)
    values(p_tournament_id,p_command_id,current_row.owner_id,p_intent_hash,'public-signup','public',0,0,next_revision,p_redacted_audit,2,p_hash_key_version,p_receipt_result);
  return jsonb_build_object('status','applied','receipt',jsonb_build_object('commandId',p_command_id,'resultingRevision',next_revision::text),'result',p_receipt_result);
end $$;

create or replace function public.internal_attempt_tournament_signup_v1(
  p_ip_digest text,
  p_tournament_id uuid
) returns jsonb
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare overall_count integer; event_count integer; oldest timestamptz; retry_after integer;
begin
  if p_ip_digest is null or length(p_ip_digest)<32 then return jsonb_build_object('allowed',false,'code','RATE_CONFIG'); end if;
  perform pg_advisory_xact_lock(hashtextextended('tournament-rate:'||p_ip_digest,0));
  delete from public.tournament_rate_attempts_v1 where attempted_at<clock_timestamp()-interval '2 minutes';
  insert into public.tournament_rate_attempts_v1(ip_digest,tournament_id) values(p_ip_digest,p_tournament_id);
  select count(*) into overall_count from public.tournament_rate_attempts_v1 where ip_digest=p_ip_digest and attempted_at>clock_timestamp()-interval '60 seconds';
  select count(*) into event_count from public.tournament_rate_attempts_v1 where ip_digest=p_ip_digest and tournament_id is not distinct from p_tournament_id and attempted_at>clock_timestamp()-interval '60 seconds';
  if overall_count>60 or (p_tournament_id is not null and event_count>10) then
    if overall_count>60 then select min(attempted_at) into oldest from public.tournament_rate_attempts_v1 where ip_digest=p_ip_digest and attempted_at>clock_timestamp()-interval '60 seconds';
    else select min(attempted_at) into oldest from public.tournament_rate_attempts_v1 where ip_digest=p_ip_digest and tournament_id=p_tournament_id and attempted_at>clock_timestamp()-interval '60 seconds'; end if;
    retry_after:=greatest(1,ceil(extract(epoch from oldest+interval '60 seconds'-clock_timestamp()))::integer);
    return jsonb_build_object('allowed',false,'code','RATE_LIMITED','retryAfter',retry_after);
  end if;
  return jsonb_build_object('allowed',true);
end $$;

create or replace function public.internal_delete_tournament_v1(
  p_owner_id uuid,
  p_operation_id uuid,
  p_tournament_id uuid,
  p_request_hash text,
  p_hash_key_version integer
) returns jsonb
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare prior public.tournament_operations_v1%rowtype; current_row public.tournaments_v1%rowtype; result jsonb;
begin
  perform pg_advisory_xact_lock(hashtextextended('tournament-operation:'||p_owner_id::text||':'||p_operation_id::text,0));
  select * into prior from public.tournament_operations_v1 where owner_id=p_owner_id and operation_id=p_operation_id;
  if found then
    if prior.tournament_id<>p_tournament_id or prior.kind<>'delete' or prior.request_hash<>p_request_hash or prior.hash_key_version<>p_hash_key_version then return jsonb_build_object('status','rejected','code','OPERATION_ID_REUSED'); end if;
    return jsonb_build_object('status','replayed','result',prior.result_json);
  end if;
  perform pg_advisory_xact_lock(hashtextextended('tournament-v1:'||p_tournament_id::text,0));
  select * into current_row from public.tournaments_v1 where id=p_tournament_id and owner_id=p_owner_id for update;
  if not found then return jsonb_build_object('status','rejected','code','NOT_FOUND'); end if;
  insert into public.tournament_tombstones_v1(tournament_id,owner_id,deleted_at) values(p_tournament_id,p_owner_id,clock_timestamp()) on conflict(tournament_id) do nothing;
  result:=jsonb_build_object('tournamentId',p_tournament_id,'deleted',true);
  insert into public.tournament_operations_v1(owner_id,operation_id,tournament_id,kind,request_hash,hash_key_version,result_json)
    values(p_owner_id,p_operation_id,p_tournament_id,'delete',p_request_hash,p_hash_key_version,result);
  delete from public.tournaments_v1 where id=p_tournament_id and owner_id=p_owner_id;
  return jsonb_build_object('status','applied','result',result);
end $$;

revoke all on function public.internal_get_tournament_v1(uuid,uuid),
  public.internal_create_tournament_v1(uuid,uuid,uuid,text,integer,jsonb),
  public.internal_import_tournament_v1(uuid,uuid,uuid,text,integer,jsonb,jsonb),
  public.internal_commit_tournament_v2(uuid,uuid,uuid,text,integer,bigint,text,text,bigint,integer,text,jsonb,jsonb,text,jsonb,jsonb,jsonb),
  public.internal_lookup_tournament_receipt_v1(uuid,uuid,uuid,text,integer,boolean),
  public.internal_grant_tournament_v1(uuid,uuid,uuid,text,text,integer,bigint,bigint,text,text,text,integer,jsonb),
  public.internal_release_tournament_v1(uuid,uuid,uuid,text,integer,bigint,bigint,integer,text,text,jsonb),
  public.internal_public_signup_tournament_v2(uuid,text,uuid,text,integer,bigint,text,text,jsonb,jsonb,jsonb,jsonb),
  public.internal_attempt_tournament_signup_v1(text,uuid),
  public.internal_delete_tournament_v1(uuid,uuid,uuid,text,integer)
  from public, anon, authenticated;
grant execute on function public.internal_get_tournament_v1(uuid,uuid),
  public.internal_create_tournament_v1(uuid,uuid,uuid,text,integer,jsonb),
  public.internal_import_tournament_v1(uuid,uuid,uuid,text,integer,jsonb,jsonb),
  public.internal_commit_tournament_v2(uuid,uuid,uuid,text,integer,bigint,text,text,bigint,integer,text,jsonb,jsonb,text,jsonb,jsonb,jsonb),
  public.internal_lookup_tournament_receipt_v1(uuid,uuid,uuid,text,integer,boolean),
  public.internal_grant_tournament_v1(uuid,uuid,uuid,text,text,integer,bigint,bigint,text,text,text,integer,jsonb),
  public.internal_release_tournament_v1(uuid,uuid,uuid,text,integer,bigint,bigint,integer,text,text,jsonb),
  public.internal_public_signup_tournament_v2(uuid,text,uuid,text,integer,bigint,text,text,jsonb,jsonb,jsonb,jsonb),
  public.internal_attempt_tournament_signup_v1(text,uuid),
  public.internal_delete_tournament_v1(uuid,uuid,uuid,text,integer)
  to service_role;

commit;
