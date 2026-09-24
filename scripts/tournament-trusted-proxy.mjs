import { createHmac, timingSafeEqual } from 'node:crypto';
import http from 'node:http';

const port = Number(process.env.KOC_TOURNAMENT_PROXY_PORT ?? '55425');
const target = new URL(process.env.KOC_TOURNAMENT_PROXY_TARGET ?? '');
const secret = process.env.KOC_TOURNAMENT_PROXY_SECRET ?? '';
const controlToken = process.env.KOC_TOURNAMENT_PROXY_CONTROL_TOKEN ?? '';
const runId = process.env.KOC_TOURNAMENT_RUN_ID ?? '';
if (target.hostname !== '127.0.0.1' || Number(target.port) !== 55421 || target.protocol !== 'http:' || port !== 55425 || secret.length < 32 || controlToken.length < 32 || !runId) throw new Error('Trusted Tournament proxy requires an owned loopback-only runtime configuration.');

function sameToken(value) {
  const left = Buffer.from(String(value ?? '')); const right = Buffer.from(controlToken);
  return left.length === right.length && timingSafeEqual(left, right);
}

const server = http.createServer(async (request, response) => {
  if (request.url === '/_tournament_harness/health' && request.method === 'GET') {
    response.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
    response.end(JSON.stringify({ kind: 'koc-tournament-trusted-proxy', runId })); return;
  }
  if (request.url === '/_tournament_harness/shutdown' && request.method === 'POST') {
    if (!sameToken(request.headers['x-tournament-harness-control'])) { response.writeHead(403); response.end(); return; }
    response.writeHead(204); response.end(); server.close(); return;
  }
  const incoming = new URL(request.url ?? '/', `http://127.0.0.1:${port}`);
  if (!incoming.pathname.startsWith('/functions/v1/tournament-public')) { response.writeHead(404); response.end(); return; }
  try {
    const chunks = []; for await (const chunk of request) chunks.push(Buffer.from(chunk));
    const headers = new Headers();
    for (const [key, value] of Object.entries(request.headers)) if (value !== undefined && !['host','content-length','x-tournament-client-ip','x-tournament-client-ip-timestamp','x-tournament-client-ip-signature'].includes(key)) headers.set(key, Array.isArray(value) ? value.join(',') : value);
    const timestamp = String(Date.now()); const ip = '127.0.0.1';
    headers.set('x-tournament-client-ip', ip); headers.set('x-tournament-client-ip-timestamp', timestamp);
    headers.set('x-tournament-client-ip-signature', createHmac('sha256', secret).update(`${timestamp}:${ip}`).digest('hex'));
    const upstream = await fetch(new URL(`${incoming.pathname}${incoming.search}`, target), { method: request.method, headers, body: chunks.length ? Buffer.concat(chunks) : undefined });
    const outgoing = Object.fromEntries(upstream.headers.entries()); response.writeHead(upstream.status, outgoing); response.end(Buffer.from(await upstream.arrayBuffer()));
  } catch {
    response.writeHead(502, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); response.end(JSON.stringify({ status: 'rejected', code: 'PROXY_UNAVAILABLE', message: 'Disposable Tournament gateway is unavailable.' }));
  }
});
server.listen({ host: '127.0.0.1', port, exclusive: true });

