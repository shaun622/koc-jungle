-- organizer_sync_signup_roster declares a row variable named `registration`
-- and also uses `registration` as a SQL table alias. PostgreSQL correctly
-- rejects references such as registration.id as ambiguous. Resolve qualified
-- SQL references as columns for this function; standalone row-variable fields
-- remain unambiguous in PL/pgSQL assignments.
do $migration$
declare
  function_definition text;
  body_marker constant text := E'AS $function$\n';
begin
  select pg_get_functiondef(
    'public.organizer_sync_signup_roster(uuid,jsonb)'::regprocedure
  ) into function_definition;

  if function_definition is null or position(body_marker in function_definition) = 0 then
    raise exception 'Could not locate organizer_sync_signup_roster function body.';
  end if;

  function_definition := replace(
    function_definition,
    body_marker,
    body_marker || E'#variable_conflict use_column\n'
  );
  execute function_definition;
end;
$migration$;
