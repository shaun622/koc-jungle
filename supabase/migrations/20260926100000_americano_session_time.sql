-- Additive options only. No event or signup rows are rewritten.
set lock_timeout = '5s';

-- Preserve the deployed validators for events that do not enable new options.
do $$
declare definition text;
begin
  definition := pg_get_functiondef('public.americano_v3_config_error(jsonb)'::regprocedure);
  execute replace(definition, 'FUNCTION public.americano_v3_config_error(', 'FUNCTION public.americano_v3_config_error_before_session(');
  definition := pg_get_functiondef('public.americano_v3_score_summary(jsonb,jsonb,boolean)'::regprocedure);
  execute replace(definition, 'FUNCTION public.americano_v3_score_summary(', 'FUNCTION public.americano_v3_score_summary_before_session(');
end $$;

create or replace function public.americano_v3_config_error(p_config jsonb)
returns text language plpgsql immutable set search_path=public,pg_temp as $$
declare plan jsonb:=p_config->'sessionPlan';
begin
  if not coalesce(public.americano_v3_nonnegative_integer(p_config->'paceMinutes',240),false)
     or (p_config->>'paceMinutes')::numeric<1 then return 'INVALID_MATCH_RULE'; end if;
  if (p_config->'scoring') ? 'allowUnfinished' and jsonb_typeof(p_config#>'{scoring,allowUnfinished}') is distinct from 'boolean' then return 'INVALID_MATCH_RULE'; end if;
  if p_config ? 'sessionPlan' then
    if jsonb_typeof(plan) is distinct from 'object' or coalesce(plan->>'preference','') not in ('full','round-length')
      or not coalesce(public.americano_v3_nonnegative_integer(plan->'totalMinutes',1440),false) or (plan->>'totalMinutes')::numeric<1
      or not coalesce(public.americano_v3_nonnegative_integer(plan->'roundMinutes',240),false) or (plan->>'roundMinutes')::numeric<1
      or not coalesce(public.americano_v3_nonnegative_integer(plan->'changeoverMinutes',60),false) then return 'INVALID_SCHEDULE'; end if;
  end if;
  return public.americano_v3_config_error_before_session(jsonb_set(p_config,'{paceMinutes}','10'::jsonb));
exception when others then return 'INVALID_MATCH_RULE';
end $$;

create or replace function public.americano_v3_score_summary(p_result jsonb,p_config jsonb,p_require_complete boolean)
returns jsonb language plpgsql immutable set search_path=public,pg_temp as $$
declare scoring jsonb:=p_config->'scoring'; rule jsonb:=scoring->'rule'; row_value jsonb; rows jsonb;
  a numeric; b numeric; ta numeric; tb numeric; high numeric; low numeric; target numeric; trigger_games numeric;
  ga numeric:=0; gb numeric:=0; sa integer:=0; sb integer:=0; idx integer:=0; needed integer;
  row_done boolean; match_done boolean:=false; row_winner text; winner text; last_lead text; last_row boolean;
begin
  if p_result ? 'endedEarly' and jsonb_typeof(p_result->'endedEarly') is distinct from 'boolean' then return null; end if;
  if p_result->'endedEarly' is distinct from 'true'::jsonb then return public.americano_v3_score_summary_before_session(p_result,p_config,p_require_complete); end if;
  if scoring->'allowUnfinished' is distinct from 'true'::jsonb then return null; end if;
  if scoring->>'kind'='rally' then
    if p_result->>'kind' is distinct from 'rally'
      or not coalesce(public.americano_v3_nonnegative_integer(p_result->'scoreA'),false)
      or not coalesce(public.americano_v3_nonnegative_integer(p_result->'scoreB'),false) then return null; end if;
    a:=(p_result->>'scoreA')::numeric; b:=(p_result->>'scoreB')::numeric;
    if a+b>(scoring->>'pointsPerMatch')::numeric then return null; end if;
    return jsonb_build_object('winner',case when a>b then 'A' when b>a then 'B' else null end,'setsA',0,'setsB',0,'gamesA',a,'gamesB',b,'complete',true);
  end if;
  rows:=p_result->'sets';
  if scoring->>'kind' is distinct from 'traditional' or p_result->>'kind' is distinct from 'traditional'
    or jsonb_typeof(rows) is distinct from 'array' or jsonb_array_length(rows)<1
    or jsonb_array_length(rows)>(rule->>'bestOfSets')::integer then return null; end if;
  needed:=((rule->>'bestOfSets')::integer/2)+1;
  for row_value in select value from jsonb_array_elements(rows) loop
    idx:=idx+1; last_row:=idx=jsonb_array_length(rows); row_done:=false; row_winner:=null; last_lead:=null;
    if match_done then return null; end if;
    if row_value->>'kind'='match-tiebreak' then
      if rule->>'family'<>'sets' or idx<>3 or sa<>1 or sb<>1 or rule->>'decidingMatchTiebreak' is null
        or not coalesce(public.americano_v3_nonnegative_integer(row_value->'pointsA'),false)
        or not coalesce(public.americano_v3_nonnegative_integer(row_value->'pointsB'),false) then return null; end if;
      a:=(row_value->>'pointsA')::numeric; b:=(row_value->>'pointsB')::numeric; target:=(rule->>'decidingMatchTiebreak')::numeric;
      high:=greatest(a,b); low:=least(a,b);
      row_done:=(high=target and low<=target-2) or (high>target and high-low=2);
      if not row_done and high>=target and high-low>=2 then return null; end if;
    elsif row_value->>'kind'='set' then
      if idx=3 and rule->>'decidingMatchTiebreak' is not null then return null; end if;
      if not coalesce(public.americano_v3_nonnegative_integer(row_value->'gamesA'),false)
        or not coalesce(public.americano_v3_nonnegative_integer(row_value->'gamesB'),false) then return null; end if;
      a:=(row_value->>'gamesA')::numeric; b:=(row_value->>'gamesB')::numeric;
      trigger_games:=(rule->>'tiebreakTrigger')::numeric; target:=(rule->>'gamesToWin')::numeric;
      ta:=null; tb:=null;
      if row_value->'tiebreakPointsA' is distinct from 'null'::jsonb or row_value->'tiebreakPointsB' is distinct from 'null'::jsonb then
        if not coalesce(public.americano_v3_nonnegative_integer(row_value->'tiebreakPointsA'),false)
          or not coalesce(public.americano_v3_nonnegative_integer(row_value->'tiebreakPointsB'),false)
          or trigger_games is null then return null; end if;
        ta:=(row_value->>'tiebreakPointsA')::numeric; tb:=(row_value->>'tiebreakPointsB')::numeric;
        high:=greatest(ta,tb); low:=least(ta,tb); target:=(rule->>'tiebreakTarget')::numeric;
        row_done:=(high=target and low<=target-2) or (high>target and high-low=2);
        if row_done then
          if not ((a=trigger_games+1 and b=trigger_games and ta>tb) or (b=trigger_games+1 and a=trigger_games and tb>ta)) then return null; end if;
        else
          if high>=target and high-low>=2 or not (a=trigger_games and b=trigger_games) then return null; end if;
          last_lead:=case when ta>tb then 'A' when tb>ta then 'B' else null end;
        end if;
      else
        high:=greatest(a,b); low:=least(a,b);
        row_done:=a<>b and (case when rule->>'gameMargin'='1' then high=target and low<=target-1
          else (high=target and low<=target-2) or (high>target and high-low=2) end)
          and (trigger_games is null or low<trigger_games);
        if not row_done and not (case when trigger_games is not null then high<=trigger_games
          when rule->>'gameMargin'='1' then high<target else high<target or high-low<2 end) then return null; end if;
      end if;
      ga:=ga+a; gb:=gb+b;
    else return null; end if;
    if row_done then
      row_winner:=case when a>b then 'A' else 'B' end;
      if rule->>'family'='games' then match_done:=true;
      else
        if row_winner='A' then sa:=sa+1; else sb:=sb+1; end if;
        match_done:=sa>=needed or sb>=needed;
      end if;
    elsif not last_row then return null; end if;
    if last_lead is null then last_lead:=case when a>b then 'A' when b>a then 'B' else null end; end if;
  end loop;
  winner:=case when sa>sb then 'A' when sb>sa then 'B' when row_done and rule->>'family'='sets' then null else last_lead end;
  return jsonb_build_object('winner',winner,'setsA',sa,'setsB',sb,'gamesA',ga,'gamesB',gb,'complete',true);
exception when others then return null;
end $$;

-- The v3 state validator reuses v2 only for fixture/lifecycle validation.
-- Normalize its synthetic v2 pace; real v3 pace is checked above and retained.
do $$
declare definition text; old_fragment text := $old$(config-'scoring')||jsonb_build_object('rulesVersion',2,'pointsPerMatch',1)$old$;
begin
  definition:=pg_get_functiondef('public.americano_v3_state_error(jsonb)'::regprocedure);
  if position(old_fragment in definition)=0 then raise exception 'Unexpected v3 validator definition; migration aborted'; end if;
  execute replace(definition,old_fragment,$new$(config-'scoring'-'sessionPlan')||jsonb_build_object('rulesVersion',2,'pointsPerMatch',1,'paceMinutes',10)$new$);
end $$;

revoke all on function public.americano_v3_config_error_before_session(jsonb) from public,anon,authenticated;
revoke all on function public.americano_v3_score_summary_before_session(jsonb,jsonb,boolean) from public,anon,authenticated;
revoke all on function public.americano_v3_config_error(jsonb) from public,anon,authenticated;
revoke all on function public.americano_v3_score_summary(jsonb,jsonb,boolean) from public,anon,authenticated;
