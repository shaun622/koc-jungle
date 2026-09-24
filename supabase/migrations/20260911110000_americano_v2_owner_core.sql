-- Americano v2 validation, owner snapshots, idempotent event save and setup config.

create or replace function public.americano_v2_canonical_json(p_value jsonb)
returns text
language plpgsql
immutable
set search_path = public, pg_temp
as $$
declare result text;
begin
  case jsonb_typeof(p_value)
    when 'object' then
      select '{' || coalesce(string_agg(to_jsonb(key)::text || ':' || public.americano_v2_canonical_json(value), ',' order by key), '') || '}'
        into result from jsonb_each(p_value);
    when 'array' then
      select '[' || coalesce(string_agg(public.americano_v2_canonical_json(value), ',' order by ordinal), '') || ']'
        into result from jsonb_array_elements(p_value) with ordinality item(value, ordinal);
    else result := p_value::text;
  end case;
  return result;
end;
$$;

create or replace function public.americano_v2_schedule_fingerprint(p_state jsonb)
returns text
language plpgsql
immutable
set search_path = public, pg_temp
as $$
declare
  schedule jsonb := p_state -> 'americanoSchedule';
  membership jsonb := 'null'::jsonb;
  fixtures jsonb := '[]'::jsonb;
  payload jsonb;
begin
  if p_state #>> '{formatConfig,pairingMode}' = 'fixed' then
    select coalesce(jsonb_agg(jsonb_build_object(
      'teamId', team ->> 'id',
      'playerIds', jsonb_build_array(team #>> '{players,0,id}', team #>> '{players,1,id}')
    ) order by ordinal), '[]'::jsonb) into membership
    from jsonb_array_elements(p_state -> 'teams') with ordinality item(team, ordinal)
    where coalesce((team ->> 'active')::boolean, false);
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'matches', (select coalesce(jsonb_agg(jsonb_build_object(
      'courtId', match ->> 'courtId', 'sideA', match -> 'sideA', 'sideB', match -> 'sideB'
    ) order by match_ordinal), '[]'::jsonb)
      from jsonb_array_elements(round_value -> 'matches') with ordinality match_item(match, match_ordinal)),
    'rests', round_value -> 'restingEntrantIds'
  ) order by round_ordinal), '[]'::jsonb) into fixtures
  from jsonb_array_elements(schedule -> 'rounds') with ordinality round_item(round_value, round_ordinal);

  payload := jsonb_build_object(
    'algorithmVersion', schedule -> 'algorithmVersion',
    'pairingMode', p_state #> '{formatConfig,pairingMode}',
    'pointsPerMatch', p_state #> '{formatConfig,pointsPerMatch}',
    'scheduleKind', p_state #> '{formatConfig,scheduleKind}',
    'customRounds', coalesce(p_state #> '{formatConfig,customRounds}', 'null'::jsonb),
    'paceMinutes', p_state #> '{formatConfig,paceMinutes}',
    'paceClockEnabled', p_state #> '{formatConfig,paceClockEnabled}',
    'seed', schedule -> 'seed',
    'orderedEntrantIds', schedule -> 'orderedEntrantIds',
    'membership', membership,
    'courtIds', schedule -> 'courtIds',
    'rosterRevision', schedule -> 'rosterRevision',
    'fixtures', fixtures,
    'metrics', schedule -> 'metrics'
  );
  return encode(public.digest(convert_to(public.americano_v2_canonical_json(payload), 'UTF8'), 'sha256'), 'hex');
exception when others then
  return null;
end;
$$;

create or replace function public.americano_v2_state_error(p_state jsonb)
returns text
language plpgsql
immutable
set search_path = public, pg_temp
as $$
declare
  mode text;
  points integer;
  pace integer;
  court_count integer;
  entrant_count integer;
  expected_matches integer;
  expected_rounds integer;
  round_value jsonb;
  match_value jsonb;
  seen text[];
  member_id text;
  match_count integer;
  expected_entrant_ids jsonb;
  expected_court_ids jsonb;
  appearance_counts jsonb := '{}'::jsonb;
  rest_counts jsonb := '{}'::jsonb;
  round_number integer := 0;
  resting_count integer;
  unused_count integer;
  minimum_appearances integer;
  maximum_appearances integer;
  scheduled_round jsonb;
  scheduled_match jsonb;
  live_round_count integer;
  confirmed_count integer;
  side_a_ids text[];
  side_b_ids text[];
  partner_pairs text[] := array[]::text[];
  opponent_pairs text[] := array[]::text[];
  matchup_keys text[] := array[]::text[];
  unique_partner_counts jsonb := '{}'::jsonb;
  unique_opponent_counts jsonb := '{}'::jsonb;
  pair_key text;
  side_a_key text;
  side_b_key text;
  frequency integer;
  minimum_partner_frequency integer := 0;
  maximum_partner_frequency integer := 0;
  minimum_opponent_frequency integer := 0;
  maximum_opponent_frequency integer := 0;
  repeated_matchups integer := 0;
  left_index integer;
  right_index integer;
begin
  if p_state is null or jsonb_typeof(p_state) <> 'object' then return 'INVALID_PAYLOAD'; end if;
  if p_state ->> 'schemaVersion' <> '2'
     or p_state ->> 'protocolVersion' <> '2'
     or p_state ->> 'format' <> 'americano'
     or p_state #>> '{formatConfig,rulesVersion}' <> '2' then
    return 'UNSUPPORTED_SCHEMA';
  end if;
  if coalesce(p_state ->> 'id', '') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then
    return 'INVALID_PAYLOAD';
  end if;
  if coalesce(p_state ->> 'name', '') = '' or char_length(p_state ->> 'name') > 120 then return 'INVALID_PAYLOAD'; end if;
  if p_state ->> 'status' not in ('setup','round-in-progress','between-rounds','complete') then return 'INVALID_PAYLOAD'; end if;
  mode := p_state #>> '{formatConfig,pairingMode}';
  if mode not in ('fixed','rotating') then return 'MODE_MISMATCH'; end if;
  begin points := (p_state #>> '{formatConfig,pointsPerMatch}')::integer; exception when others then return 'INVALID_PAYLOAD'; end;
  begin pace := (p_state #>> '{formatConfig,paceMinutes}')::integer; exception when others then return 'INVALID_PAYLOAD'; end;
  if jsonb_typeof(p_state #> '{formatConfig,pointsPerMatch}') is distinct from 'number'
     or points is null or points < 1 or pace not in (5,10,15,20,25,30) then return 'INVALID_PAYLOAD'; end if;
  if p_state #>> '{formatConfig,scheduleKind}' not in ('full','balanced','custom') then return 'INVALID_PAYLOAD'; end if;
  if jsonb_typeof(p_state -> 'courts') <> 'array'
     or jsonb_typeof(p_state -> 'teams') <> 'array'
     or jsonb_typeof(p_state -> 'participants') <> 'array'
     or jsonb_typeof(p_state -> 'rounds') <> 'array' then return 'INVALID_PAYLOAD'; end if;
  court_count := jsonb_array_length(p_state -> 'courts');
  if court_count < 1 or court_count > 16 then return 'INVALID_SCHEDULE'; end if;
  if (select count(*) from jsonb_array_elements(p_state -> 'courts') item
      where coalesce(item ->> 'id','') = '' or coalesce(item ->> 'name','') = '') <> 0 then return 'INVALID_SCHEDULE'; end if;
  if (select count(distinct item ->> 'id') from jsonb_array_elements(p_state -> 'courts') item) <> court_count then return 'INVALID_SCHEDULE'; end if;
  select coalesce(jsonb_agg(item ->> 'id' order by ordinal), '[]'::jsonb) into expected_court_ids
    from jsonb_array_elements(p_state -> 'courts') with ordinality row(item, ordinal);

  if mode = 'rotating' then
    if jsonb_array_length(p_state -> 'teams') <> 0 then return 'MODE_MISMATCH'; end if;
    entrant_count := (select count(*) from jsonb_array_elements(p_state -> 'participants') item where coalesce((item ->> 'active')::boolean, false));
    if (select count(distinct item ->> 'id') from jsonb_array_elements(p_state -> 'participants') item) <> jsonb_array_length(p_state -> 'participants') then return 'INVALID_SCHEDULE'; end if;
    if entrant_count > court_count * 4 then return 'INVALID_SCHEDULE'; end if;
    expected_matches := floor(entrant_count / 4.0);
    select coalesce(jsonb_agg(item ->> 'id' order by ordinal), '[]'::jsonb) into expected_entrant_ids
      from jsonb_array_elements(p_state -> 'participants') with ordinality row(item, ordinal)
      where coalesce((item ->> 'active')::boolean, false);
  else
    if jsonb_array_length(p_state -> 'participants') <> 0 then return 'MODE_MISMATCH'; end if;
    entrant_count := (select count(*) from jsonb_array_elements(p_state -> 'teams') item where coalesce((item ->> 'active')::boolean, false));
    if (select count(distinct item ->> 'id') from jsonb_array_elements(p_state -> 'teams') item) <> jsonb_array_length(p_state -> 'teams') then return 'INVALID_SCHEDULE'; end if;
    if exists (select 1 from jsonb_array_elements(p_state -> 'teams') item where jsonb_array_length(item -> 'players') <> 2) then return 'INVALID_SCHEDULE'; end if;
    if entrant_count > court_count * 2 then return 'INVALID_SCHEDULE'; end if;
    expected_matches := floor(entrant_count / 2.0);
    select coalesce(jsonb_agg(item ->> 'id' order by ordinal), '[]'::jsonb) into expected_entrant_ids
      from jsonb_array_elements(p_state -> 'teams') with ordinality row(item, ordinal)
      where coalesce((item ->> 'active')::boolean, false);
  end if;

  if p_state ->> 'status' = 'setup' and (jsonb_array_length(p_state -> 'rounds') <> 0 or p_state ? 'americanoSchedule') then return 'INVALID_SCHEDULE'; end if;
  if p_state ->> 'status' <> 'setup' then
    if entrant_count < (case when mode = 'rotating' then 4 else 2 end) then return 'INVALID_SCHEDULE'; end if;
    if jsonb_typeof(p_state -> 'americanoSchedule') <> 'object' then return 'INVALID_SCHEDULE'; end if;
    if p_state #>> '{americanoSchedule,algorithmVersion}' <> 'americano-v2.1' then return 'INVALID_SCHEDULE'; end if;
    if jsonb_typeof(p_state #> '{americanoSchedule,orderedEntrantIds}') <> 'array'
       or jsonb_typeof(p_state #> '{americanoSchedule,courtIds}') <> 'array'
       or jsonb_typeof(p_state #> '{americanoSchedule,rounds}') <> 'array' then return 'INVALID_SCHEDULE'; end if;
    if jsonb_array_length(p_state #> '{americanoSchedule,orderedEntrantIds}') <> entrant_count then return 'INVALID_SCHEDULE'; end if;
    if jsonb_array_length(p_state #> '{americanoSchedule,courtIds}') <> court_count then return 'INVALID_SCHEDULE'; end if;
    if p_state #> '{americanoSchedule,orderedEntrantIds}' is distinct from expected_entrant_ids
       or p_state #> '{americanoSchedule,courtIds}' is distinct from expected_court_ids then return 'INVALID_SCHEDULE'; end if;
    if p_state #>> '{formatConfig,scheduleKind}' = 'full' then
      expected_rounds := case when mode = 'fixed'
        then case when entrant_count % 2 = 0 then entrant_count - 1 else entrant_count end
        else case when entrant_count % 4 = 0 then entrant_count - 1 else entrant_count end end;
      if jsonb_array_length(p_state #> '{americanoSchedule,rounds}') <> expected_rounds then return 'INVALID_SCHEDULE'; end if;
    elsif p_state #>> '{formatConfig,scheduleKind}' = 'custom' then
      begin expected_rounds := (p_state #>> '{formatConfig,customRounds}')::integer; exception when others then return 'INVALID_PAYLOAD'; end;
      if expected_rounds < 1 or jsonb_array_length(p_state #> '{americanoSchedule,rounds}') <> expected_rounds then return 'INVALID_SCHEDULE'; end if;
    elsif jsonb_array_length(p_state #> '{americanoSchedule,rounds}') < 1 then return 'INVALID_SCHEDULE'; end if;
    if coalesce(p_state #>> '{americanoSchedule,inputFingerprint}','') = ''
       or p_state #>> '{americanoSchedule,acknowledgements,fingerprint}' is distinct from p_state #>> '{americanoSchedule,inputFingerprint}'
       or public.americano_v2_schedule_fingerprint(p_state) is distinct from p_state #>> '{americanoSchedule,inputFingerprint}' then return 'INVALID_SCHEDULE'; end if;

    for member_id in select value #>> '{}' from jsonb_array_elements(expected_entrant_ids) loop
      appearance_counts := appearance_counts || jsonb_build_object(member_id, 0);
      rest_counts := rest_counts || jsonb_build_object(member_id, 0);
      unique_partner_counts := unique_partner_counts || jsonb_build_object(member_id, 0);
      unique_opponent_counts := unique_opponent_counts || jsonb_build_object(member_id, 0);
    end loop;

    for round_value in select value from jsonb_array_elements(p_state #> '{americanoSchedule,rounds}') loop
      round_number := round_number + 1;
      if (round_value ->> 'index')::integer <> round_number then return 'INVALID_SCHEDULE'; end if;
      if jsonb_typeof(round_value -> 'matches') <> 'array'
         or jsonb_typeof(round_value -> 'restingEntrantIds') <> 'array'
         or jsonb_typeof(round_value -> 'unusedCourtIds') <> 'array' then return 'INVALID_SCHEDULE'; end if;
      match_count := jsonb_array_length(round_value -> 'matches');
      if match_count <> expected_matches then return 'INVALID_SCHEDULE'; end if;
      seen := array[]::text[];
      for match_value in select value from jsonb_array_elements(round_value -> 'matches') loop
        if coalesce(match_value ->> 'courtId','') = ''
           or not (p_state #> '{americanoSchedule,courtIds}' @> jsonb_build_array(match_value ->> 'courtId')) then return 'INVALID_SCHEDULE'; end if;
        if seen @> array['court:' || (match_value ->> 'courtId')] then return 'INVALID_SCHEDULE'; end if;
        seen := array_append(seen, 'court:' || (match_value ->> 'courtId'));
        if mode = 'rotating' and (match_value #>> '{sideA,kind}' <> 'rotating-pair' or match_value #>> '{sideB,kind}' <> 'rotating-pair') then return 'INVALID_SCHEDULE'; end if;
        if mode = 'fixed' and (match_value #>> '{sideA,kind}' <> 'fixed-team' or match_value #>> '{sideB,kind}' <> 'fixed-team') then return 'INVALID_SCHEDULE'; end if;
        if jsonb_array_length(match_value #> '{sideA,playerIds}') <> 2 or jsonb_array_length(match_value #> '{sideB,playerIds}') <> 2 then return 'INVALID_SCHEDULE'; end if;
        if mode = 'rotating' then
          select array_agg(value #>> '{}' order by ordinal) into side_a_ids from jsonb_array_elements(match_value #> '{sideA,playerIds}') with ordinality row(value,ordinal);
          select array_agg(value #>> '{}' order by ordinal) into side_b_ids from jsonb_array_elements(match_value #> '{sideB,playerIds}') with ordinality row(value,ordinal);
          for member_id in select value #>> '{}' from jsonb_array_elements(match_value #> '{sideA,playerIds}')
            union all select value #>> '{}' from jsonb_array_elements(match_value #> '{sideB,playerIds}')
          loop
            if seen @> array['entrant:' || member_id]
               or not (p_state #> '{americanoSchedule,orderedEntrantIds}' @> jsonb_build_array(member_id)) then return 'INVALID_SCHEDULE'; end if;
            seen := array_append(seen, 'entrant:' || member_id);
            appearance_counts := jsonb_set(appearance_counts, array[member_id], to_jsonb((appearance_counts ->> member_id)::integer + 1), true);
          end loop;
          side_a_key := least(side_a_ids[1],side_a_ids[2]) || chr(1) || greatest(side_a_ids[1],side_a_ids[2]);
          side_b_key := least(side_b_ids[1],side_b_ids[2]) || chr(1) || greatest(side_b_ids[1],side_b_ids[2]);
          partner_pairs := array_append(array_append(partner_pairs,side_a_key),side_b_key);
          for left_index in 1..2 loop
            for right_index in 1..2 loop
              pair_key := least(side_a_ids[left_index],side_b_ids[right_index]) || chr(1) || greatest(side_a_ids[left_index],side_b_ids[right_index]);
              opponent_pairs := array_append(opponent_pairs,pair_key);
            end loop;
          end loop;
          matchup_keys := array_append(matchup_keys,least(side_a_key,side_b_key) || chr(2) || greatest(side_a_key,side_b_key));
        else
          foreach member_id in array array[match_value #>> '{sideA,teamId}', match_value #>> '{sideB,teamId}'] loop
            if member_id is null or seen @> array['entrant:' || member_id]
               or not (p_state #> '{americanoSchedule,orderedEntrantIds}' @> jsonb_build_array(member_id)) then return 'INVALID_SCHEDULE'; end if;
            seen := array_append(seen, 'entrant:' || member_id);
            appearance_counts := jsonb_set(appearance_counts, array[member_id], to_jsonb((appearance_counts ->> member_id)::integer + 1), true);
          end loop;
          pair_key := least(match_value #>> '{sideA,teamId}',match_value #>> '{sideB,teamId}') || chr(1) || greatest(match_value #>> '{sideA,teamId}',match_value #>> '{sideB,teamId}');
          opponent_pairs := array_append(opponent_pairs,pair_key);
          matchup_keys := array_append(matchup_keys,pair_key);
        end if;
      end loop;
      if (select count(*) from unnest(seen) value where value like 'entrant:%') <> expected_matches * (case when mode = 'rotating' then 4 else 2 end) then return 'INVALID_SCHEDULE'; end if;

      resting_count := jsonb_array_length(round_value -> 'restingEntrantIds');
      if resting_count <> entrant_count - expected_matches * (case when mode='rotating' then 4 else 2 end)
         or (select count(distinct value #>> '{}') from jsonb_array_elements(round_value -> 'restingEntrantIds')) <> resting_count then return 'INVALID_SCHEDULE'; end if;
      for member_id in select value #>> '{}' from jsonb_array_elements(round_value -> 'restingEntrantIds') loop
        if not (expected_entrant_ids @> jsonb_build_array(member_id)) or seen @> array['entrant:' || member_id] then return 'INVALID_SCHEDULE'; end if;
        seen := array_append(seen, 'entrant:' || member_id);
        rest_counts := jsonb_set(rest_counts, array[member_id], to_jsonb((rest_counts ->> member_id)::integer + 1), true);
      end loop;
      if (select count(*) from unnest(seen) value where value like 'entrant:%') <> entrant_count then return 'INVALID_SCHEDULE'; end if;

      unused_count := jsonb_array_length(round_value -> 'unusedCourtIds');
      if unused_count <> court_count - match_count
         or (select count(distinct value #>> '{}') from jsonb_array_elements(round_value -> 'unusedCourtIds')) <> unused_count then return 'INVALID_SCHEDULE'; end if;
      for member_id in select value #>> '{}' from jsonb_array_elements(round_value -> 'unusedCourtIds') loop
        if not (expected_court_ids @> jsonb_build_array(member_id)) or seen @> array['court:' || member_id] then return 'INVALID_SCHEDULE'; end if;
        seen := array_append(seen, 'court:' || member_id);
      end loop;
      if (select count(*) from unnest(seen) value where value like 'court:%') <> court_count then return 'INVALID_SCHEDULE'; end if;
    end loop;

    if p_state #> '{americanoSchedule,metrics,appearances}' is distinct from appearance_counts
       or p_state #> '{americanoSchedule,metrics,rests}' is distinct from rest_counts then return 'INVALID_SCHEDULE'; end if;
    select min(value::integer),max(value::integer) into minimum_appearances,maximum_appearances from jsonb_each_text(appearance_counts);
    if (p_state #>> '{americanoSchedule,metrics,maximumAppearanceSpread}')::integer <> maximum_appearances-minimum_appearances
       or (p_state #>> '{americanoSchedule,metrics,appearancesEqual}')::boolean is distinct from (maximum_appearances=minimum_appearances)
       or (maximum_appearances>minimum_appearances and not coalesce((p_state #>> '{americanoSchedule,acknowledgements,unevenAppearances}')::boolean,false)) then return 'INVALID_SCHEDULE'; end if;

    for member_id in select value #>> '{}' from jsonb_array_elements(expected_entrant_ids) loop
      select count(distinct value) into frequency from unnest(partner_pairs) value
        where value like member_id || chr(1) || '%' or value like '%' || chr(1) || member_id;
      unique_partner_counts := jsonb_set(unique_partner_counts,array[member_id],to_jsonb(frequency),true);
      select count(distinct value) into frequency from unnest(opponent_pairs) value
        where value like member_id || chr(1) || '%' or value like '%' || chr(1) || member_id;
      unique_opponent_counts := jsonb_set(unique_opponent_counts,array[member_id],to_jsonb(frequency),true);
    end loop;

    minimum_partner_frequency := 2147483647;
    minimum_opponent_frequency := 2147483647;
    for left_index in 0..entrant_count-2 loop
      for right_index in left_index+1..entrant_count-1 loop
        pair_key := least(expected_entrant_ids ->> left_index,expected_entrant_ids ->> right_index) || chr(1) || greatest(expected_entrant_ids ->> left_index,expected_entrant_ids ->> right_index);
        select count(*) into frequency from unnest(partner_pairs) value where value=pair_key;
        minimum_partner_frequency := least(minimum_partner_frequency,frequency);
        maximum_partner_frequency := greatest(maximum_partner_frequency,frequency);
        select count(*) into frequency from unnest(opponent_pairs) value where value=pair_key;
        minimum_opponent_frequency := least(minimum_opponent_frequency,frequency);
        maximum_opponent_frequency := greatest(maximum_opponent_frequency,frequency);
      end loop;
    end loop;
    if mode='fixed' then minimum_partner_frequency:=0; maximum_partner_frequency:=0; end if;
    select coalesce(sum(occurrences-1),0)::integer into repeated_matchups from (
      select count(*)::integer occurrences from unnest(matchup_keys) value group by value having count(*)>1
    ) repeated;
    if p_state #> '{americanoSchedule,metrics,uniquePartners}' is distinct from unique_partner_counts
       or p_state #> '{americanoSchedule,metrics,uniqueOpponents}' is distinct from unique_opponent_counts
       or (p_state #>> '{americanoSchedule,metrics,minimumPartnerFrequency}')::integer <> minimum_partner_frequency
       or (p_state #>> '{americanoSchedule,metrics,maximumPartnerFrequency}')::integer <> maximum_partner_frequency
       or (p_state #>> '{americanoSchedule,metrics,minimumOpponentFrequency}')::integer <> minimum_opponent_frequency
       or (p_state #>> '{americanoSchedule,metrics,maximumOpponentFrequency}')::integer <> maximum_opponent_frequency
       or (p_state #>> '{americanoSchedule,metrics,repeatedCompleteMatchups}')::integer <> repeated_matchups
       or (repeated_matchups>0 and not coalesce((p_state #>> '{americanoSchedule,acknowledgements,repeatedCycle}')::boolean,false)) then return 'INVALID_SCHEDULE'; end if;
    if p_state #>> '{formatConfig,scheduleKind}'='full' and (
      (mode='rotating' and (minimum_partner_frequency<>1 or maximum_partner_frequency<>1 or minimum_opponent_frequency<>2 or maximum_opponent_frequency<>2))
      or (mode='fixed' and (minimum_opponent_frequency<>1 or maximum_opponent_frequency<>1))
    ) then return 'INVALID_SCHEDULE'; end if;
  end if;

  live_round_count := jsonb_array_length(p_state -> 'rounds');
  round_number := 0;
  for round_value in select value from jsonb_array_elements(p_state -> 'rounds') loop
    round_number := round_number + 1;
    scheduled_round := p_state #> array['americanoSchedule','rounds',(round_number-1)::text];
    if jsonb_typeof(round_value -> 'matches') <> 'array'
       or scheduled_round is null
       or (round_value ->> 'index')::integer <> round_number
       or round_value ->> 'fixtureRoundId' <> scheduled_round ->> 'id'
       or jsonb_array_length(round_value -> 'matches') <> jsonb_array_length(scheduled_round -> 'matches') then return 'INVALID_SCHEDULE'; end if;
    confirmed_count := 0;
    match_count := 0;
    for match_value in select value from jsonb_array_elements(round_value -> 'matches') loop
      scheduled_match := scheduled_round #> array['matches',match_count::text];
      match_count := match_count + 1;
      if scheduled_match is null
         or match_value ->> 'courtId' <> scheduled_match ->> 'courtId'
         or match_value -> 'sideA' is distinct from scheduled_match -> 'sideA'
         or match_value -> 'sideB' is distinct from scheduled_match -> 'sideB' then return 'INVALID_SCHEDULE'; end if;
      if coalesce((match_value ->> 'resultConfirmed')::boolean, false) then
        confirmed_count := confirmed_count + 1;
        if jsonb_typeof(match_value -> 'scoreA') <> 'number' or jsonb_typeof(match_value -> 'scoreB') <> 'number' then return 'INVALID_PAYLOAD'; end if;
        if (match_value ->> 'scoreA')::numeric <> trunc((match_value ->> 'scoreA')::numeric)
           or (match_value ->> 'scoreB')::numeric <> trunc((match_value ->> 'scoreB')::numeric)
           or (match_value ->> 'scoreA')::integer < 0
           or (match_value ->> 'scoreB')::integer < 0
           or (match_value ->> 'scoreA')::integer + (match_value ->> 'scoreB')::integer <> points then return 'INVALID_PAYLOAD'; end if;
      end if;
    end loop;
    if round_value ? 'completedAt' then
      if confirmed_count <> match_count or round_value ? 'excludedReason' then return 'INVALID_SCHEDULE'; end if;
    elsif round_value ? 'excludedReason' then
      if round_value ->> 'excludedReason' <> 'ended-early' or round_number <> live_round_count
         or p_state ->> 'status' <> 'complete' or p_state ->> 'completionReason' <> 'early' then return 'INVALID_SCHEDULE'; end if;
    elsif round_number <> live_round_count or p_state ->> 'status' <> 'round-in-progress' then return 'INVALID_SCHEDULE'; end if;
  end loop;
  if p_state ->> 'status' <> 'setup' and live_round_count < 1 then return 'INVALID_SCHEDULE'; end if;
  if p_state ->> 'status' = 'round-in-progress' and ((p_state -> 'rounds' -> (live_round_count-1)) ? 'completedAt') then return 'INVALID_SCHEDULE'; end if;
  if p_state ->> 'status' = 'between-rounds' and (
       not ((p_state -> 'rounds' -> (live_round_count-1)) ? 'completedAt')
       or live_round_count >= jsonb_array_length(p_state #> '{americanoSchedule,rounds}')
       or jsonb_typeof(p_state -> 'pendingAssignments') <> 'array') then return 'INVALID_SCHEDULE'; end if;
  if p_state ->> 'status' = 'complete' and p_state ->> 'completionReason' = 'scheduled' and (
       live_round_count <> jsonb_array_length(p_state #> '{americanoSchedule,rounds}')
       or not ((p_state -> 'rounds' -> (live_round_count-1)) ? 'completedAt')) then return 'INVALID_SCHEDULE'; end if;
  if p_state ->> 'status' = 'complete' and p_state ->> 'completionReason' not in ('scheduled','early') then return 'INVALID_SCHEDULE'; end if;
  return null;
exception when others then
  return 'INVALID_PAYLOAD';
end;
$$;

create or replace function public.americano_v2_payload_hash(p_operation text, p_payload jsonb)
returns text
language sql
immutable
set search_path = public, pg_temp
as $$
  select encode(public.digest(convert_to(jsonb_build_object('operation', p_operation, 'payload', p_payload)::text, 'UTF8'), 'sha256'), 'hex')
$$;

create or replace function public.organizer_signup_snapshot_v3_internal(p_signup_event_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select case when event.id is null then null else jsonb_build_object(
    'id', event.id,
    'sourceEventId', event.source_event_id,
    'publicSlug', event.public_slug,
    'accountSlug', event.account_slug,
    'eventSlug', event.event_slug,
    'title', event.title,
    'venue', event.venue,
    'startsAt', event.starts_at,
    'endsAt', event.ends_at,
    'details', event.details,
    'prizes', event.prizes,
    'isOpen', event.is_open,
    'cancelledAt', event.cancelled_at,
    'cancellationMessage', coalesce(event.cancellation_message, ''),
    'timeZone', event.time_zone,
    'organizerName', coalesce(event.organizer_name, ''),
    'publicContactMethod', event.public_contact_method,
    'publicContactValue', coalesce(event.public_contact_value, ''),
    'protocolVersion', event.protocol_version,
    'entryMode', event.entry_mode,
    'capacity', case when event.entry_mode = 'individual'
      then jsonb_build_object('unit','players','value',event.capacity_players)
      else jsonb_build_object('unit','teams','value',event.capacity_teams) end,
    'capacityRevision', event.capacity_revision::text,
    'rosterRevision', event.roster_revision::text,
    'rosterSeededAt', event.roster_seeded_at,
    'rosterLockedAt', event.roster_locked_at,
    'registrations', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', registration.id,
        'teamName', registration.team_name,
        'playerOne', registration.player_one,
        'playerTwo', registration.player_two,
        'contact', registration.contact,
        'playerTwoContact', registration.player_two_contact,
        'status', registration.status,
        'entryMode', registration.entry_mode,
        'organizerRank', registration.organizer_rank,
        'pairCompletedAt', registration.pair_completed_at,
        'createdAt', registration.created_at,
        'updatedAt', registration.updated_at
      ) order by case registration.status when 'confirmed' then 0 when 'looking' then 1 when 'waitlisted' then 2 else 3 end,
        registration.organizer_rank nulls last, registration.created_at, registration.id)
      from public.signup_registrations as registration
      where registration.signup_event_id = event.id
    ), '[]'::jsonb)
  ) end
  from public.signup_events as event
  where event.id = p_signup_event_id
$$;

create or replace function public.owner_event_snapshot_v2_internal(p_event_id uuid, p_owner_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select jsonb_build_object(
    'event', jsonb_build_object(
      'id', event.id,
      'protocolVersion', event.protocol_version,
      'revision', event.revision::text,
      'updatedAt', event.updated_at,
      'state', event.state
    ),
    'signup', public.organizer_signup_snapshot_v3_internal(signup.id)
  )
  from public.events as event
  left join public.signup_events as signup
    on signup.source_event_uuid = event.id and signup.owner_user_id = event.user_id
  where event.id = p_event_id and event.user_id = p_owner_id and event.deleted_at is null
$$;

create or replace function public.americano_v2_rejected(p_request_id uuid, p_code text, p_message text, p_field text default null)
returns jsonb
language sql
immutable
set search_path = public, pg_temp
as $$
  select jsonb_strip_nulls(jsonb_build_object(
    'status','rejected','requestId',p_request_id,'code',p_code,'message',p_message,'field',p_field
  ))
$$;

create or replace function public.organizer_save_event_v2(
  p_event_id uuid, p_base_event_revision bigint,
  p_request_id uuid, p_state jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  owner_id uuid := auth.uid();
  existing public.events%rowtype;
  receipt public.event_v2_requests%rowtype;
  payload_hash text;
  validation_error text;
  next_revision bigint;
  saved_state jsonb;
  signup_id uuid;
begin
  if owner_id is null then return public.americano_v2_rejected(p_request_id,'NOT_AUTHENTICATED','Sign in to save this event.'); end if;
  if p_request_id is null or p_base_event_revision is null or p_base_event_revision < 0 then
    return public.americano_v2_rejected(p_request_id,'INVALID_PAYLOAD','A request id and non-negative base revision are required.');
  end if;
  perform set_config('app.americano_v2_rpc','on',true);
  validation_error := public.americano_v2_state_error(p_state);
  if validation_error is not null then return public.americano_v2_rejected(p_request_id,validation_error,'The Americano event payload is invalid.'); end if;
  if p_state ->> 'id' <> p_event_id::text then return public.americano_v2_rejected(p_request_id,'INVALID_PAYLOAD','Event id does not match the payload.','id'); end if;
  payload_hash := public.americano_v2_payload_hash('organizer_save_event_v2', jsonb_build_object('baseEventRevision',p_base_event_revision,'state',p_state));

  select * into existing from public.events as event
  where event.id = p_event_id and event.user_id = owner_id for update;
  if found and existing.deleted_at is not null then return public.americano_v2_rejected(p_request_id,'EVENT_DELETED','This event was deleted.'); end if;
  if found then
    select * into receipt from public.event_v2_requests as request
    where request.event_id = p_event_id and request.request_id = p_request_id;
    if found then
      if receipt.operation <> 'organizer_save_event_v2' or receipt.payload_sha256 <> payload_hash then
        return public.americano_v2_rejected(p_request_id,'IDEMPOTENCY_MISMATCH','This request id was already used for different data.');
      end if;
      return jsonb_build_object('status','replayed','requestId',p_request_id,
        'committedEventRevision',receipt.applied_revision::text,
        'snapshot',public.owner_event_snapshot_v2_internal(p_event_id,owner_id));
    end if;
    if existing.protocol_version <> 2 then return public.americano_v2_rejected(p_request_id,'UPDATE_REQUIRED','This event uses the legacy protocol.'); end if;
    if existing.revision <> p_base_event_revision then
      return jsonb_build_object('status','conflict','requestId',p_request_id,'code','EVENT_REVISION_CONFLICT',
        'snapshot',public.owner_event_snapshot_v2_internal(p_event_id,owner_id));
    end if;
    select signup.id into signup_id from public.signup_events as signup
      where signup.source_event_uuid = p_event_id and signup.owner_user_id = owner_id;
    if signup_id is not null and (
      existing.state -> 'courts' is distinct from p_state -> 'courts'
      or existing.state -> 'teams' is distinct from p_state -> 'teams'
      or existing.state -> 'participants' is distinct from p_state -> 'participants'
      or existing.state #> '{formatConfig,pairingMode}' is distinct from p_state #> '{formatConfig,pairingMode}'
    ) then
      return public.americano_v2_rejected(p_request_id,'ROSTER_LOCKED','Published roster and capacity changes use the signup controls.');
    end if;
    if existing.state ->> 'status' <> 'setup' and p_state ->> 'status' = 'setup' then
      return public.americano_v2_rejected(p_request_id,'MODE_LOCKED','A started event cannot be reset to setup.');
    end if;
    if existing.state -> 'americanoSchedule' is not null
       and existing.state -> 'americanoSchedule' is distinct from p_state -> 'americanoSchedule' then
      return public.americano_v2_rejected(p_request_id,'INVALID_SCHEDULE','A frozen schedule cannot be replaced.');
    end if;
    next_revision := existing.revision + 1;
    saved_state := jsonb_set(p_state,'{revision}',to_jsonb(next_revision::text),true);
    update public.events as event set state = saved_state, revision = next_revision, updated_at = clock_timestamp()
      where event.id = p_event_id and event.user_id = owner_id;
  else
    if exists (select 1 from public.events as other_event where other_event.id = p_event_id)
       or exists (select 1 from public.event_tombstones as other_tombstone where other_tombstone.event_id = p_event_id and other_tombstone.user_id <> owner_id) then
      return public.americano_v2_rejected(p_request_id,'NOT_FOUND_OR_NOT_OWNED','This event could not be found or is owned by another account.');
    end if;
    if exists (select 1 from public.event_tombstones as tombstone where tombstone.user_id = owner_id and tombstone.event_id = p_event_id) then
      return public.americano_v2_rejected(p_request_id,'EVENT_DELETED','This event was deleted.');
    end if;
    if p_base_event_revision <> 0 then
      return public.americano_v2_rejected(p_request_id,'EVENT_REVISION_CONFLICT','A new event must start at revision 0.');
    end if;
    next_revision := 1;
    saved_state := jsonb_set(p_state,'{revision}',to_jsonb('1'::text),true);
    insert into public.events(id,user_id,state,protocol_version,revision,updated_at)
    values (p_event_id,owner_id,saved_state,2,1,clock_timestamp());
  end if;

  insert into public.event_v2_requests(event_id,request_id,operation,payload_sha256,applied_revision,result_ids)
  values (p_event_id,p_request_id,'organizer_save_event_v2',payload_hash,next_revision,'{}'::jsonb);
  return jsonb_build_object('status','applied','requestId',p_request_id,
    'committedEventRevision',next_revision::text,
    'snapshot',public.owner_event_snapshot_v2_internal(p_event_id,owner_id));
exception when unique_violation then
  return public.americano_v2_rejected(p_request_id,'IDEMPOTENCY_MISMATCH','This request id was already used.');
end;
$$;

create or replace function public.organizer_save_americano_config_v2(
  p_event_id uuid, p_base_event_revision bigint,
  p_signup_event_id uuid, p_base_capacity_revision bigint,
  p_base_roster_revision bigint, p_request_id uuid,
  p_courts jsonb, p_format_config jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  owner_id uuid := auth.uid();
  event_row public.events%rowtype;
  signup public.signup_events%rowtype;
  receipt public.event_v2_requests%rowtype;
  payload_hash text;
  next_revision bigint;
  next_state jsonb;
  capacity integer;
  next_mode text;
  points integer;
begin
  if owner_id is null then return public.americano_v2_rejected(p_request_id,'NOT_AUTHENTICATED','Sign in to change this event.'); end if;
  perform set_config('app.americano_v2_rpc','on',true);
  begin
    points := (p_format_config ->> 'pointsPerMatch')::integer;
  exception when others then
    return public.americano_v2_rejected(p_request_id,'INVALID_PAYLOAD','Enter a positive whole number for points per match.','formatConfig.pointsPerMatch');
  end;
  if jsonb_typeof(p_format_config -> 'pointsPerMatch') is distinct from 'number' or points is null or points < 1 then
    return public.americano_v2_rejected(p_request_id,'INVALID_PAYLOAD','Enter a positive whole number for points per match.','formatConfig.pointsPerMatch');
  end if;
  if jsonb_typeof(p_courts) <> 'array' or jsonb_array_length(p_courts) not between 1 and 16
     or p_format_config ->> 'rulesVersion' <> '2'
     or p_format_config ->> 'pairingMode' not in ('fixed','rotating')
     or (p_format_config ->> 'paceMinutes') not in ('5','10','15','20','25','30')
     or p_format_config ->> 'scheduleKind' not in ('full','balanced','custom') then
    return public.americano_v2_rejected(p_request_id,'INVALID_PAYLOAD','Check the courts and Americano settings.','formatConfig');
  end if;
  if (select count(distinct item ->> 'id') from jsonb_array_elements(p_courts) item) <> jsonb_array_length(p_courts) then
    return public.americano_v2_rejected(p_request_id,'INVALID_PAYLOAD','Court ids must be unique.','courts');
  end if;
  payload_hash := public.americano_v2_payload_hash('organizer_save_americano_config_v2',jsonb_build_object(
    'baseEventRevision',p_base_event_revision,'signupEventId',p_signup_event_id,
    'baseCapacityRevision',p_base_capacity_revision,'baseRosterRevision',p_base_roster_revision,
    'courts',p_courts,'formatConfig',p_format_config));
  select * into event_row from public.events as event
    where event.id = p_event_id and event.user_id = owner_id for update;
  if not found then return public.americano_v2_rejected(p_request_id,'NOT_FOUND_OR_NOT_OWNED','This event could not be found.'); end if;
  if event_row.deleted_at is not null then return public.americano_v2_rejected(p_request_id,'EVENT_DELETED','This event was deleted.'); end if;
  if event_row.protocol_version <> 2 then return public.americano_v2_rejected(p_request_id,'UPDATE_REQUIRED','This event uses the legacy protocol.'); end if;
  select * into receipt from public.event_v2_requests as request where request.event_id=p_event_id and request.request_id=p_request_id;
  if found then
    if receipt.operation <> 'organizer_save_americano_config_v2' or receipt.payload_sha256 <> payload_hash then
      return public.americano_v2_rejected(p_request_id,'IDEMPOTENCY_MISMATCH','This request id was already used for different data.');
    end if;
    return jsonb_build_object('status','replayed','requestId',p_request_id,'committedEventRevision',receipt.applied_revision::text,
      'snapshot',public.owner_event_snapshot_v2_internal(p_event_id,owner_id));
  end if;
  if event_row.state ->> 'status' <> 'setup' then return public.americano_v2_rejected(p_request_id,'MODE_LOCKED','Settings are locked after play starts.'); end if;
  if event_row.revision <> p_base_event_revision then
    return jsonb_build_object('status','conflict','requestId',p_request_id,'code','EVENT_REVISION_CONFLICT','snapshot',public.owner_event_snapshot_v2_internal(p_event_id,owner_id));
  end if;
  if p_signup_event_id is not null then
    select * into signup from public.signup_events as row
      where row.id=p_signup_event_id and row.source_event_uuid=p_event_id and row.owner_user_id=owner_id for update;
    if not found then return public.americano_v2_rejected(p_request_id,'NOT_FOUND_OR_NOT_OWNED','The signup page could not be found.'); end if;
    if signup.capacity_revision <> p_base_capacity_revision then
      return jsonb_build_object('status','conflict','requestId',p_request_id,'code','SIGNUP_REVISION_CONFLICT','snapshot',public.owner_event_snapshot_v2_internal(p_event_id,owner_id));
    end if;
    if signup.roster_revision <> p_base_roster_revision then
      return jsonb_build_object('status','conflict','requestId',p_request_id,'code','ROSTER_REVISION_CONFLICT','snapshot',public.owner_event_snapshot_v2_internal(p_event_id,owner_id));
    end if;
  elsif coalesce(p_base_capacity_revision,0) <> 0 or coalesce(p_base_roster_revision,0) <> 0 then
    return public.americano_v2_rejected(p_request_id,'INVALID_PAYLOAD','Unpublished signup revisions must be zero.');
  end if;
  next_mode := case p_format_config ->> 'pairingMode' when 'rotating' then 'individual' else 'fixed-pairs' end;
  if p_signup_event_id is not null and signup.entry_mode <> next_mode then
    return public.americano_v2_rejected(p_request_id,'MODE_LOCKED','Pairing mode cannot change after publication.','formatConfig.pairingMode');
  end if;
  capacity := jsonb_array_length(p_courts) * case when next_mode='individual' then 4 else 2 end;
  if p_signup_event_id is not null then
    update public.signup_events as row set
      capacity_teams = case when next_mode='fixed-pairs' then capacity else 0 end,
      capacity_players = case when next_mode='individual' then capacity else null end,
      capacity_revision = row.capacity_revision + case when row.capacity_teams is distinct from case when next_mode='fixed-pairs' then capacity else 0 end
        or row.capacity_players is distinct from case when next_mode='individual' then capacity else null end then 1 else 0 end,
      updated_at = clock_timestamp()
    where row.id=signup.id;
    perform public.rebalance_signup_event(signup.id);
  end if;
  next_revision := event_row.revision + 1;
  next_state := jsonb_set(jsonb_set(jsonb_set(event_row.state,'{courts}',p_courts,true),'{formatConfig}',p_format_config,true),'{revision}',to_jsonb(next_revision::text),true);
  update public.events as row set state=next_state, revision=next_revision, updated_at=clock_timestamp() where row.id=p_event_id;
  insert into public.event_v2_requests(event_id,request_id,operation,payload_sha256,applied_revision,result_ids)
    values(p_event_id,p_request_id,'organizer_save_americano_config_v2',payload_hash,next_revision,'{}');
  return jsonb_build_object('status','applied','requestId',p_request_id,'committedEventRevision',next_revision::text,
    'snapshot',public.owner_event_snapshot_v2_internal(p_event_id,owner_id));
end;
$$;

revoke all on function public.americano_v2_state_error(jsonb) from public, anon, authenticated;
revoke all on function public.americano_v2_canonical_json(jsonb) from public, anon, authenticated;
revoke all on function public.americano_v2_schedule_fingerprint(jsonb) from public, anon, authenticated;
revoke all on function public.americano_v2_payload_hash(text,jsonb) from public, anon, authenticated;
revoke all on function public.organizer_signup_snapshot_v3_internal(uuid) from public, anon, authenticated;
revoke all on function public.owner_event_snapshot_v2_internal(uuid,uuid) from public, anon, authenticated;
revoke all on function public.americano_v2_rejected(uuid,text,text,text) from public, anon, authenticated;
revoke all on function public.organizer_save_event_v2(uuid,bigint,uuid,jsonb) from public, anon;
revoke all on function public.organizer_save_americano_config_v2(uuid,bigint,uuid,bigint,bigint,uuid,jsonb,jsonb) from public, anon;
grant execute on function public.organizer_save_event_v2(uuid,bigint,uuid,jsonb) to authenticated;
grant execute on function public.organizer_save_americano_config_v2(uuid,bigint,uuid,bigint,bigint,uuid,jsonb,jsonb) to authenticated;
