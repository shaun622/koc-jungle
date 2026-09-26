\set ON_ERROR_STOP on
begin;
do $$
declare event_row public.events%rowtype; reply jsonb; request_id uuid:=gen_random_uuid();
begin
  select * into strict event_row from public.events where id='99999999-9999-4999-8999-999999999901';
  perform set_config('request.jwt.claim.sub','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',true);
  reply:=public.organizer_delete_event_v2(event_row.id,event_row.revision,request_id);
  if reply->>'status'<>'rejected' then raise exception 'Nonowner deleted schema3'; end if;
  perform set_config('request.jwt.claim.sub',event_row.user_id::text,true);
  reply:=public.organizer_delete_event_v2(event_row.id,event_row.revision-1,request_id);
  if reply->>'status'<>'conflict' then raise exception 'Stale delete was accepted'; end if;
  reply:=public.organizer_delete_event_v2(event_row.id,event_row.revision,request_id);
  if reply->>'status'<>'applied' then raise exception 'V3 delete failed: %',reply; end if;
  if not exists(select 1 from public.events where id=event_row.id and state is null and deleted_at is not null) then raise exception 'V3 tombstone missing'; end if;
  if exists(select 1 from public.signup_events where source_event_uuid=event_row.id and (is_open or cancelled_at is null)) then raise exception 'Signup not cancelled'; end if;
  reply:=public.organizer_delete_event_v2(event_row.id,event_row.revision,request_id);
  if reply->>'status'<>'replayed' then raise exception 'Delete replay failed'; end if;
  reply:=public.organizer_save_event_v3(event_row.id,event_row.revision,gen_random_uuid(),event_row.state);
  if reply->>'code'<>'EVENT_DELETED' then raise exception 'Deleted event resurrected'; end if;
end $$;
rollback;
select 'Americano v3 deletion/owner/replay/no-resurrection passed' as result;
