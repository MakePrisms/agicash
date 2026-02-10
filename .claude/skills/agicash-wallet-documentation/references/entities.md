# Core Entities

## Entity Relationships

```
Transaction (1) ←→ (1) Quote OR Swap (via transactionId)
```

| Transaction Type × Direction | Linked Entity | Reference |
|------------------------------|---------------|-----------|
| CASHU_TOKEN SEND | CashuSendSwap | `cashu-send-swap.md` |
| CASHU_TOKEN RECEIVE | CashuReceiveSwap or CashuReceiveQuote (type: CASHU_TOKEN) | `cashu-receive-swap.md`, `cross-account-claim.md` |
| CASHU_LIGHTNING SEND | CashuSendQuote | `cashu-lightning-send.md` |
| CASHU_LIGHTNING RECEIVE | CashuReceiveQuote (type: LIGHTNING) | `cashu-lightning-receive.md` |
| SPARK_LIGHTNING SEND | SparkSendQuote | `spark-operations.md` |
| SPARK_LIGHTNING RECEIVE | SparkReceiveQuote | `spark-operations.md` |

Each Quote/Swap type has its own state machine documented in the reference file above. This file covers cross-cutting patterns shared by all entities.

## State Transition Principles

### Atomicity via SQL RPCs

All state transitions happen inside single SQL RPC functions. Each RPC:
1. Locks the entity row with `SELECT ... FOR UPDATE`
2. Validates the current state allows the transition
3. Updates all related tables atomically (entity + proofs + transaction + account counters)
4. Increments `version` on every updated row

This means a state transition either fully succeeds or fully rolls back — there's no partial state. Entity, transaction, and proof states always move together.

**RPC naming:** `{action}_{entity}` (e.g., `complete_cashu_send_quote`, `process_cashu_receive_quote_payment`)

### Idempotency

Every state transition is safe to retry. RPCs check for the target state first and return early if already reached:
- `complete_cashu_send_quote`: If quote is already PAID → returns it unchanged
- `mark_cashu_send_quote_as_pending`: If already PENDING or PAID → returns early
- `process_cashu_receive_quote_payment`: If already PAID or COMPLETED → returns early

Service methods mirror this: check state, return early if nothing to do.

### Crash Recovery

Operations are designed so that if the app crashes mid-flow, recovery can resume without data loss:

- **Accepting multiple source states:** `completeSendQuote()` accepts both UNPAID and PENDING, because if the app crashes after payment but before `markAsPending()`, the WebSocket PAID event can still complete the quote directly from UNPAID.
- **Decoupled initiation and status:** For Cashu sends, `initiateSend()` fires the melt and returns. The mint's WebSocket events separately drive `markAsPending()` and `completeSendQuote()`. These are independent — missing one doesn't block the other.
- **Melt tracking flags:** CashuReceiveQuote (CASHU_TOKEN type) has a `meltInitiated` boolean that tracks whether the melt was attempted. The Cashu protocol has no explicit "failed" state for melt quotes — a failed melt reverts to UNPAID. The flag disambiguates: `UNPAID + meltInitiated: false` means the melt was never triggered, while `UNPAID + meltInitiated: true` means it was attempted but failed.
- **Deterministic outputs:** Keyset counters are reserved atomically in the DB before generating blinded messages. If the app crashes after reserving but before minting, the same counter range produces the same outputs on retry (NUT-13).

### Optimistic Locking (Version Field)

Every Quote/Swap entity has a `version` field, incremented on every state change (Transaction does not have a version field). Used for:
- **DB-level:** RPCs increment version atomically with state changes
- **Client-level:** Cache updates only apply if the incoming version is higher than the cached one, preventing stale data from overwriting newer state

## Transaction States

**States:** DRAFT, PENDING, COMPLETED, FAILED, REVERSED

**Transitions:**
- DRAFT → PENDING → COMPLETED
- DRAFT → PENDING → FAILED
- PENDING → REVERSED (CASHU_TOKEN SEND only — no schema constraint; enforced because only `complete_cashu_receive_swap` SQL function writes REVERSED, and it only fires when a receive swap has a `reversed_transaction_id`. Only `CashuSendSwapService.reverse()` creates receive swaps with that field set.)

| State | Meaning |
|-------|---------|
| DRAFT | Payment not guaranteed — invoice may never be paid, or user hasn't confirmed |
| PENDING | Payment in-flight or guaranteed to be attempted |
| COMPLETED | Success (terminal) |
| FAILED | Error (terminal) |
| REVERSED | Cancelled before claim (terminal, CASHU_TOKEN SEND only — see transition note above) |

**Initial Transaction state by entity:**

| Entity | Transaction starts as | Why |
|--------|----------------------|-----|
| CashuSendQuote | PENDING | User committed to send |
| CashuSendSwap | PENDING | User committed to send |
| CashuReceiveQuote (LIGHTNING) | DRAFT | Invoice may never be paid |
| CashuReceiveQuote (CASHU_TOKEN) | PENDING | Receiver initiates melt (guaranteed) |
| CashuReceiveSwap | PENDING | Direct swap (guaranteed) |
| SparkSendQuote | DRAFT | User hasn't confirmed yet |
| SparkReceiveQuote (LIGHTNING) | DRAFT | Invoice may never be paid |
| SparkReceiveQuote (CASHU_TOKEN) | PENDING | Receiver initiates melt (guaranteed) |

**Terminal state mapping** (Quote/Swap → Transaction, atomic in same SQL RPC):

| Quote/Swap terminal | Transaction terminal |
|---------------------|---------------------|
| PAID / COMPLETED | COMPLETED |
| FAILED / EXPIRED | FAILED |
| REVERSED | REVERSED |

**Type file:** `app/features/transactions/transaction.ts`

## Proof States

Three states: `UNSPENT`, `RESERVED`, `SPENT`. Defined as `wallet.cashu_proof_state` enum.

**Transitions:**
- UNSPENT → RESERVED (proofs selected for send)
- RESERVED → SPENT (payment confirmed)
- RESERVED → UNSPENT (payment failed/expired — proofs released)

**Rules:**
- **Send operations** (quotes and swaps) reserve proofs on creation, preventing double-spend within the wallet
- **Completion** marks reserved proofs as SPENT and stores any change/new proofs as UNSPENT
- **Failure/expiry** releases reserved proofs back to UNSPENT
- **Receive operations** only create new UNSPENT proofs (no reservation needed)
- **Send swap specifics:** `commit_proofs_to_send` (DRAFT → PENDING) marks input proofs SPENT and creates `proofsToSend` as RESERVED. Completion marks those SPENT. Reversal creates a receive swap that claims `proofsToSend` back.

## Keyset Counters

Per NUT-13 (Deterministic Secrets — see `cashu-protocol` skill), each Cashu account tracks a `counter_k` per keyset in `account.details.keyset_counters`. Used as the starting index for deterministic derivation of `secret` and blinding factor `r` for each proof.

**Mechanism:** The SQL RPC atomically increments the counter and stores the **pre-increment value** in the entity. This ensures each operation gets a unique, non-overlapping index range — even under concurrency or crash recovery.

| Entity | When | Condition |
|--------|------|-----------|
| CashuSendQuote | Creation | Only if change outputs needed |
| CashuSendSwap | Creation | DRAFT path only (needs swap) |
| CashuReceiveSwap | Creation | Always |
| CashuReceiveQuote | Completion (UNPAID → PAID) | Always (not at creation) |

## State Monitoring

Quote/swap state transitions are driven by external events, not inline sequential calls.

**Cashu** — WebSocket subscriptions (NUT-17):
- Melt quote state changes: callbacks (`onUnpaid`, `onPending`, `onPaid`)
- Proof state changes (UNSPENT → SPENT): triggers send swap completion
- **Receive quotes only:** Polling fallback (10s interval) for mints that don't support `bolt11_mint_quote` WebSocket command
- `bolt11_melt_quote` and `proof_state` WebSocket commands are **required** for all mints. `bolt11_mint_quote` is **optional** — hence the receive-only polling fallback.

**Mint validation** (`app/features/shared/cashu.ts` → `app/lib/cashu/mint-validation.ts`):
- `cashuMintValidator` is built via `buildMintValidator()` with app-specific requirements
- **Required NUTs:** 4, 5, 7, 8, 9, 10, 11, 12, 17, 20
- **Required WebSocket commands** (NUT-17): `bolt11_melt_quote`, `proof_state` — overrides the library default which also includes `bolt11_mint_quote`
- **Blocklist:** Loaded from `VITE_CASHU_MINT_BLOCKLIST` env var
- Validation runs in two scenarios:
  1. **Adding a mint** (`add-mint-form.tsx`): Runs as form field validation — blocks submission if the mint fails checks
  2. **Claiming a token from an unknown mint** (`receive-cashu-token-service.ts` → `buildAccountForMint()`): Runs when no existing account matches the token's mint URL. If the mint is offline or fails validation, `canReceive` is set to `false` on the in-memory account object, which prevents it from being selected as the receive destination — so no account is persisted to the database. The claim either fails with "Token from this mint cannot be claimed" (no alternative accounts) or attempts a cross-account flow via the user's existing accounts (which will also fail at the melt step if the mint is unreachable)

**Spark** — Polling for both send and receive:
- Send: 1s fixed interval
- Receive: Adaptive interval (1s → 5s → 30s → 1min based on quote age)

See individual reference files for flow-specific monitoring details.

## Type Locations

| Type | File |
|------|------|
| CashuSendQuote | `app/features/send/cashu-send-quote.ts` |
| CashuReceiveQuote | `app/features/receive/cashu-receive-quote.ts` |
| SparkSendQuote | `app/features/send/spark-send-quote.ts` |
| SparkReceiveQuote | `app/features/receive/spark-receive-quote.ts` |
| CashuSendSwap | `app/features/send/cashu-send-swap.ts` |
| CashuReceiveSwap | `app/features/receive/cashu-receive-swap.ts` |
| Transaction | `app/features/transactions/transaction.ts` |
