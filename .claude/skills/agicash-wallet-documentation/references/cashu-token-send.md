# Cashu Token Send

Create peer-to-peer ecash tokens for direct transfers.

## Overview

**Flow:** User → Cashu Account → Swap Proofs → Encoded Token → Share with Recipient

A Cashu token send operation creates a transferable ecash token by:
1. Selecting proofs from account to cover amount + fees
2. Swapping those proofs for new "sendable" proofs (if needed)
3. Encoding sendable proofs as a cashu token string
4. Recipient claims token to their account

## Entities Involved

### Primary: CashuSendSwap

**Type definition:** `app/features/send/cashu-send-swap.ts`

Read this file for the complete type with detailed inline comments explaining:
- The difference between DRAFT, PENDING, COMPLETED, REVERSED, and FAILED states
- When `inputProofs` vs `proofsToSend` are available
- How `outputAmounts` determine the swap outputs

**Key concept:** A swap is DRAFT when we've reserved `inputProofs` but haven't swapped yet. It becomes PENDING when `proofsToSend` exist and are encoded in a token.

### Supporting: Transaction

**Type definition:** `app/features/transactions/transaction.ts`

Look for:
- `type: 'CASHU_TOKEN'`
- `direction: 'SEND'`
- `details: CashuTokenSendTransactionDetails`

## State Machine

```
┌────────┐
│ DRAFT  │ Input proofs reserved, not swapped yet
└───┬────┘
    │
    ▼
┌─────────┐
│ PENDING │ Token created with proofsToSend
└────┬────┘
     │
     ├───────────────────┐
     ▼                   ▼
┌───────────┐      ┌──────────┐
│ COMPLETED │      │ REVERSED │ User cancelled before recipient claimed
└───────────┘      └──────────┘

     ▼ (if swap fails)
┌─────────┐
│ FAILED  │
└─────────┘
```

## Flow Diagram

```
1. User initiates send
   ↓
2. Create swap (state: DRAFT)
   - Select inputProofs from account
   - Calculate outputAmounts (send + change)
   - Store in database
   ↓
3. Execute swap
   - If exact amount: proofsToSend = inputProofs (no swap needed)
   - If need change: Call mint /v1/swap to get proofsToSend
   ↓
4. Encode token (state: PENDING)
   - Generate cashu token string with proofsToSend
   - Calculate tokenHash
   - Update swap state
   ↓
5. Share token with recipient
   - Display QR code / copy link
   ↓
6. Monitor for spending
   - Background service checks if proofsToSend are spent
   - State: COMPLETED when spent
   - State: REVERSED if user cancels (swap proofsToSend back)
```

## Key Fields Explained

### inputProofs vs proofsToSend

- **inputProofs**: Proofs taken from the user's account (always present)
- **proofsToSend**: New proofs to include in token (only in PENDING/COMPLETED states)

If `inputProofs` sum exactly equals `amountToSend`, then no swap is needed and `proofsToSend = inputProofs`.

Otherwise, swap `inputProofs` for exact `amountToSend` worth of `proofsToSend` plus change.

### Fee Structure

See `app/features/send/cashu-send-swap.ts` for:
- `cashuSendFee` - Fee for swapping inputProofs
- `cashuReceiveFee` - Fee for recipient to claim (included in token)
- `totalAmount` - Total deducted from account

The token includes extra proofs to cover `cashuReceiveFee` so recipient gets exact `amountRequested`.

### outputAmounts

When swapping is needed (DRAFT state):
- `outputAmounts.send` - Denominations for proofsToSend
- `outputAmounts.change` - Denominations for change back to account

These are used to generate deterministic blinded messages for the swap.

## File Structure

```
app/features/send/
├── cashu-send-swap.ts              # Type definitions
├── cashu-send-swap-hooks.ts        # TanStack Query hooks
├── cashu-send-swap-service.ts      # Business logic (swap execution)
├── cashu-send-swap-repository.ts   # Database access
└── proof-state-subscription-manager.ts  # Monitor proof spending
```

## Service Layer

**File:** `app/features/send/cashu-send-swap-service.ts`

Key functions:
- `createCashuSendSwap()` - Create swap in DRAFT state
- `executeSwap()` - Swap inputProofs for proofsToSend
- `encodeToken()` - Generate cashu token string
- `reverseSwap()` - Swap proofsToSend back to account (cancellation)

## Repository Layer

**File:** `app/features/send/cashu-send-swap-repository.ts`

Key functions:
- `insertCashuSendSwap()` - Create new swap
- `updateSwapState()` - Update state with optimistic locking
- `getSwapById()` - Fetch swap
- `getPendingSwaps()` - Get swaps awaiting completion

## Background Processing

**File:** `app/features/send/proof-state-subscription-manager.ts`

Monitors pending swaps:
- Checks if `proofsToSend` have been spent
- Updates state to COMPLETED when spent
- Handles stuck swaps

## Common Patterns

### Creating a Token Send

```typescript
const createSwap = useCreateCashuSendSwap();

const swap = await createSwap.mutateAsync({
  accountId: 'account-123',
  amountRequested: Money.fromSats(1000),
});

// Returns swap with encoded token string
```

### Reversing a Send

```typescript
const reverseSwap = useReverseCashuSendSwap();

await reverseSwap.mutateAsync({
  swapId: 'swap-123',
});

// Swaps proofsToSend back to account
// Only works if recipient hasn't claimed yet
```

## Error Handling

### Common Failures

1. **Insufficient balance**
   - Check balance before creating swap

2. **Swap operation failed**
   - State: FAILED
   - inputProofs returned to account

3. **Mint unavailable**
   - Retry swap operation
   - User can cancel to return inputProofs

4. **Token already claimed**
   - Cannot reverse (proofs spent)
   - State: COMPLETED

## Critical Considerations

1. **Optimistic Locking**: Check `version` before state updates
2. **Proof States**: Mark inputProofs as reserved when DRAFT created
3. **Deterministic Outputs**: Use keysetCounter for reproducible blinded messages
4. **Token Encoding**: Follow cashu token v3 format
5. **Reversal Window**: Can only reverse before recipient claims
6. **Fee Inclusion**: Token includes cashuReceiveFee for recipient
