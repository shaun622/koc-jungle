-- Namespace friendly signup links by organiser account:
-- /signup/<account>/<date-and-event-name>
-- Legacy UUID and single-slug links remain available through the earlier RPCs.

alter table public.signup_events
  add column if not exists account_slug text,
  add column if not exists event_slug text;

create or replace function public.normalise_signup_link_part(
  p_value text,
  p_fallback text
)
returns text
language sql
immutable
set search_path = public, pg_temp
as $$
  select coalesce(
    nullif(
      trim(both '-' from left(regexp_replace(lower(trim(coalesce(p_value, ''))), '[^a-z0-9]+', '-', 'g'), 80)),
      ''
    ),
    p_fallback
  );
$$;

create or replace function public.make_signup_event_slug(
  p_title text,
  p_starts_at timestamptz
)
returns text
language sql
stable
set search_path = public, pg_temp
as $$
  select trim(both '-' from left(
    case
      when p_starts_at is null then 'date-tbc'
      else lower(to_char(p_starts_at at time zone 'Asia/Singapore', 'DD-Mon-YYYY'))
    end
    || '-'
    || public.normalise_signup_link_part(p_title, 'event'),
    120
  ));
$$;

-- Give every existing organiser a stable account namespace based on their
-- account email. Only genuinely duplicated email prefixes receive a suffix.
with owner_candidates as (
  select distinct
    event.owner_user_id,
    public.normalise_signup_link_part(
      split_part(coalesce(account.email, ''), '@', 1),
      'organiser-' || left(event.owner_user_id::text, 6)
    ) as base_slug
  from public.signup_events as event
  left join auth.users as account on account.id = event.owner_user_id
), ranked_owners as (
  select
    owner_user_id,
    base_slug,
    row_number() over (partition by base_slug order by owner_user_id) as duplicate_number
  from owner_candidates
)
update public.signup_events as event
set account_slug = case
  when ranked.duplicate_number = 1 then ranked.base_slug
  else left(ranked.base_slug, 73) || '-' || left(event.owner_user_id::text, 6)
end
from ranked_owners as ranked
where event.owner_user_id = ranked.owner_user_id
  and event.account_slug is null;

-- The most recently updated duplicate keeps the clean date-and-title path.
-- Older true duplicates under that same account receive a short suffix.
with event_candidates as (
  select
    id,
    account_slug,
    public.make_signup_event_slug(title, starts_at) as base_slug,
    updated_at
  from public.signup_events
  where event_slug is null
), ranked_events as (
  select
    id,
    base_slug,
    row_number() over (
      partition by account_slug, base_slug
      order by updated_at desc, id desc
    ) as duplicate_number
  from event_candidates
)
update public.signup_events as event
set event_slug = case
  when ranked.duplicate_number = 1 then ranked.base_slug
  else left(ranked.base_slug, 113) || '-' || left(event.id::text, 6)
end
from ranked_events as ranked
where event.id = ranked.id;

alter table public.signup_events
  alter column account_slug set not null,
  alter column event_slug set not null;

create unique index if not exists signup_events_account_event_slug_idx
  on public.signup_events (account_slug, event_slug);

create or replace function public.assign_signup_namespaced_slugs()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  requested_account_slug text;
  base_event_slug text;
begin
  requested_account_slug := public.normalise_signup_link_part(
    new.account_slug,
    'organiser-' || left(new.owner_user_id::text, 6)
  );

  if exists (
    select 1
    from public.signup_events
    where account_slug = requested_account_slug
      and owner_user_id <> new.owner_user_id
  ) then
    requested_account_slug := left(requested_account_slug, 73)
      || '-' || left(new.owner_user_id::text, 6);
  end if;

  new.account_slug := requested_account_slug;
  base_event_slug := public.make_signup_event_slug(new.title, new.starts_at);
  -- The event being published now owns the clean address. Preserve older true
  -- duplicates by moving them to a suffixed legacy address first.
  update public.signup_events
  set event_slug = left(base_event_slug, 113) || '-' || left(id::text, 6)
  where account_slug = new.account_slug
    and event_slug = base_event_slug
    and id <> new.id;

  new.event_slug := base_event_slug;

  return new;
end;
$$;

drop trigger if exists signup_events_namespaced_slugs on public.signup_events;
create trigger signup_events_namespaced_slugs
before insert or update of owner_user_id, account_slug, title, starts_at
on public.signup_events
for each row execute function public.assign_signup_namespaced_slugs();

create or replace function public.get_public_signup(
  p_account_slug text,
  p_event_slug text
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  signup public.signup_events%rowtype;
  result jsonb;
begin
  select * into signup
  from public.signup_events
  where account_slug = p_account_slug and event_slug = p_event_slug;

  if not found then return null; end if;
  result := public.get_public_signup(signup.public_slug);
  result := jsonb_set(result, '{event,accountSlug}', to_jsonb(signup.account_slug), true);
  result := jsonb_set(result, '{event,eventSlug}', to_jsonb(signup.event_slug), true);
  return result;
end;
$$;

create or replace function public.register_public_team(
  p_account_slug text,
  p_event_slug text,
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
  resolved_uuid uuid;
begin
  select public_slug into resolved_uuid
  from public.signup_events
  where account_slug = p_account_slug and event_slug = p_event_slug;

  if resolved_uuid is null then raise exception 'This sign-up link was not found.'; end if;
  return public.register_public_team(
    resolved_uuid, p_team_name, p_player_one, p_player_two, p_contact
  );
end;
$$;

create or replace function public.cancel_public_registration(
  p_account_slug text,
  p_event_slug text,
  p_cancel_token uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  resolved_uuid uuid;
begin
  select public_slug into resolved_uuid
  from public.signup_events
  where account_slug = p_account_slug and event_slug = p_event_slug;

  if resolved_uuid is null then raise exception 'This sign-up link was not found.'; end if;
  return public.cancel_public_registration(resolved_uuid, p_cancel_token);
end;
$$;

revoke all on function public.normalise_signup_link_part(text, text) from public;
revoke all on function public.make_signup_event_slug(text, timestamptz) from public;
revoke all on function public.assign_signup_namespaced_slugs() from public;
revoke all on function public.get_public_signup(text, text) from public;
revoke all on function public.register_public_team(text, text, text, text, text, text) from public;
revoke all on function public.cancel_public_registration(text, text, uuid) from public;

grant execute on function public.get_public_signup(text, text) to anon, authenticated;
grant execute on function public.register_public_team(text, text, text, text, text, text) to anon, authenticated;
grant execute on function public.cancel_public_registration(text, text, uuid) to anon, authenticated;
