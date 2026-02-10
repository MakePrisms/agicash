# Cashu Token Send (Swap)

Create peer-to-peer ecash tokens for direct transfers.

## Flow

```
1. Create swap
   a) Select proofs from account that cover the send amount
   b) Create CashuSendSwap in DB + Transaction record (PENDING)
      → Proofs marked as RESERVED
      → If selected proofs sum to exact send amount: no mint swap needed,
        swap starts as PENDING, tokenHash computed immediately
      → If selected proofs exceed send amount: mint swap needed to split
        into send + change, swap starts as DRAFT, keyset counter incremented
2. DRAFT path: Execute swap (POST /v1/swap)
   → Get proofsToSend + change proofs
   → Encode token (cashuB...) → PENDING
3. Share token with recipient
4. Monitor proofs → COMPLETED when spent, or user reverses → REVERSED
   → FAILED: release reserved proofs back to UNSPENT
```

## State Machine

**States:** DRAFT, PENDING, COMPLETED, FAILED, REVERSED

**Two creation paths:**
- `inputAmount == amountToSend` (no swap needed): created as PENDING
- `inputAmount != amountToSend` (swap needed): created as DRAFT

**Transitions:**
- DRAFT → PENDING (swap executed, proofsToSend created)
- DRAFT → FAILED (swap fails)
- PENDING → COMPLETED (recipient claimed — proofs spent)
- PENDING → REVERSED (sender cancelled before claim)

**State-specific fields:**
- DRAFT: `keysetId`, `keysetCounter`, `outputAmounts` (no `proofsToSend`)
- PENDING/COMPLETED: `proofsToSend`, `tokenHash`
- FAILED: `failureReason`
- REVERSED: no extra fields

## Key Fields

| Field | Description |
|-------|-------------|
| `inputProofs` | Proofs from account (always present) |
| `proofsToSend` | Proofs in token (PENDING/COMPLETED only) |
| `tokenHash` | SHA256 of encoded token |
| `amountReceived` | What recipient gets |
| `amountToSend` | `amountReceived` + `cashuReceiveFee` |
| `amountSpent` | `amountToSend` + `cashuSendFee` |
| `inputAmount` | Sum of inputProofs (may exceed amountSpent) |

## Fee Structure

```
cashuSendFee = fee for swap (zero if no swap needed)
cashuReceiveFee = fee for recipient to claim (included in token)
totalFee = cashuSendFee + cashuReceiveFee
change = inputAmount - amountSpent
```

## Reversal

User can reverse a PENDING swap if recipient hasn't claimed:
- Creates a CashuReceiveSwap from `proofsToSend`
- Returns proofs to account
- Swap transitions to REVERSED

## Service Methods

| Method | Transition | Description |
|--------|------------|-------------|
| `create()` | → DRAFT or PENDING | DRAFT if change needed, PENDING if exact |
| `swapForProofsToSend()` | DRAFT → PENDING | Execute swap, get proofsToSend |
| `complete()` | PENDING → COMPLETED | When proofs spent |
| `fail()` | DRAFT → FAILED | Release inputProofs |
| `reverse()` | PENDING → REVERSED | Create receive swap from proofsToSend |

## Files

```
app/features/send/
├── cashu-send-swap.ts           # Type definition
├── cashu-send-swap-service.ts   # Business logic
├── cashu-send-swap-repository.ts
├── cashu-send-swap-hooks.ts
└── proof-state-subscription-manager.ts  # Monitor proof spending
```
