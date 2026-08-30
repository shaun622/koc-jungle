-- Serialize organiser edits with public registration operations and prevent
-- stale organiser tabs from overwriting a newer sign-up capacity/metadata
-- snapshot. Public signup lookup/registration RPCs and their URL slugs are
-- intentionally unchanged.

alter table public.signup_events
  add column if not exists capacity_revision bigint;

update public.signup_events
set capacity_revision = 0
where capacity_revision is null;

alter table public.signup_events
  alter column capacity_revision set default 0,
  alter column capacity_revision set not null;

alter table public.signup_events
  drop constraint if exists signup_events_capacity_teams_check;

alter table public.signup_events
  add constraint signup_events_capacity_teams_check
  check (capacity_teams between 0 and 128);

alter table public.signup_events
  drop constraint if exists signup_events_capacity_revision_check;

alter table public.signup_events
  add constraint signup_events_capacity_revision_check
  check (capacity_revision >= 0);

-- Replace the organiser's broad table PATCH with an event-first RPC. Locking
-- the parent event before the registration matches the public signup, join,
-- reorder and delete functions, avoiding inverted lock order.
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

  -- Resolve and lock the owner-controlled event first. The EXISTS lookup only
  -- identifies the parent; the registration row is locked afterwards.
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
    and status in ('confirmed', 'waitlisted')
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
  if next_player_two is not null
    and char_length(next_player_two) not between 1 and 100 then
    raise exception 'Enter a valid second player name.';
  end if;
  if next_player_two is not null
    and lower(next_player_one) = lower(next_player_two) then
    raise exception 'Enter two different player names.';
  end if;
  if char_length(next_contact) not between 3 and 200 then
    raise exception 'Enter a valid WhatsApp number or email.';
  end if;

  -- Public signup already performs this check while holding the same parent
  -- lock. Apply it to organiser edits as well so a rename cannot create a
  -- duplicate player or make name-based legacy matching ambiguous.
  if exists (
    select 1
    from public.signup_registrations as other
    where other.signup_event_id = event_id
      and other.id <> p_registration_id
      and other.status in ('confirmed', 'waitlisted')
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

  update public.signup_registrations
  set
    team_name = next_team_name,
    player_one = next_player_one,
    player_two = next_player_two,
    contact = next_contact,
    updated_at = now()
  where id = p_registration_id
    and signup_event_id = event_id;

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
    'updatedAt', registration.updated_at
  );
end;
$$;

-- Save or create all organiser-owned sign-up metadata using one compare-and-
-- swap revision. The caller sends the revision it last read. A differing
-- payload is applied only when that base revision is still current; a retry of
-- an already-applied identical payload succeeds idempotently.
--
-- p_signup_event_id is null on first publish and the returned event.id is used
-- thereafter. p_source_event_id is the immutable tournament EventState id.
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

  -- Serialize first-publish races as well as updates. The row lock below is
  -- the primary lock once the signup exists.
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

  -- A lost response can be retried with its old base revision. If its exact
  -- payload is already stored, treat the request as a successful no-op.
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

  return jsonb_build_object(
    'applied', true,
    'conflict', false,
    'capacityRevision', signup.capacity_revision,
    'event', to_jsonb(signup)
  );
end;
$$;

-- Closing/opening registrations participates in the same revision stream so
-- a stale metadata save cannot silently undo a newer close action.
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

-- Keep legacy direct table updates available for one deployment window so an
-- already-open cached PWA continues to work while the RPC-based bundle rolls
-- out. A follow-up migration revokes those table privileges after production
-- is verified on the new bundle.

revoke all on function public.organizer_update_signup_registration(uuid, text, text, text, text) from public;
revoke all on function public.organizer_save_signup_event(text, text, text, text, timestamptz, timestamptz, integer, bigint, text, text, boolean, uuid, boolean) from public;
revoke all on function public.organizer_set_signup_open(uuid, text, boolean, bigint) from public;

grant execute on function public.organizer_update_signup_registration(uuid, text, text, text, text) to authenticated;
grant execute on function public.organizer_save_signup_event(text, text, text, text, timestamptz, timestamptz, integer, bigint, text, text, boolean, uuid, boolean) to authenticated;
grant execute on function public.organizer_set_signup_open(uuid, text, boolean, bigint) to authenticated;

comment on column public.signup_events.capacity_revision is
  'Server CAS revision for organiser signup metadata/capacity updates.';

comment on function public.organizer_save_signup_event(text, text, text, text, timestamptz, timestamptz, integer, bigint, text, text, boolean, uuid, boolean) is
  'Owner-only signup upsert. Pass the last returned capacityRevision as p_base_revision; a conflict returns applied=false and the current event.';
