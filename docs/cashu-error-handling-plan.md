# Cashu Error Handling — Plan

Status: draft plan for the general cashu `MintOperationError` handling across send / receive / swap / melt. Supersedes the 5/20 spec on `docs/cashu-error-classifier-spec` (PR #1104). Grounded in an audit of the current per-flow handling.

Line numbers are indicative from the current codebase; confirm at implementation (symbols are stable).

---

## 1. Goal & principles

Make cashu error handling correct, consistent, and observable — replacing today's ad-hoc per-callsite `instanceof MintOperationError` checks and `throwOnError: true`.

- **Trust the spec codes.** No cross-mint normalization. A mint that emits non-conformant codes is an upstream bug → file an issue. (No NUT-07 checkstate either; trust the code for proof state.)
- **One classifier, four flow-agnostic buckets.** `transient | permanent | already-resolved | unhandled`.
- **Services refine** the coarse bucket with operation context the classifier lacks.
- **`DomainError` is the user-output type**; the classifier verdict is a control signal. They compose.
- **Money-safety first**: never treat an op as resolved without confirming it; never silently lose funds or spin forever.

## 2. The classifier

```
classify(error: unknown): 'transient' | 'permanent' | 'already-resolved' | 'unhandled'
```
- Pure, no I/O, flow-agnostic. Lives in `packages/sdk` (in-app `app/lib/cashu/error-classify.ts` initially per the SDK seam; relocates on extraction, import-flip only).
- Non-`MintOperationError` (e.g. `NetworkError`) is NOT this function's concern — callers keep existing network-retry.

**Code → bucket:**
- transient: `11002 PROOFS_ARE_PENDING`, `11004 OUTPUTS_ARE_PENDING`, `20001 QUOTE_NOT_PAID`, `31004` rate-limit.
- already-resolved: `11003 OUTPUT_ALREADY_SIGNED`, `11001 TOKEN_ALREADY_SPENT`, `20002 QUOTE_ALREADY_ISSUED`, `20005 QUOTE_PENDING`, `20006 INVOICE_ALREADY_PAID`.
- permanent: `11006`, `11013`, `20003`, `20004`, `12xxx` keyset, `3xxxx` auth/quota.
- unhandled: `11005`, `11007`, `11008`, `11014`, `11015`, and any unknown code.

**Consumer helpers** (how the flows use the verdict):
- retry predicate: `classify(e) === 'transient'` (+ existing `ConcurrencyError`).
- throwOnError predicate: `(e) => classify(e) === 'unhandled'`.
- DomainError mapping: `permanent` → `DomainError` with curated copy (§Phase 3).

## 3. Phased PRs (each independently reviewable + shippable)

- **Phase 1 — classifier foundation.** `classify()` + bucket map + unit tests. No behavior change. Pure module.
- **Phase 2 — swap flows + the crash fix + money-safety guard.** Wire `classify()` into send-swap + receive-swap; lands the `11004/11002` transient fix; add the already-resolved empty-restore guard.
- **Phase 3 — quote flows + user messages.** Mint-quote / melt-quote + lightning send/receive; map permanent codes to `DomainError`; curate user-facing copy (replace raw mint `detail`).
- **Phase 4 — observability.** Sentry-capture the bug-class/unhandled codes; bounded-retry ceilings on transient.

## 4. Per-phase grounded changes (current → target)

### Phase 1 — classifier
- NEW `error-classify.ts` (in `app/lib/cashu/` now). Imports `CashuErrorCodes` (already synced to spec, #1105).
- NEW `error-classify.test.ts`: one case per bucket + unknown-code default + the pending/already-resolved boundary. Pure, runs under `bun test` (predicate-level; no service import — see §6).

### Phase 2 — swap flows
- **send-swap** — `swapForProofsToSend` mutation (`cashu-send-swap-hooks.ts`, ~:399/:414): current `retry: 3` + `throwOnError: true` → target retry on `transient`(+`ConcurrencyError`), `throwOnError: (e) => classify(e)==='unhandled'`. Service catch (`cashu-send-swap-service.ts`, ~:412-461): current allowlist `{11003, 11001}` → restore. Target: 11004/11002 now retry (transient) instead of re-throwing.
- **MONEY-SAFETY guard** (`cashu-send-swap-service.ts`, ~:437): current restores then filters by secret and returns `{send, keep}` **without checking non-empty/balanced** → target: if restored proofs are empty / don't sum to the expected amount, do NOT return as success — throw (→ `unhandled`). Mirror the receive-swap guard.
- **receive-swap** — `completeSwap` mutation (`cashu-receive-swap-hooks.ts`, ~:166): current `retry: 3` + `throwOnError: true` → same classify()-driven target. Service catch (`cashu-receive-swap-service.ts`, ~:201-248): keep the existing `proofs.length === 0` → `TOKEN_ALREADY_CLAIMED` → fail branch (the 11001 context refinement). 11004/11002 now retry.

### Phase 3 — quote flows + messages
- **receive via LN (mint)** — `completeReceiveQuote` mutation (`cashu-receive-quote-hooks.ts`, ~:599/:632/:654): current `retry: 3` + `throwOnError: true` → classify()-driven. Service catch (`cashu-receive-quote-service.ts`, ~:332-356): current allowlist `{11003, 20002}` → restore (keep). NEW: `20003 MINTING_DISABLED` and other permanent codes → `DomainError` (don't crash).
- **send via LN (melt)** — `initiateSend` mutation (`cashu-send-quote-hooks.ts`, ~:312/:338-354): current `onError` does `failSendQuote(reason = error.message)` (raw mint detail). Target: map permanent → curated copy; keep raw `detail` for Sentry. `getLightningQuote` (`cashu-send-quote-service.ts`, ~:150): map permanent quote-create codes (11006/11012/11013) to `DomainError`.
- **cross-mint receive (melt-then-mint)** — `initiateMelt` (`cashu-receive-quote-hooks.ts`, ~:664) mirrors the melt; same curated-copy treatment; transfer flows use "transfer" framing.
- **Curated copy** (raw `detail` → user): `20003`→"This mint has paused minting. Your funds are safe — try again later." · `11013`→"This mint doesn't support {currency}." · `11006`→"Amount is outside this mint's limits." · `20004`→"Lightning payment failed. Your funds were returned." (transfer: "Transfer failed…").

### Phase 4 — observability
- Bug-class/unhandled codes (`11005/11007/11008/11014/11015` + unknown): add `Sentry.captureException(e, { extra: { code } })` at the fail sites that currently swallow to `failQuote(reason)` without capturing.
- Bounded-retry ceiling on `transient`: define a max-attempts (open question §8) after which the op surfaces "stuck — funds safe" + captures, rather than retrying forever.

## 5. Relationship to #1115

#1115 (open draft) is the **first transient instance**: it adds `isTransientCashuSwapError` (11004/11002 → `ConcurrencyError`) and rewires the two swap-task mutations. Recommended order: **#1115 merges first** (ships the urgent prod crash fix now), then **Phase 2 generalizes it** — `classify()` subsumes `isTransientCashuSwapError`, so Phase 2 deletes the bespoke predicate and routes through the classifier. (Avoids blocking the crash fix on the full build.)

## 6. Test strategy

- **classify()**: thorough unit tests, pure, run under `bun test` (the predicate-level pattern — no service import).
- **Service/flow level**: importing the services under `bun test` throws `window is not defined` (Supabase/realtime touch `window` at module top-level; all repo tests sidestep via pure modules). A render-level no-crash test needs happy-dom + bunfig = scope creep. So flow behavior is covered by: classify() unit tests + manual/E2E verification (esp. the 11004 no-crash and the empty-restore guard).

## 7. Sequencing with other work

- **monorepo #1114** (relocates `app/` → `apps/web/app/`, currently CI-blocked): this plan lands on the current layout; if #1114 merges first, paths shift under `apps/web/` (mechanical rebase). Coordinate with the monorepo conversion (#1114).
- **SDK extraction** (future, late phase): `classify()` relocates from `app/lib/cashu/` to `packages/sdk`; the web import flips `~/lib/cashu/error-classify` → `@agicash/sdk`. Pure function → no logic change. The SDK's `executeQuote` consumes the same `classify()`.
- **#1115**: merge-first (§5).

## 8. Open decisions

1. **Retry ceiling** for `transient` (Phase 4): bounded N-attempts then surface, vs the current infinite `ConcurrencyError` retry. (Recommend bounded + capture so a never-settling op is observable; this was the #1115 observability flag.)
2. **#1115 merge-first vs fold-in** (§5 recommends merge-first).
3. **Exact user-facing copy** (Phase 3 drafts above — confirm wording).

## 9. Out of scope (separate PRs / not pursued)

- Removing nutshell-specific compat handling (string-fallbacks; melt-quote change-refetch) → separate PR, gated on the minimum-nutshell-version floor (string-fallbacks need ≥0.16.5; change-refetch needs ≥0.19.0).
- Cross-mint normalization; NUT-07 checkstate verification — not pursued (trust the codes).
- Origin hardening (idempotency / advance `keysetCounter` only on confirmed success) — belongs with the SDK's `executeQuote` orchestrator (future extraction).
