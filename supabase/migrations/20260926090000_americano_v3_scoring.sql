-- Americano schema/rules v3. Additive, transactionally validated, and no row rewrite.
set lock_timeout = '5s';

alter table public.events
  add constraint events_protocol_state_check_v3 check (
    deleted_at is not null
    or (protocol_version = 1 and coalesce(state ->> 'schemaVersion', '1') = '1')
    or (protocol_version = 2 and state ->> 'schemaVersion' = '2' and state ->> 'protocolVersion' = '2'
      and state ->> 'format' = 'americano' and state #>> '{formatConfig,rulesVersion}' = '2')
    or (protocol_version = 2 and state ->> 'schemaVersion' = '3' and state ->> 'protocolVersion' = '2'
      and state ->> 'format' = 'americano' and state #>> '{formatConfig,rulesVersion}' = '3')
  ) not valid;
alter table public.events validate constraint events_protocol_state_check_v3;
alter table public.events drop constraint events_protocol_state_check;
alter table public.events rename constraint events_protocol_state_check_v3 to events_protocol_state_check;

create or replace function public.americano_v3_write_enabled()
returns boolean language sql stable set search_path=public,pg_temp as $$
  select coalesce(current_setting('app.americano_v3_rpc', true) = 'on', false)
$$;

create or replace function public.americano_v3_nonnegative_integer(p_value jsonb, p_max numeric default 2147483647)
returns boolean language plpgsql immutable set search_path=public,pg_temp as $$
declare number_value numeric;
begin
  if jsonb_typeof(p_value) <> 'number' then return false; end if;
  number_value := (p_value #>> '{}')::numeric;
  return number_value = trunc(number_value) and number_value between 0 and p_max;
exception when others then return false;
end;
$$;

create or replace function public.americano_v3_config_error(p_config jsonb)
returns text language plpgsql immutable set search_path=public,pg_temp as $$
declare scoring jsonb; ranking jsonb; rule jsonb; preset text; expected jsonb; value numeric;
begin
  if jsonb_typeof(p_config) <> 'object' or p_config->>'rulesVersion' <> '3' then return 'INVALID_MATCH_RULE'; end if;
  if p_config->>'pairingMode' not in ('fixed','rotating') then return 'MODE_MISMATCH'; end if;
  if p_config->>'scheduleKind' not in ('full','balanced','custom') then return 'INVALID_SCHEDULE'; end if;
  if p_config->>'scheduleKind'='custom' then
    if not public.americano_v3_nonnegative_integer(p_config->'customRounds',64)
       or (p_config->>'customRounds')::numeric < 1 then return 'INVALID_SCHEDULE'; end if;
  elsif p_config ? 'customRounds' then return 'INVALID_SCHEDULE'; end if;
  if p_config->>'paceMinutes' not in ('5','10','15','20','25','30')
     or jsonb_typeof(p_config->'paceClockEnabled') <> 'boolean' then return 'INVALID_MATCH_RULE'; end if;
  ranking := p_config->'ranking';
  if jsonb_typeof(ranking)<>'object' or ranking->>'tiebreak' not in ('shared','difference','head-to-head','head-to-head-then-difference')
     or ranking->>'championship' not in ('none','golden-point','tiebreak-7','tiebreak-10') then return 'INVALID_TIE_POLICY'; end if;
  if p_config->>'pairingMode'='rotating' and ranking->>'tiebreak' like 'head-to-head%' then return 'INVALID_TIE_POLICY'; end if;
  scoring := p_config->'scoring';
  if jsonb_typeof(scoring)<>'object' then return 'INVALID_MATCH_RULE'; end if;
  if scoring->>'kind'='rally' then
    if not public.americano_v3_nonnegative_integer(scoring->'pointsPerMatch',2147483647)
       or (scoring->>'pointsPerMatch')::numeric < 1 then return 'INVALID_MATCH_RULE'; end if;
    return null;
  end if;
  if scoring->>'kind'<>'traditional' then return 'INVALID_MATCH_RULE'; end if;
  rule := scoring->'rule';
  if jsonb_typeof(rule)<>'object' or rule->>'family' not in ('games','sets')
     or rule->>'bestOfSets' not in ('1','3')
     or rule->>'gameMargin' not in ('1','2')
     or rule->>'gameEnding' not in ('advantage','golden-point','star-point') then return 'INVALID_MATCH_RULE'; end if;
  if not public.americano_v3_nonnegative_integer(rule->'gamesToWin',99) or (rule->>'gamesToWin')::numeric < 1 then return 'INVALID_MATCH_RULE'; end if;
  if (rule->>'family'='games' and rule->>'bestOfSets'<>'1') then return 'INVALID_MATCH_RULE'; end if;
  if (rule->>'tiebreakTrigger'='null' or rule->'tiebreakTrigger'='null'::jsonb) then
    if rule->'tiebreakTarget' is distinct from 'null'::jsonb then return 'INVALID_MATCH_RULE'; end if;
  else
    if not public.americano_v3_nonnegative_integer(rule->'tiebreakTrigger',99)
       or (rule->>'tiebreakTrigger')::numeric < 1
       or not public.americano_v3_nonnegative_integer(rule->'tiebreakTarget',99)
       or (rule->>'tiebreakTarget')::numeric < 1
       or rule->>'family'<>'sets' then return 'INVALID_MATCH_RULE'; end if;
  end if;
  if rule->'decidingMatchTiebreak' <> 'null'::jsonb
     and rule->>'decidingMatchTiebreak' not in ('7','10') then return 'INVALID_MATCH_RULE'; end if;
  if rule->>'decidingMatchTiebreak' in ('7','10') and rule->>'bestOfSets'<>'3' then return 'INVALID_MATCH_RULE'; end if;
  if not public.americano_v3_nonnegative_integer(scoring #> '{standings,pointsPerGameWon}',1000)
     or (scoring #>> '{standings,pointsPerGameWon}')::numeric < 1
     or not public.americano_v3_nonnegative_integer(scoring #> '{standings,matchWinBonus}',1000) then return 'INVALID_STANDINGS_RULE'; end if;

  preset := scoring->>'preset';
  expected := case preset
    when 'first-to-five' then '{"family":"games","bestOfSets":1,"gamesToWin":5,"gameMargin":1,"tiebreakTrigger":null,"tiebreakTarget":null,"decidingMatchTiebreak":null,"gameEnding":"golden-point"}'::jsonb
    when 'short-set' then '{"family":"sets","bestOfSets":1,"gamesToWin":4,"gameMargin":2,"tiebreakTrigger":4,"tiebreakTarget":7,"decidingMatchTiebreak":null,"gameEnding":"golden-point"}'::jsonb
    when 'standard-set' then '{"family":"sets","bestOfSets":1,"gamesToWin":6,"gameMargin":2,"tiebreakTrigger":6,"tiebreakTarget":7,"decidingMatchTiebreak":null,"gameEnding":"advantage"}'::jsonb
    when 'best-of-three' then '{"family":"sets","bestOfSets":3,"gamesToWin":6,"gameMargin":2,"tiebreakTrigger":6,"tiebreakTarget":7,"decidingMatchTiebreak":null,"gameEnding":"advantage"}'::jsonb
    when 'best-of-three-match-tiebreak' then '{"family":"sets","bestOfSets":3,"gamesToWin":6,"gameMargin":2,"tiebreakTrigger":6,"tiebreakTarget":7,"decidingMatchTiebreak":10,"gameEnding":"advantage"}'::jsonb
    when 'custom' then null else null end;
  if preset not in ('first-to-five','short-set','standard-set','best-of-three','best-of-three-match-tiebreak','custom') then return 'INVALID_MATCH_RULE'; end if;
  if expected is not null and expected is distinct from rule then return 'INVALID_MATCH_RULE'; end if;
  return null;
exception when others then return 'INVALID_MATCH_RULE';
end;
$$;

create or replace function public.americano_v3_schedule_fingerprint(p_state jsonb)
returns text language plpgsql immutable set search_path=public,pg_temp as $$
declare schedule jsonb:=p_state->'americanoSchedule'; membership jsonb:='null'::jsonb; fixtures jsonb; payload jsonb;
begin
  if p_state #>> '{formatConfig,pairingMode}'='fixed' then
    select coalesce(jsonb_agg(jsonb_build_object('teamId',team->>'id','playerIds',jsonb_build_array(team#>>'{players,0,id}',team#>>'{players,1,id}')) order by ordinal),'[]'::jsonb)
      into membership from jsonb_array_elements(p_state->'teams') with ordinality rows(team,ordinal) where coalesce((team->>'active')::boolean,false);
  end if;
  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'matches', (
          select coalesce(
            jsonb_agg(
              jsonb_build_object('courtId',match->>'courtId','sideA',match->'sideA','sideB',match->'sideB')
              order by match_ordinal
            ),
            '[]'::jsonb
          )
          from jsonb_array_elements(round_value->'matches') with ordinality match_rows(match,match_ordinal)
        ),
        'rests', round_value->'restingEntrantIds'
      ) order by round_ordinal
    ),
    '[]'::jsonb
  ) into fixtures
  from jsonb_array_elements(schedule->'rounds') with ordinality round_rows(round_value,round_ordinal);
  payload:=jsonb_build_object('fingerprintVersion',3,'algorithmVersion',schedule->'algorithmVersion','formatConfig',p_state->'formatConfig',
    'seed',schedule->'seed','orderedEntrantIds',schedule->'orderedEntrantIds','membership',membership,'courtIds',schedule->'courtIds',
    'rosterRevision',schedule->'rosterRevision','fixtures',fixtures,'metrics',schedule->'metrics');
  return encode(pg_catalog.sha256(convert_to(public.americano_v2_canonical_json(payload),'UTF8')),'hex');
exception when others then return null;
end;
$$;

-- A score summary is derived solely from the frozen rule and entered rows.
-- Invalid input returns null; callers map that to a stable INVALID_SCORE code.
create or replace function public.americano_v3_score_summary(p_result jsonb,p_config jsonb,p_require_complete boolean)
returns jsonb language plpgsql immutable set search_path=public,pg_temp as $$
declare scoring jsonb:=p_config->'scoring'; rule jsonb:=scoring->'rule'; rows jsonb; row_value jsonb;
  index_value integer:=0; sets_a integer:=0; sets_b integer:=0; games_a numeric:=0; games_b numeric:=0;
  a numeric; b numeric; ta numeric; tb numeric; target numeric; trigger_games numeric; need_a boolean;
  row_complete boolean; saw_incomplete boolean:=false; match_done boolean:=false; winner text; high numeric; low numeric;
  result_kind text:=p_result->>'kind';
begin
  if scoring->>'kind'='rally' then
    if result_kind<>'rally' then return null; end if;
    if p_result->'scoreA'='null'::jsonb and p_result->'scoreB'='null'::jsonb then
      if p_require_complete then return null; end if;
      return jsonb_build_object('winner',null,'setsA',0,'setsB',0,'gamesA',0,'gamesB',0,'complete',false);
    end if;
    if not public.americano_v3_nonnegative_integer(p_result->'scoreA') or not public.americano_v3_nonnegative_integer(p_result->'scoreB') then return null; end if;
    a:=(p_result->>'scoreA')::numeric; b:=(p_result->>'scoreB')::numeric; target:=(scoring->>'pointsPerMatch')::numeric;
    if a>target or b>target or a+b<>target then return null; end if;
    winner:=case when a>b then 'A' when b>a then 'B' else null end;
    return jsonb_build_object('winner',winner,'setsA',0,'setsB',0,'gamesA',a,'gamesB',b,'complete',true);
  end if;
  if scoring->>'kind'<>'traditional' or result_kind<>'traditional' or jsonb_typeof(p_result->'sets')<>'array' then return null; end if;
  rows:=p_result->'sets';
  if jsonb_array_length(rows)<1 or jsonb_array_length(rows)>(rule->>'bestOfSets')::integer then return null; end if;
  for row_value in select value from jsonb_array_elements(rows) loop
    index_value:=index_value+1;
    row_complete:=false;
    if row_value->>'kind'='set' then
      if (row_value->'gamesA'<>'null'::jsonb and not public.americano_v3_nonnegative_integer(row_value->'gamesA'))
         or (row_value->'gamesB'<>'null'::jsonb and not public.americano_v3_nonnegative_integer(row_value->'gamesB'))
         or (row_value->'tiebreakPointsA'<>'null'::jsonb and not public.americano_v3_nonnegative_integer(row_value->'tiebreakPointsA'))
         or (row_value->'tiebreakPointsB'<>'null'::jsonb and not public.americano_v3_nonnegative_integer(row_value->'tiebreakPointsB')) then return null; end if;
      a:=case when row_value->'gamesA'='null'::jsonb then null else (row_value->>'gamesA')::numeric end;
      b:=case when row_value->'gamesB'='null'::jsonb then null else (row_value->>'gamesB')::numeric end;
      ta:=case when row_value->'tiebreakPointsA'='null'::jsonb then null else (row_value->>'tiebreakPointsA')::numeric end;
      tb:=case when row_value->'tiebreakPointsB'='null'::jsonb then null else (row_value->>'tiebreakPointsB')::numeric end;
      row_complete:=a is not null and b is not null and ((ta is null and tb is null) or (ta is not null and tb is not null));
      if (ta is null) <> (tb is null) then row_complete:=false; end if;
      if row_complete then
        if match_done then return null; end if;
        high:=greatest(a,b); low:=least(a,b);
        if ta is not null then
          trigger_games:=(rule->>'tiebreakTrigger')::numeric; target:=(rule->>'tiebreakTarget')::numeric;
          if rule->'tiebreakTrigger'='null'::jsonb or not ((a=trigger_games+1 and b=trigger_games) or (b=trigger_games+1 and a=trigger_games)) then return null; end if;
          if greatest(ta,tb)<target or abs(ta-tb)<2 or ((ta>tb) is distinct from (a>b)) then return null; end if;
        elsif rule->'tiebreakTrigger'<>'null'::jsonb and a >= (rule->>'tiebreakTrigger')::numeric and b >= (rule->>'tiebreakTrigger')::numeric then
          -- Games-all at the configured trigger is incomplete until its set
          -- tiebreak is recorded. A later game score cannot skip that tiebreak.
          if a=b then row_complete:=false; else return null; end if;
        end if;
        if row_complete then
          if rule->>'family'='games' then
            if high<(rule->>'gamesToWin')::numeric or high-low<(rule->>'gameMargin')::numeric then
              if p_require_complete then return null; end if;
              row_complete:=false;
            else match_done:=true; end if;
          else
            if (ta is null and (high<(rule->>'gamesToWin')::numeric or high-low<(rule->>'gameMargin')::numeric)) then
              if p_require_complete then return null; end if;
              row_complete:=false;
            end if;
            if row_complete then
              games_a:=games_a+a; games_b:=games_b+b;
              if a>b then sets_a:=sets_a+1; else sets_b:=sets_b+1; end if;
              if sets_a>((rule->>'bestOfSets')::integer/2) or sets_b>((rule->>'bestOfSets')::integer/2) then match_done:=true; end if;
            end if;
          end if;
          if rule->>'family'='games' and row_complete then games_a:=a; games_b:=b; end if;
        end if;
      end if;
    elsif row_value->>'kind'='match-tiebreak' then
      if index_value<>3 or rule->>'bestOfSets'<>'3' or rule->'decidingMatchTiebreak'='null'::jsonb or sets_a<>1 or sets_b<>1 then return null; end if;
      if (row_value->'pointsA'<>'null'::jsonb and not public.americano_v3_nonnegative_integer(row_value->'pointsA'))
         or (row_value->'pointsB'<>'null'::jsonb and not public.americano_v3_nonnegative_integer(row_value->'pointsB')) then return null; end if;
      a:=case when row_value->'pointsA'='null'::jsonb then null else (row_value->>'pointsA')::numeric end;
      b:=case when row_value->'pointsB'='null'::jsonb then null else (row_value->>'pointsB')::numeric end;
      row_complete:=a is not null and b is not null;
      if row_complete then
        target:=(rule->>'decidingMatchTiebreak')::numeric;
        if greatest(a,b)<target or abs(a-b)<2 then return null; end if;
        if a>b then sets_a:=2; else sets_b:=2; end if;
        match_done:=true;
      end if;
    else return null;
    end if;
    if not row_complete then
      if p_require_complete or index_value<>jsonb_array_length(rows) then return null; end if;
      saw_incomplete:=true;
    elsif saw_incomplete then return null;
    end if;
  end loop;
  if p_require_complete and not match_done then return null; end if;
  winner:=case when match_done and rule->>'family'='games' then
      case when games_a>games_b then 'A' else 'B' end
    when match_done and sets_a>sets_b then 'A' when match_done and sets_b>sets_a then 'B' else null end;
  return jsonb_build_object('winner',winner,'setsA',sets_a,'setsB',sets_b,'gamesA',games_a,'gamesB',games_b,'complete',match_done and not saw_incomplete);
exception when others then return null;
end;
$$;

create or replace function public.americano_v3_result_error(p_result jsonb,p_config jsonb,p_confirmed boolean)
returns text language sql immutable set search_path=public,pg_temp as $$
  select case when public.americano_v3_score_summary(p_result,p_config,p_confirmed) is null then 'INVALID_SCORE' else null end
$$;

create or replace function public.americano_v3_championship_basis(p_state jsonb)
returns text language plpgsql immutable set search_path=public,pg_temp as $$
declare pairing_mode text:=p_state#>>'{formatConfig,pairingMode}'; membership jsonb; included_rounds jsonb; payload jsonb;
begin
  if pairing_mode='fixed' then
    select coalesce(jsonb_agg(jsonb_build_object(
      'entrantId',entrant.value#>>'{}',
      'playerIds',coalesce((select jsonb_agg(player->>'id' order by player_order)
        from jsonb_array_elements(team->'players') with ordinality members(player,player_order)), '[]'::jsonb)
    ) order by entrant.ordinal),'[]'::jsonb) into membership
    from jsonb_array_elements(coalesce(p_state#>'{americanoSchedule,orderedEntrantIds}','[]'::jsonb)) with ordinality entrant(value,ordinal)
    left join jsonb_array_elements(coalesce(p_state->'teams','[]'::jsonb)) team on team->>'id'=entrant.value#>>'{}';
  else
    select coalesce(jsonb_agg(jsonb_build_object('entrantId',entrant.value#>>'{}','playerIds',jsonb_build_array(entrant.value#>>'{}')) order by entrant.ordinal),'[]'::jsonb)
      into membership
    from jsonb_array_elements(coalesce(p_state#>'{americanoSchedule,orderedEntrantIds}','[]'::jsonb)) with ordinality entrant(value,ordinal);
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'fixtureRoundId',round_value->'fixtureRoundId',
    'matches',(select coalesce(jsonb_agg(jsonb_build_object('matchId',match_value->'id','result',match_value->'result','resultConfirmed',match_value->'resultConfirmed') order by match_ordinal),'[]'::jsonb)
      from jsonb_array_elements(round_value->'matches') with ordinality match_rows(match_value,match_ordinal))
  ) order by round_ordinal),'[]'::jsonb) into included_rounds
  from jsonb_array_elements(coalesce(p_state->'rounds','[]'::jsonb)) with ordinality round_rows(round_value,round_ordinal)
  where round_value ? 'completedAt' and not (round_value ? 'excludedReason');

  payload:=jsonb_build_object(
    'schemaVersion',p_state->'schemaVersion',
    'formatConfig',p_state->'formatConfig',
    'scheduleInputFingerprint',coalesce(p_state#>'{americanoSchedule,inputFingerprint}','null'::jsonb),
    'membership',membership,
    'includedRounds',included_rounds
  );
  return encode(pg_catalog.sha256(convert_to(public.americano_v2_canonical_json(payload),'UTF8')),'hex');
exception when others then return null;
end;
$$;

create or replace function public.americano_v3_final_shape_error(p_state jsonb)
returns text language plpgsql immutable set search_path=public,pg_temp as $$
declare final_value jsonb:=p_state->'championshipFinal'; pairing_mode text:=p_state#>>'{formatConfig,pairingMode}';
  policy text:=p_state#>>'{formatConfig,ranking,championship}'; outcome jsonb; side_a text; side_b text;
  target numeric; points_a numeric; points_b numeric;
begin
  if not (p_state ? 'championshipFinal') or final_value='null'::jsonb then return null; end if;
  if jsonb_typeof(final_value)<>'object'
    or coalesce(final_value->>'id','') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    or coalesce(final_value->>'basisFingerprint','') !~ '^[0-9a-f]{64}$'
    or jsonb_typeof(final_value->'contenderIds')<>'array' or jsonb_array_length(final_value->'contenderIds')<>2
    or final_value#>>'{contenderIds,0}' is null or final_value#>>'{contenderIds,1}' is null
    or final_value#>>'{contenderIds,0}'=final_value#>>'{contenderIds,1}' then return 'INVALID_FINAL_RESULT'; end if;
  if not ((p_state#>'{americanoSchedule,orderedEntrantIds}') @> (final_value->'contenderIds')) then return 'FINAL_NOT_ELIGIBLE'; end if;
  if not exists(select 1 from jsonb_array_elements(coalesce(p_state->'courts','[]'::jsonb)) court where court->>'id'=final_value->>'courtId') then return 'INVALID_FINAL_RESULT'; end if;
  if pairing_mode='fixed' then
    if final_value->'supportPlayerIds' is distinct from 'null'::jsonb then return 'INVALID_FINAL_PARTNERS'; end if;
  else
    if jsonb_typeof(final_value->'supportPlayerIds')<>'array' or jsonb_array_length(final_value->'supportPlayerIds')<>2
      or final_value#>>'{supportPlayerIds,0}'=final_value#>>'{supportPlayerIds,1}' then return 'INVALID_FINAL_PARTNERS'; end if;
    side_a:=final_value#>>'{contenderIds,0}'; side_b:=final_value#>>'{contenderIds,1}';
    if exists(select 1 from jsonb_array_elements(final_value->'supportPlayerIds') support
      where support#>>'{}' in (side_a,side_b)
        or not exists(select 1 from jsonb_array_elements(coalesce(p_state->'participants','[]'::jsonb)) entrant
          where entrant->>'id'=support#>>'{}' and coalesce((entrant->>'active')::boolean,false))) then return 'INVALID_FINAL_PARTNERS'; end if;
  end if;
  outcome:=final_value->'outcome';
  if outcome is null or outcome='null'::jsonb then return null; end if;
  if jsonb_typeof(outcome)<>'object' or not public.americano_v3_nonnegative_integer(outcome->'confirmedAt',9007199254740991) then return 'INVALID_FINAL_RESULT'; end if;
  if policy='golden-point' then
    if outcome->>'kind'<>'golden-point' or outcome->>'winner' not in ('A','B') then return 'INVALID_FINAL_RESULT'; end if;
  elsif policy in ('tiebreak-7','tiebreak-10') then
    if outcome->>'kind'<>'tiebreak' or not public.americano_v3_nonnegative_integer(outcome->'pointsA')
      or not public.americano_v3_nonnegative_integer(outcome->'pointsB') then return 'INVALID_FINAL_RESULT'; end if;
    points_a:=(outcome->>'pointsA')::numeric; points_b:=(outcome->>'pointsB')::numeric;
    target:=case policy when 'tiebreak-7' then 7 else 10 end;
    if greatest(points_a,points_b)<target or abs(points_a-points_b)<2 then return 'INVALID_FINAL_RESULT'; end if;
  else return 'INVALID_FINAL_RESULT';
  end if;
  return null;
exception when others then return 'INVALID_FINAL_RESULT';
end;
$$;

create or replace function public.americano_v3_final_eligibility_error(p_state jsonb,p_final jsonb)
returns text language plpgsql immutable set search_path=public,pg_temp as $$
declare ids text[]; top_ids text[]; side_a_ids text[]; side_b_ids text[]; entrant_id text;
  round_value jsonb; match_value jsonb; summary jsonb; policy text:=p_state#>>'{formatConfig,ranking,tiebreak}';
  totals jsonb:='{}'::jsonb; differences jsonb:='{}'::jsonb;
  award_a numeric; award_b numeric; units_a numeric; units_b numeric; current_value numeric;
  max_total numeric; max_difference numeric; meetings integer:=0; expected_basis text; ordered_pair text[];
  direct_a numeric:=0; direct_b numeric:=0;
begin
  if p_state->>'status'<>'complete' or not exists(select 1 from jsonb_array_elements(coalesce(p_state->'rounds','[]'::jsonb)) r where r ? 'completedAt' and not (r ? 'excludedReason'))
    or policy is null or p_state#>>'{formatConfig,ranking,championship}'='none' then return 'FINAL_NOT_ELIGIBLE'; end if;
  expected_basis:=public.americano_v3_championship_basis(p_state);
  if expected_basis is null or p_final->>'basisFingerprint' is distinct from expected_basis then return 'FINAL_STALE'; end if;
  select array_agg(value#>>'{}' order by ordinal) into ids from jsonb_array_elements(p_state#>'{americanoSchedule,orderedEntrantIds}') with ordinality entrants(value,ordinal);
  if ids is null or cardinality(ids)<2 then return 'FINAL_NOT_ELIGIBLE'; end if;
  foreach entrant_id in array ids loop
    totals:=totals||jsonb_build_object(entrant_id,0);
    differences:=differences||jsonb_build_object(entrant_id,0);
  end loop;
  for round_value in select value from jsonb_array_elements(p_state->'rounds') value where value ? 'completedAt' and not (value ? 'excludedReason') loop
    for match_value in select value from jsonb_array_elements(round_value->'matches') value where coalesce((value->>'resultConfirmed')::boolean,false) loop
      summary:=public.americano_v3_score_summary(match_value->'result',p_state->'formatConfig',true);
      if summary is null then return 'INVALID_SCORE'; end if;
      units_a:=(summary->>'gamesA')::numeric; units_b:=(summary->>'gamesB')::numeric;
      if p_state#>>'{formatConfig,scoring,kind}'='rally' then
        award_a:=units_a; award_b:=units_b;
      else
        award_a:=units_a*(p_state#>>'{formatConfig,scoring,standings,pointsPerGameWon}')::numeric
          +case when summary->>'winner'='A' then (p_state#>>'{formatConfig,scoring,standings,matchWinBonus}')::numeric else 0 end;
        award_b:=units_b*(p_state#>>'{formatConfig,scoring,standings,pointsPerGameWon}')::numeric
          +case when summary->>'winner'='B' then (p_state#>>'{formatConfig,scoring,standings,matchWinBonus}')::numeric else 0 end;
      end if;
      if p_state#>>'{formatConfig,pairingMode}'='fixed' then
        side_a_ids:=array[match_value#>>'{sideA,teamId}']; side_b_ids:=array[match_value#>>'{sideB,teamId}'];
      else
        select array_agg(value#>>'{}') into side_a_ids from jsonb_array_elements(match_value#>'{sideA,playerIds}') value;
        select array_agg(value#>>'{}') into side_b_ids from jsonb_array_elements(match_value#>'{sideB,playerIds}') value;
      end if;
      foreach entrant_id in array side_a_ids loop
        totals:=jsonb_set(totals,array[entrant_id],to_jsonb((totals->>entrant_id)::numeric+award_a),true);
        differences:=jsonb_set(differences,array[entrant_id],to_jsonb((differences->>entrant_id)::numeric+units_a-units_b),true);
      end loop;
      foreach entrant_id in array side_b_ids loop
        totals:=jsonb_set(totals,array[entrant_id],to_jsonb((totals->>entrant_id)::numeric+award_b),true);
        differences:=jsonb_set(differences,array[entrant_id],to_jsonb((differences->>entrant_id)::numeric+units_b-units_a),true);
      end loop;
      if p_state#>>'{formatConfig,pairingMode}'='fixed' then
        side_a_ids:=array[match_value#>>'{sideA,teamId}']; side_b_ids:=array[match_value#>>'{sideB,teamId}'];
      end if;
    end loop;
  end loop;
  select max((totals->>value)::numeric) into max_total from unnest(ids) value;
  select array_agg(value order by ordinality) into top_ids from unnest(ids) with ordinality entrants(value,ordinality) where (totals->>value)::numeric=max_total;
  if cardinality(top_ids)=2 and policy like 'head-to-head%' and p_state#>>'{formatConfig,pairingMode}'='fixed' then
    for round_value in select value from jsonb_array_elements(p_state->'rounds') value where value ? 'completedAt' and not (value ? 'excludedReason') loop
      for match_value in select value from jsonb_array_elements(round_value->'matches') value where coalesce((value->>'resultConfirmed')::boolean,false) loop
        if (match_value#>>'{sideA,teamId}'=top_ids[1] and match_value#>>'{sideB,teamId}'=top_ids[2])
          or (match_value#>>'{sideA,teamId}'=top_ids[2] and match_value#>>'{sideB,teamId}'=top_ids[1]) then
          summary:=public.americano_v3_score_summary(match_value->'result',p_state->'formatConfig',true);
          units_a:=(summary->>'gamesA')::numeric; units_b:=(summary->>'gamesB')::numeric;
          if p_state#>>'{formatConfig,scoring,kind}'='rally' then
            award_a:=units_a; award_b:=units_b;
          else
            award_a:=units_a*(p_state#>>'{formatConfig,scoring,standings,pointsPerGameWon}')::numeric
              +case when summary->>'winner'='A' then (p_state#>>'{formatConfig,scoring,standings,matchWinBonus}')::numeric else 0 end;
            award_b:=units_b*(p_state#>>'{formatConfig,scoring,standings,pointsPerGameWon}')::numeric
              +case when summary->>'winner'='B' then (p_state#>>'{formatConfig,scoring,standings,matchWinBonus}')::numeric else 0 end;
          end if;
          if match_value#>>'{sideA,teamId}'=top_ids[1] then direct_a:=direct_a+award_a; direct_b:=direct_b+award_b;
          else direct_a:=direct_a+award_b; direct_b:=direct_b+award_a; end if;
          meetings:=meetings+1;
        end if;
      end loop;
    end loop;
    if meetings>0 and direct_a<>direct_b then
      top_ids:=array[case when direct_a>direct_b then top_ids[1] else top_ids[2] end];
    end if;
  end if;
  if cardinality(top_ids)>1 and (policy='difference' or (policy='head-to-head-then-difference' and cardinality(top_ids)>1))
    and not (policy like 'head-to-head%' and p_state#>>'{formatConfig,pairingMode}'='fixed' and meetings>0 and direct_a<>direct_b) then
    select max((differences->>value)::numeric) into max_difference from unnest(top_ids) value;
    select array_agg(value order by array_position(ids,value)) into top_ids from unnest(top_ids) value where (differences->>value)::numeric=max_difference;
  end if;
  if cardinality(top_ids)<>2 then return 'FINAL_NOT_ELIGIBLE'; end if;
  select array_agg(value#>>'{}' order by ordinal) into ordered_pair from jsonb_array_elements(p_final->'contenderIds') with ordinality contenders(value,ordinal);
  if ordered_pair is distinct from top_ids then return 'FINAL_NOT_ELIGIBLE'; end if;
  return null;
exception when others then return 'FINAL_NOT_ELIGIBLE';
end;
$$;

create or replace function public.americano_v3_state_error(p_state jsonb)
returns text language plpgsql immutable set search_path=public,pg_temp as $$
declare config jsonb:=p_state->'formatConfig'; schedule jsonb:=p_state->'americanoSchedule'; compat jsonb; compat_schedule jsonb;
  round_value jsonb; match_value jsonb; converted_rounds jsonb:='[]'::jsonb; converted_matches jsonb; summary jsonb;
  round_number integer:=0; match_number integer:=0; fixture jsonb; error_code text; entrant_count integer; court_count integer; final_error text;
begin
  if jsonb_typeof(p_state)<>'object' or p_state->>'schemaVersion'<>'3' or p_state->>'protocolVersion'<>'2'
    or p_state->>'format'<>'americano' then return 'UNSUPPORTED_SCHEMA'; end if;
  error_code:=public.americano_v3_config_error(config); if error_code is not null then return error_code; end if;
  if coalesce(p_state->>'id','')='' or coalesce(p_state->>'name','')='' or char_length(p_state->>'name')>120 then return 'INVALID_PAYLOAD'; end if;
  if p_state->>'status' not in ('setup','round-in-progress','between-rounds','complete') then return 'INVALID_PAYLOAD'; end if;
  if jsonb_typeof(p_state->'courts')<>'array' or jsonb_typeof(p_state->'teams')<>'array' or jsonb_typeof(p_state->'participants')<>'array'
    or jsonb_typeof(p_state->'rounds')<>'array' then return 'INVALID_PAYLOAD'; end if;
  if jsonb_array_length(p_state->'rounds')>64 then return 'INVALID_SCHEDULE'; end if;
  court_count:=jsonb_array_length(p_state->'courts');
  if court_count not between 1 and 16 then return 'INVALID_SCHEDULE'; end if;
  if config->>'pairingMode'='fixed' then
    if jsonb_array_length(p_state->'participants')<>0 or jsonb_array_length(p_state->'teams')>32 then return 'MODE_MISMATCH'; end if;
    entrant_count:=(select count(*) from jsonb_array_elements(p_state->'teams') team where coalesce((team->>'active')::boolean,false));
  else
    if jsonb_array_length(p_state->'teams')<>0 or jsonb_array_length(p_state->'participants')>64 then return 'MODE_MISMATCH'; end if;
    entrant_count:=(select count(*) from jsonb_array_elements(p_state->'participants') player where coalesce((player->>'active')::boolean,false));
  end if;
  if entrant_count>court_count*(case when config->>'pairingMode'='fixed' then 2 else 4 end) then return 'INVALID_SCHEDULE'; end if;
  if schedule is not null then
    if jsonb_typeof(schedule)<>'object' or schedule->>'fingerprintVersion'<>'3'
       or schedule->>'algorithmVersion'<>'americano-v2.1' or public.americano_v3_schedule_fingerprint(p_state) is distinct from schedule->>'inputFingerprint'
       or schedule#>>'{acknowledgements,fingerprint}' is distinct from schedule->>'inputFingerprint' then return 'INVALID_SCHEDULE'; end if;
  elsif p_state->>'status'<>'setup' then return 'INVALID_SCHEDULE'; end if;
  for round_value in select value from jsonb_array_elements(p_state->'rounds') loop
    round_number:=round_number+1;
    for match_value in select value from jsonb_array_elements(round_value->'matches') loop
      match_number:=match_number+1;
      if public.americano_v3_result_error(match_value->'result',config,coalesce((match_value->>'resultConfirmed')::boolean,false)) is not null then return 'INVALID_SCORE'; end if;
      if (round_value ? 'completedAt') and not coalesce((match_value->>'resultConfirmed')::boolean,false) then return 'INVALID_SCHEDULE'; end if;
    end loop;
    match_number:=0;
  end loop;
  if p_state->>'status'='setup' and jsonb_array_length(p_state->'rounds')<>0 then return 'INVALID_SCHEDULE'; end if;
  final_error:=public.americano_v3_final_shape_error(p_state); if final_error is not null then return final_error; end if;
  -- Adapt only the fixture/lifecycle validation input into the unchanged v2
  -- validator. Real v3 scoring is checked independently above.
  if schedule is not null then
    compat:=p_state;
    compat:=jsonb_set(compat,'{schemaVersion}','2'::jsonb,true);
    compat:=jsonb_set(compat,'{formatConfig}',(config-'scoring')||jsonb_build_object('rulesVersion',2,'pointsPerMatch',1),true);
    compat_schedule:=schedule-'fingerprintVersion';
    compat:=jsonb_set(compat,'{americanoSchedule}',compat_schedule,true);
    converted_rounds:='[]'::jsonb;
    for round_value in select value from jsonb_array_elements(p_state->'rounds') loop
      converted_matches:='[]'::jsonb;
      for match_value in select value from jsonb_array_elements(round_value->'matches') loop
        summary:=public.americano_v3_score_summary(match_value->'result',config,coalesce((match_value->>'resultConfirmed')::boolean,false));
        converted_matches:=converted_matches||jsonb_build_array((match_value-'result')||jsonb_build_object(
          'scoreA',case when coalesce((match_value->>'resultConfirmed')::boolean,false) then 1 else null end,
          'scoreB',case when coalesce((match_value->>'resultConfirmed')::boolean,false) then 0 else null end));
      end loop;
      converted_rounds:=converted_rounds||jsonb_build_array(jsonb_set(round_value,'{matches}',converted_matches,true));
    end loop;
    compat:=jsonb_set(compat,'{rounds}',converted_rounds,true);
    compat:=jsonb_set(compat,'{americanoSchedule,inputFingerprint}','"pending"'::jsonb,true);
    compat:=jsonb_set(compat,'{americanoSchedule,acknowledgements,fingerprint}','"pending"'::jsonb,true);
    error_code:=public.americano_v2_schedule_fingerprint(compat);
    compat:=jsonb_set(compat,'{americanoSchedule,inputFingerprint}',to_jsonb(error_code),true);
    compat:=jsonb_set(compat,'{americanoSchedule,acknowledgements,fingerprint}',to_jsonb(error_code),true);
    if public.americano_v2_state_error(compat) is not null then return 'INVALID_SCHEDULE'; end if;
  end if;
  return null;
exception when others then return 'INVALID_PAYLOAD';
end;
$$;

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

revoke all on function public.americano_v3_write_enabled() from public,anon,authenticated;
revoke all on function public.americano_v3_nonnegative_integer(jsonb,numeric) from public,anon,authenticated;
revoke all on function public.americano_v3_config_error(jsonb) from public,anon,authenticated;
revoke all on function public.americano_v3_schedule_fingerprint(jsonb) from public,anon,authenticated;
revoke all on function public.americano_v3_score_summary(jsonb,jsonb,boolean) from public,anon,authenticated;
revoke all on function public.americano_v3_result_error(jsonb,jsonb,boolean) from public,anon,authenticated;
revoke all on function public.americano_v3_championship_basis(jsonb) from public,anon,authenticated;
revoke all on function public.americano_v3_final_shape_error(jsonb) from public,anon,authenticated;
revoke all on function public.americano_v3_final_eligibility_error(jsonb,jsonb) from public,anon,authenticated;
revoke all on function public.americano_v3_state_error(jsonb) from public,anon,authenticated;
