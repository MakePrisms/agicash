# Core Entities

## Entity Relationships

```
Transaction (1) ←→ (1) Quote OR Swap (via transactionId)
```

| Transaction Type × Direction | Linked Entity |
|------------------------------|---------------|
| CASHU_TOKEN SEND | CashuSendSwap |
| CASHU_TOKEN RECEIVE | CashuReceiveSwap or CashuReceiveQuote (type: CASHU_TOKEN) |
| CASHU_LIGHTNING SEND | CashuSendQuote |
| CASHU_LIGHTNING RECEIVE | CashuReceiveQuote (type: LIGHTNING) |
| SPARK_LIGHTNING SEND | SparkSendQuote |
| SPARK_LIGHTNING RECEIVE | SparkReceiveQuote |

## Quote State Machines

### CashuSendQuote (Melt)
```
UNPAID → PENDING → PAID (terminal)
    ↓        ↓
  FAILED   FAILED
    ↓
  EXPIRED
```
- PAID: has `paymentPreimage`, `lightningFee`, `amountSpent`, `totalFee`
- FAILED: has `failureReason`
- EXPIRED: no extra fields (distinct from FAILED)

### CashuReceiveQuote (Mint)
```
UNPAID → PAID → COMPLETED (terminal)
    ↓       ↓
  FAILED  FAILED
    ↓
  EXPIRED
```
- PAID/COMPLETED: has `keysetId`, `keysetCounter`, `outputAmounts[]`
- FAILED: has `failureReason`
- Two types: `LIGHTNING` (standard) and `CASHU_TOKEN` (cross-mint bridge with `tokenReceiveData`)

### SparkSendQuote
```
UNPAID → PENDING → COMPLETED (terminal)
    ↓        ↓
  FAILED   FAILED
```
- PENDING/COMPLETED: has `sparkId`, `sparkTransferId`, `fee`
- COMPLETED: has `paymentPreimage`
- FAILED: has `failureReason`

### SparkReceiveQuote (4 states only)
```
UNPAID → PAID (terminal)
    ↓
  EXPIRED / FAILED
```
**Note:** `PAID` is the terminal success state. NO separate `COMPLETED` state.
- PAID: has `sparkTransferId`, `paymentPreimage`
- FAILED: has `failureReason`
- Two types: `LIGHTNING` (standard) and `CASHU_TOKEN` (melt token to pay invoice)

## Swap State Machines

### CashuSendSwap
```
         create()
             │
  ┌──────────┴──────────┐
  │                     │
(need change)     (exact amount)
  │                     │
  ▼                     │
DRAFT ──────────────────┼─→ PENDING → COMPLETED
  │                     │       │
  ▼                     │       ▼
FAILED ←────────────────┼── REVERSED
```
- Goes directly to PENDING if `inputAmount == amountToSend` (no swap needed)
- DRAFT: has `keysetId`, `keysetCounter`, `outputAmounts` but NO `proofsToSend`
- PENDING/COMPLETED: has `proofsToSend`, `tokenHash`
- REVERSED: user cancelled before recipient claimed

### CashuReceiveSwap (3 states only)
```
PENDING → COMPLETED
    ↓
  FAILED
```
- Created directly in PENDING state
- FAILED: has `failureReason`

## Transaction States

```
DRAFT → PENDING → COMPLETED
               ↓
            FAILED

PENDING → REVERSED (only CASHU_TOKEN SEND)
```

| State | Description |
|-------|-------------|
| DRAFT | Initial state for some flows |
| PENDING | Processing |
| COMPLETED | Success (terminal) |
| FAILED | Error (terminal) |
| REVERSED | Cancelled before claim (terminal, CASHU_TOKEN SEND only) |

**Type file:** `app/features/transactions/transaction.ts`

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
