-- Permit an explicit stopped-early result on any Americano V3 match, including
-- events created before the setup option existed. No event or result rows change.
set lock_timeout = '5s';

do $$
declare
  definition text;
  gate text := 'if scoring->''allowUnfinished'' is distinct from ''true''::jsonb then return null; end if;';
begin
  definition := pg_get_functiondef('public.americano_v3_score_summary(jsonb,jsonb,boolean)'::regprocedure);
  if position(gate in definition) = 0 then
    raise exception 'Expected Americano V3 unfinished-score gate was not found';
  end if;
  execute replace(definition, gate, '');
end $$;
