-- Make signup registrations the canonical pre-event roster.
--
-- capacity_teams is always a number of complete pair slots. Complete pairs
-- are confirmed in deterministic organiser order, overflow pairs wait, and a
-- solo registration remains in the separate "looking" state until joined.

alter table public.signup_registrations
  drop constraint if exists signup_registrations_status_check;

alter table public.signup_registrations
  add constraint signup_registrations_status_check
  check (status in ('confirmed', 'waitlisted', 'looking', 'cancelled'));

alter table public.signup_events
  add column if not exists roster_seeded_at timestamptz;

alter table public.signup_events
  add column if not exists roster_locked_at timestamptz;

alter table public.signup_registrations
  add column if not exists pair_completed_at timestamptz;

-- Existing complete pairs entered the queue when they originally registered.
-- Solos have no explicit organiser rank: if they later find a partner their
-- new pair_completed_at, rather than their solo signup time, controls order.
update public.signup_registrations
set pair_completed_at = created_at
where player_two is not null
  and trim(player_two) <> ''
  and pair_completed_at is null;

update public.signup_registrations
set organizer_rank = null
where (player_two is null or trim(player_two) = '')
  and organizer_rank is not null;

alter table public.signup_registrations
  drop constraint if exists signup_registrations_pair_completed_check;

alter table public.signup_registrations
  add constraint signup_registrations_pair_completed_check
  check (
    (
      (player_two is null or trim(player_two) = '')
      and pair_completed_at is null
    )
    or (
      player_two is not null
      and trim(player_two) <> ''
      and pair_completed_at is not null
    )
  );

alter table public.signup_registrations
  drop constraint if exists signup_registrations_roster_state_check;

-- NOT VALID permits the end-of-migration rebalance to repair legacy solo
-- statuses first. PostgreSQL still enforces it for every new/changed row.
alter table public.signup_registrations
  add constraint signup_registrations_roster_state_check
  check (
    status = 'cancelled'
    or (
      (player_two is null or trim(player_two) = '')
      and status = 'looking'
    )
    or (
      player_two is not null
      and trim(player_two) <> ''
      and status in ('confirmed', 'waitlisted')
    )
  ) not valid;

-- Pre-existing events have already passed through the legacy import path.
-- Mark them once so a stale local projection is never replayed automatically.
-- Events inserted after this migration retain the column's null default.
update public.signup_events
set roster_seeded_at = now()
where roster_seeded_at is null;

create index if not exists signup_registrations_pair_queue_idx
  on public.signup_registrations (
    signup_event_id,
    status,
    organizer_rank,
    pair_completed_at,
    created_at,
    id
  );

create or replace function public.rebalance_signup_event(p_event_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  event_capacity integer;
begin
  -- Every public and organiser mutation takes this parent lock first. That
  -- makes the capacity decision atomic even when two people register at once.
  select capacity_teams into event_capacity
  from public.signup_events
  where id = p_event_id
  for update;

  if event_capacity is null then return; end if;

  -- Lock the active queue in the same transaction before changing statuses.
  perform 1
  from public.signup_registrations
  where signup_event_id = p_event_id
    and status in ('confirmed', 'waitlisted', 'looking')
  order by id
  for update;

  with ranked_pairs as (
    select
      registration.id,
      row_number() over (
        order by
          registration.organizer_rank nulls last,
          registration.pair_completed_at nulls last,
          registration.created_at,
          registration.id
      ) as pair_position
    from public.signup_registrations as registration
    where registration.signup_event_id = p_event_id
      and registration.status in ('confirmed', 'waitlisted', 'looking')
      and registration.player_two is not null
      and trim(registration.player_two) <> ''
  ), desired as (
    select
      registration.id,
      case
        when registration.player_two is null or trim(registration.player_two) = ''
          then 'looking'
        when pair.pair_position <= event_capacity
          then 'confirmed'
        else 'waitlisted'
      end as next_status
    from public.signup_registrations as registration
    left join ranked_pairs as pair on pair.id = registration.id
    where registration.signup_event_id = p_event_id
      and registration.status in ('confirmed', 'waitlisted', 'looking')
  )
  update public.signup_registrations as registration
  set
    status = desired.next_status,
    updated_at = now()
  from desired
  where registration.id = desired.id
    and registration.status is distinct from desired.next_status;
end;
$$;

revoke all on function public.rebalance_signup_event(uuid) from public;

-- The UUID implementation remains the base implementation used by the
-- account/event-slug wrappers. Contacts and cancellation tokens stay private.
create or replace function public.get_public_signup(p_slug uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  signup public.signup_events%rowtype;
  roster jsonb;
begin
  select * into signup
  from public.signup_events
  where public_slug = p_slug;

  if not found then return null; end if;

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'id', ranked.id,
        'signupEventId', ranked.signup_event_id,
        'teamName', ranked.team_name,
        'playerOne', ranked.player_one,
        'playerTwo', coalesce(ranked.player_two, ''),
        'status', ranked.status,
        'position', ranked.position,
        'createdAt', ranked.created_at,
        'organizerRank', ranked.organizer_rank,
        'pairCompletedAt', ranked.pair_completed_at
      ) order by
        case ranked.status
          when 'confirmed' then 0
          when 'looking' then 1
          else 2
        end,
        ranked.organizer_rank nulls last,
        ranked.pair_completed_at nulls last,
        ranked.created_at,
        ranked.id
    ),
    '[]'::jsonb
  ) into roster
  from (
    select
      registration.*,
      row_number() over (
        partition by registration.status
        order by
          registration.organizer_rank nulls last,
          registration.pair_completed_at nulls last,
          registration.created_at,
          registration.id
      ) as position
    from public.signup_registrations as registration
    where registration.signup_event_id = signup.id
      and registration.status in ('confirmed', 'waitlisted', 'looking')
  ) as ranked;

  return jsonb_build_object(
    'event', jsonb_build_object(
      'id', signup.id,
      'publicSlug', signup.public_slug,
      'title', signup.title,
      'venue', signup.venue,
      'startsAt', signup.starts_at,
      'endsAt', signup.ends_at,
      'capacityTeams', signup.capacity_teams,
      'details', signup.details,
      'prizes', signup.prizes,
      'isOpen', signup.is_open
    ),
    'registrations', roster
  );
end;
$$;

revoke all on function public.get_public_signup(uuid) from public;
grant execute on function public.get_public_signup(uuid) to anon, authenticated;

create or replace function public.register_public_team(
  p_slug uuid,
  p_team_name text,
  p_player_one text,
  p_player_two text,
  p_contact text
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  signup public.signup_events%rowtype;
  registration public.signup_registrations%rowtype;
  next_position bigint;
begin
  p_team_name := trim(coalesce(p_team_name, ''));
  p_player_one := trim(coalesce(p_player_one, ''));
  p_player_two := nullif(trim(coalesce(p_player_two, '')), '');
  p_contact := trim(coalesce(p_contact, ''));

  if char_length(p_player_one) not between 1 and 100 then
    raise exception 'Enter your name.';
  end if;
  if p_player_two is not null and char_length(p_player_two) not between 1 and 100 then
    raise exception 'Enter a valid second player name.';
  end if;
  if p_player_two is not null and lower(p_player_one) = lower(p_player_two) then
    raise exception 'Enter two different player names.';
  end if;
  if char_length(p_team_name) > 100 then
    raise exception 'Pair name is too long.';
  end if;
  if char_length(p_contact) not between 3 and 200 then
    raise exception 'Enter a WhatsApp number or email.';
  end if;

  select * into signup
  from public.signup_events
  where public_slug = p_slug
  for update;

  if not found then
    raise exception 'This sign-up link was not found.';
  end if;
  if not signup.is_open then
    raise exception 'Registrations are currently closed.';
  end if;

  if (
    select count(*)
    from public.signup_registrations
    where signup_event_id = signup.id
      and status in ('confirmed', 'waitlisted', 'looking')
  ) >= 256 then
    raise exception 'This registration list has reached its limit.';
  end if;

  if exists (
    select 1
    from public.signup_registrations as other
    where other.signup_event_id = signup.id
      and other.status in ('confirmed', 'waitlisted', 'looking')
      and (
        lower(trim(other.player_one)) = lower(p_player_one)
        or lower(trim(coalesce(other.player_two, ''))) = lower(p_player_one)
        or (
          p_player_two is not null
          and (
            lower(trim(other.player_one)) = lower(p_player_two)
            or lower(trim(coalesce(other.player_two, ''))) = lower(p_player_two)
          )
        )
      )
  ) then
    raise exception 'One of these players is already registered for this event.';
  end if;

  insert into public.signup_registrations (
    signup_event_id,
    team_name,
    player_one,
    player_two,
    contact,
    status,
    pair_completed_at
  ) values (
    signup.id,
    p_team_name,
    p_player_one,
    p_player_two,
    p_contact,
    case when p_player_two is null then 'looking' else 'waitlisted' end,
    case when p_player_two is null then null else now() end
  ) returning * into registration;

  perform public.rebalance_signup_event(signup.id);

  select current_registration.* into registration
  from public.signup_registrations as current_registration
  where current_registration.id = registration.id;

  select ranked.position into next_position
  from (
    select
      row.id,
      row_number() over (
        order by
          row.organizer_rank nulls last,
          row.pair_completed_at nulls last,
          row.created_at,
          row.id
      ) as position
    from public.signup_registrations as row
    where row.signup_event_id = signup.id
      and row.status = registration.status
  ) as ranked
  where ranked.id = registration.id;

  return jsonb_build_object(
    'registrationId', registration.id,
    'status', registration.status,
    'position', next_position,
    'pairCompletedAt', registration.pair_completed_at
  );
end;
$$;

revoke all on function public.register_public_team(uuid, text, text, text, text) from public;
grant execute on function public.register_public_team(uuid, text, text, text, text) to anon, authenticated;

create or replace function public.join_public_single(
  p_slug uuid,
  p_registration_id uuid,
  p_player_two text,
  p_contact text
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  signup public.signup_events%rowtype;
  registration public.signup_registrations%rowtype;
  next_position bigint;
begin
  p_player_two := trim(coalesce(p_player_two, ''));
  p_contact := trim(coalesce(p_contact, ''));

  if char_length(p_player_two) not between 1 and 100 then
    raise exception 'Enter your name.';
  end if;
  if char_length(p_contact) not between 3 and 200 then
    raise exception 'Enter a WhatsApp number or email.';
  end if;

  select * into signup
  from public.signup_events
  where public_slug = p_slug
  for update;

  if not found then
    raise exception 'This sign-up link was not found.';
  end if;
  if not signup.is_open then
    raise exception 'Registrations are currently closed.';
  end if;

  select * into registration
  from public.signup_registrations
  where id = p_registration_id
    and signup_event_id = signup.id
    and status in ('confirmed', 'waitlisted', 'looking')
  for update;

  if not found or (registration.player_two is not null and trim(registration.player_two) <> '') then
    raise exception 'This solo registration could not be found.';
  end if;
  if lower(trim(registration.player_one)) = lower(p_player_two) then
    raise exception 'Enter a different player name.';
  end if;

  if exists (
    select 1
    from public.signup_registrations as other
    where other.signup_event_id = signup.id
      and other.id <> registration.id
      and other.status in ('confirmed', 'waitlisted', 'looking')
      and (
        lower(trim(other.player_one)) = lower(p_player_two)
        or lower(trim(coalesce(other.player_two, ''))) = lower(p_player_two)
      )
  ) then
    raise exception 'This player is already registered for the event.';
  end if;

  update public.signup_registrations as joined_registration
  set
    player_two = p_player_two,
    player_two_contact = p_contact,
    pair_completed_at = now(),
    organizer_rank = null,
    status = 'waitlisted',
    updated_at = now()
  where joined_registration.id = registration.id
    and joined_registration.signup_event_id = signup.id;

  perform public.rebalance_signup_event(signup.id);

  select current_registration.* into registration
  from public.signup_registrations as current_registration
  where current_registration.id = registration.id;

  select ranked.position into next_position
  from (
    select
      row.id,
      row_number() over (
        order by
          row.organizer_rank nulls last,
          row.pair_completed_at nulls last,
          row.created_at,
          row.id
      ) as position
    from public.signup_registrations as row
    where row.signup_event_id = signup.id
      and row.status = registration.status
  ) as ranked
  where ranked.id = registration.id;

  return jsonb_build_object(
    'registrationId', registration.id,
    'status', registration.status,
    'position', next_position,
    'pairCompletedAt', registration.pair_completed_at
  );
end;
$$;

revoke all on function public.join_public_single(uuid, uuid, text, text) from public;
grant execute on function public.join_public_single(uuid, uuid, text, text) to anon, authenticated;

-- The organiser is the source of truth. Public sign-ups can register or join a
-- solo, but cannot later mutate/cancel a roster entry directly.
revoke execute on function public.cancel_public_registration(uuid, uuid) from anon, authenticated;
revoke execute on function public.cancel_public_registration(text, uuid) from anon, authenticated;
revoke execute on function public.cancel_public_registration(text, text, uuid) from anon, authenticated;

-- Owner-only edit. A pair changed into a solo becomes "looking" and a solo
-- completed by the organiser is put through the same deterministic queue.
create or replace function public.organizer_update_signup_registration(
  p_registration_id uuid,
  p_team_name text,
  p_player_one text,
  p_player_two text,
  p_contact text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  event_id uuid;
  registration public.signup_registrations%rowtype;
  next_team_name text;
  next_player_one text;
  next_player_two text;
  next_contact text;
begin
  if auth.uid() is null then
    raise exception 'Sign in to edit this registration.';
  end if;

  select event.id into event_id
  from public.signup_events as event
  where event.owner_user_id = auth.uid()
    and exists (
      select 1
      from public.signup_registrations as candidate
      where candidate.id = p_registration_id
        and candidate.signup_event_id = event.id
    )
  for update;

  if event_id is null then
    raise exception 'This team could not be found or you do not own its sign-up.';
  end if;

  select * into registration
  from public.signup_registrations
  where id = p_registration_id
    and signup_event_id = event_id
    and status in ('confirmed', 'waitlisted', 'looking')
  for update;

  if not found then
    raise exception 'This active registration could not be found.';
  end if;

  next_team_name := trim(coalesce(p_team_name, ''));
  next_player_one := trim(coalesce(p_player_one, ''));
  next_player_two := nullif(trim(coalesce(p_player_two, '')), '');
  next_contact := case
    when p_contact is null then registration.contact
    else trim(p_contact)
  end;

  if char_length(next_team_name) > 100 then
    raise exception 'Pair name is too long.';
  end if;
  if char_length(next_player_one) not between 1 and 100 then
    raise exception 'Enter a valid first player name.';
  end if;
  if next_player_two is not null and char_length(next_player_two) not between 1 and 100 then
    raise exception 'Enter a valid second player name.';
  end if;
  if next_player_two is not null and lower(next_player_one) = lower(next_player_two) then
    raise exception 'Enter two different player names.';
  end if;
  if char_length(next_contact) not between 3 and 200 then
    raise exception 'Enter a valid WhatsApp number or email.';
  end if;

  if exists (
    select 1
    from public.signup_registrations as other
    where other.signup_event_id = event_id
      and other.id <> p_registration_id
      and other.status in ('confirmed', 'waitlisted', 'looking')
      and (
        lower(trim(other.player_one)) = lower(next_player_one)
        or lower(trim(coalesce(other.player_two, ''))) = lower(next_player_one)
        or (
          next_player_two is not null
          and (
            lower(trim(other.player_one)) = lower(next_player_two)
            or lower(trim(coalesce(other.player_two, ''))) = lower(next_player_two)
          )
        )
      )
  ) then
    raise exception 'One of these players is already registered for this event.';
  end if;

  update public.signup_registrations as existing
  set
    team_name = next_team_name,
    player_one = next_player_one,
    player_two = next_player_two,
    player_two_contact = case
      when next_player_two is null then null
      when lower(trim(coalesce(existing.player_two, ''))) = lower(next_player_two)
        then existing.player_two_contact
      else null
    end,
    pair_completed_at = case
      when next_player_two is null then null
      when existing.player_two is not null and trim(existing.player_two) <> ''
        then coalesce(existing.pair_completed_at, existing.created_at)
      else now()
    end,
    organizer_rank = case
      when next_player_two is null then null
      when existing.player_two is null or trim(existing.player_two) = '' then null
      else existing.organizer_rank
    end,
    contact = next_contact,
    status = case when next_player_two is null then 'looking' else 'waitlisted' end,
    updated_at = now()
  where existing.id = p_registration_id
    and existing.signup_event_id = event_id;

  perform public.rebalance_signup_event(event_id);

  select * into registration
  from public.signup_registrations
  where id = p_registration_id
    and signup_event_id = event_id;

  return jsonb_build_object(
    'id', registration.id,
    'signupEventId', registration.signup_event_id,
    'teamName', registration.team_name,
    'playerOne', registration.player_one,
    'playerTwo', coalesce(registration.player_two, ''),
    'contact', registration.contact,
    'status', registration.status,
    'organizerRank', registration.organizer_rank,
    'pairCompletedAt', registration.pair_completed_at,
    'updatedAt', registration.updated_at
  );
end;
$$;

-- The base mutation is deliberately private. Only the revision/status/lock
-- guarded wrapper below may invoke it.
revoke all on function public.organizer_update_signup_registration(uuid, text, text, text, text)
  from public, anon, authenticated;

create or replace function public.organizer_update_signup_registration_guarded(
  p_registration_id uuid,
  p_team_name text,
  p_player_one text,
  p_player_two text,
  p_contact text,
  p_expected_status text,
  p_expected_updated_at timestamptz,
  p_allow_locked boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  event_id uuid;
  roster_locked_at timestamptz;
  current_registration public.signup_registrations%rowtype;
  result jsonb;
begin
  if p_expected_status not in ('confirmed', 'waitlisted', 'looking')
    or p_expected_updated_at is null then
    raise exception 'Refresh this registration before editing it.';
  end if;

  select event.id, event.roster_locked_at into event_id, roster_locked_at
  from public.signup_events as event
  where event.owner_user_id = auth.uid()
    and exists (
      select 1
      from public.signup_registrations as registration
      where registration.id = p_registration_id
        and registration.signup_event_id = event.id
    )
  for update;

  if event_id is null then
    raise exception 'This registration could not be found or you do not own its sign-up.';
  end if;
  if roster_locked_at is not null and not p_allow_locked then
    raise exception 'The roster is locked because play has started.';
  end if;

  select * into current_registration
  from public.signup_registrations as registration
  where registration.id = p_registration_id
    and registration.signup_event_id = event_id
  for update;

  if not found
    or current_registration.status <> p_expected_status
    or current_registration.updated_at is distinct from p_expected_updated_at then
    raise exception 'This registration changed while it was open. Refresh and try again.';
  end if;

  select public.organizer_update_signup_registration(
    p_registration_id,
    p_team_name,
    p_player_one,
    p_player_two,
    p_contact
  ) into result;
  return result;
end;
$$;

revoke all on function public.organizer_update_signup_registration_guarded(uuid, text, text, text, text, text, timestamptz, boolean) from public;
grant execute on function public.organizer_update_signup_registration_guarded(uuid, text, text, text, text, text, timestamptz, boolean) to authenticated;

-- Keep capacity changes and the canonical queue in the same transaction. This
-- preserves the existing compare-and-swap and idempotent retry contract while
-- guaranteeing that a successful capacity save has already rebalanced rows.
create or replace function public.organizer_save_signup_event(
  p_source_event_id text,
  p_account_slug text,
  p_title text,
  p_venue text,
  p_starts_at timestamptz,
  p_ends_at timestamptz,
  p_expected_capacity integer,
  p_base_revision bigint,
  p_details text,
  p_prizes text,
  p_auto_add_pairs boolean,
  p_signup_event_id uuid default null,
  p_is_open boolean default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  owner_id uuid := auth.uid();
  signup public.signup_events%rowtype;
  next_account_slug text;
  next_title text;
  next_venue text;
  next_details text;
  next_prizes text;
  next_is_open boolean;
  payload_matches boolean;
begin
  if owner_id is null then
    raise exception 'Sign in to publish this sign-up.';
  end if;

  p_source_event_id := trim(coalesce(p_source_event_id, ''));
  next_title := trim(coalesce(p_title, ''));
  next_venue := trim(coalesce(p_venue, ''));
  next_details := trim(coalesce(p_details, ''));
  next_prizes := trim(coalesce(p_prizes, ''));
  next_account_slug := public.normalise_signup_link_part(
    p_account_slug,
    'organiser-' || left(owner_id::text, 6)
  );

  if p_source_event_id = '' then
    raise exception 'A source event id is required.';
  end if;
  if char_length(next_title) not between 1 and 120 then
    raise exception 'Enter an event title up to 120 characters.';
  end if;
  if char_length(next_venue) > 160 then
    raise exception 'Venue is too long.';
  end if;
  if p_expected_capacity not between 0 and 128 then
    raise exception 'Online team limit must be between 0 and 128.';
  end if;
  if p_base_revision is null or p_base_revision < 0 then
    raise exception 'A non-negative capacity revision is required.';
  end if;
  if char_length(next_details) > 3000 then
    raise exception 'Event details are too long.';
  end if;
  if char_length(next_prizes) > 2000 then
    raise exception 'Prizes or extras are too long.';
  end if;
  if p_ends_at is not null and p_starts_at is not null and p_ends_at <= p_starts_at then
    raise exception 'End time must be after the start time.';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('signup-event-publish', 0));

  select * into signup
  from public.signup_events
  where owner_user_id = owner_id
    and source_event_id = p_source_event_id
  for update;

  if not found then
    if p_signup_event_id is not null then
      raise exception 'This sign-up event could not be found.';
    end if;
    if p_base_revision <> 0 then
      raise exception 'A new sign-up must start at revision 0.';
    end if;

    insert into public.signup_events (
      owner_user_id,
      source_event_id,
      account_slug,
      title,
      venue,
      starts_at,
      ends_at,
      capacity_teams,
      capacity_revision,
      details,
      prizes,
      is_open,
      auto_add_pairs,
      updated_at
    ) values (
      owner_id,
      p_source_event_id,
      next_account_slug,
      next_title,
      next_venue,
      p_starts_at,
      p_ends_at,
      p_expected_capacity,
      1,
      next_details,
      next_prizes,
      coalesce(p_is_open, true),
      coalesce(p_auto_add_pairs, true),
      now()
    )
    returning * into signup;

    perform public.rebalance_signup_event(signup.id);

    return jsonb_build_object(
      'applied', true,
      'conflict', false,
      'capacityRevision', signup.capacity_revision,
      'event', to_jsonb(signup)
    );
  end if;

  if p_signup_event_id is not null and signup.id <> p_signup_event_id then
    raise exception 'The sign-up event id does not match this source event.';
  end if;

  next_is_open := coalesce(p_is_open, signup.is_open);

  -- Once play starts, an old tab may still try to save stale setup metadata.
  -- It may update harmless display details, but it must never reopen the page
  -- or change the capacity/queue until the organiser explicitly resets.
  if signup.roster_locked_at is not null then
    if p_expected_capacity <> signup.capacity_teams then
      raise exception 'The roster is locked because play has started.';
    end if;
    if next_is_open then
      raise exception 'The roster is locked because play has started.';
    end if;
  end if;

  payload_matches :=
    signup.account_slug = next_account_slug
    and signup.title = next_title
    and signup.venue = next_venue
    and signup.starts_at is not distinct from p_starts_at
    and signup.ends_at is not distinct from p_ends_at
    and signup.capacity_teams = p_expected_capacity
    and signup.details = next_details
    and signup.prizes = next_prizes
    and signup.auto_add_pairs = coalesce(p_auto_add_pairs, true)
    and signup.is_open = next_is_open;

  if payload_matches and signup.capacity_revision <> p_base_revision then
    return jsonb_build_object(
      'applied', true,
      'conflict', false,
      'capacityRevision', signup.capacity_revision,
      'event', to_jsonb(signup)
    );
  end if;

  if signup.capacity_revision <> p_base_revision then
    return jsonb_build_object(
      'applied', false,
      'conflict', true,
      'capacityRevision', signup.capacity_revision,
      'event', to_jsonb(signup)
    );
  end if;

  update public.signup_events
  set
    account_slug = next_account_slug,
    title = next_title,
    venue = next_venue,
    starts_at = p_starts_at,
    ends_at = p_ends_at,
    capacity_teams = p_expected_capacity,
    capacity_revision = signup.capacity_revision + 1,
    details = next_details,
    prizes = next_prizes,
    is_open = next_is_open,
    auto_add_pairs = coalesce(p_auto_add_pairs, true),
    updated_at = now()
  where id = signup.id
    and owner_user_id = owner_id
  returning * into signup;

  perform public.rebalance_signup_event(signup.id);

  return jsonb_build_object(
    'applied', true,
    'conflict', false,
    'capacityRevision', signup.capacity_revision,
    'event', to_jsonb(signup)
  );
end;
$$;

revoke all on function public.organizer_save_signup_event(text, text, text, text, timestamptz, timestamptz, integer, bigint, text, text, boolean, uuid, boolean) from public;
grant execute on function public.organizer_save_signup_event(text, text, text, text, timestamptz, timestamptz, integer, bigint, text, text, boolean, uuid, boolean) to authenticated;

-- Starting play is a single server transition: fix capacity from courts,
-- rebalance the canonical queue, close public registration, and prevent a
-- stale organiser tab from reopening it. A conflict returns the authoritative
-- row so the caller can retry the same intent safely.
create or replace function public.organizer_lock_signup_roster(
  p_signup_event_id uuid,
  p_source_event_id text,
  p_expected_capacity integer,
  p_base_revision bigint
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  signup public.signup_events%rowtype;
begin
  if auth.uid() is null then
    raise exception 'Sign in to start this tournament.';
  end if;
  if p_expected_capacity not between 0 and 128 then
    raise exception 'Online team limit must be between 0 and 128.';
  end if;
  if p_base_revision is null or p_base_revision < 0 then
    raise exception 'A non-negative capacity revision is required.';
  end if;

  select * into signup
  from public.signup_events
  where id = p_signup_event_id
    and source_event_id = p_source_event_id
    and owner_user_id = auth.uid()
  for update;

  if not found then
    raise exception 'This sign-up event could not be found or you do not own it.';
  end if;

  if signup.roster_seeded_at is null then
    raise exception 'Finish publishing the organiser roster before starting play.';
  end if;

  if signup.roster_locked_at is not null then
    if signup.capacity_teams <> p_expected_capacity or signup.is_open then
      raise exception 'The locked roster no longer matches this tournament.';
    end if;
    return jsonb_build_object(
      'applied', true,
      'conflict', false,
      'capacityRevision', signup.capacity_revision,
      'event', to_jsonb(signup)
    );
  end if;

  if signup.capacity_revision <> p_base_revision then
    return jsonb_build_object(
      'applied', false,
      'conflict', true,
      'capacityRevision', signup.capacity_revision,
      'event', to_jsonb(signup)
    );
  end if;

  update public.signup_events
  set
    capacity_teams = p_expected_capacity,
    is_open = false,
    roster_locked_at = now(),
    capacity_revision = signup.capacity_revision + 1,
    updated_at = now()
  where id = signup.id
    and owner_user_id = auth.uid()
  returning * into signup;

  perform public.rebalance_signup_event(signup.id);

  return jsonb_build_object(
    'applied', true,
    'conflict', false,
    'capacityRevision', signup.capacity_revision,
    'event', to_jsonb(signup)
  );
end;
$$;

revoke all on function public.organizer_lock_signup_roster(uuid, text, integer, bigint) from public;
grant execute on function public.organizer_lock_signup_roster(uuid, text, integer, bigint) to authenticated;

-- A deliberate reset unlocks the roster but leaves registrations closed. The
-- organiser can review the unchanged list and explicitly reopen it afterward.
create or replace function public.organizer_unlock_signup_roster(
  p_signup_event_id uuid,
  p_source_event_id text,
  p_base_revision bigint
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  signup public.signup_events%rowtype;
begin
  if auth.uid() is null then
    raise exception 'Sign in to reset this tournament.';
  end if;
  if p_base_revision is null or p_base_revision < 0 then
    raise exception 'A non-negative capacity revision is required.';
  end if;

  select * into signup
  from public.signup_events
  where id = p_signup_event_id
    and source_event_id = p_source_event_id
    and owner_user_id = auth.uid()
  for update;

  if not found then
    raise exception 'This sign-up event could not be found or you do not own it.';
  end if;

  if signup.roster_locked_at is null then
    return jsonb_build_object(
      'applied', true,
      'conflict', false,
      'capacityRevision', signup.capacity_revision,
      'event', to_jsonb(signup)
    );
  end if;

  if signup.capacity_revision <> p_base_revision then
    return jsonb_build_object(
      'applied', false,
      'conflict', true,
      'capacityRevision', signup.capacity_revision,
      'event', to_jsonb(signup)
    );
  end if;

  update public.signup_events
  set
    roster_locked_at = null,
    is_open = false,
    capacity_revision = signup.capacity_revision + 1,
    updated_at = now()
  where id = signup.id
    and owner_user_id = auth.uid()
  returning * into signup;

  return jsonb_build_object(
    'applied', true,
    'conflict', false,
    'capacityRevision', signup.capacity_revision,
    'event', to_jsonb(signup)
  );
end;
$$;

revoke all on function public.organizer_unlock_signup_roster(uuid, text, bigint) from public;
grant execute on function public.organizer_unlock_signup_roster(uuid, text, bigint) to authenticated;

-- Override the earlier open/close RPC so cached organiser tabs cannot reopen a
-- tournament after the atomic start transition.
create or replace function public.organizer_set_signup_open(
  p_signup_event_id uuid,
  p_source_event_id text,
  p_is_open boolean,
  p_base_revision bigint
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  signup public.signup_events%rowtype;
begin
  if auth.uid() is null then
    raise exception 'Sign in to update this sign-up.';
  end if;
  if p_base_revision is null or p_base_revision < 0 then
    raise exception 'A non-negative capacity revision is required.';
  end if;

  select * into signup
  from public.signup_events
  where id = p_signup_event_id
    and source_event_id = p_source_event_id
    and owner_user_id = auth.uid()
  for update;

  if not found then
    raise exception 'This sign-up event could not be found or you do not own it.';
  end if;
  if p_is_open and signup.roster_locked_at is not null then
    raise exception 'Reset the tournament before reopening registrations.';
  end if;

  if signup.is_open = p_is_open then
    return jsonb_build_object(
      'applied', true,
      'conflict', false,
      'capacityRevision', signup.capacity_revision,
      'event', to_jsonb(signup)
    );
  end if;

  if signup.capacity_revision <> p_base_revision then
    return jsonb_build_object(
      'applied', false,
      'conflict', true,
      'capacityRevision', signup.capacity_revision,
      'event', to_jsonb(signup)
    );
  end if;

  update public.signup_events
  set
    is_open = p_is_open,
    capacity_revision = signup.capacity_revision + 1,
    updated_at = now()
  where id = signup.id
    and owner_user_id = auth.uid()
  returning * into signup;

  return jsonb_build_object(
    'applied', true,
    'conflict', false,
    'capacityRevision', signup.capacity_revision,
    'event', to_jsonb(signup)
  );
end;
$$;

revoke all on function public.organizer_set_signup_open(uuid, text, boolean, bigint) from public;
grant execute on function public.organizer_set_signup_open(uuid, text, boolean, bigint) to authenticated;

-- Ordering is a setup-only operation. Blocking it once the roster is locked
-- prevents a stale setup tab from reshuffling the live tournament.
create or replace function public.organizer_reorder_signup_registrations(
  p_event_id uuid,
  p_registration_ids uuid[]
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  roster_locked_at timestamptz;
begin
  select event.roster_locked_at into roster_locked_at
  from public.signup_events as event
  where event.id = p_event_id
    and event.owner_user_id = auth.uid()
  for update;

  if not found then
    raise exception 'This sign-up could not be found or you do not own it.';
  end if;
  if roster_locked_at is not null then
    raise exception 'Team order is locked because play has started.';
  end if;

  if exists (
    select 1
    from unnest(p_registration_ids) as requested(registration_id)
    left join public.signup_registrations as registration
      on registration.id = requested.registration_id
      and registration.signup_event_id = p_event_id
      and registration.status in ('confirmed', 'waitlisted', 'looking')
    where registration.id is null
  ) then
    raise exception 'One or more teams do not belong to this active sign-up.';
  end if;

  update public.signup_registrations as registration
  set organizer_rank = ordered.ordinality, updated_at = now()
  from unnest(p_registration_ids) with ordinality as ordered(id, ordinality)
  where registration.id = ordered.id
    and registration.signup_event_id = p_event_id
    and registration.status in ('confirmed', 'waitlisted');

  perform public.rebalance_signup_event(p_event_id);
end;
$$;

revoke all on function public.organizer_reorder_signup_registrations(uuid, uuid[]) from public;
grant execute on function public.organizer_reorder_signup_registrations(uuid, uuid[]) to authenticated;

-- Adopt a complete local roster into the canonical signup queue. Stable
-- registration IDs win; legacy teams without IDs adopt an exact existing pair
-- before a missing organiser-managed registration is inserted. Registrations
-- not present in p_teams are preserved and follow the adopted roster.
create or replace function public.organizer_sync_signup_roster(
  p_signup_event_id uuid,
  p_teams jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  item record;
  team jsonb;
  registration public.signup_registrations%rowtype;
  registration_id uuid;
  requested_registration_id text;
  next_team_name text;
  next_player_one text;
  next_player_two text;
  next_contact text;
  requested_rank integer;
  used_registration_ids uuid[] := array[]::uuid[];
  used_ranks integer[] := array[]::integer[];
  highest_rank integer := 0;
  roster_locked_at timestamptz;
  result jsonb;
begin
  if auth.uid() is null then
    raise exception 'Sign in to sync this roster.';
  end if;
  if p_teams is null or jsonb_typeof(p_teams) <> 'array' then
    raise exception 'Roster teams must be a JSON array.';
  end if;
  if jsonb_array_length(p_teams) > 128 then
    raise exception 'A roster can contain at most 128 teams.';
  end if;

  select event.roster_locked_at into roster_locked_at
  from public.signup_events as event
  where event.id = p_signup_event_id
    and event.owner_user_id = auth.uid()
  for update;

  if not found then
    raise exception 'This sign-up could not be found or you do not own it.';
  end if;
  if roster_locked_at is not null then
    raise exception 'The roster is locked because play has started.';
  end if;

  for item in
    select value, ordinality
    from jsonb_array_elements(p_teams) with ordinality
  loop
    team := item.value;
    if jsonb_typeof(team) <> 'object' then
      raise exception 'Every roster entry must be an object.';
    end if;

    next_team_name := trim(coalesce(team->>'teamName', ''));
    next_player_one := trim(coalesce(team->>'playerOne', ''));
    next_player_two := trim(coalesce(team->>'playerTwo', ''));
    next_contact := nullif(trim(coalesce(team->>'contact', '')), '');

    if team ? 'rank' and coalesce(team->>'rank', '') !~ '^[1-9][0-9]*$' then
      raise exception 'Every roster rank must be a positive whole number.';
    end if;
    requested_rank := coalesce((team->>'rank')::integer, item.ordinality::integer);
    if requested_rank > 128 or requested_rank = any(used_ranks) then
      raise exception 'Roster ranks must be unique numbers from 1 to 128.';
    end if;
    used_ranks := array_append(used_ranks, requested_rank);
    highest_rank := greatest(highest_rank, requested_rank);

    if char_length(next_team_name) > 100 then
      raise exception 'Pair name is too long.';
    end if;
    if char_length(next_player_one) not between 1 and 100
      or char_length(next_player_two) not between 1 and 100 then
      raise exception 'Every roster team needs two valid player names.';
    end if;
    if lower(next_player_one) = lower(next_player_two) then
      raise exception 'A roster team must contain two different players.';
    end if;
    if next_contact is not null and char_length(next_contact) not between 3 and 200 then
      raise exception 'A roster contact must be between 3 and 200 characters.';
    end if;

    registration_id := null;
    requested_registration_id := nullif(trim(coalesce(team->>'registrationId', '')), '');
    if requested_registration_id is not null then
      begin
        registration_id := requested_registration_id::uuid;
      exception when invalid_text_representation then
        raise exception 'A roster registrationId is not a valid UUID.';
      end;

      select * into registration
      from public.signup_registrations as candidate
      where candidate.id = registration_id
        and candidate.signup_event_id = p_signup_event_id
        and candidate.status in ('confirmed', 'waitlisted', 'looking')
      for update;

      if not found then
        raise exception 'A roster registrationId does not belong to this sign-up.';
      end if;
    else
      select * into registration
      from public.signup_registrations as candidate
      where candidate.signup_event_id = p_signup_event_id
        and candidate.status in ('confirmed', 'waitlisted', 'looking')
        and not (candidate.id = any(used_registration_ids))
        and candidate.player_two is not null
        and (
          (
            lower(trim(candidate.player_one)) = lower(next_player_one)
            and lower(trim(candidate.player_two)) = lower(next_player_two)
          )
          or (
            lower(trim(candidate.player_one)) = lower(next_player_two)
            and lower(trim(candidate.player_two)) = lower(next_player_one)
          )
        )
      order by
        candidate.organizer_rank nulls last,
        candidate.pair_completed_at nulls last,
        candidate.created_at,
        candidate.id
      for update
      limit 1;

      if found then registration_id := registration.id; end if;
    end if;

    if registration_id is not null and registration_id = any(used_registration_ids) then
      raise exception 'The same registration appears more than once in this roster.';
    end if;

    if exists (
      select 1
      from public.signup_registrations as other
      where other.signup_event_id = p_signup_event_id
        and other.status in ('confirmed', 'waitlisted', 'looking')
        and (registration_id is null or other.id <> registration_id)
        and (
          lower(trim(other.player_one)) in (lower(next_player_one), lower(next_player_two))
          or lower(trim(coalesce(other.player_two, ''))) in (lower(next_player_one), lower(next_player_two))
        )
    ) then
      raise exception 'One of the roster players is already registered in another entry.';
    end if;

    if registration_id is null then
      insert into public.signup_registrations (
        signup_event_id,
        team_name,
        player_one,
        player_two,
        contact,
        status,
        organizer_rank,
        pair_completed_at
      ) values (
        p_signup_event_id,
        next_team_name,
        next_player_one,
        next_player_two,
        coalesce(next_contact, 'Added by organiser'),
        'waitlisted',
        requested_rank,
        now()
      ) returning * into registration;
      registration_id := registration.id;
    else
      update public.signup_registrations as existing
      set
        team_name = next_team_name,
        player_one = next_player_one,
        player_two = next_player_two,
        player_two_contact = case
          when lower(trim(coalesce(existing.player_two, ''))) = lower(next_player_two)
            then existing.player_two_contact
          else null
        end,
        pair_completed_at = case
          when existing.player_two is not null and trim(existing.player_two) <> ''
            then coalesce(existing.pair_completed_at, existing.created_at)
          else now()
        end,
        contact = coalesce(next_contact, existing.contact),
        status = 'waitlisted',
        cancelled_at = null,
        organizer_rank = requested_rank,
        updated_at = now()
      where existing.id = registration_id
        and existing.signup_event_id = p_signup_event_id;
    end if;

    used_registration_ids := array_append(used_registration_ids, registration_id);
  end loop;

  if cardinality(used_registration_ids) > 0 then
    with remaining as (
      select
        registration.id,
        row_number() over (
          order by
            case
              when registration.player_two is not null
                and trim(registration.player_two) <> '' then 0
              else 1
            end,
            registration.organizer_rank nulls last,
            registration.pair_completed_at nulls last,
            registration.created_at,
            registration.id
        ) as queue_position
      from public.signup_registrations as registration
      where registration.signup_event_id = p_signup_event_id
        and registration.status in ('confirmed', 'waitlisted', 'looking')
        and registration.player_two is not null
        and trim(registration.player_two) <> ''
        and not (registration.id = any(used_registration_ids))
    )
    update public.signup_registrations as registration
    set
      organizer_rank = highest_rank + remaining.queue_position,
      updated_at = now()
    from remaining
    where registration.id = remaining.id;
  end if;

  -- A solo has no pair-queue rank. When joined it receives a fresh
  -- pair_completed_at and enters behind pairs that were already complete.
  update public.signup_registrations
  set organizer_rank = null, updated_at = now()
  where signup_event_id = p_signup_event_id
    and status in ('confirmed', 'waitlisted', 'looking')
    and (player_two is null or trim(player_two) = '')
    and organizer_rank is not null;

  perform public.rebalance_signup_event(p_signup_event_id);

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'id', registration.id,
        'signupEventId', registration.signup_event_id,
        'teamName', registration.team_name,
        'playerOne', registration.player_one,
        'playerTwo', coalesce(registration.player_two, ''),
        'contact', registration.contact,
        'status', registration.status,
        'organizerRank', registration.organizer_rank,
        'pairCompletedAt', registration.pair_completed_at,
        'createdAt', registration.created_at,
        'updatedAt', registration.updated_at
      ) order by
        case registration.status
          when 'confirmed' then 0
          when 'looking' then 1
          else 2
        end,
        registration.organizer_rank nulls last,
        registration.pair_completed_at nulls last,
        registration.created_at,
        registration.id
    ),
    '[]'::jsonb
  ) into result
  from public.signup_registrations as registration
  where registration.signup_event_id = p_signup_event_id
    and registration.status in ('confirmed', 'waitlisted', 'looking');

  return result;
end;
$$;

revoke all on function public.organizer_sync_signup_roster(uuid, jsonb) from public;
grant execute on function public.organizer_sync_signup_roster(uuid, jsonb) to authenticated;

-- One-time migration handshake for future events. A setup screen may offer its
-- current local roster exactly once; subsequent loads return the canonical
-- rows without replaying a stale local projection.
create or replace function public.organizer_seed_signup_roster(
  p_signup_event_id uuid,
  p_teams jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  seeded_at timestamptz;
  roster jsonb;
begin
  if auth.uid() is null then
    raise exception 'Sign in to seed this roster.';
  end if;

  select event.roster_seeded_at into seeded_at
  from public.signup_events as event
  where event.id = p_signup_event_id
    and event.owner_user_id = auth.uid()
  for update;

  if not found then
    raise exception 'This sign-up could not be found or you do not own it.';
  end if;

  if seeded_at is null then
    roster := public.organizer_sync_signup_roster(p_signup_event_id, p_teams);
    update public.signup_events
    set roster_seeded_at = now(), updated_at = now()
    where id = p_signup_event_id
      and owner_user_id = auth.uid()
      and roster_seeded_at is null;

    return jsonb_build_object('seeded', true, 'roster', roster);
  end if;

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'id', registration.id,
        'signupEventId', registration.signup_event_id,
        'teamName', registration.team_name,
        'playerOne', registration.player_one,
        'playerTwo', coalesce(registration.player_two, ''),
        'contact', registration.contact,
        'status', registration.status,
        'organizerRank', registration.organizer_rank,
        'pairCompletedAt', registration.pair_completed_at,
        'createdAt', registration.created_at,
        'updatedAt', registration.updated_at
      ) order by
        case registration.status
          when 'confirmed' then 0
          when 'looking' then 1
          else 2
        end,
        registration.organizer_rank nulls last,
        registration.pair_completed_at nulls last,
        registration.created_at,
        registration.id
    ),
    '[]'::jsonb
  ) into roster
  from public.signup_registrations as registration
  where registration.signup_event_id = p_signup_event_id
    and registration.status in ('confirmed', 'waitlisted', 'looking');

  return jsonb_build_object('seeded', false, 'roster', roster);
end;
$$;

revoke all on function public.organizer_seed_signup_roster(uuid, jsonb) from public;
grant execute on function public.organizer_seed_signup_roster(uuid, jsonb) to authenticated;

-- Narrow explicit-add path. It never round-trips or overwrites the existing
-- roster, and a null organiser rank plus a fresh completion time places the
-- pair at the end of the current deterministic pair queue.
create or replace function public.organizer_add_signup_pair(
  p_signup_event_id uuid,
  p_team_name text,
  p_player_one text,
  p_player_two text,
  p_contact text default null,
  p_allow_locked boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  next_team_name text := trim(coalesce(p_team_name, ''));
  next_player_one text := trim(coalesce(p_player_one, ''));
  next_player_two text := trim(coalesce(p_player_two, ''));
  next_contact text := nullif(trim(coalesce(p_contact, '')), '');
  seeded_at timestamptz;
  roster_locked_at timestamptz;
  registration public.signup_registrations%rowtype;
begin
  if auth.uid() is null then
    raise exception 'Sign in to add a pair.';
  end if;
  if char_length(next_team_name) > 100 then
    raise exception 'Pair name is too long.';
  end if;
  if char_length(next_player_one) not between 1 and 100
    or char_length(next_player_two) not between 1 and 100 then
    raise exception 'Enter two valid player names.';
  end if;
  if lower(next_player_one) = lower(next_player_two) then
    raise exception 'Enter two different player names.';
  end if;
  if next_contact is not null and char_length(next_contact) not between 3 and 200 then
    raise exception 'Enter a valid WhatsApp number or email.';
  end if;

  select event.roster_seeded_at, event.roster_locked_at
    into seeded_at, roster_locked_at
  from public.signup_events as event
  where event.id = p_signup_event_id
    and event.owner_user_id = auth.uid()
  for update;

  if not found then
    raise exception 'This sign-up could not be found or you do not own it.';
  end if;
  if seeded_at is null then
    raise exception 'Finish publishing this sign-up before adding pairs. Refresh and try again.';
  end if;
  if roster_locked_at is not null and not p_allow_locked then
    raise exception 'The roster is locked because play has started.';
  end if;

  if exists (
    select 1
    from public.signup_registrations as other
    where other.signup_event_id = p_signup_event_id
      and other.status in ('confirmed', 'waitlisted', 'looking')
      and (
        lower(trim(other.player_one)) in (lower(next_player_one), lower(next_player_two))
        or lower(trim(coalesce(other.player_two, ''))) in (lower(next_player_one), lower(next_player_two))
      )
  ) then
    raise exception 'One of these players is already registered for this event.';
  end if;

  insert into public.signup_registrations (
    signup_event_id,
    team_name,
    player_one,
    player_two,
    contact,
    status,
    organizer_rank,
    pair_completed_at
  ) values (
    p_signup_event_id,
    next_team_name,
    next_player_one,
    next_player_two,
    coalesce(next_contact, 'Added by organiser'),
    'waitlisted',
    null,
    now()
  ) returning * into registration;

  perform public.rebalance_signup_event(p_signup_event_id);

  select current_registration.* into registration
  from public.signup_registrations as current_registration
  where current_registration.id = registration.id;

  return jsonb_build_object(
    'id', registration.id,
    'signupEventId', registration.signup_event_id,
    'teamName', registration.team_name,
    'playerOne', registration.player_one,
    'playerTwo', registration.player_two,
    'contact', registration.contact,
    'status', registration.status,
    'organizerRank', registration.organizer_rank,
    'pairCompletedAt', registration.pair_completed_at,
    'createdAt', registration.created_at,
    'updatedAt', registration.updated_at
  );
end;
$$;

revoke all on function public.organizer_add_signup_pair(uuid, text, text, text, text, boolean) from public;
grant execute on function public.organizer_add_signup_pair(uuid, text, text, text, text, boolean) to authenticated;

-- Every confirmation dialog carries the status the organiser actually saw.
-- If the queue changes before they confirm, refuse the stale delete rather
-- than removing a registration that has since been promoted, demoted or paired.
create or replace function public.organizer_delete_signup_registration_if_status(
  p_registration_id uuid,
  p_expected_status text,
  p_expected_updated_at timestamptz,
  p_allow_locked boolean default false
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  event_id uuid;
  current_status text;
  current_updated_at timestamptz;
  roster_locked_at timestamptz;
begin
  if p_expected_status not in ('confirmed', 'waitlisted', 'looking') then
    raise exception 'A valid current registration status is required.';
  end if;

  select event.id, event.roster_locked_at into event_id, roster_locked_at
  from public.signup_events as event
  where event.owner_user_id = auth.uid()
    and exists (
      select 1
      from public.signup_registrations as registration
      where registration.id = p_registration_id
        and registration.signup_event_id = event.id
    )
  for update;

  if event_id is null then
    raise exception 'This registration could not be found or you do not own its sign-up.';
  end if;
  if roster_locked_at is not null and not p_allow_locked then
    raise exception 'The roster is locked because play has started.';
  end if;

  select registration.status, registration.updated_at
    into current_status, current_updated_at
  from public.signup_registrations as registration
  where registration.id = p_registration_id
    and registration.signup_event_id = event_id
  for update;

  if not found then
    raise exception 'This registration no longer exists. Refresh and try again.';
  end if;
  if current_status <> p_expected_status
    or p_expected_updated_at is null
    or current_updated_at is distinct from p_expected_updated_at then
    raise exception 'This registration changed while the confirmation was open. Refresh and try again.';
  end if;

  delete from public.signup_registrations
  where id = p_registration_id
    and signup_event_id = event_id
    and status = p_expected_status
    and updated_at is not distinct from p_expected_updated_at;

  perform public.rebalance_signup_event(event_id);
end;
$$;

revoke all on function public.organizer_delete_signup_registration_if_status(uuid, text, timestamptz, boolean) from public;
grant execute on function public.organizer_delete_signup_registration_if_status(uuid, text, timestamptz, boolean) to authenticated;

-- Remove every legacy bypass. Current clients use the guarded functions above;
-- cached clients receive a clear permission failure instead of silently
-- mutating a promoted or locked registration.
revoke all on function public.organizer_delete_signup_registration(uuid)
  from public, anon, authenticated;
revoke all on function public.organizer_delete_waitlisted_signup_registration(uuid)
  from public, anon, authenticated;

-- Targeted, idempotent repair for the only roster that must be preserved from
-- the legacy split-source model. No active registration is deleted.
do $$
declare
  target_event_id uuid;
  double_fault_id uuid;
begin
  select event.id into target_event_id
  from public.signup_events as event
  where event.account_slug = 'krissbell'
    and event.event_slug = '31-aug-2026-silver-king-of-the-court'
  for update;

  if target_event_id is null then return; end if;

  update public.signup_events
  set
    capacity_teams = 16,
    capacity_revision = capacity_revision + 1,
    updated_at = now()
  where id = target_event_id
    and capacity_teams is distinct from 16;

  select registration.id into double_fault_id
  from public.signup_registrations as registration
  where registration.signup_event_id = target_event_id
    and (
      (
        lower(trim(registration.player_one)) = 'oli'
        and lower(trim(coalesce(registration.player_two, ''))) = 'andy s'
      )
      or (
        lower(trim(registration.player_one)) = 'andy s'
        and lower(trim(coalesce(registration.player_two, ''))) = 'oli'
      )
    )
  order by
    case when registration.status = 'cancelled' then 1 else 0 end,
    registration.created_at,
    registration.id
  for update
  limit 1;

  if double_fault_id is null then
    insert into public.signup_registrations (
      signup_event_id,
      team_name,
      player_one,
      player_two,
      contact,
      status,
      organizer_rank,
      pair_completed_at
    ) values (
      target_event_id,
      'Double Fault',
      'Oli',
      'Andy S',
      'Added by organiser',
      'waitlisted',
      14,
      now()
    ) returning id into double_fault_id;
  else
    update public.signup_registrations
    set
      team_name = 'Double Fault',
      player_one = 'Oli',
      player_two = 'Andy S',
      pair_completed_at = coalesce(pair_completed_at, created_at),
      status = 'waitlisted',
      cancelled_at = null,
      updated_at = now()
    where id = double_fault_id;
  end if;

  -- Preserve every other pair's relative order and put Double Fault at 14.
  with ordered_others as (
    select
      registration.id,
      row_number() over (
        order by
          registration.organizer_rank nulls last,
          registration.pair_completed_at nulls last,
          registration.created_at,
          registration.id
      ) as prior_position
    from public.signup_registrations as registration
    where registration.signup_event_id = target_event_id
      and registration.status in ('confirmed', 'waitlisted', 'looking')
      and registration.id <> double_fault_id
      and registration.player_two is not null
      and trim(registration.player_two) <> ''
  ), desired_ranks as (
    select
      id,
      case
        when prior_position < 14 then prior_position
        else prior_position + 1
      end as next_rank
    from ordered_others
    union all
    select double_fault_id, 14
  )
  update public.signup_registrations as registration
  set organizer_rank = desired.next_rank, updated_at = now()
  from desired_ranks as desired
  where registration.id = desired.id
    and registration.organizer_rank is distinct from desired.next_rank;

  update public.signup_registrations
  set
    status = 'looking',
    organizer_rank = null,
    pair_completed_at = null,
    updated_at = now()
  where signup_event_id = target_event_id
    and status in ('confirmed', 'waitlisted', 'looking')
    and lower(trim(player_one)) = 'edou'
    and (player_two is null or trim(player_two) = '')
    and (
      status is distinct from 'looking'
      or organizer_rank is not null
      or pair_completed_at is not null
    );

  perform public.rebalance_signup_event(target_event_id);
end;
$$;

-- Repair the invariant for every existing sign-up without deleting data.
do $$
declare
  signup record;
begin
  for signup in select id from public.signup_events order by id loop
    perform public.rebalance_signup_event(signup.id);
  end loop;
end;
$$;

alter table public.signup_registrations
  validate constraint signup_registrations_roster_state_check;
