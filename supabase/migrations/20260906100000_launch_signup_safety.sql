-- Launch hardening for public sign-up reliability and event cancellation.
-- All changes are additive and preserve existing event, registration and URL rows.

alter table public.signup_events
  add column if not exists cancelled_at timestamptz,
  add column if not exists cancellation_message text,
  add column if not exists time_zone text,
  add column if not exists organizer_name text,
  add column if not exists public_contact_method text,
  add column if not exists public_contact_value text;

alter table public.signup_templates
  add column if not exists time_zone text,
  add column if not exists organizer_name text,
  add column if not exists public_contact_method text,
  add column if not exists public_contact_value text;

alter table public.signup_events
  drop constraint if exists signup_events_cancellation_message_length_check,
  add constraint signup_events_cancellation_message_length_check
    check (cancellation_message is null or char_length(cancellation_message) <= 500) not valid,
  drop constraint if exists signup_events_time_zone_length_check,
  add constraint signup_events_time_zone_length_check
    check (time_zone is null or char_length(time_zone) between 1 and 100) not valid,
  drop constraint if exists signup_events_organizer_name_length_check,
  add constraint signup_events_organizer_name_length_check
    check (organizer_name is null or char_length(organizer_name) <= 100) not valid,
  drop constraint if exists signup_events_public_contact_method_check,
  add constraint signup_events_public_contact_method_check
    check (public_contact_method is null or public_contact_method in ('whatsapp', 'email')) not valid,
  drop constraint if exists signup_events_public_contact_value_length_check,
  add constraint signup_events_public_contact_value_length_check
    check (public_contact_value is null or char_length(public_contact_value) between 3 and 200) not valid,
  drop constraint if exists signup_events_public_contact_pair_check,
  add constraint signup_events_public_contact_pair_check
    check ((public_contact_method is null) = (public_contact_value is null)) not valid,
  drop constraint if exists signup_events_public_contact_format_check,
  add constraint signup_events_public_contact_format_check check (
    public_contact_value is null
    or (public_contact_method = 'email' and public_contact_value ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$')
    or (public_contact_method = 'whatsapp' and char_length(regexp_replace(public_contact_value, '[^0-9]', '', 'g')) >= 7)
  ) not valid;

alter table public.signup_events validate constraint signup_events_cancellation_message_length_check;
alter table public.signup_events validate constraint signup_events_time_zone_length_check;
alter table public.signup_events validate constraint signup_events_organizer_name_length_check;
alter table public.signup_events validate constraint signup_events_public_contact_method_check;
alter table public.signup_events validate constraint signup_events_public_contact_value_length_check;
alter table public.signup_events validate constraint signup_events_public_contact_pair_check;
alter table public.signup_events validate constraint signup_events_public_contact_format_check;

create table if not exists public.signup_public_requests (
  signup_event_id uuid not null references public.signup_events(id) on delete cascade,
  operation text not null check (operation in ('register', 'join')),
  request_id uuid not null,
  payload_fingerprint text not null check (char_length(payload_fingerprint) between 1 and 256),
  registration_id uuid references public.signup_registrations(id) on delete set null,
  response jsonb,
  created_at timestamptz not null default now(),
  primary key (signup_event_id, operation, request_id)
);

alter table public.signup_public_requests enable row level security;
revoke all on table public.signup_public_requests from public, anon, authenticated;

create table if not exists public.signup_promotion_notices (
  id uuid primary key default gen_random_uuid(),
  signup_event_id uuid not null references public.signup_events(id) on delete cascade,
  registration_id uuid not null references public.signup_registrations(id) on delete cascade,
  promoted_at timestamptz not null default now(),
  acknowledged_at timestamptz,
  unique (registration_id, promoted_at)
);
alter table public.signup_promotion_notices enable row level security;
create policy signup_promotion_notices_owner_select on public.signup_promotion_notices for select
  using (exists (select 1 from public.signup_events where id = signup_event_id and owner_user_id = auth.uid()));
revoke all on table public.signup_promotion_notices from public, anon, authenticated;

create or replace function public.record_signup_promotion()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  -- A brand-new pair is first inserted as waitlisted and immediately rebalanced.
  -- Its created_at equals this transaction's timestamp and its submission receipt
  -- is sufficient; notices are only for an older waiting pair gaining a place.
  if old.status = 'waitlisted' and new.status = 'confirmed' and new.created_at < transaction_timestamp() then
    insert into public.signup_promotion_notices (signup_event_id, registration_id, promoted_at)
    values (new.signup_event_id, new.id, clock_timestamp());
  end if;
  return new;
end;
$$;

drop trigger if exists record_signup_promotion on public.signup_registrations;
create trigger record_signup_promotion after update of status on public.signup_registrations
for each row when (old.status is distinct from new.status)
execute function public.record_signup_promotion();

create or replace function public.organizer_get_promotion_notices(p_signup_event_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  if not exists (select 1 from public.signup_events where id = p_signup_event_id and owner_user_id = auth.uid()) then
    raise exception 'This sign-up event could not be found.';
  end if;
  return coalesce((select jsonb_agg(jsonb_build_object(
    'id', notice.id, 'registrationId', registration.id, 'promotedAt', notice.promoted_at,
    'teamName', registration.team_name, 'playerOne', registration.player_one,
    'playerTwo', coalesce(registration.player_two, ''), 'contact', registration.contact,
    'playerTwoContact', registration.player_two_contact
  ) order by notice.promoted_at)
  from public.signup_promotion_notices notice join public.signup_registrations registration on registration.id = notice.registration_id
  where notice.signup_event_id = p_signup_event_id and notice.acknowledged_at is null and registration.status = 'confirmed'), '[]'::jsonb);
end;
$$;

create or replace function public.organizer_acknowledge_promotion(p_notice_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  update public.signup_promotion_notices notice set acknowledged_at = now()
  where notice.id = p_notice_id and notice.acknowledged_at is null
    and exists (select 1 from public.signup_events event where event.id = notice.signup_event_id and event.owner_user_id = auth.uid());
  if not found then raise exception 'This promotion is no longer available.'; end if;
end;
$$;

revoke all on function public.organizer_get_promotion_notices(uuid) from public;
revoke all on function public.organizer_acknowledge_promotion(uuid) from public;
grant execute on function public.organizer_get_promotion_notices(uuid) to authenticated;
grant execute on function public.organizer_acknowledge_promotion(uuid) to authenticated;

create or replace function public.prevent_cancelled_signup_reopen()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if old.cancelled_at is not null then
    new.cancelled_at := old.cancelled_at;
    new.cancellation_message := old.cancellation_message;
    if new.is_open then
      raise exception 'This event is cancelled and cannot be reopened.';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists prevent_cancelled_signup_reopen on public.signup_events;
create trigger prevent_cancelled_signup_reopen
before update on public.signup_events
for each row execute function public.prevent_cancelled_signup_reopen();

create or replace function public.get_public_signup_v2(p_account_slug text, p_event_slug text)
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
  select * into signup from public.signup_events
  where case
    when nullif(trim(coalesce(p_account_slug, '')), '') is not null
      then account_slug = trim(p_account_slug) and event_slug = trim(p_event_slug)
    else friendly_slug = trim(p_event_slug) or public_slug::text = trim(p_event_slug)
  end
  limit 1;
  if not found then return null; end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'id', ranked.id, 'signupEventId', ranked.signup_event_id,
    'teamName', ranked.team_name, 'playerOne', ranked.player_one,
    'playerTwo', coalesce(ranked.player_two, ''), 'status', ranked.status,
    'position', ranked.position, 'createdAt', ranked.created_at,
    'organizerRank', ranked.organizer_rank, 'pairCompletedAt', ranked.pair_completed_at
  ) order by case ranked.status when 'confirmed' then 0 when 'looking' then 1 else 2 end,
    ranked.organizer_rank nulls last, ranked.pair_completed_at nulls last, ranked.created_at, ranked.id), '[]'::jsonb)
  into roster from (
    select registration.*, row_number() over (partition by registration.status order by
      registration.organizer_rank nulls last, registration.pair_completed_at nulls last,
      registration.created_at, registration.id) as position
    from public.signup_registrations as registration
    where registration.signup_event_id = signup.id and registration.status in ('confirmed','waitlisted','looking')
  ) ranked;

  return jsonb_build_object('event', jsonb_build_object(
    'id', signup.id, 'publicSlug', signup.public_slug, 'accountSlug', signup.account_slug,
    'eventSlug', signup.event_slug, 'title', signup.title, 'venue', signup.venue,
    'startsAt', signup.starts_at, 'endsAt', signup.ends_at, 'capacityTeams', signup.capacity_teams,
    'details', signup.details, 'prizes', signup.prizes, 'isOpen', signup.is_open,
    'cancelledAt', signup.cancelled_at, 'cancellationMessage', coalesce(signup.cancellation_message, ''),
    'timeZone', signup.time_zone, 'organizerName', coalesce(signup.organizer_name, ''),
    'publicContactMethod', signup.public_contact_method,
    'publicContactValue', coalesce(signup.public_contact_value, '')
  ), 'registrations', roster);
end;
$$;

revoke all on function public.get_public_signup_v2(text,text) from public;
grant execute on function public.get_public_signup_v2(text,text) to anon, authenticated;

create or replace function public.resolve_public_signup_event(
  p_account_slug text,
  p_event_slug text
)
returns uuid
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select event.id
  from public.signup_events as event
  where case
    when nullif(trim(coalesce(p_account_slug, '')), '') is not null
      then event.account_slug = trim(p_account_slug) and event.event_slug = trim(p_event_slug)
    else event.friendly_slug = trim(p_event_slug) or event.public_slug::text = trim(p_event_slug)
  end
  limit 1
$$;

revoke all on function public.resolve_public_signup_event(text, text) from public;

create or replace function public.register_public_team_v2(
  p_account_slug text,
  p_event_slug text,
  p_team_name text,
  p_player_one text,
  p_player_two text,
  p_contact text,
  p_request_id uuid,
  p_payload_fingerprint text
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  event_id uuid;
  signup public.signup_events%rowtype;
  registration public.signup_registrations%rowtype;
  saved_request public.signup_public_requests%rowtype;
  next_position bigint;
  result jsonb;
begin
  if p_request_id is null or char_length(trim(coalesce(p_payload_fingerprint, ''))) not between 1 and 256 then
    raise exception 'This registration request is invalid. Refresh and try again.';
  end if;
  p_team_name := trim(coalesce(p_team_name, ''));
  p_player_one := trim(coalesce(p_player_one, ''));
  p_player_two := nullif(trim(coalesce(p_player_two, '')), '');
  p_contact := trim(coalesce(p_contact, ''));
  if char_length(p_player_one) not between 1 and 100 then raise exception 'Enter your name.'; end if;
  if p_player_two is not null and char_length(p_player_two) not between 1 and 100 then raise exception 'Enter a valid second player name.'; end if;
  if p_player_two is not null and lower(p_player_one) = lower(p_player_two) then raise exception 'Enter two different player names.'; end if;
  if char_length(p_team_name) > 100 then raise exception 'Pair name is too long.'; end if;
  if char_length(p_contact) not between 3 and 200 then raise exception 'Enter a WhatsApp number or email.'; end if;

  event_id := public.resolve_public_signup_event(p_account_slug, p_event_slug);
  select * into signup from public.signup_events where id = event_id for update;
  if not found then raise exception 'This sign-up link was not found.'; end if;

  select * into saved_request
  from public.signup_public_requests
  where signup_event_id = signup.id and operation = 'register' and request_id = p_request_id;
  if found then
    if saved_request.payload_fingerprint <> p_payload_fingerprint then
      raise exception 'This request was already used with different registration details.';
    end if;
    return saved_request.response;
  end if;

  if signup.cancelled_at is not null then raise exception 'This event has been cancelled.'; end if;
  if not signup.is_open or (signup.starts_at is not null and signup.starts_at <= now()) then
    raise exception 'Registrations are currently closed.';
  end if;
  if (select count(*) from public.signup_registrations where signup_event_id = signup.id and status in ('confirmed','waitlisted','looking')) >= 256 then
    raise exception 'This registration list has reached its limit.';
  end if;
  if exists (
    select 1 from public.signup_registrations as other
    where other.signup_event_id = signup.id and other.status in ('confirmed','waitlisted','looking')
      and (lower(trim(other.player_one)) = lower(p_player_one)
        or lower(trim(coalesce(other.player_two, ''))) = lower(p_player_one)
        or (p_player_two is not null and (
          lower(trim(other.player_one)) = lower(p_player_two)
          or lower(trim(coalesce(other.player_two, ''))) = lower(p_player_two))))
  ) then raise exception 'One of these players is already registered for this event.'; end if;

  insert into public.signup_registrations (signup_event_id, team_name, player_one, player_two, contact, status, pair_completed_at)
  values (signup.id, p_team_name, p_player_one, p_player_two, p_contact,
    case when p_player_two is null then 'looking' else 'waitlisted' end,
    case when p_player_two is null then null else now() end)
  returning * into registration;
  perform public.rebalance_signup_event(signup.id);
  select * into registration from public.signup_registrations where id = registration.id;
  select ranked.position into next_position from (
    select row.id, row_number() over (order by row.organizer_rank nulls last, row.pair_completed_at nulls last, row.created_at, row.id) as position
    from public.signup_registrations as row where row.signup_event_id = signup.id and row.status = registration.status
  ) ranked where ranked.id = registration.id;
  result := jsonb_build_object('registrationId', registration.id, 'status', registration.status, 'position', next_position, 'pairCompletedAt', registration.pair_completed_at);
  insert into public.signup_public_requests (signup_event_id, operation, request_id, payload_fingerprint, registration_id, response)
  values (signup.id, 'register', p_request_id, p_payload_fingerprint, registration.id, result);
  return result;
end;
$$;

revoke all on function public.register_public_team_v2(text,text,text,text,text,text,uuid,text) from public;
grant execute on function public.register_public_team_v2(text,text,text,text,text,text,uuid,text) to anon, authenticated;

create or replace function public.join_public_single_v2(
  p_account_slug text,
  p_event_slug text,
  p_registration_id uuid,
  p_player_two text,
  p_contact text,
  p_request_id uuid,
  p_payload_fingerprint text
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  event_id uuid;
  signup public.signup_events%rowtype;
  registration public.signup_registrations%rowtype;
  saved_request public.signup_public_requests%rowtype;
  next_position bigint;
  result jsonb;
begin
  if p_request_id is null or char_length(trim(coalesce(p_payload_fingerprint, ''))) not between 1 and 256 then
    raise exception 'This partner request is invalid. Refresh and try again.';
  end if;
  p_player_two := trim(coalesce(p_player_two, ''));
  p_contact := trim(coalesce(p_contact, ''));
  if char_length(p_player_two) not between 1 and 100 then raise exception 'Enter your name.'; end if;
  if char_length(p_contact) not between 3 and 200 then raise exception 'Enter a WhatsApp number or email.'; end if;

  event_id := public.resolve_public_signup_event(p_account_slug, p_event_slug);
  select * into signup from public.signup_events where id = event_id for update;
  if not found then raise exception 'This sign-up link was not found.'; end if;
  select * into saved_request from public.signup_public_requests
    where signup_event_id = signup.id and operation = 'join' and request_id = p_request_id;
  if found then
    if saved_request.payload_fingerprint <> p_payload_fingerprint then raise exception 'This request was already used with different partner details.'; end if;
    return saved_request.response;
  end if;
  if signup.cancelled_at is not null then raise exception 'This event has been cancelled.'; end if;
  if not signup.is_open or (signup.starts_at is not null and signup.starts_at <= now()) then raise exception 'Registrations are currently closed.'; end if;

  select * into registration from public.signup_registrations
    where id = p_registration_id and signup_event_id = signup.id and status in ('confirmed','waitlisted','looking') for update;
  if not found or nullif(trim(coalesce(registration.player_two, '')), '') is not null then raise exception 'This solo registration could not be found.'; end if;
  if lower(trim(registration.player_one)) = lower(p_player_two) then raise exception 'Enter a different player name.'; end if;
  if exists (select 1 from public.signup_registrations as other
    where other.signup_event_id = signup.id and other.id <> registration.id and other.status in ('confirmed','waitlisted','looking')
      and (lower(trim(other.player_one)) = lower(p_player_two) or lower(trim(coalesce(other.player_two, ''))) = lower(p_player_two)))
  then raise exception 'This player is already registered for the event.'; end if;

  update public.signup_registrations set player_two = p_player_two, player_two_contact = p_contact,
    pair_completed_at = now(), organizer_rank = null, status = 'waitlisted', updated_at = now()
  where id = registration.id;
  perform public.rebalance_signup_event(signup.id);
  select * into registration from public.signup_registrations where id = registration.id;
  select ranked.position into next_position from (
    select row.id, row_number() over (order by row.organizer_rank nulls last, row.pair_completed_at nulls last, row.created_at, row.id) as position
    from public.signup_registrations as row where row.signup_event_id = signup.id and row.status = registration.status
  ) ranked where ranked.id = registration.id;
  result := jsonb_build_object('registrationId', registration.id, 'status', registration.status, 'position', next_position, 'pairCompletedAt', registration.pair_completed_at);
  insert into public.signup_public_requests (signup_event_id, operation, request_id, payload_fingerprint, registration_id, response)
  values (signup.id, 'join', p_request_id, p_payload_fingerprint, registration.id, result);
  return result;
end;
$$;

revoke all on function public.join_public_single_v2(text,text,uuid,text,text,uuid,text) from public;
grant execute on function public.join_public_single_v2(text,text,uuid,text,text,uuid,text) to anon, authenticated;

create or replace function public.organizer_cancel_signup_event(
  p_signup_event_id uuid,
  p_source_event_id text,
  p_base_revision bigint,
  p_message text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  owner_id uuid := auth.uid();
  signup public.signup_events%rowtype;
  next_message text := nullif(trim(coalesce(p_message, '')), '');
begin
  if owner_id is null then raise exception 'Sign in to cancel this event.'; end if;
  if char_length(coalesce(next_message, '')) > 500 then raise exception 'Cancellation message is too long.'; end if;
  perform pg_advisory_xact_lock(hashtextextended('signup-event-publish', 0));
  select * into signup from public.signup_events
    where id = p_signup_event_id and owner_user_id = owner_id and source_event_id = p_source_event_id for update;
  if not found then raise exception 'This sign-up event could not be found.'; end if;
  if signup.cancelled_at is not null then
    return jsonb_build_object('applied', true, 'conflict', false, 'capacityRevision', signup.capacity_revision, 'event', to_jsonb(signup));
  end if;
  if signup.capacity_revision <> p_base_revision then
    return jsonb_build_object('applied', false, 'conflict', true, 'capacityRevision', signup.capacity_revision, 'event', to_jsonb(signup));
  end if;
  update public.signup_events set cancelled_at = now(), cancellation_message = next_message,
    is_open = false, capacity_revision = capacity_revision + 1, updated_at = now()
  where id = signup.id returning * into signup;
  return jsonb_build_object('applied', true, 'conflict', false, 'capacityRevision', signup.capacity_revision, 'event', to_jsonb(signup));
end;
$$;

revoke all on function public.organizer_cancel_signup_event(uuid,text,bigint,text) from public;
grant execute on function public.organizer_cancel_signup_event(uuid,text,bigint,text) to authenticated;

create or replace function public.organizer_save_signup_event_v2(
  p_source_event_id text, p_account_slug text, p_title text, p_venue text,
  p_starts_at timestamptz, p_ends_at timestamptz, p_expected_capacity integer,
  p_base_revision bigint, p_details text, p_prizes text, p_auto_add_pairs boolean,
  p_signup_event_id uuid default null, p_is_open boolean default null,
  p_time_zone text default null, p_organizer_name text default null,
  p_public_contact_method text default null, p_public_contact_value text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  owner_id uuid := auth.uid();
  existing public.signup_events%rowtype;
  saved public.signup_events%rowtype;
  core jsonb;
  metadata_matches boolean;
begin
  if owner_id is null then raise exception 'Sign in to publish this sign-up.'; end if;
  p_time_zone := nullif(trim(coalesce(p_time_zone, '')), '');
  p_organizer_name := nullif(trim(coalesce(p_organizer_name, '')), '');
  p_public_contact_method := nullif(trim(coalesce(p_public_contact_method, '')), '');
  p_public_contact_value := nullif(trim(coalesce(p_public_contact_value, '')), '');
  if p_time_zone is not null and not exists (select 1 from pg_timezone_names where name = p_time_zone) then raise exception 'Choose a valid event time zone.'; end if;
  if char_length(coalesce(p_organizer_name, '')) > 100 then raise exception 'Organiser name is too long.'; end if;
  if p_public_contact_method is not null and p_public_contact_method not in ('whatsapp','email') then raise exception 'Choose WhatsApp or email for public contact.'; end if;
  if (p_public_contact_method is null) <> (p_public_contact_value is null) then raise exception 'Choose a contact method and enter the public contact.'; end if;
  if char_length(coalesce(p_public_contact_value, '')) > 200 then raise exception 'Public contact is too long.'; end if;
  if p_public_contact_method = 'email' and p_public_contact_value !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' then raise exception 'Enter a valid public email address.'; end if;
  if p_public_contact_method = 'whatsapp' and char_length(regexp_replace(p_public_contact_value, '[^0-9]', '', 'g')) < 7 then raise exception 'Enter a complete WhatsApp number including country code.'; end if;

  perform pg_advisory_xact_lock(hashtextextended('signup-event-publish', 0));
  select * into existing from public.signup_events
    where owner_user_id = owner_id and source_event_id = trim(coalesce(p_source_event_id, '')) for update;
  if found then
    metadata_matches := existing.time_zone is not distinct from p_time_zone
      and existing.organizer_name is not distinct from p_organizer_name
      and existing.public_contact_method is not distinct from p_public_contact_method
      and existing.public_contact_value is not distinct from p_public_contact_value;
    if existing.capacity_revision <> p_base_revision and not metadata_matches then
      return jsonb_build_object('applied', false, 'conflict', true,
        'capacityRevision', existing.capacity_revision, 'event', to_jsonb(existing));
    end if;
  end if;

  core := public.organizer_save_signup_event(p_source_event_id, p_account_slug, p_title, p_venue,
    p_starts_at, p_ends_at, p_expected_capacity, p_base_revision, p_details, p_prizes,
    p_auto_add_pairs, p_signup_event_id, p_is_open);
  if coalesce((core->>'conflict')::boolean, false) then return core; end if;

  update public.signup_events set time_zone = p_time_zone, organizer_name = p_organizer_name,
    public_contact_method = p_public_contact_method, public_contact_value = p_public_contact_value
  where id = (core->'event'->>'id')::uuid and owner_user_id = owner_id returning * into saved;
  return jsonb_build_object('applied', coalesce((core->>'applied')::boolean, true),
    'conflict', false, 'capacityRevision', saved.capacity_revision, 'event', to_jsonb(saved));
end;
$$;

revoke all on function public.organizer_save_signup_event_v2(text,text,text,text,timestamptz,timestamptz,integer,bigint,text,text,boolean,uuid,boolean,text,text,text,text) from public;
grant execute on function public.organizer_save_signup_event_v2(text,text,text,text,timestamptz,timestamptz,integer,bigint,text,text,boolean,uuid,boolean,text,text,text,text) to authenticated;

create or replace function public.enforce_signup_event_start_cutoff()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare signup public.signup_events%rowtype;
begin
  select * into signup from public.signup_events where id = new.signup_event_id;
  if found and signup.cancelled_at is not null and coalesce(auth.role(), '') <> 'service_role'
    and (auth.uid() is null or auth.uid() <> signup.owner_user_id)
  then raise exception 'This event has been cancelled.';
  end if;
  if found and signup.starts_at is not null and signup.starts_at <= now()
    and coalesce(auth.role(), '') <> 'service_role' and (auth.uid() is null or auth.uid() <> signup.owner_user_id)
  then raise exception 'This event has already started. Registrations are closed.';
  end if;
  return new;
end;
$$;

create or replace function public.delete_event(p_event_id uuid)
returns timestamptz
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  caller_id uuid := auth.uid();
  existing_deleted_at timestamptz;
  deletion_time timestamptz;
begin
  if caller_id is null then raise exception 'Not authenticated'; end if;
  perform pg_advisory_xact_lock(hashtextextended('signup-event-publish', 0));
  select event.deleted_at into existing_deleted_at from public.events as event
    where event.id = p_event_id and event.user_id = caller_id for update;
  if not found then raise exception 'This event could not be found or you do not own it.'; end if;
  deletion_time := coalesce(existing_deleted_at, clock_timestamp());

  update public.signup_events
  set cancelled_at = coalesce(cancelled_at, deletion_time),
      cancellation_message = coalesce(cancellation_message, 'This event has been cancelled by the organiser.'),
      is_open = false,
      capacity_revision = capacity_revision + case when cancelled_at is null or is_open then 1 else 0 end,
      updated_at = greatest(updated_at, deletion_time)
  where owner_user_id = caller_id and source_event_id = p_event_id::text;

  insert into public.event_tombstones (user_id, event_id, deleted_at)
  values (caller_id, p_event_id, deletion_time)
  on conflict (user_id, event_id) do update set deleted_at = least(public.event_tombstones.deleted_at, excluded.deleted_at);
  update public.events set state = null, deleted_at = deletion_time, updated_at = deletion_time
    where id = p_event_id and user_id = caller_id and deleted_at is null;
  return deletion_time;
end;
$$;

revoke all on function public.delete_event(uuid) from public, anon;
grant execute on function public.delete_event(uuid) to authenticated;
