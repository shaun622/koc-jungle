-- Old UUID and single-slug links resolve to the event as before, but now also
-- return the canonical account/event namespace so the app can replace the URL.
create or replace function public.get_public_signup(p_share_slug text)
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
  where friendly_slug = p_share_slug or public_slug::text = p_share_slug
  limit 1;

  if not found then return null; end if;
  result := public.get_public_signup(signup.public_slug);
  result := jsonb_set(result, '{event,publicSlug}', to_jsonb(signup.friendly_slug), true);
  result := jsonb_set(result, '{event,accountSlug}', to_jsonb(signup.account_slug), true);
  result := jsonb_set(result, '{event,eventSlug}', to_jsonb(signup.event_slug), true);
  return result;
end;
$$;

revoke all on function public.get_public_signup(text) from public;
grant execute on function public.get_public_signup(text) to anon, authenticated;
