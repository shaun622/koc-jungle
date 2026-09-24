export interface TournamentHttpErrorBody {
  status: 'rejected' | 'conflict';
  code: string;
  message: string;
  field?: string;
  currentRevision?: string;
  retryAfter?: number;
}

export class TournamentHttpError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public field?: string,
    public details: Pick<TournamentHttpErrorBody, 'currentRevision' | 'retryAfter'> = {},
  ) { super(message); }
}

export const exactKeys = (value: Record<string, unknown>, allowed: readonly string[], field = 'body') => {
  const unknown = Object.keys(value).filter((key) => !allowed.includes(key));
  if (unknown.length) throw new TournamentHttpError(400, 'UNKNOWN_FIELD', `${field}.${unknown[0]} is not supported.`, `${field}.${unknown[0]}`);
};

export const objectBody = (value: unknown, field = 'body'): Record<string, unknown> => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TournamentHttpError(400, 'BODY_SHAPE', `${field} must be an object.`, field);
  return value as Record<string, unknown>;
};

export async function readJsonBytes(request: Request, maximumBytes: number): Promise<unknown> {
  const reader = request.body?.getReader();
  if (!reader) throw new TournamentHttpError(400, 'BODY_REQUIRED', 'A JSON body is required.');
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maximumBytes) {
      await reader.cancel('body too large').catch(() => undefined);
      throw new TournamentHttpError(413, 'BODY_TOO_LARGE', `Request body exceeds ${maximumBytes} bytes.`);
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  let text: string;
  try { text = new TextDecoder('utf-8', { fatal: true }).decode(bytes); }
  catch { throw new TournamentHttpError(400, 'BAD_UTF8', 'Request body must be valid UTF-8.'); }
  try { return JSON.parse(text); }
  catch { throw new TournamentHttpError(400, 'BAD_JSON', 'Request body must be valid JSON.'); }
}

export function corsHeaders(request: Request, env: (name: string) => string | undefined): Headers {
  const headers = new Headers({
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'Access-Control-Allow-Headers': 'authorization,apikey,content-type,x-client-info,x-tournament-capability,x-tournament-client-ip,x-tournament-client-ip-signature,x-tournament-client-ip-timestamp',
    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
    'Access-Control-Expose-Headers': 'Retry-After',
    'Vary': 'Origin',
  });
  const origin = request.headers.get('origin');
  const configured = (env('TOURNAMENT_ALLOWED_ORIGINS') ?? '').split(',').map((value) => value.trim()).filter(Boolean);
  const allowed = new Set(configured);
  if (env('TOURNAMENT_LOCAL_TEST_MODE') === 'true') {
    allowed.add('http://127.0.0.1:4186'); allowed.add('http://127.0.0.1:4187');
  }
  if (origin && allowed.has(origin)) headers.set('Access-Control-Allow-Origin', origin);
  return headers;
}

export function jsonReply(request: Request, env: (name: string) => string | undefined, body: unknown, status = 200, extra: Record<string, string> = {}): Response {
  const headers = corsHeaders(request, env);
  for (const [key, value] of Object.entries(extra)) headers.set(key, value);
  return new Response(status === 204 ? null : JSON.stringify(body), { status, headers });
}

export function errorReply(request: Request, env: (name: string) => string | undefined, error: unknown): Response {
  if (error instanceof TournamentHttpError) {
    const body: TournamentHttpErrorBody = { status: error.status === 409 ? 'conflict' : 'rejected', code: error.code, message: error.message, ...(error.field ? { field: error.field } : {}), ...error.details };
    return jsonReply(request, env, body, error.status, error.details.retryAfter ? { 'Retry-After': String(error.details.retryAfter) } : {});
  }
  const typed = error as { code?: string; field?: string; message?: string };
  if (typed?.code && typeof typed.code === 'string') return jsonReply(request, env, { status: 'rejected', code: typed.code, message: typed.message ?? 'Tournament request was rejected.', ...(typed.field ? { field: typed.field } : {}) }, 400);
  return jsonReply(request, env, { status: 'rejected', code: 'INTERNAL', message: 'Tournament service could not complete the request.' }, 500);
}

export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value as Record<string, unknown>).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson((value as Record<string, unknown>)[key])}`).join(',')}}`;
  return JSON.stringify(value);
}

const hex = (bytes: ArrayBuffer) => [...new Uint8Array(bytes)].map((byte) => byte.toString(16).padStart(2, '0')).join('');

export async function hmacHex(secret: string, value: unknown): Promise<string> {
  if (!secret) throw new TournamentHttpError(503, 'IDEMPOTENCY_UNAVAILABLE', 'Tournament idempotency service is unavailable.');
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return hex(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(typeof value === 'string' ? value : canonicalJson(value))));
}

export async function sha256Hex(value: string): Promise<string> {
  return hex(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)));
}

export function requireUuid(value: unknown, field: string): string {
  if (typeof value !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)) throw new TournamentHttpError(400, 'UUID_REQUIRED', `${field} must be a UUID.`, field);
  return value;
}

export function requireDecimal(value: unknown, field: string): string {
  if (typeof value !== 'string' || !/^(0|[1-9][0-9]*)$/.test(value) || BigInt(value) > 9223372036854775807n) throw new TournamentHttpError(400, 'DECIMAL_REQUIRED', `${field} must be a canonical signed-bigint decimal.`, field);
  return value;
}
