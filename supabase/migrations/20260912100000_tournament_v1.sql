-- Flexible Tournament V1 is deliberately isolated from legacy events and signups.
create table if not exists public.tournaments_v1 (
  id uuid primary key,
  owner_id uuid not null references auth.users(id) on delete cascade,
  schema_version text not null check (schema_version = 'tournament-v1'),
  revision bigint not null default 0 check (revision >= 0),
  lifecycle text not null check (lifecycle in ('setup','live','complete','cancelled')),
  controller_device_id text,
  controller_epoch bigint not null default 0 check (controller_epoch >= 0),
  controller_next_sequence integer not null default 0 check (controller_next_sequence >= 0),
  controller_capability_hash text,
  state jsonb not null,
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (owner_id, id)
);

create index if not exists tournaments_v1_owner_updated_idx on public.tournaments_v1(owner_id, updated_at desc);

create table if not exists public.tournament_contacts_v1 (
  tournament_id uuid not null references public.tournaments_v1(id) on delete cascade,
  entry_id text not null,
  owner_id uuid not null references auth.users(id) on delete cascade,
  contact text not null check (char_length(contact) <= 100),
  updated_at timestamptz not null default now(),
  primary key (tournament_id, entry_id),
  foreign key (owner_id, tournament_id) references public.tournaments_v1(owner_id, id) on delete cascade
);

create table if not exists public.tournament_commands_v1 (
  tournament_id uuid not null references public.tournaments_v1(id) on delete cascade,
  command_id uuid not null,
  owner_id uuid not null references auth.users(id) on delete cascade,
  payload_hash text not null,
  kind text not null,
  actor_device_id text not null,
  controller_epoch bigint not null,
  sequence integer not null,
  resulting_revision bigint not null,
  redacted_audit jsonb not null default '{}'::jsonb,
  accepted_at timestamptz not null default now(),
  primary key (tournament_id, command_id),
  foreign key (owner_id, tournament_id) references public.tournaments_v1(owner_id, id) on delete cascade
);

create table if not exists public.tournament_public_v1 (
  tournament_id uuid primary key references public.tournaments_v1(id) on delete cascade,
  public_slug text not null unique check (char_length(public_slug) between 3 and 120),
  public_revision bigint not null,
  projection jsonb not null,
  updated_at timestamptz not null default now()
);

create table if not exists public.tournament_tombstones_v1 (
  tournament_id uuid primary key,
  owner_id uuid not null references auth.users(id) on delete cascade,
  deleted_at timestamptz not null default now()
);

-- Raw claim nonce/capability values are never stored. This table is service-only.
create table if not exists public.tournament_claim_receipts_v1 (
  tournament_id uuid not null references public.tournaments_v1(id) on delete cascade,
  claim_id uuid not null,
  owner_id uuid not null references auth.users(id) on delete cascade,
  device_id text not null,
  granted_epoch bigint not null,
  nonce_hash text not null,
  capability_hash text not null,
  derivation_key_version integer not null,
  created_at timestamptz not null default now(),
  primary key (tournament_id, claim_id)
);

alter table public.tournaments_v1 enable row level security;
alter table public.tournament_contacts_v1 enable row level security;
alter table public.tournament_commands_v1 enable row level security;
alter table public.tournament_public_v1 enable row level security;
alter table public.tournament_tombstones_v1 enable row level security;
alter table public.tournament_claim_receipts_v1 enable row level security;

drop policy if exists tournaments_v1_owner_read on public.tournaments_v1;
create policy tournaments_v1_owner_read on public.tournaments_v1 for select to authenticated using (owner_id = auth.uid());
drop policy if exists tournament_contacts_v1_owner_read on public.tournament_contacts_v1;
create policy tournament_contacts_v1_owner_read on public.tournament_contacts_v1 for select to authenticated using (owner_id = auth.uid());
drop policy if exists tournament_commands_v1_owner_read on public.tournament_commands_v1;
create policy tournament_commands_v1_owner_read on public.tournament_commands_v1 for select to authenticated using (owner_id = auth.uid());
drop policy if exists tournament_tombstones_v1_owner_read on public.tournament_tombstones_v1;
create policy tournament_tombstones_v1_owner_read on public.tournament_tombstones_v1 for select to authenticated using (owner_id = auth.uid());
-- No client write policies. Edge service role is the only writer.
-- Public projection is read through the bounded Edge endpoint, never direct table access.

revoke all on public.tournaments_v1, public.tournament_contacts_v1, public.tournament_commands_v1,
  public.tournament_public_v1, public.tournament_tombstones_v1, public.tournament_claim_receipts_v1 from anon, authenticated;
grant select on public.tournaments_v1, public.tournament_contacts_v1, public.tournament_commands_v1,
  public.tournament_tombstones_v1 to authenticated;

create or replace function public.internal_commit_tournament_v1(
  p_owner_id uuid,
  p_tournament_id uuid,
  p_command_id uuid,
  p_payload_hash text,
  p_expected_revision bigint,
  p_device_id text,
  p_capability_hash text,
  p_controller_epoch bigint,
  p_sequence integer,
  p_kind text,
  p_next_state jsonb,
  p_public_slug text,
  p_public_projection jsonb,
  p_redacted_audit jsonb
) returns jsonb
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  current_row public.tournaments_v1%rowtype;
  prior public.tournament_commands_v1%rowtype;
  next_revision bigint;
begin
  if exists(select 1 from public.tournament_tombstones_v1 where tournament_id = p_tournament_id) then
    return jsonb_build_object('status','rejected','code','TOURNAMENT_DELETED');
  end if;
  select * into prior from public.tournament_commands_v1 where tournament_id = p_tournament_id and command_id = p_command_id;
  if found then
    if prior.payload_hash <> p_payload_hash then return jsonb_build_object('status','rejected','code','COMMAND_ID_REUSED'); end if;
    return jsonb_build_object('status','replayed','revision',prior.resulting_revision::text,'payloadHash',prior.payload_hash);
  end if;
  select * into current_row from public.tournaments_v1 where id = p_tournament_id and owner_id = p_owner_id for update;
  if not found then return jsonb_build_object('status','rejected','code','NOT_FOUND'); end if;
  if current_row.revision <> p_expected_revision then return jsonb_build_object('status','conflict','code','REVISION_CONFLICT','revision',current_row.revision::text); end if;
  if current_row.lifecycle = 'live' and (current_row.controller_device_id is distinct from p_device_id or current_row.controller_capability_hash is distinct from p_capability_hash or current_row.controller_epoch <> p_controller_epoch or current_row.controller_next_sequence <> p_sequence) then
    return jsonb_build_object('status','conflict','code','CONTROLLER_CONFLICT','revision',current_row.revision::text);
  end if;
  next_revision := current_row.revision + 1;
  update public.tournaments_v1 set state=p_next_state, revision=next_revision,
    lifecycle=p_next_state->>'lifecycle', controller_device_id=nullif(p_next_state#>>'{controller,deviceId}',''),
    controller_epoch=(p_next_state#>>'{controller,epoch}')::bigint,
    controller_next_sequence=(p_next_state#>>'{controller,nextSequence}')::integer,
    archived_at=case when p_next_state->>'archivedAt' is null then null else to_timestamp((p_next_state->>'archivedAt')::double precision/1000) end,
    updated_at=now() where id=p_tournament_id;
  insert into public.tournament_commands_v1(tournament_id,command_id,owner_id,payload_hash,kind,actor_device_id,controller_epoch,sequence,resulting_revision,redacted_audit)
    values(p_tournament_id,p_command_id,p_owner_id,p_payload_hash,p_kind,p_device_id,p_controller_epoch,p_sequence,next_revision,p_redacted_audit);
  if p_public_slug is not null then
    insert into public.tournament_public_v1(tournament_id,public_slug,public_revision,projection,updated_at)
      values(p_tournament_id,p_public_slug,next_revision,p_public_projection,now())
      on conflict(tournament_id) do update set public_slug=excluded.public_slug,public_revision=excluded.public_revision,projection=excluded.projection,updated_at=excluded.updated_at;
  end if;
  return jsonb_build_object('status','applied','revision',next_revision::text,'payloadHash',p_payload_hash);
end $$;

revoke all on function public.internal_commit_tournament_v1(uuid,uuid,uuid,text,bigint,text,text,bigint,integer,text,jsonb,text,jsonb,jsonb) from public, anon, authenticated;
grant execute on function public.internal_commit_tournament_v1(uuid,uuid,uuid,text,bigint,text,text,bigint,integer,text,jsonb,text,jsonb,jsonb) to service_role;

create or replace function public.internal_public_signup_tournament_v1(
  p_public_slug text,
  p_command_id uuid,
  p_payload_hash text,
  p_expected_revision bigint,
  p_entry_id text,
  p_contact text,
  p_next_state jsonb,
  p_public_projection jsonb,
  p_redacted_audit jsonb
) returns jsonb
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  current_row public.tournaments_v1%rowtype;
  public_row public.tournament_public_v1%rowtype;
  prior public.tournament_commands_v1%rowtype;
  next_revision bigint;
begin
  select * into public_row from public.tournament_public_v1 where public_slug=p_public_slug for update;
  if not found then return jsonb_build_object('status','rejected','code','NOT_FOUND'); end if;
  select * into prior from public.tournament_commands_v1 where tournament_id=public_row.tournament_id and command_id=p_command_id;
  if found then
    if prior.payload_hash <> p_payload_hash then return jsonb_build_object('status','rejected','code','COMMAND_ID_REUSED'); end if;
    return jsonb_build_object('status','replayed','revision',prior.resulting_revision::text);
  end if;
  select * into current_row from public.tournaments_v1 where id=public_row.tournament_id for update;
  if current_row.revision <> p_expected_revision then return jsonb_build_object('status','conflict','code','REVISION_CONFLICT','revision',current_row.revision::text); end if;
  if current_row.lifecycle <> 'setup' or coalesce((current_row.state#>>'{meta,signupOpen}')::boolean,false) is false then return jsonb_build_object('status','rejected','code','SIGNUP_CLOSED'); end if;
  if nullif(current_row.state#>>'{meta,startsAt}','') is not null and (current_row.state#>>'{meta,startsAt}')::timestamptz <= now() then return jsonb_build_object('status','rejected','code','SIGNUP_CLOSED'); end if;
  next_revision := current_row.revision + 1;
  update public.tournaments_v1 set state=p_next_state,revision=next_revision,updated_at=now() where id=current_row.id;
  if p_contact <> '' then insert into public.tournament_contacts_v1(tournament_id,entry_id,owner_id,contact) values(current_row.id,p_entry_id,current_row.owner_id,p_contact); end if;
  insert into public.tournament_commands_v1(tournament_id,command_id,owner_id,payload_hash,kind,actor_device_id,controller_epoch,sequence,resulting_revision,redacted_audit)
    values(current_row.id,p_command_id,current_row.owner_id,p_payload_hash,'public-signup','public',0,0,next_revision,p_redacted_audit);
  update public.tournament_public_v1 set public_revision=next_revision,projection=p_public_projection,updated_at=now() where tournament_id=current_row.id;
  return jsonb_build_object('status','applied','revision',next_revision::text);
end $$;

revoke all on function public.internal_public_signup_tournament_v1(text,uuid,text,bigint,text,text,jsonb,jsonb,jsonb) from public, anon, authenticated;
grant execute on function public.internal_public_signup_tournament_v1(text,uuid,text,bigint,text,text,jsonb,jsonb,jsonb) to service_role;
