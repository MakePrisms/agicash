# Spark Lightning Operations

Direct Lightning payments through Spark wallet (no ecash involved).

## Overview

Spark accounts provide direct Lightning Network access without Cashu mints:
- **Send**: Pay Lightning invoices directly from Spark balance
- **Receive**: Generate Lightning invoices paid directly to Spark balance

## Send Operations

### Entity: SparkSendQuote

**Type definition:** `app/features/send/spark-send-quote.ts`

Read this file for complete type and inline documentation.

### State Machine

```
┌─────────┐
│ UNPAID  │ Quote created
└────┬────┘
     │
     ▼
┌─────────┐
│ PENDING │ Payment initiated via Spark SDK
└────┬────┘
     │
     ├──────────────┐
     ▼              ▼
┌───────────┐  ┌─────────┐
│ COMPLETED │  │ FAILED  │
└───────────┘  └─────────┘
```

### Key Fields

- `sparkId` - ID in Spark system (available in PENDING/COMPLETED/FAILED)
- `sparkTransferId` - Transfer ID in Spark system
- `estimatedFee` - Fee estimate (UNPAID state)
- `fee` - Actual fee paid (PENDING/COMPLETED states)
- `paymentPreimage` - Proof of payment (COMPLETED only)
- `paymentRequestIsAmountless` - Whether invoice had no amount

### Flow

```
1. User initiates send
   ↓
2. Create quote (state: UNPAID)
   - Parse payment request
   - Get fee estimate from Spark
   ↓
3. User confirms
   ↓
4. Initiate payment (state: PENDING)
   - Call Spark SDK to pay invoice
   - Get sparkId and sparkTransferId
   - Get actual fee
   ↓
5. Monitor payment
   - Spark SDK provides status updates
   ↓
6. Settlement (state: COMPLETED or FAILED)
   - COMPLETED: Store preimage
   - FAILED: Store failureReason
```

### Files

```
app/features/send/
├── spark-send-quote.ts              # Type definition
├── spark-send-quote-hooks.ts        # TanStack Query hooks
├── spark-send-quote-service.ts      # Spark SDK integration
└── spark-send-quote-repository.ts   # Database access
```

### Transaction Details

**Type definition:** `app/features/transactions/transaction.ts`

Search for:
- `type: 'SPARK_LIGHTNING'`
- `direction: 'SEND'`
- `IncompleteSparkLightningSendTransactionDetails` (PENDING/FAILED)
- `CompletedSparkLightningSendTransactionDetails` (COMPLETED)

## Receive Operations

### Entity: SparkReceiveQuote

**Type definition:** `app/features/receive/spark-receive-quote.ts`

Read this file for complete type. Note the two variants:
- `type: 'LIGHTNING'` - Standard Lightning receive
- `type: 'CASHU_TOKEN'` - Receiving Cashu token into Spark account (melts token to pay invoice)

**For standard receives, focus on `type: 'LIGHTNING'` branch.**

### State Machine

```
┌─────────┐
│ UNPAID  │ Invoice created, awaiting payment
└────┬────┘
     │
     ├──────────────────┐
     ▼                  ▼
┌────────┐         ┌─────────┐
│  PAID  │         │ EXPIRED │
└────┬───┘         └─────────┘
     │
     ├──────────────┐
     ▼              ▼
┌───────────┐  ┌─────────┐
│ COMPLETED │  │ FAILED  │ (rare - payment received but processing failed)
└───────────┘  └─────────┘
```

### Key Fields

- `sparkId` - ID in Spark system
- `paymentRequest` - Lightning invoice to share
- `receiverIdentityPubkey` - Optional public key
- `sparkTransferId` - Transfer ID (PAID only)
- `paymentPreimage` - Proof of payment (PAID only)

### Flow

```
1. User initiates receive
   ↓
2. Create quote (state: UNPAID)
   - Call Spark SDK to generate invoice
   - Get sparkId and paymentRequest
   ↓
3. Share payment request
   - Display QR code / copy invoice
   ↓
4. Monitor for payment
   - Spark SDK provides payment notifications
   ↓
5. Payment received (state: PAID)
   - Store sparkTransferId and preimage
   - Balance automatically updated by Spark
```

### Files

```
app/features/receive/
├── spark-receive-quote.ts              # Type definition
├── spark-receive-quote-hooks.ts        # TanStack Query hooks
├── spark-receive-quote-service.ts      # Spark SDK integration
└── spark-receive-quote-repository.ts   # Database access
```

### Transaction Details

**Type definition:** `app/features/transactions/transaction.ts`

Search for:
- `type: 'SPARK_LIGHTNING'`
- `direction: 'RECEIVE'`
- `SparkLightningReceiveTransactionDetails` (DRAFT/PENDING/FAILED)
- `CompletedSparkLightningReceiveTransactionDetails` (COMPLETED)

## Spark SDK Integration

Spark operations use the `@buildonspark/spark-sdk` package.

Key concepts:
- Spark manages Lightning node infrastructure
- Balances tracked server-side by Spark
- SDK provides WebSocket for real-time updates
- Non-custodial - user controls keys

## Differences from Cashu Operations

| Aspect | Spark | Cashu |
|--------|-------|-------|
| Privacy | Standard Lightning | Blind signatures hide amounts |
| Custody | Non-custodial (user keys) | Non-custodial (user proofs) |
| Network | Lightning only | Lightning + peer-to-peer tokens |
| Fees | Lightning routing fees | Mint fees + Lightning fees |
| Balance | Server-tracked | Client-tracked proofs |
| Offline | Must be online | Can send/receive tokens offline |

## Common Patterns

### Spark Send

```typescript
const createQuote = useCreateSparkSendQuote();

await createQuote.mutateAsync({
  accountId: 'spark-account-123',
  paymentRequest: 'lnbc...',
  amount: Money.fromSats(1000), // Only for amountless invoices
});
```

### Spark Receive

```typescript
const createQuote = useCreateSparkReceiveQuote();

const quote = await createQuote.mutateAsync({
  accountId: 'spark-account-123',
  amount: Money.fromSats(1000),
});

// Returns quote with paymentRequest to share
```

## Error Handling

### Common Send Failures

1. **Insufficient balance** - Not enough funds in Spark account
2. **Routing failure** - Cannot find path to destination
3. **Invoice expired** - Payment took too long
4. **Network error** - Spark service unavailable

### Common Receive Failures

1. **Invoice expired** - Payer took too long
2. **Network error** - Spark service unavailable

## Critical Considerations

1. **No Proofs**: Spark doesn't use Cashu proofs - balance tracked by Spark service
2. **Real-time Updates**: Use Spark SDK WebSocket for payment notifications
3. **Fee Estimation**: `estimatedFee` may differ from actual `fee`
4. **Amountless Invoices**: User specifies amount for amountless payment requests
5. **Preimage Storage**: Always store `paymentPreimage` for proof of payment
6. **SDK Errors**: Handle Spark SDK errors gracefully with retries
