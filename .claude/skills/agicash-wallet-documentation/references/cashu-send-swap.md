# Cashu Token Send (Swap)

Create peer-to-peer ecash tokens for direct transfers.

## Flow

```
1. Select proofs from account
2. If exact amount: use proofs directly → PENDING
   If need change: create DRAFT with outputAmounts
3. DRAFT: Execute swap (POST /v1/swap) → get proofsToSend + change
4. Encode token (cashuB...) with proofsToSend → PENDING
5. Share token with recipient
6. Monitor proofs → COMPLETED when spent, or user reverses → REVERSED
```

## State Machine

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

**Key insight:** Goes directly to PENDING if `inputAmount == amountToSend` (no swap needed).

**State-specific fields:**
- DRAFT: `keysetId`, `keysetCounter`, `outputAmounts` (NO `proofsToSend`)
- PENDING/COMPLETED: `proofsToSend`, `tokenHash`
- FAILED: `failureReason`

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
