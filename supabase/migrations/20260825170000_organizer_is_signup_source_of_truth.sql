-- The public link is for registration only. Once registered, roster changes
-- are controlled by the authenticated organiser so the tournament and public
-- list cannot drift apart through an old private cancellation link.

revoke execute on function public.cancel_public_registration(uuid, uuid) from anon, authenticated;
revoke execute on function public.cancel_public_registration(text, uuid) from anon, authenticated;
revoke execute on function public.cancel_public_registration(text, text, uuid) from anon, authenticated;
