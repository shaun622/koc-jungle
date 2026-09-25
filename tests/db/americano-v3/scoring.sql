\set ON_ERROR_STOP on

do $$
declare result jsonb; rally_config jsonb; first_to_five_config jsonb; set_config jsonb;
  valid_state jsonb; invalid_config jsonb; final_state jsonb; prepared_final jsonb; final_row jsonb;
begin
  rally_config := '{"scoring":{"kind":"rally","pointsPerMatch":24}}'::jsonb;
  result := public.americano_v3_score_summary('{"kind":"rally","scoreA":10,"scoreB":14}'::jsonb,rally_config,true);
  if result is null or result->>'gamesA'<>'10' or result->>'gamesB'<>'14' or result->>'winner'<>'B' then
    raise exception 'v3 rally score summary did not preserve the entered side scores';
  end if;
  result := public.americano_v3_score_summary('{"kind":"rally","scoreA":12,"scoreB":12}'::jsonb,rally_config,true);
  if result is null or result->>'winner' is not null then raise exception 'v3 equal rally score was not retained as a draw'; end if;
  if public.americano_v3_score_summary('{"kind":"rally","scoreA":10,"scoreB":13}'::jsonb,rally_config,true) is not null then
    raise exception 'v3 rally score with the wrong match total was accepted';
  end if;
  result := public.americano_v3_score_summary('{"kind":"rally","scoreA":null,"scoreB":null}'::jsonb,rally_config,false);
  if result is null or result->>'complete'<>'false' then raise exception 'empty v3 rally draft was not preserved as incomplete'; end if;

  first_to_five_config := '{"scoring":{"kind":"traditional","preset":"first-to-five","rule":{"family":"games","bestOfSets":1,"gamesToWin":5,"gameMargin":1,"tiebreakTrigger":null,"tiebreakTarget":null,"decidingMatchTiebreak":null,"gameEnding":"golden-point"},"standings":{"pointsPerGameWon":2,"matchWinBonus":3}}}'::jsonb;
  result := public.americano_v3_score_summary('{"kind":"traditional","sets":[{"kind":"set","gamesA":5,"gamesB":3,"tiebreakPointsA":null,"tiebreakPointsB":null}]}'::jsonb,first_to_five_config,true);
  if result is null or result->>'gamesA'<>'5' or result->>'gamesB'<>'3' or result->>'winner'<>'A' then
    raise exception 'v3 first-to-five result summary is incorrect';
  end if;

  set_config := '{"scoring":{"kind":"traditional","preset":"standard-set","rule":{"family":"sets","bestOfSets":1,"gamesToWin":6,"gameMargin":2,"tiebreakTrigger":6,"tiebreakTarget":7,"decidingMatchTiebreak":null,"gameEnding":"advantage"},"standings":{"pointsPerGameWon":1,"matchWinBonus":0}}}'::jsonb;
  result := public.americano_v3_score_summary('{"kind":"traditional","sets":[{"kind":"set","gamesA":7,"gamesB":6,"tiebreakPointsA":8,"tiebreakPointsB":6}]}'::jsonb,set_config,true);
  if result is null or result->>'gamesA'<>'7' or result->>'gamesB'<>'6' then raise exception 'valid standard-set tiebreak was rejected'; end if;
  if public.americano_v3_score_summary('{"kind":"traditional","sets":[{"kind":"set","gamesA":8,"gamesB":6,"tiebreakPointsA":null,"tiebreakPointsB":null}]}'::jsonb,set_config,true) is not null then
    raise exception 'a score that skipped the configured set tiebreak was accepted';
  end if;
  if public.americano_v3_score_summary('{"kind":"traditional","sets":[{"kind":"set","gamesA":6,"gamesB":6,"tiebreakPointsA":null,"tiebreakPointsB":null}]}'::jsonb,set_config,true) is not null then
    raise exception 'a set tied at the tiebreak trigger was confirmed without the tiebreak score';
  end if;

  valid_state := jsonb_build_object(
    'id','99999999-9999-4999-8999-999999999991','schemaVersion',3,'protocolVersion',2,'format','americano',
    'name','Americano v3 SQL contract','createdAt',1790340000000,'revision','0','status','setup',
    'settings','{}'::jsonb,'courts',jsonb_build_array(jsonb_build_object('id','99999999-9999-4999-8999-999999999992','name','Court 1','position',1,'pointValue',1)),
    'teams','[]'::jsonb,'participants','[]'::jsonb,'rounds','[]'::jsonb,
    'formatConfig','{"rulesVersion":3,"pairingMode":"rotating","scoring":{"kind":"rally","pointsPerMatch":24},"ranking":{"tiebreak":"shared","championship":"none"},"scheduleKind":"full","paceMinutes":10,"paceClockEnabled":false}'::jsonb
  );
  if public.americano_v3_state_error(valid_state) is not null then raise exception 'valid setup-only v3 state rejected: %',public.americano_v3_state_error(valid_state); end if;
  invalid_config := jsonb_set(valid_state,'{formatConfig,ranking,tiebreak}','"head-to-head"'::jsonb);
  if public.americano_v3_state_error(invalid_config) is null then raise exception 'rotating v3 state accepted fixed-pair head-to-head'; end if;

  final_state:=jsonb_build_object(
    'schemaVersion',3,
    'status','complete',
    'formatConfig','{"rulesVersion":3,"pairingMode":"rotating","scoring":{"kind":"rally","pointsPerMatch":24},"ranking":{"tiebreak":"shared","championship":"golden-point"},"scheduleKind":"full","paceMinutes":10,"paceClockEnabled":false}'::jsonb,
    'participants',jsonb_build_array(
      jsonb_build_object('id','99999999-9999-4999-8999-999999999911','active',true),
      jsonb_build_object('id','99999999-9999-4999-8999-999999999912','active',true),
      jsonb_build_object('id','99999999-9999-4999-8999-999999999913','active',true),
      jsonb_build_object('id','99999999-9999-4999-8999-999999999914','active',true)
    ),
    'courts',jsonb_build_array(jsonb_build_object('id','99999999-9999-4999-8999-999999999992','name','Court 1')),
    'americanoSchedule',jsonb_build_object('inputFingerprint','basis-seed','orderedEntrantIds',jsonb_build_array(
      '99999999-9999-4999-8999-999999999911','99999999-9999-4999-8999-999999999912',
      '99999999-9999-4999-8999-999999999913','99999999-9999-4999-8999-999999999914')),
    'rounds',jsonb_build_array(jsonb_build_object('fixtureRoundId','fixture-round-1','completedAt',100,'matches',jsonb_build_array(jsonb_build_object(
      'id','fixture-match-1','resultConfirmed',true,
      'sideA',jsonb_build_object('kind','rotating-pair','playerIds',jsonb_build_array('99999999-9999-4999-8999-999999999911','99999999-9999-4999-8999-999999999913')),
      'sideB',jsonb_build_object('kind','rotating-pair','playerIds',jsonb_build_array('99999999-9999-4999-8999-999999999912','99999999-9999-4999-8999-999999999914')),
      'result',jsonb_build_object('kind','rally','scoreA',24,'scoreB',0)
    ))))
  );
  prepared_final:=jsonb_build_object(
    'id','99999999-9999-4999-8999-999999999920',
    'contenderIds',jsonb_build_array('99999999-9999-4999-8999-999999999911','99999999-9999-4999-8999-999999999913'),
    'courtId','99999999-9999-4999-8999-999999999992',
    'supportPlayerIds',jsonb_build_array('99999999-9999-4999-8999-999999999912','99999999-9999-4999-8999-999999999914'),
    'outcome',null
  );
  prepared_final:=prepared_final||jsonb_build_object('basisFingerprint',public.americano_v3_championship_basis(final_state));
  final_state:=jsonb_set(final_state,'{championshipFinal}',prepared_final,true);
  if public.americano_v3_final_shape_error(final_state) is not null then raise exception 'valid rotating championship final failed shape validation: %',public.americano_v3_final_shape_error(final_state); end if;
  if public.americano_v3_final_eligibility_error(final_state,prepared_final) is not null then raise exception 'valid rotating championship final failed eligibility validation: %',public.americano_v3_final_eligibility_error(final_state,prepared_final); end if;
  final_row:=prepared_final||jsonb_build_object('outcome',jsonb_build_object('kind','golden-point','winner','A','confirmedAt',101));
  final_state:=jsonb_set(final_state,'{championshipFinal}',final_row,true);
  if public.americano_v3_final_shape_error(final_state) is not null then raise exception 'valid golden-point final outcome failed server validation'; end if;
  final_state:=jsonb_set(final_state,'{rounds,0,matches,0,result}', '{"kind":"rally","scoreA":23,"scoreB":1}'::jsonb,true);
  if public.americano_v3_final_eligibility_error(final_state,final_row)<>'FINAL_STALE' then raise exception 'a championship final survived a regular-results basis change'; end if;
end;
$$;

select 'Americano v3 SQL scoring/state contract passed' as result;
