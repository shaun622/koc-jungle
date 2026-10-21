# Supabase migrations

New public tables need explicit per-role grants in their creation migration, together with RLS and policies. Supabase no longer supplies automatic Data API table grants from 30 October 2026. Grant only required operations; public signup should continue through the existing RPCs rather than anonymous table access.

Keep event deletion behind its existing RPC and preserve read-only tombstones and server-only Tournament command tables. Use forward migrations, including the grants migration after the schema bootstrap and earlier migrations. See `supabase/DATA_API_GRANTS.md` for verification.
