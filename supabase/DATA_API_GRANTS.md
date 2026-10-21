# Explicit Data API table grants

Supabase stops adding automatic Data API privileges to new public tables on **30 October 2026**. Existing table ACLs survive, but a fresh database recreates those tables and needs the permissions in source. [Platform announcement](https://github.com/orgs/supabase/discussions/45329).

The active project has eight public tables and does not yet contain the optional Tournament tables present in source. The new migration repairs the existing event/signup schema without requiring that feature. Its optional Tournament block grants only the SELECT access used by the Edge endpoints when those tables exist.

For a fresh project, apply supabase/schema.sql, then migrations in filename order. The final grants migration is required; schema.sql alone is not the full bootstrap. If Tournament is installed later through manual SQL, rerun the grants migration after the Tournament migrations. Do not deploy an optional feature merely to apply this repair. Event DELETE remains RPC-only, tombstones remain read-only for clients, and public signup remains behind RPCs.

## Scope

The forward migration adds explicit per-table grants that were previously supplied by platform defaults. Authenticated privileges are limited to operations covered by the final RLS policies; existing explicit service-role grant sets are preserved. It does not add anonymous access, alter default privileges, change RLS, replace column restrictions, change RPC ACLs or touch customer records. Reapplying the migration is safe.

## Verification

Run after all applicable migrations on a disposable database:

```sh
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/tests/data_api_grants_verify.sql
```

The verification checks representative application permissions, RLS, protected internal tables, and actual zero-row queries under the authenticated role. Rehearse both an existing-project upgrade and a fresh database without automatic public-table CRUD grants. Reapplying the grants must leave the ACLs unchanged.

Portable PostgreSQL validation passed the new permission assertions in both modes and compared every public-table ACL, column grant and policy with the old baseline. RLS and column restrictions were unchanged; existing-project table ACLs were unchanged. The portable runtime stubs Auth/Storage catalog objects and does not replace PostgREST, GoTrue, Storage API or live application testing.

## Future tables

Put explicit minimum grants, RLS and policies in the same migration that creates each public table. Choose authenticated and service-role rights from actual callers. Add anonymous access only for a deliberate public table API. Do not restore project-wide automatic defaults or blanket-grant every table.
