-- Explicit access for application tables created before 2026-10-30.
-- Forward-only: historical migrations, RLS policies, column grants and RPC ACLs
-- remain unchanged. Fresh databases no longer inherit these rights automatically.
-- Grant only authenticated operations already admitted by the final RLS policies.
-- Existing explicit service-role grant sets are deliberately left alone.
-- No anonymous access or project-wide default privileges are added.

begin;

-- Client access remains constrained by the existing RLS policies.
grant select, insert, update on table public.events to authenticated;

-- Server access for legacy tables that previously depended entirely on defaults.
grant select, insert, update, delete on table public.event_tombstones to service_role;
grant select, insert, update, delete on table public.event_v2_requests to service_role;
grant select, insert, update, delete on table public.events to service_role;
grant select, insert, update, delete on table public.signup_events to service_role;
grant select, insert, update, delete on table public.signup_promotion_notices to service_role;
grant select, insert, update, delete on table public.signup_public_requests to service_role;
grant select, insert, update, delete on table public.signup_registrations to service_role;
grant select, insert, update, delete on table public.signup_templates to service_role;
-- Tournament is not installed on the active Americano-only project. Do not
-- require that optional feature just to make existing event sync portable.
-- Its Edge endpoints read these two tables; all mutations remain in RPCs.
-- An operator releasing Tournament later must rerun this migration after it.
do $tournament_reads$
begin
  if to_regclass('public.tournaments_v1') is not null then
    grant select on table public.tournaments_v1 to service_role;
  end if;
  if to_regclass('public.tournament_public_v1') is not null then
    grant select on table public.tournament_public_v1 to service_role;
  end if;
end;
$tournament_reads$;

commit;
