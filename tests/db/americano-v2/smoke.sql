\set ON_ERROR_STOP on

begin;

do $$
begin
  if current_database() not like 'koc_americano_test_%' then
    raise exception 'Refusing to run against database %', current_database();
  end if;
end;
$$;

select 'isolated americano database verified' as result;

rollback;
