import { supabase, supabaseAnonKey, supabaseUrl } from '@/lib/supabase';
import type { TournamentGrantRequest, TournamentReleaseRequest, TournamentV1 } from '@/logic/tournament';

export interface TournamentServiceError {
  status: 'rejected' | 'conflict';
  code: string;
  message: string;
  field?: string;
  currentRevision?: string;
  retryAfter?: number;
}

export interface TournamentListCard {
  tournamentId: string;
  revision: string;
  lifecycle: TournamentV1['lifecycle'];
  title: string;
  venue: string;
  startsAt: string | null;
  archivedAt: string | null;
  updatedAt: string;
}

export type TournamentOwnerReply<T = Record<string, unknown>> =
  | ({ status: 'applied' } & T)
  | ({ status: 'replayed' } & T)
  | TournamentServiceError;

async function ownerRequest<T>(body: Record<string, unknown>, capability?: string): Promise<TournamentOwnerReply<T>> {
  if (!supabase || !supabaseUrl || !supabaseAnonKey) return { status: 'rejected', code: 'CLOUD_NOT_CONFIGURED', message: 'Tournament cloud service is not configured.' };
  const { data: sessionData } = await supabase.auth.getSession();
  const token = sessionData.session?.access_token;
  if (!token) return { status: 'rejected', code: 'AUTH_REQUIRED', message: 'Sign in to manage this tournament.' };
  const controller = new AbortController(); const timeout = globalThis.setTimeout(() => controller.abort(), 12_000);
  try {
    const response = await fetch(`${supabaseUrl}/functions/v1/tournament-owner`, {
      method: 'POST', signal: controller.signal,
      headers: { apikey: supabaseAnonKey, Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...(capability ? { 'x-tournament-capability': capability } : {}) },
      body: JSON.stringify(body),
    });
    let parsed: unknown;
    try { parsed = await response.json(); } catch { parsed = null; }
    if (!parsed || typeof parsed !== 'object') return { status: 'rejected', code: 'BAD_RESPONSE', message: 'Tournament service returned an unreadable response.' };
    return parsed as TournamentOwnerReply<T>;
  } catch (error) {
    return { status: 'rejected', code: error instanceof DOMException && error.name === 'AbortError' ? 'TIMEOUT' : 'NETWORK', message: 'Tournament outcome is unknown. Retry the exact request.' };
  } finally { globalThis.clearTimeout(timeout); }
}

export const tournamentOwnerService = {
  request: ownerRequest,
  create: (request: { operationId: string; tournamentId: string; title: string; courtCount: number; timeZone: string }) => ownerRequest<{ snapshot: TournamentV1 }>({ action: 'create', ...request }),
  importCopy: (request: { operationId: string; tournamentId: string; snapshot: TournamentV1; contacts: Record<string, string> }) => ownerRequest<{ snapshot: TournamentV1; contacts: Record<string, string> }>({ action: 'import-copy', ...request }),
  list: (request: { limit?: number; cursor?: string; archived?: boolean } = {}) => ownerRequest<{ tournaments: TournamentListCard[]; nextCursor: string | null }>({ action: 'list', ...request }),
  get: (tournamentId: string) => ownerRequest<{ snapshot: TournamentV1; contacts: Record<string, string>; revision: string; requiresTakeover?: boolean }>({ action: 'get', tournamentId }),
  receipts: (tournamentId: string, commandIds: string[]) => ownerRequest<{ receipts: Array<{ commandId: string; resultingRevision: string; kind?: string; acceptedAt?: string }> }>({ action: 'receipts', tournamentId, commandIds }),
  delete: (request: { operationId: string; tournamentId: string }) => ownerRequest<{ result: { tournamentId: string; deleted: boolean } }>({ action: 'delete', ...request }),
  grant: (request: TournamentGrantRequest) => ownerRequest<{ capability: string; snapshot?: TournamentV1; result: { grantedEpoch: string; resultingRevision: string; claimId: string } }>({ action: request.action, request }),
  release: (request: TournamentReleaseRequest, capability: string) => ownerRequest<{ snapshot?: TournamentV1; result: { resultingRevision: string; epoch: string } }>({ action: 'release', request }, capability),
};
