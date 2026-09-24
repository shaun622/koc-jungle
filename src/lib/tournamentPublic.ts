import { TOURNAMENT_CONTRACT_VERSION, type TournamentPublicProjection } from '@/logic/tournament';

const serviceUrl = (slug: string) => {
  const base = String(import.meta.env.VITE_TOURNAMENT_PUBLIC_ORIGIN ?? import.meta.env.VITE_SUPABASE_URL ?? '').replace(/\/$/, '');
  return base ? `${base}/functions/v1/tournament-public?slug=${encodeURIComponent(slug)}` : '';
};

function headers(): HeadersInit {
  const anon = String(import.meta.env.VITE_SUPABASE_ANON_KEY ?? '');
  return { apikey: anon, Authorization: `Bearer ${anon}`, 'Content-Type': 'application/json' };
}

export class TournamentPublicError extends Error {
  constructor(public code: string, message: string, public retryAfter?: number) { super(message); this.name = 'TournamentPublicError'; }
}

async function boundedFetch(url: string, init: RequestInit, timeoutMs = 12_000): Promise<Response> {
  const controller = new AbortController();
  const timeout = globalThis.setTimeout(() => controller.abort(), timeoutMs);
  try { return await fetch(url, { ...init, signal: controller.signal }); }
  catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') throw new TournamentPublicError('TIMEOUT', 'The request took too long. Retry without changing your details.');
    throw new TournamentPublicError('NETWORK', 'The tournament service could not be reached. Retry without changing your details.');
  } finally { globalThis.clearTimeout(timeout); }
}

async function responseJson(response: Response): Promise<Record<string, unknown>> {
  let data: unknown;
  try { data = await response.json(); } catch { throw new TournamentPublicError('BAD_RESPONSE', 'The tournament service returned an unreadable response.'); }
  if (!data || typeof data !== 'object' || Array.isArray(data)) throw new TournamentPublicError('BAD_RESPONSE', 'The tournament service returned an unreadable response.');
  const body = data as Record<string, unknown>;
  if (!response.ok) {
    const code = typeof body.code === 'string' ? body.code : `HTTP_${response.status}`;
    const message = typeof body.message === 'string' ? body.message : response.status === 404 ? 'Tournament not found.' : 'The tournament request failed.';
    throw new TournamentPublicError(code, message, typeof body.retryAfter === 'number' ? body.retryAfter : undefined);
  }
  return body;
}

export async function loadPublicTournament(slug: string): Promise<{ projection: TournamentPublicProjection; revision: string; updatedAt: string }> {
  const url = serviceUrl(slug);
  if (!url) throw new TournamentPublicError('NOT_CONFIGURED', 'Hosted tournament service is not configured.');
  return await responseJson(await boundedFetch(url, { method: 'GET', headers: headers(), cache: 'no-store' })) as unknown as { projection: TournamentPublicProjection; revision: string; updatedAt: string };
}

export interface PublicPairSubmission {
  commandId: string;
  tournamentId: string;
  divisionId: string;
  teamName: string;
  playerOne: string;
  playerTwo: string;
  contact: string;
}

export async function submitPublicTournamentPair(slug: string, submission: PublicPairSubmission): Promise<{ status: string; result?: { entryId?: string; admission?: string }; admission?: string; code?: string; message?: string }> {
  const url = serviceUrl(slug);
  if (!url) throw new TournamentPublicError('NOT_CONFIGURED', 'Hosted tournament service is not configured.');
  return await responseJson(await boundedFetch(url, { method: 'POST', headers: headers(), body: JSON.stringify({ contractVersion: TOURNAMENT_CONTRACT_VERSION, ...submission }) })) as { status: string; result?: { entryId?: string; admission?: string }; admission?: string; code?: string; message?: string };
}
