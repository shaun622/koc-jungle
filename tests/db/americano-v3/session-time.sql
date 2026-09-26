begin;
do $$
declare config jsonb:='{"rulesVersion":3,"pairingMode":"rotating","scoring":{"kind":"rally","pointsPerMatch":24,"allowUnfinished":true},"ranking":{"tiebreak":"shared","championship":"none"},"scheduleKind":"custom","customRounds":10,"paceMinutes":7,"paceClockEnabled":true,"sessionPlan":{"totalMinutes":90,"preference":"round-length","roundMinutes":7,"changeoverMinutes":2}}'; summary jsonb;
begin
  if public.americano_v3_config_error(config) is not null then raise exception 'Session config rejected'; end if;
  if public.americano_v3_config_error(jsonb_set(config,'{paceMinutes}','0')) is null then raise exception 'Zero pace accepted'; end if;
  if public.americano_v3_config_error(jsonb_set(config,'{sessionPlan,changeoverMinutes}','-1')) is null then raise exception 'Negative changeover accepted'; end if;
  if public.americano_v3_config_error(jsonb_set(config,'{scoring,allowUnfinished}','"yes"')) is null then raise exception 'Nonboolean option accepted'; end if;
  summary:=public.americano_v3_score_summary('{"kind":"rally","scoreA":10,"scoreB":8,"endedEarly":true}',config,true);
  if summary is null or summary->>'gamesA'<>'10' or summary->>'gamesB'<>'8' or summary->>'winner'<>'A' or summary->>'complete'<>'true' then raise exception 'Partial rally points changed'; end if;
  if public.americano_v3_score_summary('{"kind":"rally","scoreA":10,"scoreB":8}',config,true) is not null then raise exception 'Implicit unfinished result accepted'; end if;
  if public.americano_v3_score_summary('{"kind":"rally","scoreA":10,"scoreB":8,"endedEarly":true}',jsonb_set(config,'{scoring,allowUnfinished}','false'),true) is not null then raise exception 'Disabled unfinished result accepted'; end if;
  if public.americano_v3_score_summary('{"kind":"rally","scoreA":0,"scoreB":0,"endedEarly":true}',config,true)->>'winner' is not null then raise exception 'Explicit zero draw gained a winner'; end if;
  if has_function_privilege('anon','public.americano_v3_config_error_before_session(jsonb)','execute') or has_function_privilege('authenticated','public.americano_v3_score_summary_before_session(jsonb,jsonb,boolean)','execute') then raise exception 'Internal validator exposed'; end if;
end $$;
rollback;
