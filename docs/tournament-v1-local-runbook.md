# Tournament v1 local-only runbook

This runbook is for the disposable Tournament acceptance environment only. It never links to Supabase Cloud and refuses non-loopback targets.

## Prerequisites

- Windows host with Node/npm dependencies already installed.
- Docker Desktop with a working Linux container daemon.
- Microsoft Edge available to Playwright.
- Ports `55420`–`55425`, `55432`, `4186` and `4187` free.

The Supabase CLI version is pinned by `scripts/tournament-local-runtime.mjs` (`2.45.5`) and runs through `npx`. Do not copy `.env.production`, hosted project keys or customer data into this runtime.

## Prepare and start

From `work/koc-multi-event`:

```powershell
npm run test:isolation:tournament
npm run local:tournament -- --prepare
npm run local:tournament -- --start
```

The generated project lives only at:

```text
outputs/tournament-local-runtime
```

relative to the workspace root. Its manifest records the exact run ID, project ID, ports and owned paths. Runtime secrets and synthetic owner credentials are stored in ignored private files and are never printed.

The start command:

1. refuses inherited non-loopback backend environment variables;
2. checks every fixed port without stopping another process;
3. verifies Docker and the pinned CLI;
4. starts the allowlisted local schema/migrations/functions;
5. creates two synthetic confirmed owners;
6. starts the loopback-only signed trusted-IP proxy on `127.0.0.1:55425`;
7. writes the isolated Vite environment with Tournament creation enabled only there; and
8. imports/smokes both Tournament Edge entrypoints.

If Docker is absent, startup stops after safe preparation. Do not substitute production.

## Retrieve synthetic credentials without logging them

The durable browser runner reads credentials itself. Humans normally do not need them. If manual inspection is required, open this file locally in an editor and do not paste it into chat, screenshots, shell history or evidence:

```text
outputs/tournament-local-runtime/.private/runtime.json
```

Use only the `syntheticUsers` records. Never print the file with `Get-Content`, `type`, logging, CI output or terminal capture.

## Validation commands

```powershell
npm run test:tournament
npm test
npm run typecheck
npm run build
npm run test:db:tournament
npm run test:edge:tournament
npm run rehearse:tournament:durable
npm run test:performance:tournament
npm run test:isolation:tournament
```

- V5 (`test:db:tournament`) is separate SQL-only evidence. It requires `KOC_TOURNAMENT_TEST_DATABASE_URL` whose literal host is loopback and database name starts `koc_tournament_test_`. Never point it at the full local Auth stack or any hosted database.
- V6 uses real local Auth/gateway/Edge/RPC and the signed public proxy.
- V7 builds the isolated PWA, launches fresh Edge contexts, signs in synthetic users, creates/imports/publishes/runs a Tournament, exercises public signup, offline IndexedDB recovery, a second device, responsive themes and TV privacy.
- V8 writes nonsecret benchmark evidence to `outputs/tournament-completion-evidence/`.

The lightweight `npm run rehearse:tournament` remains a demo-only frontend smoke and is not V7/backend/security evidence.

## Manual preview

After the disposable stack is running, build and preview with the isolated config:

```powershell
node node_modules/vite/bin/vite.js build --config vite.tournament-test.config.ts
node node_modules/vite/bin/vite.js preview --config vite.tournament-test.config.ts --host 127.0.0.1 --port 4187 --strictPort
```

Open `http://127.0.0.1:4187/#/home` in a fresh browser profile. Keep all traffic on `127.0.0.1`; public Tournament requests are intentionally routed through `55425`, while owner requests use the local API at `55421`.

## Stop and reset safely

Stop preserves generated files and synthetic data:

```powershell
npm run local:tournament -- --stop
```

Reset deletes only the exact manifest-owned disposable runtime after verifying its parent, marker, project ID and absence of reparse points:

```powershell
npm run local:tournament -- --reset --confirm-disposable
```

Never manually broaden that deletion target. If any path check, lock or deletion fails, stop and inspect; do not retry with a stronger command.

## Recovery and evidence rules

- A failed V6/V7 run retains the disposable stack and evidence for diagnosis.
- Unknown network outcomes retry the exact immutable request; do not invent a new command ID.
- Restore creates a new unlinked Tournament identity and never copies device authority.
- Physical iPad/AirPlay observations belong in `outputs/tournament-completion-evidence/physical-device-checklist.md` and cannot be replaced by emulation.
- Hosted migration/deployment/feature enablement and App Store work require separate explicit authorisation.
