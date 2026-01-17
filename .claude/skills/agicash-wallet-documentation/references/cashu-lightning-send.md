# Cashu Lightning Send

Pay a Lightning invoice by melting Cashu proofs.

## Overview

**Flow:** User → Cashu Account → Mint Melt → Lightning Payment

A Cashu Lightning send operation converts ecash proofs into a Lightning payment by:
1. Creating a melt quote with the mint
2. Selecting proofs to cover amount + fees
3. Melting proofs to pay the Lightning invoice
4. Receiving change if fee reserve exceeds actual fee

## Entities Involved

### Primary: CashuSendQuote

**Type definition:** `app/features/send/cashu-send-quote.ts`

This file contains the complete `CashuSendQuote` type with:
- All fields and their purposes (see inline comments)
- State-specific discriminated union branches
- State transitions: UNPAID → PENDING → PAID/EXPIRED/FAILED

**Key fields to understand:**
- `quoteId` - The mint's melt quote ID
- `proofs` - Cashu proofs being melted
- `lightningFeeReserve` vs actual fee paid
- `version` - For optimistic locking

### Supporting: Transaction

**Type definition:** `app/features/transactions/transaction.ts`

Look for the `Transaction` type branches where:
- `type: 'CASHU_LIGHTNING'`
- `direction: 'SEND'`

Two variants:
1. Incomplete (state: PENDING | FAILED) with `IncompleteCashuLightningSendTransactionDetails`
2. Completed (state: COMPLETED) with `CompletedCashuLightningSendTransactionDetails`

## State Machine

```
┌─────────┐
│ UNPAID  │ Initial state after quote creation
└────┬────┘
     │
     ▼
┌─────────┐
│ PENDING │ Melt initiated, waiting for settlement
└────┬────┘
     │
     ├──────────────┐
     ▼              ▼
┌─────────┐    ┌─────────┐
│  PAID   │    │ FAILED  │
└─────────┘    └─────────┘

     ▼ (timeout)
┌─────────┐
│ EXPIRED │
└─────────┘
```

## Transaction Details by State

**Type definitions:** `app/features/transactions/transaction.ts`

Search for:
- `IncompleteCashuLightningSendTransactionDetails` (PENDING/FAILED states)
- `CompletedCashuLightningSendTransactionDetails` (COMPLETED state)

**Key difference:** Completed details include `amountSpent`, `preimage`, `lightningFee`, and `totalFees` which are not available until payment settles.

## Flow Diagram

```
1. User initiates send
   ↓
2. Create quote (CashuSendQuote, state: UNPAID)
   - Call mint /v1/melt/quote/bolt11
   - Get quoteId and fee_reserve
   ↓
3. Select proofs
   - Find proofs >= amount + fee_reserve
   - Calculate cashu swap fee
   ↓
4. Create transaction (state: DRAFT)
   - Store quote + transaction
   ↓
5. User confirms
   ↓
6. Initiate melt (state: PENDING)
   - Call mint /v1/melt/bolt11
   - Send proofs + outputs for change
   ↓
7. Poll for settlement
   - Check mint for payment status
   ↓
8. Settlement (state: PAID)
   - Receive change proofs
   - Store preimage
   - Update transaction (state: COMPLETED)
```

## Key Fields Explained

### amountRequested vs amountToReceive

- **amountRequested**: User's input in account currency
- **amountToReceive**: Actual invoice amount (may differ due to exchange rate)

For amountless invoices:
- User specifies `amountRequested`
- Converted to msat using exchange rate
- `amountToReceive = amountRequested` (both in account currency)

For invoices with amount:
- Invoice amount is `amountToReceive`
- User doesn't specify amount
- `amountRequested = amountToReceive`

### Fee Structure

1. **cashuFee**: Mint's fee for melting proofs (from quote)
2. **lightningFeeReserve**: Max Lightning network fee (from quote)
3. **lightningFee**: Actual fee paid (COMPLETED state only)

Change calculation:
```
change = lightningFeeReserve - lightningFee
```

### Proof Selection

Algorithm:
1. Find proofs where sum >= amountToReceive + lightningFeeReserve + cashuFee
2. Generate deterministic change outputs
3. Store selected proofs in quote

File: `app/features/send/cashu-send-quote-service.ts`

## File Structure

```
app/features/send/
├── cashu-send-quote.ts              # Type definitions
├── cashu-send-quote-hooks.ts        # TanStack Query hooks
├── cashu-send-quote-service.ts      # Business logic
├── cashu-send-quote-repository.ts   # Database access
└── proof-state-subscription-manager.ts  # Real-time proof tracking
```

## Service Layer

**File:** `app/features/send/cashu-send-quote-service.ts`

Key functions:
- `createCashuSendQuote()` - Create melt quote with mint
- `payCashuSendQuote()` - Execute melt operation
- `checkCashuSendQuoteStatus()` - Poll for settlement
- `handleCompletedQuote()` - Process successful payment

## Repository Layer

**File:** `app/features/send/cashu-send-quote-repository.ts`

Key functions:
- `insertCashuSendQuote()` - Store new quote
- `updateCashuSendQuoteState()` - Update state with optimistic locking
- `getCashuSendQuote()` - Fetch quote by ID
- `getPendingCashuSendQuotes()` - Get quotes awaiting settlement

## Hooks Layer

**File:** `app/features/send/cashu-send-quote-hooks.ts`

Key hooks:
- `useCreateCashuSendQuote()` - Mutation to create quote
- `usePayCashuSendQuote()` - Mutation to initiate payment
- `useCashuSendQuote()` - Query quote by ID

## Common Patterns

### Creating a Send Quote

```typescript
const createMutation = useCreateCashuSendQuote();

await createMutation.mutateAsync({
  accountId: 'account-123',
  paymentRequest: 'lnbc...',
  amountRequested: Money.fromSats(1000),
});
```

### Paying a Quote

```typescript
const payMutation = usePayCashuSendQuote();

await payMutation.mutateAsync({
  quoteId: 'quote-123',
});
```

### Polling for Status

Background service polls pending quotes:

```typescript
// In proof-state-subscription-manager.ts
setInterval(() => {
  const pending = await getPendingCashuSendQuotes();
  for (const quote of pending) {
    await checkCashuSendQuoteStatus(quote.id);
  }
}, 5000);
```

## Error Handling

### Common Failures

1. **Insufficient balance**
   - State: Quote not created
   - Handling: Show error before quote creation

2. **Invoice expired**
   - State: FAILED or EXPIRED
   - Handling: Allow user to retry with new quote

3. **Payment routing failed**
   - State: FAILED
   - Reason stored in `failureReason`
   - Handling: Return reserved proofs to account

4. **Mint unavailable**
   - State: PENDING (stuck)
   - Handling: Retry polling, eventually timeout

## Critical Considerations

1. **Optimistic Locking**: Always check `version` before updates
2. **Proof States**: Mark proofs as pending when quote created
3. **Change Handling**: Store change proofs from successful melt
4. **Fee Reserve**: User pays max fee upfront, gets change back
5. **Idempotency**: Use `quoteId` to prevent duplicate melts
6. **Invoice Validation**: Verify invoice before quote creation
