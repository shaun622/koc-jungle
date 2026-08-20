-- When duplicate historical signup rows exist for the same account/date/title,
-- the one updated most recently owns the clean path. Older rows remain intact
-- under suffixed legacy paths, so registrations are never deleted.
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

  update public.signup_events
  set event_slug = left(base_event_slug, 113) || '-' || left(id::text, 6)
  where account_slug = new.account_slug
    and event_slug = base_event_slug
    and id <> new.id;

  new.event_slug := base_event_slug;
  return new;
end;
$$;

revoke all on function public.assign_signup_namespaced_slugs() from public;
