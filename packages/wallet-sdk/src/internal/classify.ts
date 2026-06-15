import {
  ConcurrencyError,
  DomainError,
  NotFoundError,
  SdkError,
} from '../errors';

/**
 * Extracts a human-readable message from an unknown thrown value.
 */
function extractMessage(error: unknown): string {
  if (typeof error === 'string') return error;
  if (error instanceof Error) return error.message;
  return 'Unknown error';
}

/**
 * Returns true for network/fetch errors: `TypeError` whose message contains
 * "fetch" or "network", or anything with `name === 'NetworkError'`.
 */
function isNetworkError(error: unknown): boolean {
  if (error instanceof TypeError) {
    const msg = error.message.toLowerCase();
    return msg.includes('fetch') || msg.includes('network');
  }
  if (error !== null && typeof error === 'object' && 'name' in error) {
    return (error as { name: unknown }).name === 'NetworkError';
  }
  return false;
}

/**
 * Normalizes any thrown value to an `SdkError` subtype.
 *
 * Mapping:
 * - Existing `SdkError` → returned unchanged (pass-through)
 * - Postgrest unique-violation (`code === '23505'`) → `DomainError / UNIQUE_CONSTRAINT`
 * - Postgres RPC concurrency hint (`hint === 'CONCURRENCY_ERROR'`) → `ConcurrencyError / CONCURRENCY_ERROR`
 * - PostgREST no-rows (`code === 'PGRST116'`) → `NotFoundError / NOT_FOUND`
 * - Network / fetch failure → `SdkError / NETWORK_ERROR`
 * - Anything else → `SdkError / UNKNOWN`
 */
export function classify(error: unknown): SdkError {
  // Pass through already-classified errors.
  if (error instanceof SdkError) return error;

  const msg = extractMessage(error);

  // Postgrest / Postgres error shapes carry `code` and/or `hint`.
  if (error !== null && typeof error === 'object') {
    const e = error as Record<string, unknown>;

    if (e['code'] === '23505') return new DomainError(msg, 'UNIQUE_CONSTRAINT');
    if (e['hint'] === 'CONCURRENCY_ERROR')
      return new ConcurrencyError(msg, 'CONCURRENCY_ERROR');
    if (e['code'] === 'PGRST116') return new NotFoundError(msg, 'NOT_FOUND');
  }

  if (isNetworkError(error)) return new SdkError(msg, 'NETWORK_ERROR');

  return new SdkError(msg, 'UNKNOWN');
}
