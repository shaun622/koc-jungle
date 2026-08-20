-- Always return the human-readable canonical slug, including when an old UUID
-- link was used to find the event.
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

revoke all on function public.get_public_signup(text) from public;
grant execute on function public.get_public_signup(text) to anon, authenticated;
