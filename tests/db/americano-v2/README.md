# Americano v2 isolated database tests

Set `KOC_TEST_DATABASE_URL` to a disposable loopback PostgreSQL database whose name starts with `koc_americano_test_`, then run `npm run test:db:americano`.

The runner deliberately has no `.env` or Supabase-project fallback. It rejects non-loopback hosts and unexpected database names before invoking `psql`. Production and linked Supabase projects must never be used.
