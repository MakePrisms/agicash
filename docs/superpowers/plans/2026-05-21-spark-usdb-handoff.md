# Spark USDB — Implementation Handoff

> Resume point for the Spark USD account (USDB) work. Companion to the plan
> (`2026-05-21-spark-usdb.md`) and spec (`../specs/2026-05-21-spark-usdb-design.md`).
> Last updated 2026-05-21.

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
| 6 — Receive flow: currency dispatch + conversion wait | ⚠️ committed, **code-quality review NOT run** | `58215313` |
| 7 — Send DB JSON schema conversion fields | ⛔ not started | — |
| 8 — Send flow: currency dispatch + two-leg wait | ⛔ not started | — |
| 9 — Manual mainnet smoke checklist | ⛔ deferred to operator (human-only) | — |

Branch `spark-usdb`, 11 commits ahead of `origin/master` (first 2 are the
pre-existing plan/spec doc commits). Working tree clean. Not pushed.

## ⚠️ First thing to do on resume

**Task 6's code-quality review was interrupted before it ran.** Spec-compliance
review passed (commit matches plan, BTC path verified intact, all 4 fields
persisted). But the code-quality pass never completed. Before starting Task 7,
either run the code-quality reviewer against `58215313` (BASE `0fbfa357`,
HEAD `58215313`) or consciously accept the spec-review-only state.

Task 6 known concerns to weigh during that review:
1. **Preimage cache leak** — `usdPreimageByQuoteIdRef` (a `useRef<Map>`) is
   cleared on the completed path but **not** on `failed`/`refundNeeded` or on
   quote expiry. Small per-session leak. Tidy fix: also `.delete(quote.id)` in
   the failure branch.
2. **`slippageDelta` is always `undefined`** — the quote shape carries no
   quote-time USDB estimate to diff against actual output. Schema field is
   `.optional()`, so this is spec-legal. A real slippage number needs a
   quote-time estimate persisted (follow-up).
3. **Page-reload mid-conversion** loses the in-memory preimage cache; the
   catch-up path then can't find a preimage and leaves the quote UNPAID +
   fires Sentry. Acceptable for MVP, may be noisy.
4. **UI callers don't pass `exchangeRate`** — `receive-spark.tsx` and
   `buy-store.ts` were NOT touched (out of Task 6 scope). USD-account quote
   creation will throw at runtime until that wiring lands. BTC unaffected.
   This is genuine remaining work not covered by any plan task — see below.

## How to resume

1. `cd /Users/claude/agicash/.claude/worktrees/spark-usdb`
2. Re-load `superpowers:subagent-driven-development`.
3. (Optional) finish Task 6 code-quality review — see above.
4. Task 7 then Task 8, each: implementer subagent → spec review → code-quality
   review → fix loop. Task 7 is trivial (schema add, mirror of Task 5).
   Task 8 is large (mirror of Task 6 shape, send direction).
5. Task 9 is a human-run mainnet smoke checklist — hand it to the operator.

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
