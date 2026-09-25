-- Expose only the schema-3 competition rules on the anonymous public reader.
-- Keep the established signup projection, identity/contact redaction and RPC
-- signature unchanged for every existing event.
create or replace function public.get_public_signup_v3(p_account_slug text,p_event_slug text)
returns jsonb language plpgsql stable security definer set search_path=public,pg_temp as $$
declare signup public.signup_events%rowtype; roster jsonb; source_state jsonb; public_rules jsonb; event_projection jsonb;
begin
  select * into signup from public.signup_events event where case
    when nullif(trim(coalesce(p_account_slug,'')),'') is not null then event.account_slug=trim(p_account_slug) and event.event_slug=trim(p_event_slug)
    else event.friendly_slug=trim(p_event_slug) or event.public_slug::text=trim(p_event_slug) end limit 1;
  if not found then return null; end if;
  select coalesce(jsonb_agg(jsonb_build_object(
    'id',ranked.id,'teamName',ranked.team_name,'playerOne',ranked.player_one,'playerTwo',ranked.player_two,
    'status',ranked.status,'position',ranked.position,'createdAt',ranked.created_at,'updatedAt',ranked.updated_at,
    'organizerRank',ranked.organizer_rank,'pairCompletedAt',ranked.pair_completed_at,'entryMode',ranked.entry_mode
  ) order by case ranked.status when 'confirmed' then 0 when 'looking' then 1 else 2 end,ranked.position), '[]'::jsonb) into roster
  from (select registration.*,row_number() over(partition by registration.status order by registration.organizer_rank nulls last,
    registration.pair_completed_at nulls last,registration.created_at,registration.id) position
    from public.signup_registrations registration where registration.signup_event_id=signup.id and registration.status in ('confirmed','waitlisted','looking')) ranked;

  select event.state into source_state from public.events event where event.id=signup.source_event_uuid;
  if source_state->>'schemaVersion'='3' and jsonb_typeof(source_state#>'{formatConfig,scoring}')='object'
     and jsonb_typeof(source_state#>'{formatConfig,ranking}')='object' then
    public_rules:=jsonb_build_object(
      'rulesVersion',3,
      'pairingMode',source_state#>'{formatConfig,pairingMode}',
      'scoring',source_state#>'{formatConfig,scoring}',
      'ranking',source_state#>'{formatConfig,ranking}'
    );
  end if;

  event_projection:=jsonb_build_object(
    'id',signup.id,'publicSlug',signup.public_slug,'accountSlug',signup.account_slug,'eventSlug',signup.event_slug,
    'title',signup.title,'venue',signup.venue,'startsAt',signup.starts_at,'endsAt',signup.ends_at,'details',signup.details,'prizes',signup.prizes,
    'isOpen',signup.is_open,'cancelledAt',signup.cancelled_at,'cancellationMessage',coalesce(signup.cancellation_message,''),
    'timeZone',signup.time_zone,'organizerName',coalesce(signup.organizer_name,''),'publicContactMethod',signup.public_contact_method,
    'publicContactValue',coalesce(signup.public_contact_value,''),'protocolVersion',signup.protocol_version,'entryMode',signup.entry_mode,
    'capacityTeams',signup.capacity_teams,
    'capacity',case when signup.entry_mode='individual' then jsonb_build_object('unit','players','value',signup.capacity_players)
      else jsonb_build_object('unit','teams','value',signup.capacity_teams) end
  );
  if public_rules is not null then event_projection:=event_projection||jsonb_build_object('competitionRules',public_rules); end if;
  return jsonb_build_object('event',event_projection,'registrations',roster);
end; $$;

revoke all on function public.get_public_signup_v3(text,text) from public;
grant execute on function public.get_public_signup_v3(text,text) to anon,authenticated;
