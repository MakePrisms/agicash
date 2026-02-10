# Spark Lightning Operations

Direct Lightning payments through Spark wallet (no ecash involved).

## Send (SparkSendQuote)

### Flow
```
1. Create quote
   a) Parse invoice, get fee estimate from Spark
   b) User confirms → createSendQuote()
      → SparkSendQuote in DB (UNPAID) + Transaction record (DRAFT)
2. Background task picks up UNPAID quote → calls initiateSend():
   → Spark SDK payLightningInvoice() → markAsPending() (sequential, not event-driven)
   → Quote becomes PENDING, sets sparkId/sparkTransferId
3. Poll for status (1s interval)
   → COMPLETED: paymentPreimage set
   → FAILED: failureReason set
```

### State Machine

**States:** UNPAID, PENDING, COMPLETED, FAILED

**Transitions:**
- UNPAID → PENDING (payLightningInvoice succeeds, sets sparkId)
- UNPAID → FAILED (payment initiation fails)
- PENDING → COMPLETED (payment confirmed, sets paymentPreimage)
- PENDING → FAILED (payment fails after initiation)

**State-specific fields:**
- PENDING/COMPLETED: `sparkId`, `sparkTransferId`, `fee` (actual)
- COMPLETED: `paymentPreimage`
- FAILED: `failureReason`, optional `sparkId`, `sparkTransferId`, `fee` (present if failed after initiation)

### Key Fields
| Field | Description |
|-------|-------------|
| `amount` | Amount being sent (excludes fee) |
| `estimatedFee` | Fee estimate (used as `maxFeeSats` limit) |
| `fee` | Actual fee (PENDING/COMPLETED only, often less than estimate) |

## Receive (SparkReceiveQuote)

### Flow
```
1. Create quote
   a) Call Spark SDK to generate invoice
   b) Create SparkReceiveQuote in DB (UNPAID) + Transaction record
      → LIGHTNING type: Transaction starts as DRAFT
      → CASHU_TOKEN type: Transaction starts as PENDING
2. Share invoice with payer
3. Poll for payment (adaptive interval based on quote age)
   → PAID: sparkTransferId and paymentPreimage set
```

### State Machine (4 states only)

**States:** UNPAID, EXPIRED, FAILED, PAID

**Transitions:**
- UNPAID → PAID (payment received)
- UNPAID → EXPIRED (quote past expiresAt)
- UNPAID → FAILED (monitoring fails)

Note: `PAID` is the terminal success state. NO separate `COMPLETED` state.

**State-specific fields:**
- PAID: `sparkTransferId`, `paymentPreimage`
- FAILED: `failureReason`

### Type Variants
- `LIGHTNING` - Standard receive (totalFee = 0)
- `CASHU_TOKEN` - Receive Cashu token by melting it to pay the invoice (see `references/cashu-receive-swap.md` → Cross-Account Lightning Payment)
  - `tokenReceiveData` contains `CashuTokenMeltData`:
    - `sourceMintUrl`, `tokenProofs`, `meltQuoteId`
    - `tokenAmount` (Money — original token value)
    - `meltInitiated` (boolean — idempotency flag)
    - `cashuReceiveFee`, `lightningFeeReserve` (required — known at quote creation)
    - `lightningFee` (optional — actual fee, set on melt completion)

## Polling

Spark uses **polling** for both send and receive status checks. The SDK exposes realtime events for receives but not sends; polling is used for both to keep the approach consistent.

- **Send quotes:** 1s fixed interval via `getLightningSendRequest()`
- **Receive quotes:** Adaptive interval based on quote age:
  - < 5 minutes → 1s
  - 5–10 minutes → 5s
  - 10 minutes–1 hour → 30s
  - > 1 hour → 1 minute

## Key Differences from Cashu

| Aspect | Spark | Cashu |
|--------|-------|-------|
| Balance | Server-tracked | Client-tracked proofs |
| Privacy | Standard Lightning | Blind signatures |
| P2P | No | Yes (via tokens) |
| Status monitoring | Polling | WebSocket (NUT-17) + polling fallback |

## Files

```
app/features/send/
├── spark-send-quote.ts           # Type definition
├── spark-send-quote-service.ts
├── spark-send-quote-repository.ts
└── spark-send-quote-hooks.ts

app/features/receive/
├── spark-receive-quote.ts
├── spark-receive-quote-core.ts              # Shared logic (getLightningQuote, expiry, fees)
├── spark-receive-quote-service.ts
├── spark-receive-quote-repository.ts
├── spark-receive-quote-hooks.ts
├── spark-receive-quote-service.server.ts    # Server-side (Lightning Address)
├── spark-receive-quote-repository.server.ts # Server-side (create-only, no decrypt)
└── cashu-token-melt-data.ts                 # CashuTokenMeltData schema (shared with CashuReceiveQuote)
```
