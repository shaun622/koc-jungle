import type { TournamentGrantRequest } from './tournament/index.ts';
import { TournamentHttpError, hmacHex, sha256Hex } from './tournamentHttp.ts';

type Environment = (name: string) => string | undefined;

export function currentAuthorityKeyVersion(env: Environment): number {
  const version = Number(env('TOURNAMENT_AUTHORITY_KEY_VERSION') ?? '');
  if (!Number.isSafeInteger(version) || version < 1 || !env('TOURNAMENT_AUTHORITY_SECRET')) throw new TournamentHttpError(503, 'AUTHORITY_UNAVAILABLE', 'Tournament controller service is unavailable.');
  return version;
}

export function authoritySecret(env: Environment, version: number): string {
  const current = currentAuthorityKeyVersion(env);
  if (version === current) return env('TOURNAMENT_AUTHORITY_SECRET')!;
  let retained: Record<string, string> = {};
  try { retained = JSON.parse(env('TOURNAMENT_AUTHORITY_RETAINED_KEYS') ?? '{}'); } catch { /* unavailable below */ }
  const secret = retained[String(version)];
  if (!secret) throw new TournamentHttpError(503, 'AUTHORITY_KEY_UNAVAILABLE', 'Controller recovery key is unavailable.');
  return secret;
}

export async function deriveAuthorityMaterial(
  env: Environment,
  input: { ownerId: string; request: TournamentGrantRequest; claimId: string; grantedEpoch: string; keyVersion?: number },
): Promise<{ nonceHash: string; capability: string; capabilityHash: string; keyVersion: number }> {
  const keyVersion = input.keyVersion ?? currentAuthorityKeyVersion(env);
  const secret = authoritySecret(env, keyVersion);
  const nonceHash = await sha256Hex(input.request.nonce);
  const capability = await hmacHex(secret, { ownerId: input.ownerId, tournamentId: input.request.tournamentId, deviceId: input.request.deviceId, claimId: input.claimId, grantedEpoch: input.grantedEpoch, nonceHash });
  return { nonceHash, capability, capabilityHash: await sha256Hex(capability), keyVersion };
}
