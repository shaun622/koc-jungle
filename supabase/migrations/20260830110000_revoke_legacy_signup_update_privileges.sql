-- The RPC-based organiser bundle is live in production. Remove the broad
-- legacy update paths so stale tabs cannot bypass event locking, capacity
-- reconciliation, or compare-and-swap revision checks.

revoke update on table public.signup_registrations from authenticated;
revoke update on table public.signup_events from authenticated;

comment on function public.organizer_save_signup_event(text, text, text, text, timestamptz, timestamptz, integer, bigint, text, text, boolean, uuid, boolean) is
  'Owner-only signup upsert and the sole authenticated write path after the RPC rollout. Pass the last returned capacityRevision as p_base_revision.';
