# Cashu Lightning Receive

Receive Bitcoin via Lightning and mint Cashu ecash.

## Overview

**Flow:** Payer → Lightning Network → Mint → Cashu Account

A Cashu Lightning receive operation mints ecash by:
1. Creating a mint quote with the mint
2. Getting a Lightning invoice to share with payer
3. Payer pays the invoice
4. Mint receives payment and allows minting
5. Client mints ecash proofs and stores in account

## Entities Involved

### Primary: CashuReceiveQuote

**Type definition:** `app/features/receive/cashu-receive-quote.ts`

Read this file for:
- Complete type definition with all fields
- State-specific discriminated union branches
- Difference between `type: 'LIGHTNING'` and `type: 'CASHU_TOKEN'` variants

**For this flow, focus on the `type: 'LIGHTNING'` branch.**

### Supporting: Transaction

**Type definition:** `app/features/transactions/transaction.ts`

Look for:
- `type: 'CASHU_LIGHTNING'`
- `direction: 'RECEIVE'`
- `details: CashuLightningReceiveTransactionDetails`

## State Machine

```
┌─────────┐
│ UNPAID  │ Quote created, invoice shared, awaiting payment
└────┬────┘
     │
     ▼
┌────────┐
│  PAID  │ Invoice paid, minting in progress
└────┬───┘
     │
     ├──────────────────┐
     ▼                  ▼
┌───────────┐      ┌─────────┐
│ COMPLETED │      │ FAILED  │
└───────────┘      └─────────┘

     ▼ (timeout)
┌─────────┐
│ EXPIRED │
└─────────┘
```

## Flow Diagram

```
1. User initiates receive
   ↓
2. Create mint quote (state: UNPAID)
   - Call mint /v1/mint/quote/bolt11
   - Get quoteId and paymentRequest
   - Generate lockingDerivationPath for P2PK
   ↓
3. Share payment request
   - Display QR code / copy invoice
   - User shares with payer
   ↓
4. Poll for payment
   - Check mint for quote status
   - State: PAID when invoice settled
   ↓
5. Mint tokens (state: PAID → COMPLETED)
   - Generate blinded messages using outputAmounts
   - Call mint /v1/mint/bolt11
   - Store received proofs in account
   ↓
6. Update transaction (state: COMPLETED)
```

## Key Fields Explained

### quoteId

The mint's quote ID, used for:
- Checking payment status
- Minting tokens after payment

### lockingDerivationPath

BIP32 path for deriving keys to lock the minted proofs with P2PK (NUT-11).

Format: `m/129372'/0'/0'/{counter}` where last index is unhardened.

See field documentation in type file for details.

### outputAmounts

Only present in PAID/COMPLETED states.

Determines the denominations of minted proofs (e.g., [1, 2, 4, 8, 16, ...]).

Generated when payment is detected, before minting.

### mintingFee

Optional fee the mint charges to mint ecash.

If present, `paymentRequest` amount = `amount` + `mintingFee`.

## File Structure

```
app/features/receive/
├── cashu-receive-quote.ts              # Type definition
├── cashu-receive-quote-hooks.ts        # TanStack Query hooks
├── cashu-receive-quote-service.ts      # Quote & mint logic
└── cashu-receive-quote-repository.ts   # Database access
```

## Service Layer

**File:** `app/features/receive/cashu-receive-quote-service.ts`

Key functions:
- `createCashuReceiveQuote()` - Create mint quote
- `checkQuoteStatus()` - Poll for payment
- `mintTokens()` - Execute minting after payment
- `handlePaidQuote()` - Process paid quote

## Repository Layer

**File:** `app/features/receive/cashu-receive-quote-repository.ts`

Key functions:
- `insertCashuReceiveQuote()` - Create quote
- `updateQuoteState()` - Update with optimistic locking
- `getQuoteById()` - Fetch quote
- `getUnpaidQuotes()` - Get quotes awaiting payment

## Common Patterns

### Creating a Receive Quote

```typescript
const createQuote = useCreateCashuReceiveQuote();

const quote = await createQuote.mutateAsync({
  accountId: 'account-123',
  amount: Money.fromSats(1000),
  description: 'Payment for services',
});

// Returns quote with paymentRequest to share
```

### Polling for Payment

Background service:

```typescript
// Polls unpaid quotes
setInterval(async () => {
  const quotes = await getUnpaidQuotes();
  for (const quote of quotes) {
    await checkQuoteStatus(quote.id);
  }
}, 5000);
```

## Error Handling

### Common Failures

1. **Invoice expired**
   - State: EXPIRED
   - User creates new quote

2. **Minting failed**
   - State: FAILED
   - Funds may be stuck (mint received payment but minting failed)
   - Retry minting or contact mint support

3. **Mint unavailable**
   - Cannot create quote
   - Cannot check status
   - Retry later

4. **Invalid amount**
   - Below mint minimum
   - Above mint maximum

## Critical Considerations

1. **P2PK Locking**: Use lockingDerivationPath for proof locking
2. **Deterministic Secrets**: Use keysetCounter for reproducible blinded messages
3. **Polling Strategy**: Balance between responsiveness and mint load
4. **Fee Disclosure**: Show mintingFee to user if present
5. **Idempotency**: Check if already minted before minting
6. **Output Amounts**: Generate appropriate denominations for efficient spending
7. **Optimistic Locking**: Check version before updates
