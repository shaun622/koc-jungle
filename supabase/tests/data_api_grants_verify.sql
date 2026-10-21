-- Catalog and zero-row queries only; run after all migrations on a disposable DB.
-- psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/tests/data_api_grants_verify.sql
begin;
do $verify$
declare required record;
begin
  for required in select * from (values
      ('authenticated','public.events','SELECT'),
      ('authenticated','public.events','INSERT'),
      ('authenticated','public.events','UPDATE'),
      ('authenticated','public.event_tombstones','SELECT'),
      ('service_role','public.signup_events','SELECT')
  ) expected(role_name,table_name,privilege_name) loop
    if not has_table_privilege(required.role_name,required.table_name,required.privilege_name) then
      raise exception 'Missing % % on %',required.role_name,required.privilege_name,required.table_name;
    end if;
  end loop;
  if exists(select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind in ('r','p') and not c.relrowsecurity) then
    raise exception 'A public application table has RLS disabled';
  end if;
  if has_table_privilege('authenticated','public.events','DELETE') then
    raise exception 'Unexpected direct authenticated DELETE access to events';
  end if;
  if has_table_privilege('authenticated','public.event_tombstones','INSERT') then
    raise exception 'Unexpected direct authenticated INSERT access to event_tombstones';
  end if;
  if to_regclass('public.tournament_commands_v1') is not null and has_table_privilege('authenticated','public.tournament_commands_v1','SELECT') then
    raise exception 'Unexpected direct authenticated SELECT access to tournament_commands_v1';
  end if;
  if to_regclass('public.tournaments_v1') is not null and not has_table_privilege('service_role','public.tournaments_v1','SELECT') then
    raise exception 'Tournament Edge reads are missing their service-role grant';
  end if;
end;
$verify$;

-- Exercise the caller role as well as inspecting its catalog privileges.
set local role authenticated;
select id from public.events limit 0;
select event_id from public.event_tombstones limit 0;
reset role;
rollback;
