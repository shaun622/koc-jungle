# Tournament V1 isolated database contract

The harness refuses non-loopback hosts and database names that do not start with `koc_tournament_test_`. It never reads the app's hosted credentials.

Create a disposable local database, then run:

```powershell
$env:KOC_TOURNAMENT_TEST_DATABASE_URL='postgresql://postgres@127.0.0.1:55432/koc_tournament_test_example'
npm run test:db:tournament
```

The test rebuilds only that disposable database's `public` and `auth` schemas, applies the Tournament V1 migration, and rolls back its contract data.
