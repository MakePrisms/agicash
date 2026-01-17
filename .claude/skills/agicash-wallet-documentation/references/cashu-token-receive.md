# Cashu Token Receive

Claim peer-to-peer ecash tokens into a Cashu account.

## Overview

**Flow:** Recipient receives token → Parse proofs → Swap into account → Balance updated

A Cashu token receive operation claims an external token by:
1. Parsing the cashu token string to extract proofs
2. Determining if token mint matches recipient's account mint
3. **Same mint**: Swap proofs directly into account (CashuTokenSwap)
4. **Different mint**: Melt token proofs → pay Lightning invoice → mint to account (CashuReceiveQuote)

## Two Paths

### Path 1: Same Mint (Direct Swap)

**Entity:** CashuTokenSwap

When token mint matches account mint, use direct swap.

**Type definition:** `app/features/receive/cashu-token-swap.ts`

Read this file for complete type including:
- How `tokenProofs` differ from received proofs
- Fee calculation (`feeAmount`)
- Output amount determination

### Path 2: Different Mint (Lightning Bridge)

**Entity:** CashuReceiveQuote (with `type: 'CASHU_TOKEN'`)

When token mint differs from account mint, bridge via Lightning.

**Type definition:** `app/features/receive/cashu-receive-quote.ts`

Read this file for:
- `CashuReceiveQuoteTokenReceiveData` type
- How `meltQuoteId` and `sourceMintUrl` are used
- Difference between LIGHTNING and CASHU_TOKEN types

## Path 1: Same Mint Direct Swap

### Entity: CashuTokenSwap

**File:** `app/features/receive/cashu-token-swap.ts`

### State Machine

```
┌─────────┐
│ PENDING │ Swap initiated, waiting for mint response
└────┬────┘
     │
     ├──────────────┐
     ▼              ▼
┌───────────┐  ┌─────────┐
│ COMPLETED │  │ FAILED  │
└───────────┘  └─────────┘
```

### Flow

```
1. User inputs token
   ↓
2. Parse token to extract proofs and mint URL
   ↓
3. Verify mint matches account mint
   ↓
4. Create swap (state: PENDING)
   - Store tokenProofs
   - Calculate outputAmounts (accounting for fees)
   - Generate blinded messages
   ↓
5. Call mint /v1/swap
   - Send tokenProofs
   - Receive new proofs for account
   ↓
6. Store proofs (state: COMPLETED)
   - Add to account balance
   - Update transaction
```

### File Structure

```
app/features/receive/
├── cashu-token-swap.ts              # Type definition
├── cashu-token-swap-hooks.ts        # TanStack Query hooks
├── cashu-token-swap-service.ts      # Swap execution
├── cashu-token-swap-repository.ts   # Database access
└── claim-cashu-token-service.ts     # Token parsing & routing
```

## Path 2: Different Mint (Lightning Bridge)

### Entity: CashuReceiveQuote

**File:** `app/features/receive/cashu-receive-quote.ts`

Look for the branch where `type: 'CASHU_TOKEN'` which includes `tokenReceiveData`.

### State Machine

Same as Lightning receive:
```
UNPAID → PAID → COMPLETED
       ↓
    FAILED
       ↓
    EXPIRED
```

### Flow

```
1. User inputs token from different mint
   ↓
2. Parse token to extract proofs and mint URL
   ↓
3. Verify mint differs from account mint
   ↓
4. Create melt quote on source mint
   - Get Lightning invoice
   - Store as CashuReceiveQuote with type: 'CASHU_TOKEN'
   ↓
5. Melt token proofs on source mint
   - Pay our Lightning invoice
   - Funds arrive via Lightning
   ↓
6. Mint proofs on destination mint (user's account mint)
   - State: COMPLETED
```

### Key Fields (tokenReceiveData)

See `CashuReceiveQuoteTokenReceiveData` in `app/features/receive/cashu-receive-quote.ts`:
- `sourceMintUrl` - Where token came from
- `tokenProofs` - Original proofs from token
- `meltQuoteId` - Quote ID on source mint
- `meltInitiated` - Whether melt started

## Token Parsing and Routing

**File:** `app/features/receive/claim-cashu-token-service.ts`

This service:
1. Decodes cashu token string
2. Extracts mint URL and proofs
3. Determines which path to use (same mint vs different mint)
4. Routes to appropriate handler

## Transaction Entity

**Type definition:** `app/features/transactions/transaction.ts`

Look for:
- `type: 'CASHU_TOKEN'`
- `direction: 'RECEIVE'`
- `details: CashuTokenReceiveTransactionDetails`

## Common Patterns

### Claiming a Token

```typescript
const claimToken = useClaimCashuToken();

await claimToken.mutateAsync({
  accountId: 'account-123',
  token: 'cashuAey...', // Encoded token string
});

// Service routes to swap or quote path automatically
```

## Error Handling

### Common Failures

1. **Token already claimed**
   - Proofs already spent
   - State: FAILED

2. **Invalid token**
   - Malformed token string
   - Invalid proofs

3. **Mint unavailable**
   - Cannot reach mint
   - Retry later

4. **Insufficient token amount**
   - Token doesn't cover fees
   - State: FAILED

## Critical Considerations

1. **Proof Validation**: Verify proofs before swapping
2. **Fee Handling**: Token sender should include fee coverage
3. **Mint Verification**: Check mint URL matches expected
4. **Idempotency**: Don't double-claim tokens (check tokenHash)
5. **Two Paths**: Different logic for same-mint vs cross-mint
6. **Background Processing**: Cross-mint claims happen async
