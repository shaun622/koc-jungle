-- Keep schema-2 RPCs callable for their own records while giving old clients a
-- stable response instead of allowing a schema-3 event to hit the write guard.
-- The renamed implementations retain their previously reviewed v2 semantics.

alter function public.organizer_save_event_v2(uuid,bigint,uuid,jsonb)
  rename to organizer_save_event_v2_schema2;
alter function public.organizer_save_americano_config_v2(uuid,bigint,uuid,bigint,bigint,uuid,jsonb,jsonb)
  rename to organizer_save_americano_config_v2_schema2;
alter function public.organizer_start_americano_v2(uuid,bigint,uuid,bigint,bigint,uuid,jsonb)
  rename to organizer_start_americano_v2_schema2;

create function public.organizer_save_event_v2(
  p_event_id uuid,p_base_event_revision bigint,p_request_id uuid,p_state jsonb
)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
begin
  if p_state->>'schemaVersion' is distinct from '2' or p_state->>'protocolVersion' is distinct from '2' then
    return public.americano_v2_rejected(p_request_id,'UPDATE_REQUIRED','This event requires the current Americano version.');
  end if;
  if auth.uid() is not null and exists(select 1 from public.events event_row where event_row.id=p_event_id and event_row.user_id=auth.uid()
    and event_row.deleted_at is null and event_row.state->>'schemaVersion'='3') then
    return public.americano_v2_rejected(p_request_id,'UPDATE_REQUIRED','This event uses Americano rules 3.');
  end if;
  return public.organizer_save_event_v2_schema2(p_event_id,p_base_event_revision,p_request_id,p_state);
end;
$$;

create function public.organizer_save_americano_config_v2(
  p_event_id uuid,p_base_event_revision bigint,p_signup_event_id uuid,p_base_capacity_revision bigint,
  p_base_roster_revision bigint,p_request_id uuid,p_courts jsonb,p_format_config jsonb
)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
begin
  if auth.uid() is not null and exists(select 1 from public.events event_row where event_row.id=p_event_id and event_row.user_id=auth.uid()
    and event_row.deleted_at is null and event_row.state->>'schemaVersion'='3') then
    return public.americano_v2_rejected(p_request_id,'UPDATE_REQUIRED','This event uses Americano rules 3.');
  end if;
  if p_format_config->>'rulesVersion' is distinct from '2' then
    return public.americano_v2_rejected(p_request_id,'UPDATE_REQUIRED','This event requires the current Americano version.','formatConfig');
  end if;
  return public.organizer_save_americano_config_v2_schema2(
    p_event_id,p_base_event_revision,p_signup_event_id,p_base_capacity_revision,p_base_roster_revision,
    p_request_id,p_courts,p_format_config
  );
end;
$$;

create function public.organizer_start_americano_v2(
  p_event_id uuid,p_base_event_revision bigint,p_signup_event_id uuid,p_base_capacity_revision bigint,
  p_base_roster_revision bigint,p_request_id uuid,p_start_state jsonb
)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
begin
  if p_start_state->>'schemaVersion' is distinct from '2' or p_start_state->>'protocolVersion' is distinct from '2' then
    return public.americano_v2_rejected(p_request_id,'UPDATE_REQUIRED','This event requires the current Americano version.');
  end if;
  if auth.uid() is not null and exists(select 1 from public.events event_row where event_row.id=p_event_id and event_row.user_id=auth.uid()
    and event_row.deleted_at is null and event_row.state->>'schemaVersion'='3') then
    return public.americano_v2_rejected(p_request_id,'UPDATE_REQUIRED','This event uses Americano rules 3.');
  end if;
  return public.organizer_start_americano_v2_schema2(
    p_event_id,p_base_event_revision,p_signup_event_id,p_base_capacity_revision,p_base_roster_revision,p_request_id,p_start_state
  );
end;
$$;

revoke all on function public.organizer_save_event_v2_schema2(uuid,bigint,uuid,jsonb) from public,anon,authenticated;
revoke all on function public.organizer_save_americano_config_v2_schema2(uuid,bigint,uuid,bigint,bigint,uuid,jsonb,jsonb) from public,anon,authenticated;
revoke all on function public.organizer_start_americano_v2_schema2(uuid,bigint,uuid,bigint,bigint,uuid,jsonb) from public,anon,authenticated;
revoke all on function public.organizer_save_event_v2(uuid,bigint,uuid,jsonb) from public,anon;
revoke all on function public.organizer_save_americano_config_v2(uuid,bigint,uuid,bigint,bigint,uuid,jsonb,jsonb) from public,anon;
revoke all on function public.organizer_start_americano_v2(uuid,bigint,uuid,bigint,bigint,uuid,jsonb) from public,anon;
grant execute on function public.organizer_save_event_v2(uuid,bigint,uuid,jsonb) to authenticated;
grant execute on function public.organizer_save_americano_config_v2(uuid,bigint,uuid,bigint,bigint,uuid,jsonb,jsonb) to authenticated;
grant execute on function public.organizer_start_americano_v2(uuid,bigint,uuid,bigint,bigint,uuid,jsonb) to authenticated;
