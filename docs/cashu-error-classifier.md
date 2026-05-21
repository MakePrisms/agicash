# Cashu Error-Codes Classifier — Minimal Spec

**Goal.** Properly handle every cashu mint error code via a flow-agnostic classifier. Sync `error-codes.ts` to current NUT spec. Replace ad-hoc patterns with a single source of truth for retry policy.

**Scope (in).**
1. Sync `app/lib/cashu/error-codes.ts` to current NUT spec.
2. Add `classify(err)` + `normalizeCode(err)` helpers in `app/lib/cashu/error-classify.ts`.
3. Replace existing per-mutation `instanceof MintOperationError` retry-skips with classifier-based decisions.
4. Replace `throwOnError: true` on cashu-touching mutations with `(err) => classify(err) === 'unhandled'`.
5. Update existing service-level recovery branches to reference the renumbered enum names (no logic change — names stayed the same, only values moved).

**Scope (explicitly out — follow-up PRs).**
- Auth-refresh interceptor (auth codes still classify as `permanent` for now).
- Keyset-refresh-and-retry on `12002` (#673, future repair layer).
- `failSwap()` state transitions for cashu-send-swap retry exhaustion (#421).
- Pre-send balance check (#425, pure UI).
- Already-spent on send extended recovery (#708).
- Fixing the 23 `throwOnError: true` sites that DON'T call cashu-ts (those are separate state-machine work).

---

## Phase 1 — Enum sync (`app/lib/cashu/error-codes.ts`)

### 1a. Drift fixes (4 codes — *dangerous because two collide with spec codes*)

| Const                        | Current value | Spec value | Risk if unfixed |
|------------------------------|---------------|------------|-----------------|
| `OUTPUT_ALREADY_SIGNED`      | `10002`       | `11003`    | Mints emitting spec-correct `10002` (currently undefined in spec at that slot) currently no-op; mints emitting spec-correct `11003` are misclassified as unknown. |
| `TOKEN_VERIFICATION_FAILED`  | `10003`       | `10001`    | Mints emitting spec-correct `10001` are misclassified as unknown. |
| `TRANSACTION_NOT_BALANCED`   | `11002`       | `11005`    | **COLLISION** — spec `11002 Proofs are pending` would be misclassified as `TRANSACTION_NOT_BALANCED` (wallet bug) when it's actually an idempotency-shaped already-resolved state. |
| `UNIT_NOT_SUPPORTED`         | `11005`       | `11013`    | **COLLISION** — spec `11005 Transaction is not balanced` would be misclassified as `UNIT_NOT_SUPPORTED`. |

Renumbering is **safe**: every callsite in `app/` uses `CashuErrorCodes.NAME`, no raw-number references. Verified via `grep -rE 'error\.code\s*===?\s*1[0-9]{4}' app/` — 0 matches.

### 1b. Missing codes (10 — add to enum)

```
11002  PROOFS_ARE_PENDING               (NUT-03/05) — already-resolved-shaped (mint is processing)
11004  OUTPUTS_ARE_PENDING              (NUT-04)    — already-resolved-shaped
11011  AMOUNTLESS_INVOICE_UNSUPPORTED   (NUT-05)    — permanent
11012  AMOUNT_MISMATCH                  (NUT-05)    — permanent (client request != invoice amount)
11013  UNIT_NOT_SUPPORTED               (replaces drift fix above)
11014  MAX_INPUTS_EXCEEDED              (NUT-03/05) — permanent (wallet should batch differently)
11015  MAX_OUTPUTS_EXCEEDED             (NUT-03/05) — permanent
11016  DUPLICATE_QUOTE_IDS              (NUT-23?)   — permanent (batch endpoints)
11017  MAX_BATCH_SIZE_EXCEEDED          (NUT-23?)   — permanent
12003  KEYSET_EXPIRED                   (NUT-02)    — permanent (same shape as 12002; keyset rotation aftermath)
```

### 1c. Nutshell legacy compatibility

Nutshell pre-0.16.5 emits message strings instead of structured codes (already handled at `cashu-receive-quote-service.ts:339-344` + `cashu-receive-swap-service.ts:224-226` + `cashu-send-swap-service.ts:431-433`). The new `normalizeCode(err)` helper centralises this — service-level recovery branches will call `normalizeCode(err)` instead of `error.code` + message-string sniffing.

---

## Phase 2 — Classifier helper (`app/lib/cashu/error-classify.ts`, new file)

Pure functions; no React, no service dependencies; unit-testable.

```ts
import { MintOperationError, NetworkError, HttpResponseError } from '@cashu/cashu-ts';
import { CashuErrorCodes } from './error-codes';
import { DomainError, ConcurrencyError } from '~/features/shared/error';

export type ErrorClassification =
  | 'transient'         // retry-then-fail safe
  | 'permanent'         // never retry; surface to user
  | 'already-resolved'  // mint moved past this; service should attempt recovery
  | 'unhandled';        // unknown error type; throw to boundary (real bug)

const ALREADY_RESOLVED_CODES = new Set<number>([
  CashuErrorCodes.OUTPUT_ALREADY_SIGNED,  // 11003 (post-sync)
  CashuErrorCodes.TOKEN_ALREADY_SPENT,    // 11001
  CashuErrorCodes.QUOTE_ALREADY_ISSUED,   // 20002
  CashuErrorCodes.PROOFS_ARE_PENDING,     // 11002 (new)
  CashuErrorCodes.OUTPUTS_ARE_PENDING,    // 11004 (new)
]);

const TRANSIENT_CODES = new Set<number>([
  CashuErrorCodes.QUOTE_NOT_PAID,                // 20001 — short backoff + re-poll
  CashuErrorCodes.BAT_MINT_RATE_LIMIT_EXCEEDED,  // 31004 — backoff
]);

// All other known mint codes are permanent. Unknown mint codes default to permanent
// (mint emitted a structured body = deterministic decision).

/**
 * Normalize a cashu error to a numeric code, accepting:
 *   - Modern spec values (default)
 *   - Legacy enum values (no-op since enum has been renumbered to spec)
 *   - Nutshell pre-0.16.5 message strings
 * Returns undefined if the error is not a MintOperationError.
 */
export function normalizeCode(err: unknown): number | undefined {
  if (!(err instanceof MintOperationError)) return undefined;
  if (err.code) return err.code;
  // Pre-0.16.5 Nutshell fallback
  const m = (err.message || '').toLowerCase();
  if (m.includes('outputs have already been signed before')) return CashuErrorCodes.OUTPUT_ALREADY_SIGNED;
  if (m.includes('mint quote already issued')) return CashuErrorCodes.QUOTE_ALREADY_ISSUED;
  return undefined;
}

export function classify(err: unknown): ErrorClassification {
  // App-level domain types
  if (err instanceof DomainError) return 'permanent';
  if (err instanceof ConcurrencyError) return 'transient';

  // Cashu-ts wire-level types
  if (err instanceof NetworkError) return 'transient';
  if (err instanceof HttpResponseError && !(err instanceof MintOperationError)) {
    // Non-2xx without a Cashu body (5xx, 429, etc.)
    return err.status >= 500 || err.status === 429 ? 'transient' : 'permanent';
  }
  if (err instanceof MintOperationError) {
    const code = normalizeCode(err);
    if (code !== undefined && ALREADY_RESOLVED_CODES.has(code)) return 'already-resolved';
    if (code !== undefined && TRANSIENT_CODES.has(code)) return 'transient';
    // Known permanent + unknown custom codes both default to 'permanent'
    return 'permanent';
  }

  // CORS / fetch failures arrive as plain TypeError
  if (err instanceof TypeError) return 'transient';

  // Unknown: real bug, throw to boundary
  return 'unhandled';
}
```

**Design constraints honored:**
- Flow-agnostic. No `flow` parameter. Services that need contextual logic (e.g. receive-swap's `TOKEN_ALREADY_CLAIMED` when restore is empty) continue handling it themselves.
- No repair hints. 4 buckets only.
- Composes with existing `DomainError` (Josip's pattern — DomainError always classifies as permanent).
- Composes with `meltProofsIdempotent` (the wrapper already handles `20004`/`20005`/`20006` via state-recheck; classifier only sees what the wrapper re-throws).

---

## Phase 3 — Hook wiring (replace existing patterns)

### 3a. Replace `instanceof MintOperationError` retry-skips (5 mutations)

For each mutation that currently has:

```ts
retry: (failureCount, error) => {
  if (error instanceof MintOperationError) return false;
  return failureCount < 3;
}
```

Replace with:

```ts
retry: (failureCount, error) => {
  return classify(error) === 'transient' && failureCount < 3;
}
```

Sites:
- `app/features/send/cashu-send-quote-hooks.ts:332` (`useInitiateCashuSendQuote`)
- `app/features/receive/cashu-receive-quote-hooks.ts:705` (`useInitiateMelt`)
- `app/features/receive/spark-receive-quote-hooks.ts:599` (`spark variant`)
- `app/features/send/cashu-send-quote-hooks.ts` (`useCreateCashuLightningSendQuote` — PR #1090's target)
- `app/features/receive/receive-cashu-token-hooks.ts` (`useCreateCrossAccountReceiveQuotes` — PR #1090's target)

### 3b. Replace `throwOnError: true` on cashu-touching mutations

For each mutation that calls a cashu-ts wallet method (createMeltQuoteBolt11, meltProofsBolt11, createMintQuote, mintProofs, swap, etc.), replace:

```ts
throwOnError: true,
```

with:

```ts
throwOnError: (err) => classify(err) === 'unhandled',
```

Sites (to be enumerated during implementation — likely 8-12 of the 23 `throwOnError: true` sites). DB-only mutations (markAsPending, expireQuote, etc.) keep `throwOnError: true` for this PR; those are a separate concern.

### 3c. Update `onError` handlers

Where `onError` currently does:

```ts
if (error instanceof MintOperationError) {
  failSendQuote({ sendQuoteId, reason: error.message });
}
```

Update to the equivalent classifier-driven form, e.g.:

```ts
const kind = classify(error);
if (kind === 'permanent') {
  failSendQuote({ sendQuoteId, reason: getErrorMessage(error) });
} else if (kind === 'already-resolved') {
  // Recovery should have happened at the service layer. If it reached here, log + treat as permanent.
  console.warn('Already-resolved error reached hook layer — service recovery missing', { sendQuoteId, error });
  failSendQuote({ sendQuoteId, reason: getErrorMessage(error) });
}
// 'transient' was retried and exhausted — already handled by retry budget
// 'unhandled' propagates via throwOnError predicate
```

---

## Phase 4 — Service-level recovery uses `normalizeCode`

Three sites currently inline the legacy-code + message-string check:

- `cashu-receive-quote-service.ts:333-356` (recovery for `OUTPUT_ALREADY_SIGNED` + `QUOTE_ALREADY_ISSUED`)
- `cashu-receive-swap-service.ts:215-247` (recovery for `OUTPUT_ALREADY_SIGNED` + `TOKEN_ALREADY_SPENT`)
- `cashu-send-swap-service.ts:422-461` (same pattern)

Refactor each `if (error instanceof MintOperationError && [codes...].includes(error.code) || error.message.toLowerCase().includes(...))` block to:

```ts
const code = normalizeCode(error);
if (code === CashuErrorCodes.OUTPUT_ALREADY_SIGNED || code === CashuErrorCodes.TOKEN_ALREADY_SPENT) {
  // existing restore logic
}
```

Centralizes the legacy-message-string fallback in one place (`normalizeCode`).

---

## PR #1090 disposition

PR #1090 commit `e78cd7c` wraps `MintOperationError → DomainError(error.message)` in `cashu-send-quote-service.ts` + `receive-cashu-token-quote-service.ts`. This was Josip's preferred shape.

**Recommendation:** revert the service-level wrap and use the classifier instead (option (i) from earlier). Rationale:
- The wrap loses `error.code` (only message preserved), which the classifier needs.
- DomainError → `permanent` and MintOperationError → mostly `permanent` give the same hook-layer behaviour; the wrap is redundant once the classifier exists.
- Josip's instinct was correct (DomainError is the right semantic type for user-facing); we just don't need it at this specific boundary because the classifier covers the same ground.

PR #1090 then becomes part of THIS PR (the classifier replaces both the original hook-level fix AND the wrap).

---

## Estimated diff size

- `error-codes.ts` — ~40 LOC (4 value changes + 10 new entries + JSDoc)
- `error-classify.ts` — ~80 LOC (new file)
- Hook updates — ~50 LOC across 5-10 mutations (retry + throwOnError predicate)
- Service recovery refactor — ~30 LOC (inline → `normalizeCode` call)
- Tests for `classify` + `normalizeCode` — ~150 LOC

Total: ~350 LOC, single PR, no breaking changes (enum sync only renumbers; consumers use names).

---

## Open implementation questions (smaller than the original 10)

- **Test coverage strategy.** Unit-test `classify`/`normalizeCode` directly + add one E2E that hits a closed-loop gift-card mint with `20739` to confirm the unknown-code path. Acceptable?
- **`onError` handler shape.** Several mutations currently transition state (`failSendQuote`, `failSwap`) on `MintOperationError`. The classifier-driven version above keeps this only for `permanent`. Need a per-mutation review to confirm none currently rely on transitioning for `already-resolved` cases without going through service recovery first.
- **`20003 MINTING_DISABLED` and `20007 QUOTE_EXPIRED`** — hours-scale "transient" but we ship `permanent`. Confirm that's correct.
