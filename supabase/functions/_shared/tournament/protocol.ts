import { invariant } from './errors';

export const MAX_SIGNED_BIGINT_DECIMAL = 9_223_372_036_854_775_807n;
export const TOURNAMENT_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export const TOURNAMENT_DOMAIN_ID = /^[A-Za-z0-9_-]{1,160}$/;
export const TOURNAMENT_ISO_INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/;

export function validateDecimal(value: unknown, field: string): asserts value is string {
  invariant(typeof value === 'string' && /^(?:0|[1-9]\d*)$/.test(value), 'BIGINT', `${field} must be a canonical non-negative decimal string.`, field);
  invariant(BigInt(value) <= MAX_SIGNED_BIGINT_DECIMAL, 'BIGINT_RANGE', `${field} exceeds signed bigint range.`, field);
}

export function validateUuid(value: unknown, field: string): asserts value is string {
  invariant(typeof value === 'string' && TOURNAMENT_UUID.test(value), 'UUID', `${field} must be a UUID.`, field);
}

export function validateDomainId(value: unknown, field: string): asserts value is string {
  invariant(typeof value === 'string' && TOURNAMENT_DOMAIN_ID.test(value), 'DOMAIN_ID', `${field} must contain only letters, numbers, underscore or hyphen and be at most 160 characters.`, field);
}

export function validateEpochMillis(value: unknown, field: string): asserts value is number {
  invariant(typeof value === 'number' && Number.isSafeInteger(value) && value >= 0, 'EPOCH_MILLIS', `${field} must be a non-negative safe epoch-millisecond integer.`, field);
}

export function validateIsoInstant(value: unknown, field: string): asserts value is string {
  invariant(typeof value === 'string' && TOURNAMENT_ISO_INSTANT.test(value) && Number.isFinite(Date.parse(value)), 'ISO_INSTANT', `${field} must be an ISO-8601 instant with Z or an explicit offset.`, field);
}
