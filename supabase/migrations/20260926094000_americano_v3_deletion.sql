-- Preserve schema downgrade protection while allowing the existing owner delete
-- RPC to install its tombstone and clear a schema-3 event body.
create or replace function public.guard_event_protocol_write()
returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
declare old_schema text; new_schema text; v3_rpc boolean:=public.americano_v3_write_enabled(); v2_rpc boolean:=public.americano_v2_write_enabled();
  validation_error text;
begin
  old_schema:=case when tg_op='UPDATE' then old.state->>'schemaVersion' else null end;
  new_schema:=new.state->>'schemaVersion';
  if (coalesce(new.protocol_version,1)=2 or (tg_op='UPDATE' and old.protocol_version=2)) and not (v2_rpc or v3_rpc) then
    raise exception using errcode='P0001',message='UPDATE_REQUIRED';
  end if;
  if tg_op='UPDATE' and old.protocol_version=2 and new.protocol_version<>2 then raise exception using errcode='P0001',message='UPDATE_REQUIRED'; end if;
  if tg_op='UPDATE' and old_schema='3' and new.state is null and new.deleted_at is not null
     and new.user_id=old.user_id and new.id=old.id and old.user_id=auth.uid() and v2_rpc
     and exists(select 1 from public.event_tombstones tombstone where tombstone.event_id=old.id and tombstone.user_id=old.user_id) then
    return new;
  end if;
  if old_schema='3' and new_schema is distinct from '3' then raise exception using errcode='P0001',message='UPDATE_REQUIRED'; end if;
  if new_schema='3' then
    if not v3_rpc and not (v2_rpc and old_schema='3') then raise exception using errcode='P0001',message='UPDATE_REQUIRED'; end if;
    if new.protocol_version<>2 or new.state->>'protocolVersion'<>'2' then raise exception using errcode='P0001',message='UPDATE_REQUIRED'; end if;
    if new.deleted_at is null then
      validation_error:=public.americano_v3_state_error(new.state);
      if validation_error is not null then raise exception using errcode='22023',message=validation_error; end if;
    end if;
  elsif new_schema='2' and old_schema='3' then raise exception using errcode='P0001',message='UPDATE_REQUIRED'; end if;
  if new.state is not null and new.state->>'id' is distinct from new.id::text then raise exception using errcode='22023',message='Event state id does not match its row id.'; end if;
  return new;
end;
$$;
