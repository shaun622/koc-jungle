-- Human-readable public links while retaining the original UUID links.
-- Example: /signup/24-aug-2026-monday-high-silver-koc

alter table public.signup_events
  add column if not exists friendly_slug text;

create or replace function public.make_signup_friendly_slug(
  p_title text,
  p_starts_at timestamptz,
  p_id uuid
)
returns text
language plpgsql
stable
set search_path = public, pg_temp
as $$
declare
  date_slug text;
  title_slug text;
  base_slug text;
  candidate text;
begin
  date_slug := case
    when p_starts_at is null then 'date-tbc'
    else lower(to_char(p_starts_at at time zone 'Asia/Singapore', 'DD-Mon-YYYY'))
  end;
  title_slug := trim(both '-' from regexp_replace(lower(coalesce(p_title, 'event')), '[^a-z0-9]+', '-', 'g'));
  if title_slug = '' then title_slug := 'event'; end if;

  base_slug := trim(both '-' from left(date_slug || '-' || title_slug, 100));
  candidate := base_slug;

  if exists (
    select 1 from public.signup_events
    where friendly_slug = candidate and id <> p_id
  ) then
    candidate := left(base_slug, 93) || '-' || left(p_id::text, 6);
  end if;

  return candidate;
end;
$$;

create or replace function public.assign_signup_friendly_slug()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  new.friendly_slug := public.make_signup_friendly_slug(new.title, new.starts_at, new.id);
  return new;
end;
$$;

drop trigger if exists signup_events_friendly_slug on public.signup_events;
create trigger signup_events_friendly_slug
before insert or update of title, starts_at on public.signup_events
for each row execute function public.assign_signup_friendly_slug();

-- Backfill all existing events, including the link already shared by the
-- organiser. A short UUID suffix is only used when two events would otherwise
-- have the same date-and-title link.
with slug_candidates as (
  select
    id,
    public.make_signup_friendly_slug(title, starts_at, id) as base_slug
  from public.signup_events
  where friendly_slug is null
), ranked_slugs as (
  select
    id,
    base_slug,
    row_number() over (partition by base_slug order by id) as duplicate_number
  from slug_candidates
)
update public.signup_events as event
set friendly_slug = case
  when ranked.duplicate_number = 1 then ranked.base_slug
  else left(ranked.base_slug, 93) || '-' || left(event.id::text, 6)
end
from ranked_slugs as ranked
where event.id = ranked.id;

alter table public.signup_events
  alter column friendly_slug set not null;

create unique index if not exists signup_events_friendly_slug_idx
  on public.signup_events (friendly_slug);

-- New RPC argument names let the current UUID-based app keep working during
-- rollout while the updated app can pass either the friendly slug or old UUID.
create or replace function public.get_public_signup(p_share_slug text)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  resolved_uuid uuid;
  resolved_friendly_slug text;
  result jsonb;
begin
  select public_slug, friendly_slug into resolved_uuid, resolved_friendly_slug
  from public.signup_events
  where friendly_slug = p_share_slug or public_slug::text = p_share_slug
  limit 1;

  if resolved_uuid is null then return null; end if;
  result := public.get_public_signup(resolved_uuid);
  return jsonb_set(result, '{event,publicSlug}', to_jsonb(resolved_friendly_slug), true);
end;
$$;

create or replace function public.register_public_team(
  p_share_slug text,
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
  where friendly_slug = p_share_slug or public_slug::text = p_share_slug
  limit 1;

  if resolved_uuid is null then raise exception 'This sign-up link was not found.'; end if;
  return public.register_public_team(
    resolved_uuid, p_team_name, p_player_one, p_player_two, p_contact
  );
end;
$$;

create or replace function public.cancel_public_registration(
  p_share_slug text,
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
  where friendly_slug = p_share_slug or public_slug::text = p_share_slug
  limit 1;

  if resolved_uuid is null then raise exception 'This sign-up link was not found.'; end if;
  return public.cancel_public_registration(resolved_uuid, p_cancel_token);
end;
$$;

revoke all on function public.make_signup_friendly_slug(text, timestamptz, uuid) from public;
revoke all on function public.assign_signup_friendly_slug() from public;
revoke all on function public.get_public_signup(text) from public;
revoke all on function public.register_public_team(text, text, text, text, text) from public;
revoke all on function public.cancel_public_registration(text, uuid) from public;

grant execute on function public.get_public_signup(text) to anon, authenticated;
grant execute on function public.register_public_team(text, text, text, text, text) to anon, authenticated;
grant execute on function public.cancel_public_registration(text, uuid) to anon, authenticated;
