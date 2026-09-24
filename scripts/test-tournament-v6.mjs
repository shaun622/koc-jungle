import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runSmoke } from '../tests/edge/tournament-v1/smoke.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const privatePath = resolve(root, '../../outputs/tournament-local-runtime/.private/runtime.json');
if (!existsSync(privatePath)) throw new Error('V6 requires the isolated Tournament runtime. Run npm run tournament:local:start first.');
const runtime = JSON.parse(await readFile(privatePath, 'utf8'));
const runtimeApiUrl = runtime.values?.api_url ?? runtime.values?.API_URL;
if (typeof runtimeApiUrl !== 'string' || !runtimeApiUrl) throw new Error('V6 requires a started disposable Tournament backend. Run npm run local:tournament -- --start after Docker is available.');
const apiUrl = new URL(runtimeApiUrl);
if (apiUrl.hostname !== '127.0.0.1' || Number(apiUrl.port) !== 55421) throw new Error('V6 refuses a nonloopback or unexpected Tournament backend.');
await runSmoke(runtime);
process.stdout.write('Tournament V6 incremental Auth/Edge smoke passed.\n');
