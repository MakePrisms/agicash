/**
 * Error classifier — §12 of the contract (the locked 4-bucket seam).
 *
 * `classify(err)` is a PURE function returning a bare 4-bucket string union
 * (gudnuf's no-repair-hints ruling: NO repair hints, services handle the
 * specifics). It is consumed by BOTH the SDK `executeQuote` orchestrator AND
 * (later) the web hooks. The orchestrator maps the verdict onto its error model:
 *
 * | verdict            | meaning                                   | orchestrator action          |
 * | ------------------ | ----------------------------------------- | ---------------------------- |
 * | `transient`        | stale / in-flight / connectivity          | retry / recover (→ `ConcurrencyError`) |
 * | `permanent`        | the mint/peer rejected it; never succeeds | surface (→ `DomainError`)    |
 * | `already-resolved` | the operation already happened            | no-op (reconcile via restore) |
 * | `unhandled`        | not recognised                            | propagate                    |
 *
 * GROUNDING. The mapping ports master's hook-resident branching, which gates retry
 * purely on `error instanceof MintOperationError` (a mint-emitted protocol error →
 * no retry, fail the quote) vs everything else (→ retry up to 3×). See
 * `app/features/send/cashu-send-quote-hooks.ts` (~L331) +
 * `app/features/receive/cashu-receive-quote-hooks.ts` (~L704). This function refines
 * that binary into the 4 buckets using the NUT `code` carried on `MintOperationError`:
 *   - in-flight-elsewhere codes (OUTPUTS/PROOFS pending — #1115 mapped 11004/11002
 *     → transient) become `transient` (a parallel op holds them; retry/recover);
 *   - already-happened codes (already-spent / already-issued / already-paid /
 *     output-already-signed) become `already-resolved` (recovery = restore, no-op);
 *   - every other mint rejection stays `permanent`.
 * cashu-ts `NetworkError` and bare `HttpResponseError` (e.g. 429 / 5xx — the master
 * receive hook treats 429 as retryable) are connectivity/transport → `transient`.
 *
 * @module
 */
import {
  HttpResponseError,
  MintOperationError,
  NetworkError,
} from '@cashu/cashu-ts';
import { ConcurrencyError, DomainError, NotFoundError } from './errors';
import { CashuErrorCodes } from './internal/cashu-error-codes';

/**
 * The four buckets every error collapses into. Bare strings — no repair hints
 * (a verdict, not an instruction). The caller/orchestrator owns the response.
 */
export type ErrorClass =
  | 'transient'
  | 'permanent'
  | 'already-resolved'
  | 'unhandled';

/**
 * Mint NUT codes meaning "a parallel operation currently holds these proofs/outputs".
 * The work has NOT completed — retrying (or recovering via `restore`) is correct.
 * #1115 mapped 11004 / 11002 → transient; kept consistent here.
 */
const TRANSIENT_MINT_CODES: ReadonlySet<number> = new Set([
  CashuErrorCodes.OUTPUTS_ARE_PENDING, // 11004
  CashuErrorCodes.PROOFS_ARE_PENDING, // 11002
  CashuErrorCodes.QUOTE_PENDING, // 20005 — quote still settling
]);

/**
 * Mint NUT codes meaning "this already happened" — the desired end-state is reached,
 * so recovery is a no-op (reconcile local state via `wallet.restore` / idempotent
 * re-fetch). These must NOT be retried (the second attempt would error) and must NOT
 * be surfaced as a user-facing failure.
 */
const ALREADY_RESOLVED_MINT_CODES: ReadonlySet<number> = new Set([
  CashuErrorCodes.TOKEN_ALREADY_SPENT, // 11001
  CashuErrorCodes.OUTPUT_ALREADY_SIGNED, // 11003
  CashuErrorCodes.QUOTE_ALREADY_ISSUED, // 20002
  CashuErrorCodes.INVOICE_ALREADY_PAID, // 20006
]);

/**
 * Classify an arbitrary thrown value into one of the four recovery buckets.
 *
 * PURE: no side effects, no I/O, no logging — safe to call from anywhere (orchestrator,
 * web hook, test). Unknown shapes return `'unhandled'` so the caller propagates rather
 * than silently swallowing.
 *
 * @param err - the thrown value (typed `unknown`; this function narrows it).
 * @returns the 4-bucket verdict.
 */
export function classify(err: unknown): ErrorClass {
  // --- SDK-native errors -----------------------------------------------------
  // ConcurrencyError is the SDK's own "stale, refetch + retry" signal (DB optimistic
  // lock) — transient by definition. DomainError / NotFoundError are terminal.
  if (err instanceof ConcurrencyError) {
    return 'transient';
  }
  if (err instanceof DomainError || err instanceof NotFoundError) {
    return 'permanent';
  }

  // --- cashu-ts protocol errors ---------------------------------------------
  // MintOperationError extends HttpResponseError, so check it FIRST (most specific).
  if (err instanceof MintOperationError) {
    if (TRANSIENT_MINT_CODES.has(err.code)) {
      return 'transient';
    }
    if (ALREADY_RESOLVED_MINT_CODES.has(err.code)) {
      return 'already-resolved';
    }
    // Any other mint rejection (unbalanced tx, unit mismatch, keyset inactive,
    // amount-out-of-limits, auth required, …) is a deterministic rejection: retrying
    // the same request will fail identically. Surface it.
    return 'permanent';
  }

  // A NetworkError or a non-mint HTTP error (timeout, 429, 5xx, connection refused)
  // is a transport/connectivity failure — retry. Master's receive hook explicitly
  // treats HTTP 429 as retryable.
  if (err instanceof NetworkError || err instanceof HttpResponseError) {
    return 'transient';
  }

  // --- unknown ---------------------------------------------------------------
  return 'unhandled';
}
