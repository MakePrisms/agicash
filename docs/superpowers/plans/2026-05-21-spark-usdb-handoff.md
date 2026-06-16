# Spark USDB — Implementation Handoff

> Resume point for the Spark USD account (USDB) work. Companion to the plan
> (`2026-05-21-spark-usdb.md`) and spec (`../specs/2026-05-21-spark-usdb-design.md`).
> Last updated 2026-06-16.

## Where things stand

Executing the plan via `superpowers:subagent-driven-development` (fresh
subagent per task, spec-compliance review then code-quality review after each).

| Task | Status | Commit |
|------|--------|--------|
| 0 — Pre-flight: lock `account_number` | ✅ done, reviewed | `b9286e24` |
| 1 — Pure helpers `app/lib/spark/usdb.ts` (TDD) | ✅ done, reviewed | `76095b9b` + fix `daeaf784` |
| 2 — DB unique index migration (file only, not applied) | ✅ done | `c79da2e9` |
| 3 — Seed USD spark account by default | ✅ done | `1b2eacbd` |
| 4 — Account-aware Spark SDK init | ✅ done, reviewed | `8bd9ca9e` + fix `0fbfa357` |
| 5 — Receive DB JSON schema conversion fields | ✅ done | `21aea69b` |
| 6 — Receive flow: currency dispatch + conversion wait | ✅ done, reviewed, fixes applied | `58215313` + fixes `029fd3ec` |
| 6b — Receive UI: pass `exchangeRate` (out-of-plan follow-up) | ✅ done | `f3cc4ef1` |
| 7 — Send DB JSON schema conversion fields | ✅ done | `ca9861db` |
| 8 — Send flow: currency dispatch + two-leg wait | ✅ done, reviewed, open findings ↓ | `59e9506f` |
| 8b — Send UI: pass `exchangeRate` (out-of-plan follow-up) | ✅ done | `e17848b5` |
| 9 — Manual mainnet smoke checklist | ⛔ deferred to operator (human-only) | — |

Branch `spark-usdb`, pushed to `origin/spark-usdb`. Working tree clean.

## ⚠️ First thing to do on resume

**Three open Task 8 review findings need a decision before merge.** Reviewer
ran the same criteria that surfaced the Task 6 P1/P2 issues. Findings:

1. **P1 (conf. 82) — `isConversionLeg` may swallow `status === 'pending'`.**
   `app/features/send/spark-send-quote-hooks.ts:315-316` guards with
   `conversionStatus !== undefined && conversionStatus !== 'pending'`. If a
   conversion-leg `paymentSucceeded` ever fires with `status === 'pending'`,
   the code falls through to the lightning-leg path and the extras cache never
   populates → stranded quote. The **same idiom exists on the corrected
   receive side** (`spark-receive-quote-hooks.ts`) — so this is either a
   parallel bug to fix in both, or an SDK guarantee to verify and document.
   Cheap hardening: switch the conversion-leg detection from "status field"
   to "details.type !== 'lightning'", which patches both sides at once.

2. **P2 (conf. 88) — silent PENDING on conversion failure has no UI feedback.**
   `spark-send-quote-hooks.ts:445-449` + `367-397`. When a `paymentPending`
   event arrives with `conversionStatus === 'failed'` / `'refundNeeded'`, the
   code routes through `handlePaymentSucceeded`, fires Sentry, and returns —
   leaving the quote PENDING. The PENDING-state unique index also blocks
   future attempts for the same invoice. Product decision required:
   (a) toast user + leave PENDING for manual ops resolution, or
   (b) mark FAILED and accept the "dangling sats" data loss.

3. **P2 (conf. 80) — `payment.fees` unit assumption may be wrong.**
   `spark-send-quote-hooks.ts:329-330, 343-347`. SDK-storage replay path
   falls back to `payment.fees` and constructs `Money({ unit: 'sat' })`. If
   the SDK ever returns `payment.fees` in msats on `'spark'`/`'token'`-detail
   payments, the stored fee will be 1000× too large. Verify against
   `node_modules/@agicash/breez-sdk-spark/web/breez_sdk_spark_wasm.d.ts`
   before merge — should take 30 seconds.

4. **P3 — explanatory comment** at `spark-send-quote-hooks.ts:352-357`
   about the deferred `slippageActual` belongs in the commit message per
   CLAUDE.md, not inline.

Task 8 review also verified clean: listener `.catch` calls `console.warn`
directly (no regression of the Task 6 dead-catch bug); extras cache cleared
on 5 exit paths (completed / failed / refundNeeded / refunded /
handlePaymentFailed); all four `currency: 'BTC'` hardcodes in service.ts
turned out to be genuinely sats and were intentionally kept; balance check
is USD-vs-USD; all `bigint → Money` use `.toString()`; `paymentRequest`
fallback in `findQuote` robust across `'lightning'` / `'spark'` / `'token'`
detail shapes.

### Resolved Task 6 concerns (kept for historical reference)

1. **Preimage cache leak on failure** — fixed in `029fd3ec`: `.delete(quote.id)`
   now runs at the top of the `failed`/`refundNeeded` branches.
2. **Dead `catch` body** in listener removal — fixed in `029fd3ec`: now calls
   `console.warn` directly (the original inner-arrow-never-called pattern is
   gone). **The same pattern was avoided from the start in Task 8.**
3. **`slippageDelta` always `undefined`** — confirmed real follow-up. Schema
   field is `.optional()`, so spec-legal. Needs a quote-time estimate persisted
   to ever be non-undefined. Same shape on the send side as `slippageActual`.
4. **Page-reload mid-conversion** — known gap. Preimage map is in-memory only;
   if the user reloads between the lightning leg and the conversion leg, the
   catch-up path leaves the quote UNPAID + fires Sentry. Acceptable for MVP;
   real fix needs a durable preimage store. Same gap likely exists on the
   send side.
5. **UI callers don't pass `exchangeRate`** — fixed for receive in `f3cc4ef1`
   (Task 6b) and for send in `e17848b5` (Task 8b). Mirror pattern: ref-backed
   `getExchangeRate` injected into the store via the provider; store throws
   `DomainError` for USD without a rate; BTC path untouched.

## How to resume

1. `cd /Users/claude/agicash/.claude/worktrees/spark-usdb`
2. Decide on the three open Task 8 review findings above (P1 `isConversionLeg`
   hardening, P2 PENDING-on-failure UX, P2 `payment.fees` unit verification,
   P3 comment cleanup). If you fix P1, **fix it on the receive side too** —
   same idiom, same potential bug.
3. Task 9 is a human-run mainnet smoke checklist — hand it to the operator.

## Hard-won facts (don't rediscover these)

### Locked constants (Task 0 pre-flight, mainnet-verified)
- `BTC_ACCOUNT_NUMBER = 1` — existing BTC users derive here; this is the SDK's
  implicit default in `@agicash/breez-sdk-spark@0.13.5-1`.
- `USD_ACCOUNT_NUMBER = 2` — operator chose `2` (the spec's "default + 1"
  framing) over the plan's literal "smallest distinct" rule (`0`). Both produce
  distinct pubkeys; `2` was the deliberate call.
- These live in `app/lib/spark/usdb.ts` `getSparkAccountNumber()`.

### SDK API corrections — the plan's literal code is WRONG in places
The plan was written before the SDK surface was verified. Confirmed against
`node_modules/@agicash/breez-sdk-spark/web/breez_sdk_spark_wasm.d.ts`:
- **`accountNumber` is NOT on `ConnectRequest`.** Passing it to `connect()` is
  silently ignored. Use `SdkBuilder.new(config, seed).withKeySet({ keySetType:
  'default', useAddressIndex: false, accountNumber }).withDefaultStorage(dir)`
  — note `withDefaultStorage` returns `Promise<SdkBuilder>` — `.build()`.
  Already done in Task 4 (`app/features/shared/spark.ts`).
- **`GetInfoResponse.tokenBalances` is a `Map<string, TokenBalance>`** — use
  `.get(USDB_MAINNET_ID)`, not `[key]`. `TokenBalance.balance` is already
  `bigint`.
- **`GetTokensMetadataRequest.tokenIdentifiers`** (not `identifiers`).
- **`GetInfoResponse.identityPubkey`** (not `receiverIdentityPubkey`).
- `generateMnemonic` is **not** exported by the SDK — use `@scure/bip39`.
- Sentry import path is `@sentry/react-router` (not `@sentry/react`).
- `Money` constructor input is `number | string | Big` — **not `bigint`**.
  Convert SDK `bigint`s with `.toString()` before `new Money({ amount })`.

### SDK conversion-event types (relevant to Task 8, already scouted)
- `Payment` has `details?: PaymentDetails` and `conversionDetails?:
  ConversionDetails`.
- `PaymentDetails` discriminated union: `spark | token | lightning | withdraw
  | deposit`. Only `spark`/`token` carry `conversionInfo?`.
- `ConversionDetails = { status: ConversionStatus; from?: ConversionStep;
  to?: ConversionStep }`.
- `ConversionStatus = 'pending' | 'completed' | 'failed' | 'refundNeeded' |
  'refunded'`.
- `ConversionStep = { paymentId; amount: bigint; fee: bigint; method;
  tokenMetadata?; amountAdjustment? }`.
- `ConversionEstimate = { options; amountIn: bigint; amountOut: bigint;
  fee: bigint; amountAdjustment? }` — `prepareSendPayment` on a USD wallet
  should return one of these (Task 8 persists `usdbDebited` etc. from it).
- There is **no** dedicated "conversion" event type. Dispatch keys off
  `payment.conversionDetails.status`, not `event.type`. Two `paymentSucceeded`
  events fire for a USD receive: lightning leg, then conversion leg.
- Caveat seen in Task 6: the SDK's bundled `web/storage/index.js` can
  reconstruct `conversionDetails` as `{status, from: null, to: null}` for
  replayed/persisted payments — fall back to `payment.amount`/`payment.fees`
  when `from`/`to` are missing.

## What Task 7 needs (small)
Mirror of Task 5. Add optional fields to `SparkLightningSendDbDataSchema` in
`app/features/agicash-db/json-models/spark-lightning-send-db-data.ts`:
`usdbDebited`, `satsAfterConversion`, `conversionFee`, `slippageActual` — all
`z.instanceof(Money).optional()`. See plan Task 7 for the exact JSDoc.

## What Task 8 needs (large)
Files: `app/features/send/spark-send-quote-{service,hooks,repository}.ts`.
- Replace the four `currency: 'BTC'` hardcodes (`spark-send-quote-service.ts`
  lines ~136/142/171/308) with `account.currency` — but keep genuinely-sats
  fee fields (`lightningFeeReserve` etc.) as `'BTC'`/`'sat'`.
- USD source account: accept USD amount, convert to sats via `exchangeRate`
  (same plumbing as `cashu-send-quote-service.ts:128-135`), call
  `prepareSendPayment` — its response includes a `conversionEstimate` when
  `stable_balance_config` is active.
- Two-leg wait in `useOnSparkSendStateChange` / `useProcessSparkSendQuoteTasks`:
  conversion leg `completed` → record `satsAfterConversion`, `conversionFee`,
  `slippageActual`, stay PENDING; lightning leg success → mark COMPLETED;
  `failed`/`refundNeeded` → Sentry tag `spark.usd.dangling_sats`, stay PENDING.
- Same preimage-across-two-events problem as Task 6 — reuse that pattern.

## Environment / process notes
- `.env` was copied into this worktree from `/Users/claude/agicash/.env`
  (it carries `VITE_BREEZ_API_KEY`). It is gitignored.
- This worktree has **no `.pre-commit-config.yaml`** (it shares a `.git` with
  the agicash-rs repo). Commits need `PREK_ALLOW_NO_CONFIG=1`. The hooks did
  not run for tasks 0–6; **CI is the real gate** — run `bun run fix:all`
  before considering anything merge-ready.
- Operator decisions in effect: migration file created but **not applied**
  (`bunx supabase migration up` is the operator's to run, before
  `db:generate-types`); live `bun run dev` UI smoke is skipped — verify with
  `bun run typecheck` + `bun run lint:check` + `bun test` only.
- Every task so far: `bun run typecheck` clean, `bun run lint:check` clean
  (2 pre-existing `vite-env.d.ts` warnings are unrelated), `bun test
  app/lib/spark/usdb.test.ts` 11/11.
- `tools/spark-usdb-preflight.ts` is a one-off; Biome wants to reformat it
  (moves the `node:` imports above the header comment). That reformat has been
  reverted twice — leave the file as committed in `b9286e24`.

## Open items beyond the plan
- Wire `exchangeRate` through the USD receive UI (`receive-spark.tsx`,
  `buy-store.ts`) — without it, USD-account receive throws at runtime. Not in
  any plan task. Same will apply to the send UI after Task 8.
- LNURL verify path (`lightning-address-service.ts handleSparkLnurlpVerify`)
  uses the legacy un-suffixed `/tmp/.spark-data` storage dir while the callback
  path is now per-account. Documented in-code as intentional; revisit if the
  verify path should become account-aware.
- `slippageDelta` / `slippageActual` need a quote-time estimate persisted to
  ever be non-undefined.
