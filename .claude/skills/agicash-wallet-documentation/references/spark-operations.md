# Spark Lightning Operations

Direct Lightning payments through Spark wallet (no ecash involved).

## Send (SparkSendQuote)

### Flow
```
1. Parse invoice, get fee estimate from Spark
2. Create quote (UNPAID)
3. User confirms → Call Spark SDK payLightningInvoice()
4. Poll for status → COMPLETED or FAILED
```

### State Machine
```
UNPAID → PENDING → COMPLETED (terminal)
    ↓        ↓
  FAILED   FAILED
```

**State-specific fields:**
- PENDING/COMPLETED: `sparkId`, `sparkTransferId`, `fee` (actual)
- COMPLETED: `paymentPreimage`
- FAILED: `failureReason` (sparkId/fee may be missing if failed before initiation)

### Key Fields
| Field | Description |
|-------|-------------|
| `amount` | Amount being sent (excludes fee) |
| `estimatedFee` | Fee estimate (used as `maxFeeSats` limit) |
| `fee` | Actual fee (PENDING/COMPLETED only, often less than estimate) |

## Receive (SparkReceiveQuote)

### Flow
```
1. Call Spark SDK to generate invoice
2. Share invoice with payer
3. Poll for payment → PAID
```

### State Machine (4 states only)
```
UNPAID → PAID (terminal)
    ↓
  EXPIRED / FAILED
```

**Important:** `PAID` is the terminal success state. NO separate `COMPLETED` state.

**State-specific fields:**
- PAID: `sparkTransferId`, `paymentPreimage`
- FAILED: `failureReason`

### Type Variants
- `LIGHTNING` - Standard receive (totalFee = 0)
- `CASHU_TOKEN` - Receive Cashu token by melting it to pay the invoice
  - `tokenReceiveData`: `sourceMintUrl`, `tokenProofs`, `meltQuoteId`, fees

## Polling

Spark uses **polling** (not WebSockets) to check payment status:
- Send quotes: 1-second fixed interval
- Receive quotes: Adaptive (1s → 5s → 30s → 1min based on age)

## Key Differences from Cashu

| Aspect | Spark | Cashu |
|--------|-------|-------|
| Balance | Server-tracked | Client-tracked proofs |
| Privacy | Standard Lightning | Blind signatures |
| P2P | No | Yes (via tokens) |

## Files

```
app/features/send/
├── spark-send-quote.ts           # Type definition
├── spark-send-quote-service.ts
├── spark-send-quote-repository.ts
└── spark-send-quote-hooks.ts

app/features/receive/
├── spark-receive-quote.ts
├── spark-receive-quote-service.ts
├── spark-receive-quote-repository.ts
└── spark-receive-quote-hooks.ts
```
